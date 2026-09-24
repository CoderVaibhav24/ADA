"""Load the authority's boundary KML into zones, villages, parcels and KML red zones.

The file format is docs/icms/kml-import-spec.md; why it is parsed this way is
docs/icms/kml-import.md. `parse_kml` is pure and needs no database; `run_import`
applies a parsed file in one transaction.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any

from ada_core.datetimes import now_ist
from ada_core.models import RESERVED_FEATURE_TYPES, RedZone
from ada_core.models_icms import BoundaryImport, Parcel, Village, Zone
from ada_core.validation import ULPIN, KhasraNo, LGDCode, normalise_text
from lxml import etree
from pydantic import TypeAdapter, ValidationError
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.validation import explain_validity, make_valid
from sqlalchemy import insert, select, text, update
from sqlalchemy.orm import Session

from .geo import geojson_value
from .schemas import ZoneCode

__all__ = [
    "FOLDERS",
    "MAX_FILE_BYTES",
    "Feature",
    "ImportResult",
    "KmlRejected",
    "ParsedFile",
    "parse_kml",
    "run_import",
    "parcel_key",
    "safe_filename",
    "sector_key",
]

KML_NAMESPACES = ("http://www.opengis.net/kml/2.2", "http://earth.google.com/kml/2.2")
FOLDERS = ("zones", "villages", "parcels", "reserved")
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_KMZ_UNCOMPRESSED = 200 * 1024 * 1024
# West, south, east, north. A point outside is almost always latitude,longitude swapped.
INDIA_BOUNDS = (68.0, 6.0, 98.0, 38.0)
# A self-intersection is repaired only when make_valid changes the area by less than this.
REPAIR_AREA_TOLERANCE = 0.005
# pg_advisory_xact_lock key: one boundary import at a time.
IMPORT_LOCK_KEY = 0x0ADA_B0DA_0000_0015

_GEOMETRY_TAGS = frozenset({
    "Polygon", "MultiGeometry", "Point", "LineString", "LinearRing", "Model", "Track",
    "MultiTrack",
})
_ZONE_CODE = TypeAdapter(ZoneCode)
_LGD = TypeAdapter(LGDCode)
_KHASRA = TypeAdapter(KhasraNo)
_ULPIN = TypeAdapter(ULPIN)
# A scheme plot number: "4/285", "CP-1", "NEW VISION SCHOOL".
PLOT_NO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 /.\-]{0,39}$")


class KmlRejected(ValueError):
    """The whole file is refused; nothing in it was looked at placemark by placemark."""


@dataclass
class Feature:
    folder: str
    index: int
    name: str | None
    attributes: dict[str, str]
    geometry: MultiPolygon | None = None
    key: str | None = None
    values: dict[str, Any] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.reasons and self.geometry is not None

    def geojson(self) -> dict:
        return json.loads(json.dumps(mapping(self.geometry)))

    def report(self, reasons: list[str]) -> dict:
        return {"folder": self.folder, "index": self.index, "name": self.name,
                "key": self.key, "reasons": list(reasons)}


@dataclass
class ParsedFile:
    features: list[Feature]
    folders: set[str]
    # Placemarks outside any of the four folders; reported, never loaded.
    stray: list[Feature]

    def layer(self, folder: str) -> list[Feature]:
        return [f for f in self.features if f.folder == folder]


@dataclass
class ImportResult:
    filename: str
    sha256: str
    dry_run: bool
    counts: dict[str, dict[str, int]] = field(default_factory=lambda: {
        name: {"inserted": 0, "updated": 0, "deactivated": 0, "rejected": 0}
        for name in FOLDERS})
    rejected: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    import_id: int | None = None

    def reject(self, feature: Feature) -> None:
        if feature.folder in self.counts:
            self.counts[feature.folder]["rejected"] += 1
        self.rejected.append(feature.report(feature.reasons))


# ---------------------------------------------------------------- parsing

def _local(tag: object) -> str:
    return etree.QName(tag).localname if isinstance(tag, str) else ""


def _unzip(data: bytes) -> bytes:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise KmlRejected("the .kmz is not a readable zip archive") from exc
    names = [i for i in archive.infolist() if i.filename.lower().endswith(".kml")]
    if not names:
        raise KmlRejected("the .kmz holds no .kml document")
    chosen = next((i for i in names if i.filename.lower() == "doc.kml"),
                  min(names, key=lambda i: (i.filename.count("/"), i.filename)))
    if chosen.file_size > MAX_KMZ_UNCOMPRESSED:
        raise KmlRejected(f"{chosen.filename} unpacks to more than "
                          f"{MAX_KMZ_UNCOMPRESSED // (1024 * 1024)} MB")
    with archive.open(chosen) as handle:
        body = handle.read(MAX_KMZ_UNCOMPRESSED + 1)
    if len(body) > MAX_KMZ_UNCOMPRESSED:
        raise KmlRejected(f"{chosen.filename} unpacks to more than the limit")
    return body


def _document(data: bytes, filename: str) -> etree._Element:
    if filename.lower().endswith(".kmz") or data[:4] == b"PK\x03\x04":
        data = _unzip(data)
    # No DTDs, no entities, no network: the file comes from outside.
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False,
                             huge_tree=False, remove_comments=True, remove_pis=True)
    try:
        root = etree.fromstring(data, parser)  # noqa: S320 - hardened parser above
    except etree.XMLSyntaxError as exc:
        raise KmlRejected(f"not well-formed XML: {exc}") from exc
    namespace = etree.QName(root).namespace
    if _local(root.tag) != "kml" or namespace not in KML_NAMESPACES:
        raise KmlRejected(
            f"the root element must be <kml xmlns=\"{KML_NAMESPACES[0]}\">; found "
            f"<{_local(root.tag) or root.tag}> in namespace {namespace or 'none'}. "
            "KML 2.2 is WGS 84 (EPSG:4326) by definition; any other version or a "
            "file with no namespace is refused rather than guessed at.")
    return root


def _child_text(element: etree._Element, local: str) -> str | None:
    for child in element:
        if _local(child.tag) == local:
            value = normalise_text(child.text or "")
            return value or None
    return None


def _folder_of(placemark: etree._Element) -> tuple[str | None, str | None]:
    nearest = None
    for ancestor in placemark.iterancestors():
        if _local(ancestor.tag) != "Folder":
            continue
        name = (_child_text(ancestor, "name") or "").strip()
        if nearest is None:
            nearest = name
        if name.lower() in FOLDERS:
            return name.lower(), nearest
    return None, nearest


def _attributes(placemark: etree._Element) -> dict[str, str]:
    found: dict[str, str] = {}
    for extended in placemark:
        if _local(extended.tag) != "ExtendedData":
            continue
        for node in extended.iter():
            local = _local(node.tag)
            name = (node.get("name") or "").strip().lower()
            if local == "Data" and name:
                found[name] = _child_text(node, "value") or ""
            elif local == "SimpleData" and name:
                found[name] = normalise_text(node.text or "")
    return found


def _ring(element: etree._Element, feature: Feature) -> list[tuple[float, float]] | None:
    raw = None
    for node in element.iter():
        if _local(node.tag) == "coordinates":
            raw = node.text or ""
            break
    if raw is None or not raw.strip():
        feature.reasons.append("a ring has no <coordinates>")
        return None
    points: list[tuple[float, float]] = []
    for token in raw.split():
        parts = token.split(",")
        try:
            if len(parts) not in (2, 3):
                raise ValueError
            lon, lat = float(parts[0]), float(parts[1])
        except ValueError:
            feature.reasons.append(f"'{token[:40]}' is not longitude,latitude[,altitude]")
            return None
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            feature.reasons.append(f"{lon},{lat} is not a WGS 84 longitude,latitude")
            return None
        points.append((lon, lat))
    if points and points[0] != points[-1]:
        points.append(points[0])
        feature.warnings.append("a ring was not closed; its first point was repeated")
    if len(points) < 4:
        feature.reasons.append("a ring needs at least three distinct points")
        return None
    return points


def _polygon(element: etree._Element, feature: Feature) -> Polygon | None:
    outer, inners = None, []
    for child in element:
        local = _local(child.tag)
        if local == "outerBoundaryIs":
            outer = _ring(child, feature)
        elif local == "innerBoundaryIs":
            for ring in child:
                if _local(ring.tag) == "LinearRing":
                    hole = _ring(ring, feature)
                    if hole:
                        inners.append(hole)
    if outer is None:
        if not feature.reasons:
            feature.reasons.append("a Polygon has no outerBoundaryIs")
        return None
    return Polygon(outer, inners)


def _leaves(element: etree._Element) -> list[etree._Element]:
    if _local(element.tag) != "MultiGeometry":
        return [element]
    return [leaf for child in element if _local(child.tag) in _GEOMETRY_TAGS
            for leaf in _leaves(child)]


def _geometry(placemark: etree._Element, feature: Feature) -> MultiPolygon | None:
    tops = [child for child in placemark if _local(child.tag) in _GEOMETRY_TAGS]
    if not tops:
        feature.reasons.append("no geometry; a Polygon or MultiGeometry of Polygons is required")
        return None
    if len(tops) > 1:
        feature.reasons.append("more than one geometry; put one feature in each Placemark")
        return None
    leaves = _leaves(tops[0])
    wrong = sorted({_local(leaf.tag) for leaf in leaves} - {"Polygon"})
    if wrong or not leaves:
        feature.reasons.append(
            f"geometry is {', '.join(wrong) or 'empty'}; only Polygon or a "
            "MultiGeometry of Polygons is accepted")
        return None
    polygons = [_polygon(leaf, feature) for leaf in leaves]
    if feature.reasons:
        return None
    return _validated(MultiPolygon(polygons), feature)


def _polygonal(geometry: Any) -> MultiPolygon | None:
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])
    if isinstance(geometry, MultiPolygon):
        return geometry
    parts = [g for g in getattr(geometry, "geoms", ()) if isinstance(g, Polygon | MultiPolygon)]
    flat = [p for g in parts for p in (g.geoms if isinstance(g, MultiPolygon) else [g])]
    return MultiPolygon(flat) if flat else None


def _validated(geometry: MultiPolygon, feature: Feature) -> MultiPolygon | None:
    if not geometry.is_valid:
        problem = explain_validity(geometry)
        repaired = _polygonal(make_valid(geometry))
        # Signed-area cancellation makes a bow-tie's own area meaningless, so the
        # comparison is against the outer rings' footprint.
        footprint = sum(Polygon(p.exterior).area for p in geometry.geoms)
        if (repaired is None or repaired.is_empty or footprint == 0
                or abs(repaired.area - geometry.area) / footprint > REPAIR_AREA_TOLERANCE):
            feature.reasons.append(f"invalid geometry: {problem}")
            return None
        feature.warnings.append(f"geometry repaired: {problem}")
        geometry = repaired
    if geometry.is_empty or geometry.area == 0:
        feature.reasons.append("geometry has no area")
        return None
    west, south, east, north = geometry.bounds
    if (west < INDIA_BOUNDS[0] or south < INDIA_BOUNDS[1]
            or east > INDIA_BOUNDS[2] or north > INDIA_BOUNDS[3]):
        feature.reasons.append(
            "coordinates fall outside India; KML order is longitude,latitude")
        return None
    return geometry


def _check(adapter: TypeAdapter, value: str, label: str, feature: Feature) -> Any:
    try:
        return adapter.validate_python(value)
    except ValidationError:
        feature.reasons.append(f"{label} '{value[:40]}' is not valid")
        return None


def _required(feature: Feature, name: str) -> str | None:
    value = feature.attributes.get(name) or None
    if value is None:
        feature.reasons.append(f"missing required attribute {name}")
    return value


def _optional(feature: Feature, name: str) -> str | None:
    return feature.attributes.get(name) or None


def _zone_values(feature: Feature) -> None:
    code = _required(feature, "zone_cd")
    if code:
        feature.key = _check(_ZONE_CODE, code, "zone_cd", feature)
    feature.values = {"zone_cd": feature.key, "name": _optional(feature, "zone_name"),
                      "name_hi": _optional(feature, "zone_name_hi")}


def _village_values(feature: Feature) -> None:
    lgd = _required(feature, "village_lgd")
    if lgd:
        feature.key = _check(_LGD, lgd, "village_lgd", feature)
    district = _optional(feature, "district_lgd")
    feature.values = {
        "village_lgd": feature.key,
        "name": _optional(feature, "village_name") or feature.name,
        "name_hi": _optional(feature, "village_name_hi"),
        "tehsil": _optional(feature, "tehsil"),
        "district_lgd": _check(_LGD, district, "district_lgd", feature) if district else None,
    }


def sector_key(value: str) -> str:
    """The zone-code form of a sector name: "Sector 4" -> "SECTOR-4"."""
    return re.sub(r"\s+", "-", normalise_text(value)).upper()


def parcel_key(village_lgd: str | None, khasra_no: str | None, sector: str | None,
               plot_no: str | None) -> str | None:
    """`lgd/khasra` for a revenue parcel, `SECTOR#plot` for a scheme plot."""
    if village_lgd and khasra_no:
        return f"{village_lgd}/{khasra_no}"
    if sector and plot_no:
        return f"{sector}#{plot_no}"
    return None


def _number(feature: Feature, name: str) -> float | None:
    raw = _optional(feature, name)
    if not raw:
        return None
    try:
        value = round(float(raw.replace(",", "")), 2)
        if value < 0 or value != value:
            raise ValueError
    except ValueError:
        feature.reasons.append(f"{name} '{raw[:40]}' is not a non-negative number")
        return None
    return value


def _scheme_key(feature: Feature, required: bool) -> tuple[str | None, str | None, str | None]:
    get = _required if required else _optional
    sector_name, plot = get(feature, "sector"), get(feature, "plot_no")
    sector = None
    if sector_name:
        sector = _check(_ZONE_CODE, sector_key(sector_name), "sector", feature)
    if plot and not PLOT_NO.fullmatch(plot):
        feature.reasons.append(f"plot_no '{plot[:40]}' is not valid")
        plot = None
    return sector, sector_name, plot


def _parcel_values(feature: Feature) -> None:
    has = feature.attributes.get
    revenue = bool(has("khasra_no") or has("village_lgd"))
    scheme = bool(has("sector") or has("plot_no"))
    khasra = lgd = None
    if revenue or not scheme:
        khasra, lgd = _required(feature, "khasra_no"), _required(feature, "village_lgd")
        khasra = _check(_KHASRA, khasra, "khasra_no", feature) if khasra else None
        lgd = _check(_LGD, lgd, "village_lgd", feature) if lgd else None
    sector, sector_name, plot = _scheme_key(feature, required=scheme and not revenue)
    ulpin = _optional(feature, "ulpin")
    feature.key = parcel_key(lgd, khasra, sector, plot)
    feature.values = {
        "village_lgd": lgd, "khasra_no": khasra,
        "sector": sector, "sector_name": sector_name, "plot_no": plot,
        "ulpin": _check(_ULPIN, ulpin, "ulpin", feature) if ulpin else None,
        "land_use": _optional(feature, "land_use"),
        "plot_type": _optional(feature, "plot_type"),
        "tenure": _optional(feature, "tenure"),
        "registration_no": _optional(feature, "registration_no"),
        "owner_name": _optional(feature, "owner_name"),
        "area_sqm": _number(feature, "area_sqm"),
        "sanctioned_area_sqm": _number(feature, "sanctioned_area_sqm"),
    }


def _reserved_values(feature: Feature) -> None:
    kind = (_required(feature, "feature_type") or "").lower()
    if kind and kind not in RESERVED_FEATURE_TYPES:
        feature.reasons.append(
            f"feature_type '{kind[:40]}' is not one of {', '.join(RESERVED_FEATURE_TYPES)}")
    name = _optional(feature, "name") or feature.name
    ref = _optional(feature, "source_ref")
    if kind and not (ref or name):
        feature.reasons.append("a reserved feature needs a source_ref or a name to be keyed by")
    if kind and (ref or name):
        feature.key = f"{kind}:{ref or name}"[:300]
    feature.values = {"feature_type": kind or None, "name": (name or f"Reserved {kind}")[:200],
                      "source_ref": ref}


_VALUES = {"zones": _zone_values, "villages": _village_values,
           "parcels": _parcel_values, "reserved": _reserved_values}


def parse_kml(data: bytes, filename: str = "boundaries.kml") -> ParsedFile:
    """Every placemark, with its attributes, geometry and the reasons it cannot be loaded."""
    root = _document(data, filename)
    features: list[Feature] = []
    stray: list[Feature] = []
    folders: set[str] = set()
    seen: dict[tuple[str, str], int] = {}
    position: dict[str, int] = {}
    for placemark in root.iter(f"{{{etree.QName(root).namespace}}}Placemark"):
        folder, nearest = _folder_of(placemark)
        bucket = folder or (nearest or "(no folder)")
        position[bucket] = position.get(bucket, 0) + 1
        feature = Feature(folder=bucket, index=position[bucket],
                          name=_child_text(placemark, "name"),
                          attributes=_attributes(placemark))
        if folder is None:
            feature.reasons.append(
                f"placemark is in folder '{nearest}', not one of {', '.join(FOLDERS)}"
                if nearest else f"placemark is in no folder; use one of {', '.join(FOLDERS)}")
            stray.append(feature)
            continue
        folders.add(folder)
        _VALUES[folder](feature)
        feature.geometry = _geometry(placemark, feature)
        if feature.key is not None:
            first = seen.setdefault((folder, feature.key), feature.index)
            if first != feature.index:
                feature.reasons.append(
                    f"duplicate key {feature.key}; placemark {first} in {folder} has it too")
        features.append(feature)
    if not features and not stray:
        raise KmlRejected("the file contains no Placemark")
    return ParsedFile(features=features, folders=folders, stray=stray)


# ---------------------------------------------------------------- applying

def _is_postgres(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def _keys_in_file(parsed: ParsedFile, folder: str) -> set[str]:
    return {f.key for f in parsed.layer(folder) if f.key is not None}


def _apply_zones(db: Session, parsed: ParsedFile, result: ImportResult, write: bool) -> None:
    counts = result.counts["zones"]
    existing = set(db.execute(select(Zone.zone_cd)).scalars())
    for feature in parsed.layer("zones"):
        if not feature.ok:
            result.reject(feature)
            continue
        values = {k: v for k, v in feature.values.items() if v is not None}
        values["geom"] = geojson_value(db, feature.geojson())
        if feature.key in existing:
            counts["updated"] += 1
            if write:
                values.pop("zone_cd")
                db.execute(update(Zone).where(Zone.zone_cd == feature.key)
                           .values(**values, updated_at=now_ist()))
        else:
            counts["inserted"] += 1
            if write:
                values.setdefault("name", feature.name or feature.key)
                db.execute(insert(Zone).values(**values))


def _apply_villages(db: Session, parsed: ParsedFile, result: ImportResult,
                    write: bool) -> set[str]:
    counts = result.counts["villages"]
    existing = dict(db.execute(select(Village.village_lgd, Village.active)).all())
    known = set(existing)
    for feature in parsed.layer("villages"):
        if not feature.ok:
            result.reject(feature)
            continue
        known.add(feature.key)
        values = {**feature.values, "geom": geojson_value(db, feature.geojson()),
                  "attributes": feature.attributes, "active": True}
        if feature.key in existing:
            counts["updated"] += 1
            if write:
                values.pop("village_lgd")
                db.execute(update(Village).where(Village.village_lgd == feature.key)
                           .values(**values, updated_at=now_ist()))
        else:
            counts["inserted"] += 1
            if write:
                db.execute(insert(Village).values(**values))
    if "villages" in parsed.folders:
        in_file = _keys_in_file(parsed, "villages")
        gone = sorted(k for k, active in existing.items() if active and k not in in_file)
        counts["deactivated"] += len(gone)
        if write and gone:
            db.execute(update(Village).where(Village.village_lgd.in_(gone))
                       .values(active=False, updated_at=now_ist()))
    return known


def _parcel_index(db: Session) -> tuple[dict[str, tuple[int, bool]], dict[str, int]]:
    """Existing parcels by their key, and by every key they could be matched on."""
    by_key: dict[str, tuple[int, bool]] = {}
    by_any: dict[str, int] = {}
    for pid, lgd, khasra, sector, plot, active in db.execute(
            select(Parcel.id, Parcel.village_lgd, Parcel.khasra_no, Parcel.sector,
                   Parcel.plot_no, Parcel.active)).all():
        by_key[parcel_key(lgd, khasra, sector, plot)] = (pid, active)
        for alias in (parcel_key(lgd, khasra, None, None), parcel_key(None, None, sector, plot)):
            if alias:
                by_any[alias] = pid
    return by_key, by_any


def _apply_parcels(db: Session, parsed: ParsedFile, result: ImportResult, write: bool,
                   villages: set[str]) -> None:
    counts = result.counts["parcels"]
    existing, aliases = _parcel_index(db)
    shapes = {f.key: f.geometry for f in parsed.layer("villages") if f.ok}
    matched: dict[int, int] = {}
    for feature in parsed.layer("parcels"):
        lgd = feature.values["village_lgd"]
        if feature.ok and lgd is not None and lgd not in villages:
            feature.reasons.append(
                f"village_lgd {lgd} is not a known village; include it in the villages folder")
        # A row is matched on either key, so a plot can move between revenue and scheme keys.
        v = feature.values
        pid = next((aliases[k] for k in (feature.key, parcel_key(lgd, v["khasra_no"], None, None),
                                         parcel_key(None, None, v["sector"], v["plot_no"]))
                    if k in aliases), None)
        if feature.ok and pid in matched:
            feature.reasons.append(
                f"parcel {feature.key} is the same stored parcel as placemark {matched[pid]}")
        if not feature.ok:
            result.reject(feature)
            continue
        village = shapes.get(lgd)
        if village is not None and not village.buffer(1e-7).covers(feature.geometry):
            feature.warnings.append(f"parcel is not wholly inside village {lgd}")
        values = {**feature.values, "geom": geojson_value(db, feature.geojson()),
                  "attributes": feature.attributes, "active": True}
        if pid is not None:
            matched[pid] = feature.index
            counts["updated"] += 1
            if write:
                db.execute(update(Parcel).where(Parcel.id == pid)
                           .values(**values, updated_at=now_ist()))
        else:
            counts["inserted"] += 1
            if write:
                db.execute(insert(Parcel).values(**values))
    if "parcels" in parsed.folders:
        in_file = _keys_in_file(parsed, "parcels")
        gone = sorted(pid for key, (pid, active) in existing.items()
                      if active and key not in in_file and pid not in matched)
        counts["deactivated"] += len(gone)
        if write and gone:
            db.execute(update(Parcel).where(Parcel.id.in_(gone))
                       .values(active=False, updated_at=now_ist()))


def _apply_reserved(db: Session, parsed: ParsedFile, result: ImportResult,
                    write: bool) -> None:
    counts = result.counts["reserved"]
    existing = {key: (rid, active) for rid, key, active in db.execute(
        select(RedZone.id, RedZone.import_key, RedZone.active)
        .where(RedZone.source == "kml")).all()}
    for feature in parsed.layer("reserved"):
        if not feature.ok:
            result.reject(feature)
            continue
        values = {**feature.values, "geometry": feature.geojson(), "source": "kml",
                  "import_key": feature.key, "attributes": feature.attributes,
                  "active": True, "project_id": None}
        if feature.key in existing:
            counts["updated"] += 1
            if write:
                db.execute(update(RedZone).where(RedZone.id == existing[feature.key][0])
                           .values(**values))
        else:
            counts["inserted"] += 1
            if write:
                db.execute(insert(RedZone).values(**values, created_at=now_ist()))
    if "reserved" in parsed.folders:
        in_file = _keys_in_file(parsed, "reserved")
        gone = sorted(rid for key, (rid, active) in existing.items()
                      if active and key not in in_file)
        counts["deactivated"] += len(gone)
        if write and gone:
            db.execute(update(RedZone).where(RedZone.id.in_(gone)).values(active=False))


def run_import(db: Session, data: bytes, filename: str, *, actor: str,
               actor_name: str | None = None, dry_run: bool = False) -> ImportResult:
    """Parse, validate and upsert one file in one transaction; a dry run writes nothing."""
    parsed = parse_kml(data, filename)
    result = ImportResult(filename=filename, sha256=hashlib.sha256(data).hexdigest(),
                          dry_run=dry_run)
    write = not dry_run
    try:
        if write and _is_postgres(db):
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": IMPORT_LOCK_KEY})
        for feature in parsed.stray:
            result.rejected.append(feature.report(feature.reasons))
        _apply_zones(db, parsed, result, write)
        villages = _apply_villages(db, parsed, result, write)
        _apply_parcels(db, parsed, result, write, villages)
        _apply_reserved(db, parsed, result, write)
        result.warnings = [f.report(f.warnings) for f in parsed.features
                           if f.warnings and f.ok]
        if not write:
            db.rollback()
            return result
        result.import_id = db.execute(
            insert(BoundaryImport).values(
                filename=filename, sha256=result.sha256, imported_by=actor,
                imported_by_name=(actor_name or None) and actor_name[:200],
                imported_at=now_ist(), counts=result.counts)
            .returning(BoundaryImport.id)).scalar_one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return result


def safe_filename(name: str | None) -> str:
    base = re.split(r"[\\/]", name or "")[-1]
    return normalise_text(base)[:255] or "boundaries.kml"
