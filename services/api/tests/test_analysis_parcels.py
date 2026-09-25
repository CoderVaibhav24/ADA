"""Per-parcel change results of one analysis: the page, the map layer and the CSV."""

from __future__ import annotations

import csv
import io
import json

import pytest
from ada_core import models
from ada_core.models_icms import Parcel

OWNER_NAME = "Invented Owner Name"
PARCELS = "/api/analyses/{}/parcels"
SUMMARY = {
    "parcels_total": 3, "assessable": 2, "bias_offset_sqm": 4.5,
    "histogram": {"bin_edges": [0.0, 450.0, 900.0], "counts": [1, 1]},
    "counts_by_class": {"new_build": 1, "unchanged": 1, "unassessable": 1},
    "counts_by_verdict_t1": {"vacant": 1, "over_tolerance": 1, "insufficient_imagery": 1},
    "counts_by_verdict_t2": {"within_tolerance": 1, "over_tolerance": 1,
                             "insufficient_imagery": 1},
}


def square(lon: float, lat: float, side: float = 0.0004) -> str:
    ring = [[lon, lat], [lon + side, lat], [lon + side, lat + side], [lon, lat + side],
            [lon, lat]]
    return json.dumps({"type": "MultiPolygon", "coordinates": [[ring]]})


def result(job_id: int, parcel: Parcel, **fields) -> models.AnalysisParcelResult:
    base = dict(
        job_id=job_id, parcel_id=parcel.id, parcel_key=f"SECTOR-9#{parcel.plot_no}",
        sanctioned_area_sqm=parcel.sanctioned_area_sqm, parcel_area_sqm=1600,
        tolerance_frac=0.2, imagery_frac_t1=1.0, imagery_frac_t2=1.0, built_frac_t1=0.0,
        built_frac_t2=0.0, built_sqm_t1=0.0, built_sqm_t2=0.0, delta_sqm=0.0,
        delta_sqm_corrected=-4.5, verdict_t1="vacant", verdict_t2="vacant",
        change_class="unchanged")
    return models.AnalysisParcelResult(**{**base, **fields})


@pytest.fixture
def parcel_job(db, project, ready_rasters):
    job = models.AnalysisJob(
        project_id=project.id, raster_t1_id=ready_rasters[0].id,
        raster_t2_id=ready_rasters[1].id, mode="ai", status="done", progress=1.0,
        stats={"polygons": 0, "parcels": SUMMARY})
    plots = [
        Parcel(sector="SECTOR-9", plot_no=str(n), land_use="RESIDENTIAL",
               plot_type="D TYPE PLOT", sanctioned_area_sqm=sanctioned,
               owner_name=OWNER_NAME, geom=square(80.9 + n * 0.001, 26.9))
        for n, sanctioned in ((1, 1000), (2, 300), (3, None))
    ]
    db.add_all([job, *plots])
    db.commit()
    db.add_all([
        result(job.id, plots[0], built_frac_t2=0.56, built_sqm_t2=900.0, delta_sqm=900.0,
               delta_sqm_corrected=895.5, verdict_t2="within_tolerance",
               change_class="new_build"),
        result(job.id, plots[1], built_frac_t1=0.25, built_frac_t2=0.25, built_sqm_t1=400.0,
               built_sqm_t2=400.0, verdict_t1="over_tolerance", verdict_t2="over_tolerance"),
        result(job.id, plots[2], imagery_frac_t1=0.25, imagery_frac_t2=0.25, delta_sqm=None,
               delta_sqm_corrected=None, verdict_t1="insufficient_imagery",
               verdict_t2="insufficient_imagery", change_class="unassessable"),
    ])
    db.commit()
    return job, plots


