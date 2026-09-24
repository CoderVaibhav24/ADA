"""The authority's boundary KML: parsing, validation, the upsert, and the three routes.

The sample file is the fixture, so the file handed to the authority is the file
the importer is proven against.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from ada_core.models import RedZone
from ada_core.models_icms import BoundaryImport, Parcel, Village, Zone
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.icms.boundary_import import KmlRejected, parse_kml, run_import, sector_key
from tests.conftest import NODAL, SUPER_ADMIN, SURVEYOR

SAMPLE_PATH = Path(__file__).resolve().parents[3] / "data" / "samples" / \
    "agra-boundaries-sample.kml"
SAMPLE = SAMPLE_PATH.read_bytes()
KML_NS = "http://www.opengis.net/kml/2.2"
SQUARE = "78.00,27.00 78.01,27.00 78.01,27.01 78.00,27.01 78.00,27.00"

IMPORT = "/api/icms/admin/geo/import"
IMPORTS = "/api/icms/admin/geo/imports"
PARCEL = "/api/icms/geo/parcel"

# Inside parcel 900101/101, inside village 900101 only, inside zone LOHAMANDI only, nowhere.
IN_PARCEL = {"lat": 27.18325, "lon": 77.9723}
IN_VILLAGE = {"lat": 27.20, "lon": 77.99}
IN_ZONE = {"lat": 27.175, "lon": 77.965}
NOWHERE = {"lat": 27.5, "lon": 78.5}


def data(**fields: str) -> str:
    return "".join(f'<Data name="{k}"><value>{v}</value></Data>' for k, v in fields.items())


def placemark(fields: str, geometry: str | None = None, name: str = "P") -> str:
    geometry = geometry if geometry is not None else polygon(SQUARE)
    return (f"<Placemark><name>{name}</name><ExtendedData>{fields}</ExtendedData>"
            f"{geometry}</Placemark>")


def polygon(coordinates: str) -> str:
    return ("<Polygon><outerBoundaryIs><LinearRing><coordinates>"
            f"{coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon>")


def kml(*folders: tuple[str, list[str]], namespace: str = KML_NS, loose: str = "") -> bytes:
    body = "".join(f"<Folder><name>{n}</name>{''.join(p)}</Folder>" for n, p in folders)
    xmlns = f' xmlns="{namespace}"' if namespace else ""
    return (f'<?xml version="1.0" encoding="UTF-8"?><kml{xmlns}><Document>'
            f"{body}{loose}</Document></kml>").encode()


def only(parsed, folder: str):
    [feature] = parsed.layer(folder)
    return feature


VILLAGE = data(village_lgd="900999", village_name="Test Village")


# ------------------------------------------------------------------ parsing

class TestTheSampleFile:
    def test_it_is_marked_as_a_sample(self):
        text = SAMPLE.decode()
        assert "<name>SAMPLE" in text
        assert "SAMPLE ONLY" in text

    def test_every_placemark_loads(self):
        parsed = parse_kml(SAMPLE, "agra-boundaries-sample.kml")
        sizes = {folder: len(parsed.layer(folder)) for folder in parsed.folders}
        assert sizes == {"zones": 3, "villages": 4, "parcels": 8, "reserved": 3}
        assert not parsed.stray
        assert all(f.ok and not f.warnings for f in parsed.features), [
            (f.folder, f.index, f.reasons, f.warnings) for f in parsed.features if not f.ok]

    def test_every_attribute_is_extracted(self):
        parcel = parse_kml(SAMPLE).layer("parcels")[0]
        assert parcel.attributes == {
            "khasra_no": "101", "village_lgd": "900101", "ulpin": "09118900100001",
            "land_use": "residential", "owner_name": "SAMPLE Owner 1", "area_sqm": "3283.86",
        }
        assert parcel.key == "900101/101"
        assert parcel.values["area_sqm"] == 3283.86

    def test_hindi_names_survive(self):
        zone = parse_kml(SAMPLE).layer("zones")[2]
        assert zone.values == {"zone_cd": "TAJGANJ", "name": "Taj Ganj (sample)",
                               "name_hi": "ताजगंज (नमूना)"}

    def test_the_parcels_nest_in_the_villages_and_the_villages_in_the_zones(self):
        parsed = parse_kml(SAMPLE)
        zones = parsed.layer("zones")
        villages = {v.key: v for v in parsed.layer("villages")}
        for village in villages.values():
            assert any(z.geometry.covers(village.geometry) for z in zones), village.key
        for parcel in parsed.layer("parcels"):
            assert villages[parcel.values["village_lgd"]].geometry.covers(parcel.geometry)

    def test_the_multigeometry_parcel_is_two_polygons(self):
        parcel = parse_kml(SAMPLE).layer("parcels")[-1]
        assert len(parcel.geometry.geoms) == 2

    def test_a_kmz_reads_the_same(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("doc.kml", SAMPLE)
        parsed = parse_kml(buffer.getvalue(), "agra.kmz")
        assert len(parsed.features) == 18

    def test_the_generator_reproduces_the_file(self):
        import importlib.util

        script = Path(__file__).resolve().parents[3] / "scripts" / "geo" / "make_sample_kml.py"
        spec = importlib.util.spec_from_file_location("make_sample_kml", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        assert module.build().encode() == SAMPLE


class TestAttributes:
    def test_unknown_attributes_are_preserved(self):
        parsed = parse_kml(kml(("villages", [placemark(VILLAGE + data(survey_year="2024"))])))
        assert only(parsed, "villages").attributes["survey_year"] == "2024"

    def test_schema_data_is_read_like_data(self):
        fields = ('<SchemaData schemaUrl="#s"><SimpleData name="village_lgd">900998</SimpleData>'
                  '<SimpleData name="Tehsil">Etmadpur</SimpleData></SchemaData>')
        village = only(parse_kml(kml(("villages", [placemark(fields)]))), "villages")
        assert village.ok, village.reasons
        assert village.values["village_lgd"] == "900998"
        assert village.values["tehsil"] == "Etmadpur"

    def test_folder_names_are_case_insensitive_and_subfolders_count(self):
        body = kml(("Parcels", [
            f"<Folder><name>Village 900999</name>"
            f"{placemark(data(khasra_no='12', village_lgd='900999'))}</Folder>"]))
        assert only(parse_kml(body), "parcels").ok

    def test_the_placemark_name_stands_in_for_a_missing_village_name(self):
        body = kml(("villages", [placemark(data(village_lgd="900999"), name="Nagla")]))
        assert only(parse_kml(body), "villages").values["name"] == "Nagla"

    @pytest.mark.parametrize("folder,fields,missing", [
        ("zones", data(zone_name="No code"), "zone_cd"),
        ("villages", data(village_name="No code"), "village_lgd"),
        ("parcels", data(village_lgd="900999"), "khasra_no"),
        ("parcels", data(khasra_no="12"), "village_lgd"),
        ("reserved", data(name="Park"), "feature_type"),
    ])
    def test_a_missing_required_attribute_rejects_the_placemark(self, folder, fields, missing):
        feature = only(parse_kml(kml((folder, [placemark(fields)]))), folder)
        assert not feature.ok
        assert f"missing required attribute {missing}" in feature.reasons

    @pytest.mark.parametrize("folder,fields,word", [
        ("villages", data(village_lgd="12AB"), "village_lgd"),
        ("villages", data(village_lgd="1234567890123"), "village_lgd"),
        ("parcels", data(khasra_no="12", village_lgd="900999", ulpin="123"), "ulpin"),
        ("parcels", data(khasra_no="abc", village_lgd="900999"), "khasra_no"),
        ("parcels", data(khasra_no="12", village_lgd="900999", area_sqm="-4"), "area_sqm"),
        ("reserved", data(feature_type="temple", name="X"), "feature_type"),
        ("zones", data(zone_cd="has space"), "zone_cd"),
    ])
    def test_a_malformed_value_is_named(self, folder, fields, word):
        feature = only(parse_kml(kml((folder, [placemark(fields)]))), folder)
        assert not feature.ok
        assert any(word in reason for reason in feature.reasons), feature.reasons

    def test_a_duplicate_key_rejects_the_second(self):
        body = kml(("villages", [placemark(VILLAGE), placemark(VILLAGE)]))
        first, second = parse_kml(body).layer("villages")
        assert first.ok
        assert any("duplicate key 900999" in r for r in second.reasons)


PLOT = data(sector="SECTOR 4", plot_no="4/285")


class TestSchemePlots:
    def test_a_scheme_plot_is_keyed_by_sector_and_plot_number(self):
        fields = PLOT + data(plot_type="C TYPE PLOT", tenure="REGISTERED",
                             registration_no="2319435", sanctioned_area_sqm="288",
                             area_sqm="460.56")
        plot = only(parse_kml(kml(("parcels", [placemark(fields)]))), "parcels")
        assert plot.ok, plot.reasons
        assert plot.key == "SECTOR-4#4/285"
        assert plot.values.items() >= {
            "village_lgd": None, "khasra_no": None, "sector": "SECTOR-4",
            "sector_name": "SECTOR 4", "plot_no": "4/285", "plot_type": "C TYPE PLOT",
            "tenure": "REGISTERED", "registration_no": "2319435",
            "sanctioned_area_sqm": 288.0, "area_sqm": 460.56}.items()

    @pytest.mark.parametrize("raw,key", [("SECTOR 4", "SECTOR-4"), ("  Sector   12 ", "SECTOR-12"),
                                         ("sector-4", "SECTOR-4")])
    def test_the_sector_is_keyed_like_a_zone_code(self, raw, key):
        assert sector_key(raw) == key

    @pytest.mark.parametrize("plot_no", ["4/285", "4/349-A", "CP-1", "F-1", "NEW VISION SCHOOL",
                                         "EXTRA PLOT", "NA-143", "12.5"])
    def test_named_and_numbered_plots_are_accepted(self, plot_no):
        body = kml(("parcels", [placemark(data(sector="SECTOR 4", plot_no=plot_no))]))
        plot = only(parse_kml(body), "parcels")
        assert plot.ok, plot.reasons
        assert plot.key == f"SECTOR-4#{plot_no}"

    @pytest.mark.parametrize("plot_no", ["-1", "/4", "4#5", "PLOT_9", "X" * 41])
    def test_a_malformed_plot_number_is_named(self, plot_no):
        body = kml(("parcels", [placemark(data(sector="SECTOR 4", plot_no=plot_no))]))
        plot = only(parse_kml(body), "parcels")
        assert not plot.ok
        assert any(r.startswith("plot_no ") for r in plot.reasons), plot.reasons

    @pytest.mark.parametrize("fields,missing", [
        (data(sector="SECTOR 4"), "plot_no"),
        (data(plot_no="4/285"), "sector"),
    ])
    def test_half_a_scheme_key_is_rejected(self, fields, missing):
        plot = only(parse_kml(kml(("parcels", [placemark(fields)]))), "parcels")
        assert f"missing required attribute {missing}" in plot.reasons

    def test_a_parcel_with_no_key_at_all_asks_for_the_revenue_pair(self):
        plot = only(parse_kml(kml(("parcels", [placemark(data(land_use="x"))]))), "parcels")
        assert "missing required attribute khasra_no" in plot.reasons
        assert "missing required attribute village_lgd" in plot.reasons

    def test_both_keys_present_keys_by_village_and_khasra(self):
        fields = data(khasra_no="12", village_lgd="900999") + PLOT
        plot = only(parse_kml(kml(("parcels", [placemark(fields)]))), "parcels")
        assert plot.ok and plot.key == "900999/12"
        assert plot.values["plot_no"] == "4/285"

    def test_the_same_plot_twice_is_a_duplicate(self):
        body = kml(("parcels", [placemark(PLOT), placemark(data(sector="Sector  4",
                                                                  plot_no="4/285"))]))
        first, second = parse_kml(body).layer("parcels")
        assert first.ok
        assert any("duplicate key SECTOR-4#4/285" in r for r in second.reasons)

    def test_a_non_numeric_sanctioned_area_is_named(self):
        body = kml(("parcels", [placemark(PLOT + data(sanctioned_area_sqm="288 SQMT"))]))
        plot = only(parse_kml(body), "parcels")
        assert any("sanctioned_area_sqm" in r for r in plot.reasons)


class TestGeometry:
    @pytest.mark.parametrize("geometry,kind", [
        ("<Point><coordinates>78.0,27.0</coordinates></Point>", "Point"),
        (f"<LineString><coordinates>{SQUARE}</coordinates></LineString>", "LineString"),
        (f"<MultiGeometry>{polygon(SQUARE)}<Point><coordinates>78.0,27.0</coordinates>"
         "</Point></MultiGeometry>", "Point"),
    ])
    def test_a_non_polygon_is_rejected(self, geometry, kind):
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, geometry)]))), "villages")
        assert not feature.ok
        assert any(kind in r and "only Polygon" in r for r in feature.reasons), feature.reasons

    def test_no_geometry_is_rejected(self):
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, "")]))), "villages")
        assert any("no geometry" in r for r in feature.reasons)

    def test_a_bow_tie_is_rejected_not_repaired(self):
        bow_tie = polygon("78.00,27.00 78.01,27.01 78.01,27.00 78.00,27.01 78.00,27.00")
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, bow_tie)]))), "villages")
        assert not feature.ok
        assert any(r.startswith("invalid geometry: Self-intersection") for r in feature.reasons)

    def test_a_minor_ring_fault_is_repaired_with_a_warning(self):
        kinked = polygon("78.00,27.00 78.01,27.00 78.01,27.01 78.00001,27.01 "
                         "78.00,27.00999 78.00,27.01 78.00,27.00")
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, kinked)]))), "villages")
        assert feature.ok, feature.reasons
        assert feature.geometry.is_valid
        assert any(w.startswith("geometry repaired") for w in feature.warnings)

    def test_an_unclosed_ring_is_closed_with_a_warning(self):
        open_ring = polygon("78.00,27.00 78.01,27.00 78.01,27.01 78.00,27.01")
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, open_ring)]))), "villages")
        assert feature.ok
        assert any("not closed" in w for w in feature.warnings)

    def test_altitude_is_accepted_and_dropped(self):
        ring = polygon("78.00,27.00,0 78.01,27.00,0 78.01,27.01,0 78.00,27.01,0 78.00,27.00,0")
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, ring)]))), "villages")
        assert feature.ok and not feature.geometry.has_z

    def test_latitude_first_is_caught(self):
        swapped = polygon("27.00,78.00 27.01,78.00 27.01,78.01 27.00,78.01 27.00,78.00")
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, swapped)]))), "villages")
        assert any("longitude,latitude" in r for r in feature.reasons)

    def test_a_hole_is_kept(self):
        with_hole = ("<Polygon><outerBoundaryIs><LinearRing><coordinates>"
                     f"{SQUARE}</coordinates></LinearRing></outerBoundaryIs>"
                     "<innerBoundaryIs><LinearRing><coordinates>78.002,27.002 78.004,27.002 "
                     "78.004,27.004 78.002,27.004 78.002,27.002</coordinates></LinearRing>"
                     "</innerBoundaryIs></Polygon>")
        feature = only(parse_kml(kml(("villages", [placemark(VILLAGE, with_hole)]))), "villages")
        assert feature.ok
        assert len(feature.geometry.geoms[0].interiors) == 1


class TestTheFileItself:
    def test_an_unknown_folder_is_reported_per_placemark(self):
        parsed = parse_kml(kml(("wards", [placemark(VILLAGE)]), ("villages", [placemark(VILLAGE)])))
        [stray] = parsed.stray
        assert stray.folder == "wards"
        assert "not one of zones, villages, parcels, reserved" in stray.reasons[0]
        assert only(parsed, "villages").ok

    def test_a_placemark_in_no_folder_is_reported(self):
        parsed = parse_kml(kml(loose=placemark(VILLAGE)))
        assert "in no folder" in parsed.stray[0].reasons[0]

    @pytest.mark.parametrize("namespace", ["", "http://earth.google.com/kml/2.1",
                                           "http://www.opengis.net/kml/2.3"])
    def test_a_file_that_is_not_kml_2_2_is_refused_whole(self, namespace):
        with pytest.raises(KmlRejected, match="KML 2.2"):
            parse_kml(kml(("villages", [placemark(VILLAGE)]), namespace=namespace))

    def test_the_google_2_2_namespace_is_accepted(self):
        body = kml(("villages", [placemark(VILLAGE)]), namespace="http://earth.google.com/kml/2.2")
        assert only(parse_kml(body), "villages").ok

    @pytest.mark.parametrize("body", [b"not xml", b"<kml", b""])
    def test_something_that_is_not_xml_is_refused(self, body):
        with pytest.raises(KmlRejected):
            parse_kml(body)

    def test_an_empty_document_is_refused(self):
        with pytest.raises(KmlRejected, match="no Placemark"):
            parse_kml(kml())

    def test_a_kmz_with_no_kml_inside_is_refused(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("readme.txt", "nothing")
        with pytest.raises(KmlRejected, match="no .kml"):
            parse_kml(buffer.getvalue(), "x.kmz")

    def test_an_external_entity_is_never_resolved(self, tmp_path):
        secret = tmp_path / "secret.txt"
        secret.write_text("TOP-SECRET")
        body = (f'<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x SYSTEM "file://{secret}">]>'
                f'<kml xmlns="{KML_NS}"><Document><Folder><name>villages</name>'
                f'{placemark(data(village_lgd="900999", village_name="&x;"))}'
                "</Folder></Document></kml>").encode()
        try:
            parsed = parse_kml(body)
        except KmlRejected:
            return
        assert "TOP-SECRET" not in str(only(parsed, "villages").attributes)


# ------------------------------------------------------------------ importing

def counts(result, folder: str) -> tuple[int, int, int, int]:
    c = result.counts[folder]
    return c["inserted"], c["updated"], c["deactivated"], c["rejected"]


class TestTheImport:
    def test_the_sample_loads_every_layer(self, db):
        result = run_import(db, SAMPLE, "sample.kml", actor="tester")
        assert {f: counts(result, f) for f in result.counts} == {
            "zones": (3, 0, 0, 0), "villages": (4, 0, 0, 0),
            "parcels": (8, 0, 0, 0), "reserved": (3, 0, 0, 0)}
        assert result.rejected == [] and result.import_id is not None

        zone = db.execute(select(Zone).where(Zone.zone_cd == "TAJGANJ")).scalar_one()
        assert zone.name_hi == "ताजगंज (नमूना)" and zone.geom
        parcel = db.execute(select(Parcel).where(Parcel.khasra_no == "101")).scalar_one()
        assert parcel.attributes["owner_name"] == "SAMPLE Owner 1"
        assert float(parcel.area_sqm) == 3283.86
        red = db.execute(select(RedZone)).scalars().all()
        assert {(r.source, r.feature_type, r.project_id) for r in red} == {
            ("kml", "heritage", None), ("kml", "park", None), ("kml", "water", None)}
        assert red[0].geometry["type"] == "MultiPolygon"

        log = db.execute(select(BoundaryImport)).scalar_one()
        assert log.imported_by == "tester" and len(log.sha256) == 64
        assert log.counts["parcels"]["inserted"] == 8

    def test_a_second_import_of_the_same_file_updates_in_place(self, db):
        run_import(db, SAMPLE, "sample.kml", actor="tester")
        again = run_import(db, SAMPLE, "sample.kml", actor="tester")
        assert {f: counts(again, f) for f in again.counts} == {
            "zones": (0, 3, 0, 0), "villages": (0, 4, 0, 0),
            "parcels": (0, 8, 0, 0), "reserved": (0, 3, 0, 0)}
        assert len(db.execute(select(Parcel)).scalars().all()) == 8
        assert len(db.execute(select(BoundaryImport)).scalars().all()) == 2

    def test_a_feature_missing_from_the_next_file_is_deactivated_not_deleted(self, db):
        run_import(db, SAMPLE, "sample.kml", actor="tester")
        text = SAMPLE.decode()
        start = text.index("<Placemark>", text.index("<name>parcels</name>"))
        end = text.index("</Placemark>", start) + len("</Placemark>")
        result = run_import(db, (text[:start] + text[end:]).encode(), "v2.kml", actor="tester")
        assert counts(result, "parcels") == (0, 7, 1, 0)
        gone = db.execute(select(Parcel).where(Parcel.khasra_no == "101")).scalar_one()
        assert gone.active is False

        back = run_import(db, SAMPLE, "v3.kml", actor="tester")
        assert counts(back, "parcels") == (0, 8, 0, 0)
        db.refresh(gone)
        assert gone.active is True

    def test_a_folder_left_out_of_the_file_is_left_alone(self, db):
        run_import(db, SAMPLE, "sample.kml", actor="tester")
        result = run_import(db, kml(("villages", [placemark(VILLAGE)])), "v.kml", actor="t")
        assert counts(result, "villages") == (1, 0, 4, 0)
        assert counts(result, "parcels") == (0, 0, 0, 0)
        assert all(p.active for p in db.execute(select(Parcel)).scalars())

    def test_zones_are_upserted_and_never_deactivated(self, db, zones):
        body = kml(("zones", [placemark(data(zone_cd="TAJ"))]))
        result = run_import(db, body, "z.kml", actor="tester")
        assert counts(result, "zones") == (0, 1, 0, 0)
        db.expire_all()
        taj = db.execute(select(Zone).where(Zone.zone_cd == "TAJ")).scalar_one()
        assert taj.name == "Taj Ganj", "a file with no zone_name keeps the name on record"
        assert db.execute(select(Zone).where(Zone.zone_cd == "RURAL")).scalar_one().active

    def test_a_parcel_in_an_unknown_village_is_rejected(self, db):
        body = kml(("parcels", [placemark(data(khasra_no="12", village_lgd="123456"))]))
        result = run_import(db, body, "p.kml", actor="tester")
        assert counts(result, "parcels") == (0, 0, 0, 1)
        assert "not a known village" in result.rejected[0]["reasons"][0]

    def test_a_parcel_outside_its_village_is_loaded_with_a_warning(self, db):
        elsewhere = polygon("78.10,27.10 78.11,27.10 78.11,27.11 78.10,27.11 78.10,27.10")
        body = kml(("villages", [placemark(VILLAGE)]),
                   ("parcels", [placemark(data(khasra_no="7", village_lgd="900999"), elsewhere)]))
        result = run_import(db, body, "p.kml", actor="tester")
        assert counts(result, "parcels") == (1, 0, 0, 0)
        assert "not wholly inside village 900999" in result.warnings[0]["reasons"][0]

    def test_rejections_are_counted_and_the_rest_still_loads(self, db):
        body = kml(("villages", [placemark(VILLAGE), placemark(data(village_name="x"))]),
                   ("wards", [placemark(VILLAGE)]))
        result = run_import(db, body, "mixed.kml", actor="tester")
        assert counts(result, "villages") == (1, 0, 0, 1)
        assert [r["folder"] for r in result.rejected] == ["wards", "villages"]
        assert db.execute(select(Village)).scalar_one().village_lgd == "900999"

    def test_a_dry_run_counts_and_writes_nothing(self, db):
        result = run_import(db, SAMPLE, "sample.kml", actor="tester", dry_run=True)
        assert counts(result, "parcels") == (8, 0, 0, 0)
        assert result.import_id is None and result.dry_run is True
        for model in (Village, Parcel, BoundaryImport, RedZone):
            assert db.execute(select(model)).first() is None, model.__name__


class TestSchemePlotImport:
    def test_scheme_plots_load_without_a_village(self, db):
        body = kml(("parcels", [placemark(PLOT), placemark(data(sector="SECTOR 4",
                                                                  plot_no="CP-1"))]))
        result = run_import(db, body, "s4.kml", actor="tester")
        assert counts(result, "parcels") == (2, 0, 0, 0), result.rejected
        row = db.execute(select(Parcel).where(Parcel.plot_no == "CP-1")).scalar_one()
        assert (row.sector, row.sector_name, row.village_lgd, row.khasra_no) == (
            "SECTOR-4", "SECTOR 4", None, None)
        again = run_import(db, body, "s4.kml", actor="tester")
        assert counts(again, "parcels") == (0, 2, 0, 0)

    def test_moving_from_khasras_to_plots_deactivates_the_old_rows_without_deleting(self, db):
        run_import(db, SAMPLE, "sample.kml", actor="tester")
        result = run_import(db, kml(("parcels", [placemark(PLOT)])), "s4.kml", actor="tester")
        assert counts(result, "parcels") == (1, 0, 8, 0)
        rows = db.execute(select(Parcel)).scalars().all()
        assert len(rows) == 9
        assert [r.plot_no for r in rows if r.active] == ["4/285"]
        assert all(r.village_lgd for r in rows if not r.active)

    def test_a_plot_moving_from_a_khasra_key_to_a_plot_key_is_re_keyed_in_place(self, db):
        both = data(khasra_no="12", village_lgd="900999") + PLOT
        run_import(db, kml(("villages", [placemark(VILLAGE)]), ("parcels", [placemark(both)])),
                   "v1.kml", actor="tester")
        result = run_import(db, kml(("parcels", [placemark(PLOT)])), "v2.kml", actor="tester")
        assert counts(result, "parcels") == (0, 1, 0, 0)
        [row] = db.execute(select(Parcel)).scalars().all()
        assert (row.village_lgd, row.khasra_no, row.plot_no, row.active) == (
            None, None, "4/285", True)

    def test_two_placemarks_matching_one_stored_parcel_reject_the_second(self, db):
        both = data(khasra_no="12", village_lgd="900999") + PLOT
        run_import(db, kml(("villages", [placemark(VILLAGE)]), ("parcels", [placemark(both)])),
                   "v1.kml", actor="tester")
        body = kml(("parcels", [placemark(data(khasra_no="12", village_lgd="900999")),
                                placemark(PLOT)]))
        result = run_import(db, body, "v2.kml", actor="tester")
        assert counts(result, "parcels") == (0, 1, 0, 1)
        assert "same stored parcel as placemark 1" in result.rejected[0]["reasons"][0]

    def test_the_same_plot_cannot_be_stored_twice(self, db):
        db.add(Parcel(sector="SECTOR-4", plot_no="1", geom="{}"))
        db.commit()
        db.add(Parcel(sector="SECTOR-4", plot_no="1", geom="{}"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    def test_keyless_rows_on_the_other_index_do_not_collide(self, db):
        db.add_all([Parcel(sector="SECTOR-4", plot_no="1", geom="{}"),
                    Parcel(sector="SECTOR-4", plot_no="2", geom="{}")])
        db.commit()
        assert len(db.execute(select(Parcel)).scalars().all()) == 2

    def test_a_row_with_neither_key_is_refused_by_the_database(self, db):
        db.add(Parcel(sector="SECTOR-4", geom="{}"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


# ------------------------------------------------------------------ routes

def upload(client, body: bytes = SAMPLE, name: str = "agra.kml", **params):
    return client.post(IMPORT, params=params,
                       files={"file": (name, body, "application/vnd.google-earth.kml+xml")})


class TestTheRoutes:
    def test_import_then_look_up_a_parcel(self, icms_client, policy_tables):
        response = upload(icms_client.sign_in(SUPER_ADMIN))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["counts"]["parcels"] == {"inserted": 8, "updated": 0, "deactivated": 0,
                                             "rejected": 0}
        assert body["filename"] == "agra.kml" and body["import_id"] == 1

        found = icms_client.sign_in(NODAL).get(PARCEL, params=IN_PARCEL).json()
        assert found == {"zone_cd": "LOHAMANDI", "zone_name": "Lohamandi (sample)",
                         "village_lgd": "900101", "village_name": "Sample Village A",
                         "khasra_no": "101", "ulpin": "09118900100001", "sector": None,
                         "plot_no": None, "ward": None, "source": "kml"}

    @pytest.mark.parametrize("point,expected", [
        (IN_VILLAGE, {"zone_cd": "LOHAMANDI", "village_lgd": "900101", "khasra_no": None}),
        (IN_ZONE, {"zone_cd": "LOHAMANDI", "village_lgd": None, "khasra_no": None}),
    ])
    def test_a_point_fills_what_covers_it(self, icms_client, policy_tables, point, expected):
        upload(icms_client.sign_in(SUPER_ADMIN))
        found = icms_client.sign_in(SURVEYOR).get(PARCEL, params=point).json()
        assert {k: found[k] for k in expected} == expected
        assert found["source"] == "kml"

    @pytest.mark.parametrize("load", [False, True])
    def test_nothing_under_the_point_is_all_null(self, icms_client, policy_tables, load):
        if load:
            upload(icms_client.sign_in(SUPER_ADMIN))
        found = icms_client.sign_in(NODAL).get(PARCEL, params=NOWHERE)
        assert found.status_code == 200
        assert found.json() == {"zone_cd": None, "zone_name": None, "village_lgd": None,
                                "village_name": None, "khasra_no": None, "ulpin": None,
                                "sector": None, "plot_no": None, "ward": None,
                                "source": "none"}

    def test_the_import_log_lists_real_imports_newest_first(self, icms_client, policy_tables):
        admin = icms_client.sign_in(SUPER_ADMIN)
        upload(admin, name="first.kml")
        upload(admin, dry_run="true")
        upload(admin, name="second.kml")
        rows = admin.get(IMPORTS).json()
        assert [r["filename"] for r in rows] == ["second.kml", "first.kml"]
        subject = icms_client.subject_of(SUPER_ADMIN)
        assert rows[0]["imported_by"] == subject
        assert rows[0]["imported_by_name"] == f"officer-{subject[:8]}"
        assert rows[0]["imported_at"].endswith("+05:30")

    def test_a_dry_run_answers_the_counts_without_an_import_id(self, icms_client,
                                                                policy_tables):
        body = upload(icms_client.sign_in(SUPER_ADMIN), dry_run="true").json()
        assert body["dry_run"] is True and body["import_id"] is None
        assert body["counts"]["zones"]["inserted"] == 3

    def test_a_file_that_is_not_kml_is_422(self, icms_client, policy_tables):
        response = upload(icms_client.sign_in(SUPER_ADMIN), b"<kml><Document/></kml>")
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_kml"
        assert response.json()["error"]["field"] == "file"

    def test_the_wrong_extension_is_415(self, icms_client, policy_tables):
        response = upload(icms_client.sign_in(SUPER_ADMIN), name="agra.geojson")
        assert response.status_code == 415
        assert response.json()["error"]["allowed"] == [".kml", ".kmz"]

    def test_an_oversized_file_is_413(self, icms_client, policy_tables, monkeypatch):
        from app.routers import icms_geo

        monkeypatch.setattr(icms_geo, "MAX_FILE_BYTES", 1024)
        response = upload(icms_client.sign_in(SUPER_ADMIN))
        assert response.status_code == 413

    @pytest.mark.parametrize("role", [NODAL, SURVEYOR])
    def test_only_zone_administration_may_import(self, icms_client, policy_tables, role):
        assert upload(icms_client.sign_in(role)).status_code == 403
        assert icms_client.sign_in(role).get(IMPORTS).status_code == 403


# SQUARE's centre, inside the plot below and inside the zone the sector names.
IN_PLOT = {"lat": 27.005, "lon": 78.005}
AROUND = polygon("77.99,26.99 78.02,26.99 78.02,27.02 77.99,27.02 77.99,26.99")


class TestSchemePlotLookup:
    def test_a_point_in_a_scheme_plot_answers_its_sector_and_number(self, icms_client,
                                                                   policy_tables):
        body = kml(("zones", [placemark(data(zone_cd="SECTOR-4", zone_name="Sector 4"),
                                        AROUND)]),
                   ("parcels", [placemark(PLOT)]))
        assert upload(icms_client.sign_in(SUPER_ADMIN), body).status_code == 200
        found = icms_client.sign_in(NODAL).get(PARCEL, params=IN_PLOT).json()
        assert found == {"zone_cd": "SECTOR-4", "zone_name": "Sector 4", "village_lgd": None,
                         "village_name": None, "khasra_no": None, "ulpin": None,
                         "sector": "SECTOR 4", "plot_no": "4/285", "ward": None,
                         "source": "kml"}

    def test_the_plot_s_own_sector_zone_wins_over_a_smaller_zone(self, icms_client,
                                                                  policy_tables):
        body = kml(("zones", [placemark(data(zone_cd="SECTOR-4"), AROUND),
                              placemark(data(zone_cd="WARD-9"))]),
                   ("parcels", [placemark(PLOT)]))
        upload(icms_client.sign_in(SUPER_ADMIN), body)
        found = icms_client.sign_in(NODAL).get(PARCEL, params=IN_PLOT).json()
        assert found["zone_cd"] == "SECTOR-4"

    def test_with_no_sector_zone_the_containing_zone_answers(self, icms_client, policy_tables):
        body = kml(("zones", [placemark(data(zone_cd="WARD-9"), AROUND)]),
                   ("parcels", [placemark(PLOT)]))
        upload(icms_client.sign_in(SUPER_ADMIN), body)
        found = icms_client.sign_in(NODAL).get(PARCEL, params=IN_PLOT).json()
        assert (found["zone_cd"], found["plot_no"]) == ("WARD-9", "4/285")


@pytest.mark.parametrize("claims,username,email,expected", [
    ({"name": "Asha Verma", "given_name": "A"}, "averma", "a@x.in", "Asha Verma"),
    ({"given_name": "Asha", "family_name": "Verma"}, "averma", "a@x.in", "Asha Verma"),
    ({}, "averma", "a@x.in", "averma"),
    ({}, "a@x.in", "a@x.in", "a@x.in"),
    ({}, "", "", None),
])
def test_the_importer_is_named_in_the_web_header_s_claim_order(claims, username, email,
                                                               expected):
    from ada_platform import Principal

    from app.routers.icms_geo import principal_name

    user = Principal(subject="s", azp="ada-web", scopes=frozenset(), username=username,
                     email=email, claims=claims)
    assert principal_name(user) == expected
