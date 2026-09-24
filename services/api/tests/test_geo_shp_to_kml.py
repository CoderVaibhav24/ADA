"""scripts/geo/shp_to_kml.py on a tiny shapefile the test writes, read back by the importer."""

from __future__ import annotations

import importlib.util
import struct
import sys
from pathlib import Path

import pytest
from pyproj import Transformer

from app.icms.boundary_import import parse_kml

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "geo" / "shp_to_kml.py"
UTM_44N = (
    'PROJCS["WGS_1984_UTM_Zone_44N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
    'SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],'
    'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],'
    'PARAMETER["Central_Meridian",81.0],PARAMETER["Scale_Factor",0.9996],'
    'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]')
FIELDS = ("PLOT_NO", "SECTOR_NAM", "CATEGORY", "PRO_AREA", "AREA_GIS", "APPLIC_NAM", "REMARK")
ROWS = [
    ("4/1", "SECTOR 9", "REGISTERED", "288 SQMT PLOT", "4.00000000000e+002", "Invented Owner", ""),
    ("NA", "SECTOR 9", "NO RECORD", "", "4.00000000000e+002", "", "no file"),
    ("PARK", "SECTOR 9", "PARK", "", "4.00000000000e+002", "", ""),
    ("CP-1", "SECTOR 9", "ALLOTTED", "PLOT 162 SQM", "4.00000000000e+002", "Another Owner", ""),
]
ORIGIN = (494000.0, 2980000.0)


@pytest.fixture(scope="module")
def tool():
    spec = importlib.util.spec_from_file_location("shp_to_kml", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    yield module
    sys.modules.pop(spec.name, None)


def square(index: int) -> list[tuple[float, float]]:
    x, y = ORIGIN[0] + 30 * index, ORIGIN[1]
    # Clockwise, as a shapefile writes an outer ring.
    return [(x, y), (x, y + 20), (x + 20, y + 20), (x + 20, y), (x, y)]


def write_dbf(path: Path) -> None:
    width = 40
    header = struct.pack("<BBBBIHH20x", 3, 126, 9, 24, len(ROWS), 32 + 32 * len(FIELDS) + 1,
                         1 + width * len(FIELDS))
    fields = b"".join(struct.pack("<11sc4xBB14x", name.encode(), b"C", width, 0)
                      for name in FIELDS)
    records = b"".join(b" " + b"".join(v.encode().ljust(width) for v in row) for row in ROWS)
    path.write_bytes(header + fields + b"\x0d" + records + b"\x1a")


def write_shp(path: Path) -> None:
    body = b""
    for number, _ in enumerate(ROWS, start=1):
        ring = square(number)
        xs, ys = [p[0] for p in ring], [p[1] for p in ring]
        content = struct.pack("<i4dii", 5, min(xs), min(ys), max(xs), max(ys), 1, len(ring))
        content += struct.pack("<i", 0) + b"".join(struct.pack("<2d", *p) for p in ring)
        body += struct.pack(">ii", number, len(content) // 2) + content
    header = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(body)) // 2)
    header += struct.pack("<ii8d", 1000, 5, *ORIGIN, *ORIGIN, 0, 0, 0, 0)
    path.write_bytes(header + body)


@pytest.fixture
def shapefile(tmp_path: Path) -> Path:
    shp = tmp_path / "SECTOR_9.shp"
    write_shp(shp)
    write_dbf(shp.with_suffix(".dbf"))
    shp.with_suffix(".prj").write_text(UTM_44N)
    shp.with_suffix(".cpg").write_text("UTF-8")
    return shp


def run(tool, shapefile: Path, *flags: str) -> tuple[bytes, object]:
    out = shapefile.with_name("out.kml")
    tool.main([str(shapefile), str(out), "--layer", "parcels", *flags])
    body = out.read_bytes()
    return body, parse_kml(body, "out.kml")


def test_scheme_plots_reserved_land_and_the_sector_zone(tool, shapefile):
    body, parsed = run(tool, shapefile, "--sector-zone")
    assert not parsed.stray and all(f.ok for f in parsed.features), [
        (f.folder, f.index, f.reasons) for f in parsed.features if not f.ok]
    assert [f.key for f in parsed.layer("parcels")] == [
        "SECTOR-9#4/1", "SECTOR-9#NA-2", "SECTOR-9#CP-1"]
    [park] = parsed.layer("reserved")
    assert park.key == "park:SECTOR-9/PARK/3" and park.values["name"] == "PARK (Sector 9)"
    [zone] = parsed.layer("zones")
    assert zone.values == {"zone_cd": "SECTOR-9", "name": "Sector 9", "name_hi": "सेक्टर 9"}
    assert all(zone.geometry.buffer(1e-7).covers(f.geometry) for f in parsed.features)
    plot, unnumbered, _ = parsed.layer("parcels")
    assert plot.values["sanctioned_area_sqm"] == 288.0 and plot.values["area_sqm"] == 400.0
    assert unnumbered.values["tenure"] == "NO RECORD"
    assert b"Invented Owner" not in body and b"Another Owner" not in body
    assert b"owner_name" not in body


def test_the_geometry_is_reprojected_from_the_prj(tool, shapefile):
    _, parsed = run(tool, shapefile)
    first = parsed.layer("parcels")[0].geometry
    x, y = square(1)[0]
    lon, lat = Transformer.from_crs("EPSG:32644", "EPSG:4326", always_xy=True).transform(x, y)
    west, south, *_ = first.bounds
    assert (round(west, 6), round(south, 6)) == (round(lon, 6), round(lat, 6))


def test_without_sector_zone_reserved_rows_are_skipped_not_written(tool, shapefile, capsys):
    _, parsed = run(tool, shapefile)
    assert parsed.folders == {"parcels"}
    assert len(parsed.layer("parcels")) == 3
    assert "PARK is reserved land" in capsys.readouterr().err


def test_owner_names_only_with_the_flag(tool, shapefile):
    _, parsed = run(tool, shapefile, "--with-pii")
    assert parsed.layer("parcels")[0].values["owner_name"] == "Invented Owner"


def test_the_mapping_is_merged_over_the_defaults(tool, shapefile):
    _, parsed = run(tool, shapefile, "--mapping", '{"REMARK": null, "CATEGORY": "status"}')
    unnumbered = parsed.layer("parcels")[1]
    assert "remark" not in unnumbered.attributes
    assert unnumbered.attributes["status"] == "NO RECORD"


def test_a_shapefile_without_a_prj_is_refused(tool, shapefile):
    shapefile.with_suffix(".prj").unlink()
    with pytest.raises(SystemExit, match="SECTOR_9.prj is missing"):
        run(tool, shapefile)
