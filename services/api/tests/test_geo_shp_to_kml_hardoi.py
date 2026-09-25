"""scripts/geo/shp_to_kml.py --preset hardoi: the LDA Hardoi Road cadastre fields."""

from __future__ import annotations

import importlib.util
import struct
import sys
from pathlib import Path

import pytest

from app.icms.boundary_import import parse_kml

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "geo" / "shp_to_kml.py"
UTM_44N = (
    'PROJCS["WGS_1984_UTM_Zone_44N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
    'SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],'
    'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],'
    'PARAMETER["Central_Meridian",81.0],PARAMETER["Scale_Factor",0.9996],'
    'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]')
FIELDS = ("SECTOR", "PLOT_NO", "PLOT_AREA", "PLOT_SIZE", "DIMENTION", "AREA_PLOT", "AREA_20",
          "PROPERTY_T", "LAND_USE", "TENURE", "APPLICANT_")
ROWS = [
    ("SECTOR D BASANT KUNJ", "12", "112.5 Sqm", "", "", "9999", "9999",
     "D TYPE PLOT", "RESIDENTIAL", "ALLOTTED", "Invented Allottee"),
    ("SECTOR - H", "E-7", "", "3.0X8.5 M", "", "1", "1",
     "EWS/ E TYPE HOUSE", "RESIDENTIAL", "REGISTERED", ""),
    ("SECTOR-O", "44", "", "", "", "", "", "D TYPE PLOT", "COMMERCIAL", "", ""),
]
ORIGIN = (494000.0, 2980000.0)