class TestThePage:
    def test_rows_carry_the_cadastre_fields_and_the_summary(self, client, parcel_job):
        job, plots = parcel_job
        body = client.get(PARCELS.format(job.id)).json()

        assert body["total"] == 3 and len(body["items"]) == 3
        assert body["bias_offset_sqm"] == 4.5
        assert body["summary"]["counts_by_class"]["new_build"] == 1
        first = body["items"][0]
        assert first["parcel_id"] == plots[0].id
        assert (first["sector"], first["plot_no"], first["land_use"], first["plot_type"]) == (
            "SECTOR-9", "1", "RESIDENTIAL", "D TYPE PLOT")
        assert first["sanctioned_area_sqm"] == 1000.0
        assert first["parcel_area_sqm"] == 1600.0
        assert first["change_class"] == "new_build"
        assert body["items"][2]["delta_sqm"] is None

    def test_the_shape_is_what_the_portal_codes_against(self, client, parcel_job):
        job, _ = parcel_job
        item = client.get(PARCELS.format(job.id)).json()["items"][0]
        assert set(item) == {
            "id", "job_id", "parcel_id", "parcel_key", "sector", "plot_no", "village_lgd",
            "khasra_no", "land_use", "plot_type", "sanctioned_area_sqm", "parcel_area_sqm",
            "tolerance_frac", "imagery_frac_t1", "imagery_frac_t2", "built_frac_t1",
            "built_frac_t2", "built_sqm_t1", "built_sqm_t2", "delta_sqm",
            "delta_sqm_corrected", "verdict_t1", "verdict_t2", "change_class"}

    def test_filters_narrow_the_rows_and_the_total(self, client, parcel_job):
        job, _ = parcel_job
        by_class = client.get(PARCELS.format(job.id), params={"change_class": "new_build"})
        assert [i["plot_no"] for i in by_class.json()["items"]] == ["1"]
        by_verdict = client.get(PARCELS.format(job.id), params={"verdict": "over_tolerance"})
        assert by_verdict.json()["total"] == 1
        assert by_verdict.json()["items"][0]["plot_no"] == "2"

    def test_a_row_without_a_stored_key_still_has_one(self, client, parcel_job, db):
        job, plots = parcel_job
        row = db.query(models.AnalysisParcelResult).filter_by(parcel_id=plots[0].id).one()
        row.parcel_key = None
        db.commit()
        item = client.get(PARCELS.format(job.id)).json()["items"][0]
        assert item["parcel_key"] == f"#{plots[0].id}"

    def test_limit_and_offset_page(self, client, parcel_job):
        job, _ = parcel_job
        page = client.get(PARCELS.format(job.id), params={"limit": 2, "offset": 2}).json()
        assert page["total"] == 3 and [i["plot_no"] for i in page["items"]] == ["3"]

    @pytest.mark.parametrize("params", [
        {"change_class": "bulldozed"}, {"verdict": "guilty"}, {"limit": 0},
        {"limit": 1001}, {"offset": -1},
    ])
    def test_bad_parameters_are_refused(self, client, parcel_job, params):
        job, _ = parcel_job
        assert client.get(PARCELS.format(job.id), params=params).status_code == 422

    def test_a_run_without_a_parcel_summary_answers_null(self, client, parcel_job, db):
        job, _ = parcel_job
        job.stats = {"parcels": {"skipped": "classical mode"}}
        db.commit()
        body = client.get(PARCELS.format(job.id)).json()
        assert body["summary"] is None and body["bias_offset_sqm"] is None
        assert body["total"] == 3

    def test_an_empty_run_is_an_empty_page(self, client, ready_rasters, project, db):
        job = models.AnalysisJob(project_id=project.id, raster_t1_id=ready_rasters[0].id,
                                 raster_t2_id=ready_rasters[1].id, status="done")
        db.add(job)
        db.commit()
        body = client.get(PARCELS.format(job.id)).json()
        assert body == {"items": [], "total": 0, "bias_offset_sqm": None, "summary": None}


class TestTheMapLayer:
    def test_each_feature_is_the_parcel_outline_with_its_result(self, client, parcel_job):
        job, plots = parcel_job
        body = client.get(PARCELS.format(job.id) + ".geojson").json()
        assert body["type"] == "FeatureCollection"
        assert body["metadata"]["total"] == 3
        feature = body["features"][0]
        assert feature["geometry"]["type"] == "MultiPolygon"
        assert feature["geometry"]["coordinates"][0][0][0] == pytest.approx([80.901, 26.9])
        assert feature["properties"]["parcel_id"] == plots[0].id
        assert feature["id"] == feature["properties"]["id"], "the portal keys rows by it"
        assert isinstance(feature["properties"]["sanctioned_area_sqm"], float)
        assert isinstance(feature["properties"]["parcel_area_sqm"], float)
        assert feature["properties"]["change_class"] == "new_build"

    def test_the_same_filters_apply(self, client, parcel_job):
        job, _ = parcel_job
        body = client.get(PARCELS.format(job.id) + ".geojson",
                          params={"change_class": "unassessable"}).json()
        assert [f["properties"]["plot_no"] for f in body["features"]] == ["3"]
        assert body["metadata"]["total"] == 1


class TestTheCsv:
    def test_one_row_per_parcel_with_the_json_columns(self, client, parcel_job):
        job, _ = parcel_job
        response = client.get(PARCELS.format(job.id) + ".csv")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert f"ada_parcels_{job.id}.csv" in response.headers["content-disposition"]
        rows = list(csv.DictReader(io.StringIO(response.text)))
        assert len(rows) == 3
        assert rows[0]["parcel_key"] == "SECTOR-9#1" and rows[0]["change_class"] == "new_build"
        assert rows[2]["delta_sqm"] == ""

    def test_filters_apply_to_the_export(self, client, parcel_job):
        job, _ = parcel_job
        response = client.get(PARCELS.format(job.id) + ".csv", params={"verdict": "vacant"})
        assert list(csv.DictReader(io.StringIO(response.text))) == []


