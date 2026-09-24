"""Convert an ESRI shapefile into one folder of the boundary KML that docs/icms/kml-import-spec.md asks for.

Pure Python for the shapefile, pyproj for the reprojection, shapely for the geometry.
The CRS comes from the .prj beside the .shp; a shapefile without one is refused.
docs/icms/kml-import.md explains the field mapping and the scheme-plot rules.

    uv run python scripts/geo/shp_to_kml.py "SECTOR 4/SECTOR_4.shp" sector4.kml \\
        --layer parcels --sector-zone

Owner names (any field mapped to owner_name) are left out unless --with-pii is given.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

from pyproj import CRS, Transformer
from shapely import make_valid
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

LAYERS = ("zones", "villages", "parcels", "reserved")
PII = frozenset({"owner_name"})

# DBF field -> KML attribute for a development-scheme plot layer (ADA's SECTOR_n.shp).
SCHEME_PLOT_MAPPING: dict[str, str | None] = {
    "PLOT_NO": "plot_no",
    "SECTOR_NAM": "sector",
    "MY_STATU": "land_use",
    "PRO_TYPE": "plot_type",
    "CATEGORY": "tenure",
    "REGIS_NO": "registration_no",
    "PRO_AREA": "sanctioned_area_sqm",
    "AREA_GIS": "area_sqm",
    "APPLIC_NAM": "owner_name",
}

# plot_no or tenure values that are reserved land, not a plot, and their feature_type.
RESERVED_USES = {"PARK": "park", "ROAD": "road", "OPEN LAND": "other", "PUMP HOUSE": "other"}
UNNUMBERED = frozenset({"", "NA", "N/A", "NIL", "-"})
NUMBER = re.compile(r"\d+(?:\.\d+)?")


class Refused(SystemExit):
    def __init__(self, message: str) -> None:
        super().__init__(f"shp_to_kml: {message}")


@dataclass
class Record:
    index: int
    fields: dict[str, str]
    geometry: MultiPolygon | None


@dataclass
class Output:
    folders: dict[str, list[str]] = field(default_factory=lambda: {n: [] for n in LAYERS})
    skipped: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- reading

def read_dbf(path: Path, encoding: str) -> list[dict[str, str] | None]:
    """Every record as {FIELD: text}; a deleted record is None so indexes still match the .shp."""
    data = path.read_bytes()
    count, header, size = struct.unpack("<IHH", data[4:12])
    fields, offset = [], 32
    while data[offset] != 0x0D:
        name = data[offset:offset + 11].split(b"\0")[0].decode("latin-1")
        fields.append((name, data[offset + 16]))
        offset += 32
    rows: list[dict[str, str] | None] = []
    for number in range(count):
        record = data[header + number * size:header + (number + 1) * size]
        if record[:1] == b"*":
            rows.append(None)
            continue
        row, position = {}, 1
        for name, length in fields:
            row[name] = record[position:position + length].decode(encoding, "replace").strip()
            position += length
        rows.append(row)
    return rows


def read_shp(path: Path) -> list[list[list[tuple[float, float]]] | None]:
    """Each record's rings, or None for a null or non-polygon shape."""
    data = path.read_bytes()
    shapes: list[list[list[tuple[float, float]]] | None] = []
    offset = 100
    while offset + 8 <= len(data):
        length = struct.unpack(">i", data[offset + 4:offset + 8])[0] * 2
        body = data[offset + 8:offset + 8 + length]
        offset += 8 + length
        kind = struct.unpack("<i", body[:4])[0]
        if kind not in (5, 15, 25):
            shapes.append(None)
            continue
        parts_n, points_n = struct.unpack("<ii", body[36:44])
        parts = [*struct.unpack(f"<{parts_n}i", body[44:44 + 4 * parts_n]), points_n]
        start = 44 + 4 * parts_n
        flat = struct.unpack(f"<{2 * points_n}d", body[start:start + 16 * points_n])
        points = list(zip(flat[0::2], flat[1::2], strict=True))
        shapes.append([points[parts[i]:parts[i + 1]] for i in range(parts_n)])
    return shapes