@pytest.fixture(scope="module")
def tool():
    spec = importlib.util.spec_from_file_location("shp_to_kml_hardoi", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    yield module
    sys.modules.pop(spec.name, None)


def square(index: int) -> list[tuple[float, float]]:
    x, y = ORIGIN[0] + 30 * index, ORIGIN[1]
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
    shp = tmp_path / "HARDOI.shp"
    write_shp(shp)
    write_dbf(shp.with_suffix(".dbf"))
    shp.with_suffix(".prj").write_text(UTM_44N)
    return shp


def run(tool, shapefile: Path, *flags: str) -> tuple[bytes, object]:
    out = shapefile.with_name("out.kml")
    tool.main([str(shapefile), str(out), "--layer", "parcels", "--preset", "hardoi", *flags])
    body = out.read_bytes()
    return body, parse_kml(body, "out.kml")


@pytest.mark.parametrize("plot_area,plot_size,dimention,expected", [
    ("112.5 Sqm", "", "", "112.5"),
    ("112.5", "", "", "112.5"),
    ("1,250 SQM", "", "", "1250.0"),
    ("", "3.0X8.5 M", "", "25.5"),
    ("0", "3.0 x 8.5", "", "25.5"),
    ("", "", "9*12", "108.0"),
    ("", "irregular", "", ""),
    ("", "", "", ""),
])
def test_plot_area_parsing(tool, plot_area, plot_size, dimention, expected):
    assert tool.plot_area_sqm(plot_area, plot_size, dimention) == expected


@pytest.mark.parametrize("raw,key", [
    ("SECTOR D BASANT KUNJ", "SECTOR-D"),
    ("SECTOR - H", "SECTOR-H"),
    ("sector-o", "SECTOR-O"),
    ("CATTLE COLONY", "CATTLE COLONY"),
])
def test_sector_names_normalise_to_the_key_form(tool, raw, key):
    assert tool.hardoi_sector(raw) == key


def test_the_preset_maps_the_cadastre_into_importable_parcels(tool, shapefile):
    body, parsed = run(tool, shapefile)
    assert all(f.ok for f in parsed.features), [
        (f.index, f.reasons) for f in parsed.features if not f.ok]
    assert [f.key for f in parsed.layer("parcels")] == [
        "SECTOR-D#12", "SECTOR-H#E-7", "SECTOR-O#44"]
    first, house, bare = parsed.layer("parcels")
    assert first.values["sanctioned_area_sqm"] == 112.5
    assert house.values["sanctioned_area_sqm"] == 25.5
    assert bare.values.get("sanctioned_area_sqm") is None
    assert first.attributes["plot_type"] == "D TYPE PLOT"
    assert first.attributes["land_use"] == "RESIDENTIAL"
    assert first.attributes["tenure"] == "ALLOTTED"
    assert b"9999" not in body, "AREA_PLOT and AREA_20 are known-bad and never written"
    assert b"Invented Allottee" not in body and b"owner_name" not in body


def test_allottees_only_with_the_flag(tool, shapefile):
    _, parsed = run(tool, shapefile, "--with-pii")
    assert parsed.layer("parcels")[0].values["owner_name"] == "Invented Allottee"


def test_the_default_preset_is_still_the_sector_4_mapping(tool):
    assert tool.load_mapping(None) == tool.SCHEME_PLOT_MAPPING
    assert tool.load_mapping(None, "hardoi")["AREA_20"] is None


@pytest.mark.parametrize("plot_area,expected", [
    ("40x30", "1200.0"),
    ("40X30 Ft", "111.48"),
    ("1200 Sqft", "111.48"),
    ("100 sq yd", "83.61"),
    ("100 Sqyd", "83.61"),
    ("100 gaj", "83.61"),
    ("112,5", ""),
    ("", ""),
    ("   ", ""),
    ("112.5 Sqm", "112.5"),
    ("112.5 m2", "112.5"),
    ("112.5 Metres", "112.5"),
])
def test_plot_area_units_and_dimensions(tool, plot_area, expected):
    assert tool.plot_area_sqm(plot_area) == expected


@pytest.mark.parametrize("raw,key", [
    ("SECTOR D BASANT KUNJ", "SECTOR-D"),
    ("Cattle Colony", "CATTLE COLONY"),
    ("SECTOR 4", "SECTOR-4"),
    ("SECTOR-AB", "SECTOR-AB"),
])
def test_hardoi_sector_rules(tool, raw, key):
    assert tool.hardoi_sector(raw) == key


def record(tool, **fields):
    return tool.Record(1, dict(fields), None)


def test_sector_comes_from_layout_columns_in_priority_order(tool):
    mapping = tool.load_mapping(None, "hardoi")
    row = record(tool, SECTOR_NAM="SECTOR-O", PLDVSECTOR="SECTOR H", LAYOUT_NAM="",
                 LAYOUT_NA="SECTOR D BASANT KUNJ", PLOT_NO="1")
    assert tool.mapped(row, mapping, False, "hardoi", "SECTOR-X")["sector"] == "SECTOR-D"


def test_sector_falls_back_to_the_shapefile_stem(tool):
    mapping = tool.load_mapping(None, "hardoi")
    row = record(tool, PLOT_NO="1")
    assert tool.mapped(row, mapping, False, "hardoi", "SECTOR-J")["sector"] == "SECTOR-J"


def test_unmapped_personal_columns_need_the_pii_flag(tool):
    mapping = tool.load_mapping(None, "hardoi")
    row = record(tool, PLOT_NO="1", SECTOR_NAM="SECTOR-O", FATHER_NAM="Invented Father",
                 MOBILE_NO="9999999999", APPLICANT_="Invented Allottee")
    plain = tool.mapped(row, mapping, False, "hardoi", "")
    assert set(plain) == {"plot_no", "sector"}
    assert "Invented Father" not in plain.values() and "9999999999" not in plain.values()
    full = tool.mapped(row, mapping, True, "hardoi", "")
    assert full["father_nam"] == "Invented Father" and full["mobile_no"] == "9999999999"
    assert full["owner_name"] == "Invented Allottee"


def test_plot_type_follows_preset_order_not_column_order(tool):
    mapping = tool.load_mapping(None, "hardoi")
    both = record(tool, PLOT_TYPE="COMMERCIAL", PROPERTY_T="D TYPE PLOT", PLOT_NO="1")
    only = record(tool, PROPERTY_T="", PLOT_TYPE="COMMERCIAL", PLOT_NO="1")
    assert tool.mapped(both, mapping, False, "hardoi", "")["plot_type"] == "D TYPE PLOT"
    assert tool.mapped(only, mapping, False, "hardoi", "")["plot_type"] == "COMMERCIAL"


def test_sector4_keeps_its_column_order_rule(tool):
    mapping = {**tool.SCHEME_PLOT_MAPPING, "EXTRA": "plot_type"}
    row = record(tool, PRO_TYPE="FIRST", EXTRA="LAST", PLOT_NO="1")
    assert tool.mapped(row, mapping, False)["plot_type"] == "LAST"