class TestCsvFormulaInjection:
    def test_parcel_text_is_quoted_and_numbers_stay_numeric(self, client, parcel_job, db):
        job, plots = parcel_job
        plots[0].plot_no = '=HYPERLINK("x")'
        db.commit()
        response = client.get(PARCELS.format(job.id) + ".csv")
        rows = list(csv.DictReader(io.StringIO(response.text)))
        assert rows[0]["plot_no"] == '\'=HYPERLINK("x")'
        assert rows[1]["delta_sqm_corrected"] == "-4.5"
        assert float(rows[1]["delta_sqm_corrected"]) == -4.5

    def test_report_csv_quotes_a_property_starting_with_at(self, client, parcel_job, db):
        job, _ = parcel_job
        db.add(models.ChangePolygon(
            job_id=job.id,
            geometry={"type": "Polygon", "coordinates": [[
                [78.0, 27.1], [78.1, 27.1], [78.1, 27.2], [78.0, 27.1]]]},
            properties={"label": "@SUM(A1:A9)", "status": '=HYPERLINK("x")',
                        "area_m2": -12.5, "confidence": 0.9}))
        db.commit()
        response = client.get(f"/api/analyses/{job.id}/report.csv")
        row = next(csv.DictReader(io.StringIO(response.text)))
        assert row["label"] == "'@SUM(A1:A9)"
        assert row["status"] == '\'=HYPERLINK("x")'
        assert row["area_m2"] == "-12.5"


@pytest.mark.parametrize("suffix", ["", ".geojson", ".csv"])
def test_owner_names_never_leave_the_server(client, parcel_job, suffix):
    job, _ = parcel_job
    response = client.get(PARCELS.format(job.id) + suffix)
    assert response.status_code == 200
    assert OWNER_NAME not in response.text
    assert "owner_name" not in response.text


@pytest.mark.parametrize("suffix", ["", ".geojson", ".csv"])
def test_somebody_elses_analysis_is_404(client, db, foreign_project, suffix):
    job = models.AnalysisJob(project_id=foreign_project.id, raster_t1_id=1, raster_t2_id=2)
    db.add(job)
    db.commit()
    assert client.get(PARCELS.format(job.id) + suffix).status_code == 404


@pytest.mark.parametrize("suffix", ["", ".geojson", ".csv"])
def test_a_caller_without_an_imagery_role_is_refused(icms_client, parcel_job, suffix):
    job, _ = parcel_job
    icms_client.sign_in()
    response = icms_client.get(PARCELS.format(job.id) + suffix)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "role_not_permitted"


def test_deleting_the_analysis_takes_its_parcel_rows(client, parcel_job, db):
    job, plots = parcel_job
    assert client.delete(f"/api/analyses/{job.id}").status_code == 200
    db.expire_all()
    assert db.query(models.AnalysisParcelResult).count() == 0
    assert db.query(Parcel).count() == len(plots), "the cadastre itself is untouched"


def test_the_routes_document_their_answers(client):
    schema = client.get("/api/openapi.json").json()
    paths = schema["paths"]
    page = paths["/api/analyses/{job_id}/parcels"]["get"]["responses"]["200"]
    assert page["content"]["application/json"]["schema"]["$ref"].endswith("ParcelResultPage")
    layer = paths["/api/analyses/{job_id}/parcels.geojson"]["get"]["responses"]["200"]
    assert layer["content"]["application/json"]["schema"]["$ref"].endswith(
        "ParcelFeatureCollection")
    assert "text/csv" in paths["/api/analyses/{job_id}/parcels.csv"]["get"]["responses"][
        "200"]["content"]
    out = schema["components"]["schemas"]["ParcelResultOut"]["properties"]
    assert "owner_name" not in out
    params = {p["name"] for p in paths["/api/analyses/{job_id}/parcels"]["get"]["parameters"]}
    assert {"change_class", "verdict", "limit", "offset"} <= params


def test_the_enums_match_the_model_constants():
    from typing import get_args

    from app.analysis_schemas import ChangeClass, ParcelVerdict

    assert get_args(ParcelVerdict) == models.PARCEL_VERDICTS
    assert get_args(ChangeClass) == models.PARCEL_CHANGE_CLASSES


@pytest.mark.parametrize("value,cell", [
    ("=1+1", "'=1+1"), ("+1", "'+1"), ("-1", "'-1"), ("@x", "'@x"), ("\tx", "'\tx"),
    ("\rx", "'\rx"), ("plain", "plain"), (-4.5, -4.5), (None, ""), (3, 3),
])
def test_csv_cell_quotes_only_text_formula_triggers(value, cell):
    from app.routers.analysis import _csv_cell
    assert _csv_cell(value) == cell