def to_multipolygon(rings: list[list[tuple[float, float]]]) -> MultiPolygon | None:
    """Shapefile rings to shapely: clockwise rings are shells, the rest are holes."""
    shells, holes = [], []
    for ring in rings:
        if len(ring) < 4:
            continue
        (holes if Polygon(ring).exterior.is_ccw else shells).append(ring)
    if not shells:
        shells, holes = holes, []
    polygons = [Polygon(s, [h for h in holes if Polygon(s).contains(Polygon(h))]) for s in shells]
    geometry = make_valid(unary_union(polygons))
    members = getattr(geometry, "geoms", [geometry])
    parts = [g for g in members if isinstance(g, Polygon)]
    parts += [p for g in members if isinstance(g, MultiPolygon) for p in g.geoms]
    return MultiPolygon(parts) if parts else None


def read_layer(shp: Path) -> tuple[list[Record], Transformer]:
    prj = shp.with_suffix(".prj")
    dbf = shp.with_suffix(".dbf")
    if not prj.exists():
        raise Refused(f"{prj.name} is missing; the CRS cannot be guessed")
    if not dbf.exists():
        raise Refused(f"{dbf.name} is missing; the attributes are in it")
    crs = CRS.from_wkt(prj.read_text(encoding="latin-1"))
    cpg = shp.with_suffix(".cpg")
    encoding = cpg.read_text(encoding="latin-1").strip() if cpg.exists() else ""
    rows, shapes = read_dbf(dbf, encoding or "latin-1"), read_shp(shp)
    if len(rows) != len(shapes):
        raise Refused(f"{dbf.name} has {len(rows)} records and {shp.name} has {len(shapes)}")
    records = [Record(i, row, to_multipolygon(rings) if rings else None)
               for i, (row, rings) in enumerate(zip(rows, shapes, strict=True), start=1)
               if row is not None]
    return records, Transformer.from_crs(crs, "EPSG:4326", always_xy=True)


# ---------------------------------------------------------------- writing

def sector_key(value: str) -> str:
    return re.sub(r"\s+", "-", value.strip()).upper()


def leading_number(value: str) -> str:
    """ "288 SQMT PLOT" -> "288", "PLOT 162 SQM" -> "162", "4.6e+002" -> "460.0"."""
    try:
        return str(round(float(value), 2))
    except ValueError:
        found = NUMBER.search(value.replace(",", ""))
        return found.group(0) if found else ""


def coordinates(ring, to_wgs: Transformer) -> str:
    xs, ys = zip(*[(point[0], point[1]) for point in ring], strict=True)
    lons, lats = to_wgs.transform(xs, ys)
    return " ".join(f"{lon:.7f},{lat:.7f}" for lon, lat in zip(lons, lats, strict=True))


def kml_geometry(geometry: MultiPolygon, to_wgs: Transformer) -> str:
    polygons = []
    for polygon in geometry.geoms:
        holes = "".join(
            "<innerBoundaryIs><LinearRing><coordinates>"
            f"{coordinates(r.coords, to_wgs)}</coordinates></LinearRing></innerBoundaryIs>"
            for r in polygon.interiors)
        polygons.append(
            "<Polygon><outerBoundaryIs><LinearRing><coordinates>"
            f"{coordinates(polygon.exterior.coords, to_wgs)}</coordinates></LinearRing>"
            f"</outerBoundaryIs>{holes}</Polygon>")
    if len(polygons) == 1:
        return polygons[0]
    return f"<MultiGeometry>{''.join(polygons)}</MultiGeometry>"


def placemark(name: str, attributes: dict[str, str], geometry: MultiPolygon,
              to_wgs: Transformer) -> str:
    data = "".join(f"<Data name={quoteattr(k)}><value>{escape(v)}</value></Data>"
                   for k, v in attributes.items() if v != "")
    return (f"<Placemark><name>{escape(name)}</name><ExtendedData>{data}</ExtendedData>"
            f"{kml_geometry(geometry, to_wgs)}</Placemark>")


def mapped(record: Record, mapping: dict[str, str | None], with_pii: bool) -> dict[str, str]:
    attributes: dict[str, str] = {}
    for source, value in record.fields.items():
        target = mapping[source] if source in mapping else source.lower()
        if target is None or (target in PII and not with_pii):
            continue
        if target in ("sanctioned_area_sqm", "area_sqm"):
            value = leading_number(value)
        attributes[target] = value
    return attributes


def reserved_use(attributes: dict[str, str]) -> str | None:
    for name in ("plot_no", "tenure"):
        kind = RESERVED_USES.get(attributes.get(name, "").upper())
        if kind:
            return kind
    return None


def convert(shp: Path, layer: str, mapping: dict[str, str | None], *, with_pii: bool,
            sector_zone: bool) -> tuple[str, Output]:
    """The KML text for one shapefile, and what went in each folder."""
    records, to_wgs = read_layer(shp)
    out = Output()
    sectors: dict[str, tuple[str, list[MultiPolygon]]] = {}
    for record in records:
        if record.geometry is None:
            out.skipped.append(f"record {record.index}: no polygon")
            continue
        attributes = mapped(record, mapping, with_pii)
        sector = attributes.get("sector", "")
        if sector_zone and sector:
            sectors.setdefault(sector_key(sector), (sector, []))[1].append(record.geometry)
        if layer != "parcels":
            name = attributes.get("name") or attributes.get(f"{layer[:-1]}_name") or ""
            out.folders[layer].append(placemark(name or f"#{record.index}", attributes,
                                                record.geometry, to_wgs))
            continue
        plot = attributes.get("plot_no", "")
        kind = reserved_use(attributes)
        if kind:
            if not sector_zone:
                out.skipped.append(f"record {record.index}: {plot or kind} is reserved land; "
                                   "pass --sector-zone to write it to reserved/")
                continue
            label = f"{plot} ({sector.title()})" if sector else plot
            ref = (f"{sector_key(sector)}/{plot}/{record.index}" if sector
                   else f"{plot}/{record.index}")
            extra = {k: v for k, v in attributes.items() if k != "plot_no"}
            out.folders["reserved"].append(placemark(
                label, {"feature_type": kind, "name": label, "source_ref": ref, **extra},
                record.geometry, to_wgs))
            continue
        if plot.upper() in UNNUMBERED:
            attributes["plot_no"] = plot = f"NA-{record.index}"
            attributes["tenure"] = "NO RECORD"
        out.folders["parcels"].append(placemark(plot, attributes, record.geometry, to_wgs))
    for key, (display, shapes) in sorted(sectors.items()):
        hull = unary_union(shapes).convex_hull
        number = re.fullmatch(r"SECTOR-(\d+)", key)
        zone = {"zone_cd": key, "zone_name": display.title(),
                "zone_name_hi": f"सेक्टर {number.group(1)}" if number else ""}
        out.folders["zones"].append(placemark(key, zone, MultiPolygon([hull]), to_wgs))
    folders = "".join(f"<Folder><name>{name}</name>{''.join(items)}</Folder>"
                      for name, items in out.folders.items() if items)
    note = (f"Converted from {shp.name} by scripts/geo/shp_to_kml.py. "
            f"Owner names {'included' if with_pii else 'left out'}.")
    document = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
                f"<name>{escape(shp.stem)}</name><description>{escape(note)}</description>"
                f"{folders}</Document></kml>\n")
    return document, out


def load_mapping(raw: str | None) -> dict[str, str | None]:
    mapping = dict(SCHEME_PLOT_MAPPING)
    if raw is None:
        return mapping
    text = Path(raw).read_text(encoding="utf-8") if Path(raw).is_file() else raw
    extra = json.loads(text)
    if not isinstance(extra, dict):
        raise Refused("--mapping must be a JSON object of DBF field -> attribute (or null)")
    mapping.update(extra)
    return mapping


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("shp", type=Path, help="the .shp; its .dbf, .prj and .cpg sit beside it")
    parser.add_argument("out", type=Path, help="the .kml to write")
    parser.add_argument("--layer", choices=LAYERS, required=True,
                        help="the folder the records go in")
    parser.add_argument("--mapping", help="JSON object, or a file holding one: DBF field -> "
                                          "attribute name, null to drop; merged over the "
                                          "scheme-plot defaults")
    parser.add_argument("--with-pii", action="store_true",
                        help="keep owner_name; left out by default")
    parser.add_argument("--sector-zone", action="store_true",
                        help="also write one zone per sector (hull of its records) and put "
                             "parks, roads, open land and pump houses in reserved/")
    args = parser.parse_args(argv)
    document, out = convert(args.shp, args.layer, load_mapping(args.mapping),
                            with_pii=args.with_pii, sector_zone=args.sector_zone)
    args.out.write_text(document, encoding="utf-8")
    sizes = ", ".join(f"{name}={len(items)}" for name, items in out.folders.items() if items)
    print(f"wrote {args.out}: {sizes}; skipped={len(out.skipped)}; pii={args.with_pii}")
    for line in out.skipped:
        print(f"  skipped {line}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
