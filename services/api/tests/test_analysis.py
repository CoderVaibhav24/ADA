"""Starting an analysis, and what the officer gets back afterwards."""

from __future__ import annotations

import pytest
from ada_core import models


@pytest.fixture
def queued(monkeypatch):
    """Record handoffs to ada-ml instead of making them."""
    calls: list[int] = []
    from app.routers import analysis as analysis_router

    monkeypatch.setattr(analysis_router.ml_client, "submit_analysis", calls.append)
    return calls


def start(client, project, rasters, mode="diff"):
    return client.post(
        f"/api/projects/{project.id}/analyses",
        json={"raster_t1_id": rasters[0].id, "raster_t2_id": rasters[1].id, "mode": mode},
    )


def test_a_valid_analysis_is_queued(client, project, ready_rasters, queued, db):
    response = start(client, project, ready_rasters)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    # The row exists before the handoff, which is what makes the handoff
    # retryable rather than the only record of the request.
    assert db.get(models.AnalysisJob, body["id"]) is not None
    assert queued == [body["id"]]


def test_the_same_raster_twice_is_refused(client, project, ready_rasters, queued):
    response = client.post(
        f"/api/projects/{project.id}/analyses",
        json={"raster_t1_id": ready_rasters[0].id,
              "raster_t2_id": ready_rasters[0].id, "mode": "diff"},
    )
    assert response.status_code == 400
    assert queued == []


def test_a_raster_still_ingesting_is_refused(client, project, ready_rasters, queued, db):
    """Its COG does not exist yet. Accepting would produce a job that fails
    minutes later with a missing-file error, for a reason the officer could
    have been told immediately."""
    ready_rasters[0].status = "processing"
    db.commit()
    assert start(client, project, ready_rasters).status_code == 400
    assert queued == []


def test_a_raster_from_another_project_is_refused(client, project, ready_rasters, queued, db):
    """The project is the officer's, so ownership passes — but pairing it with
    a raster from elsewhere would read imagery they were never given."""
    other = models.Project(user_id=project.user_id, name="Second")
    db.add(other)
    db.commit()
    stray = models.Raster(project_id=other.id, name="elsewhere",
                          original_path="/x.tif", status="ready")
    db.add(stray)
    db.commit()
    db.refresh(stray)

    response = client.post(
        f"/api/projects/{project.id}/analyses",
        json={"raster_t1_id": ready_rasters[0].id, "raster_t2_id": stray.id, "mode": "diff"},
    )
    assert response.status_code == 404
    assert queued == []


def test_a_raster_that_does_not_exist_is_refused(client, project, ready_rasters, queued):
    response = client.post(
        f"/api/projects/{project.id}/analyses",
        json={"raster_t1_id": ready_rasters[0].id, "raster_t2_id": 99999, "mode": "diff"},
    )
    assert response.status_code == 404
    assert queued == []


@pytest.fixture
def finished_job(db, project, ready_rasters):
    job = models.AnalysisJob(
        project_id=project.id,
        raster_t1_id=ready_rasters[0].id,
        raster_t2_id=ready_rasters[1].id,
        mode="ai",
        status="done",
        progress=1.0,
        stats={"polygons": 1, "illegal": 1, "changed_area_m2": 120.5},
    )
    db.add(job)
    db.commit()
    polygon = models.ChangePolygon(
        job_id=job.id,
        geometry={"type": "Polygon",
                  "coordinates": [[[78.0, 27.1], [78.1, 27.1], [78.1, 27.2], [78.0, 27.1]]]},
        properties={"label": "New building", "status": "illegal",
                    "area_m2": 120.5, "confidence": 0.91},
    )
    db.add(polygon)
    db.commit()
    db.refresh(job)
    db.refresh(polygon)
    return job, polygon


def test_features_come_back_as_a_feature_collection(client, finished_job):
    job, polygon = finished_job
    body = client.get(f"/api/analyses/{job.id}/features").json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 1
    feature = body["features"][0]
    assert feature["id"] == polygon.id
    assert feature["properties"]["status"] == "illegal"


@pytest.fixture
def many_polygons(db, finished_job):
    """Seven detections in two clusters a degree and a half apart.

    The distance is the point: a bbox test has to be able to ask for one cluster
    and be told about that one only, and two clusters inside one extent would
    prove nothing.
    """
    job, first = finished_job
    near = [
        models.ChangePolygon(
            job_id=job.id,
            geometry={"type": "Polygon", "coordinates": [[
                [78.0 + n / 1000, 27.1], [78.1, 27.1], [78.1, 27.2], [78.0, 27.1]]]},
            properties={"label": f"Near {n}", "status": "change",
                        "change_type": "extension"},
        )
        for n in range(3)
    ]
    far = [
        models.ChangePolygon(
            job_id=job.id,
            geometry={"type": "Polygon", "coordinates": [[
                [79.5 + n / 1000, 28.5], [79.6, 28.5], [79.6, 28.6], [79.5, 28.5]]]},
            properties={"label": f"Far {n}", "status": "change"},
        )
        for n in range(3)
    ]
    db.add_all(near + far)
    db.commit()
    return job, first, near, far


class TestTheFeatureWindow:
    """The detection list used to be fetched whole — `.all()` with no limit, no
    offset and no extent, which is what the "no unbounded map query" rule exists
    to forbid. These are the clauses that keep it a window."""

    def test_the_default_is_bounded_rather_than_everything(self, client, many_polygons):
        from app.routers.analysis import DEFAULT_FEATURE_LIMIT, MAX_FEATURE_LIMIT

        job, *_ = many_polygons
        body = client.get(f"/api/analyses/{job.id}/features").json()

        assert body["metadata"]["limit"] == DEFAULT_FEATURE_LIMIT
        assert DEFAULT_FEATURE_LIMIT <= MAX_FEATURE_LIMIT < 100_000
        assert body["metadata"]["total"] == 7

    def test_limit_and_offset_page_without_overlapping(self, client, many_polygons):
        job, *_ = many_polygons
        first = client.get(f"/api/analyses/{job.id}/features?limit=3").json()
        second = client.get(f"/api/analyses/{job.id}/features?limit=3&offset=3").json()

        assert [len(first["features"]), len(second["features"])] == [3, 3]
        assert not ({f["id"] for f in first["features"]}
                    & {f["id"] for f in second["features"]})

    def test_the_total_is_the_count_behind_the_window_and_does_not_move(
        self, client, many_polygons
    ):
        """A client pages on this number; a page-sized total would stop it at one page."""
        job, *_ = many_polygons
        for limit, offset, count in ((2, 0, 2), (2, 6, 1), (2, 99, 0)):
            body = client.get(
                f"/api/analyses/{job.id}/features?limit={limit}&offset={offset}").json()

            assert body["metadata"]["total"] == 7, (limit, offset)
            assert (body["metadata"]["count"], len(body["features"])) == (count, count)

    def test_a_bbox_narrows_the_set(self, client, many_polygons):
        job, _, _, far = many_polygons
        body = client.get(
            f"/api/analyses/{job.id}/features?bbox=79.4,28.4,79.7,28.7").json()

        assert {f["id"] for f in body["features"]} == {p.id for p in far}
        assert body["metadata"]["total"] == 3
        assert body["metadata"]["bbox"] == [79.4, 28.4, 79.7, 28.7]

    def test_a_bbox_over_empty_ground_returns_an_empty_collection(self, client,
                                                                  many_polygons):
        job, *_ = many_polygons
        body = client.get(
            f"/api/analyses/{job.id}/features?bbox=10.0,10.0,10.2,10.2").json()

        assert (body["features"], body["metadata"]["total"]) == ([], 0)

    @pytest.mark.parametrize("bad", [
        "70.0,20.0,80.0,30.0",   # ten degrees a side, past the cap
        "79.7,28.4,79.4,28.7",   # east of west
        "79.4,28.4,79.7",        # three numbers
        "near,the,taj,mahal",    # not numbers
    ])
    def test_an_extent_outside_the_cap_is_refused_rather_than_scanned(
        self, client, many_polygons, bad
    ):
        job, *_ = many_polygons
        response = client.get(f"/api/analyses/{job.id}/features?bbox={bad}")

        assert response.status_code == 400, response.text[:200]
        assert "bbox" in response.json()["detail"]

    @pytest.mark.parametrize("params", ["limit=0", "limit=5001", "offset=-1"])
    def test_a_window_outside_the_bounds_is_refused(self, client, many_polygons, params):
        job, *_ = many_polygons

        assert client.get(f"/api/analyses/{job.id}/features?{params}").status_code == 422

    def test_the_collection_keeps_the_shape_the_portal_reads(self, client, many_polygons):
        """`metadata` is additive: `type` and `features` are what
        apps/web/src/features/changeDetection/model.ts walks, and both are untouched."""
        job, *_ = many_polygons
        body = client.get(f"/api/analyses/{job.id}/features").json()

        assert set(body) == {"type", "features", "metadata"}
        assert body["type"] == "FeatureCollection"
        assert all(
            {"type", "id", "geometry", "properties"} == set(f) for f in body["features"])

    def test_a_property_the_model_never_heard_of_still_reaches_the_client(
        self, client, db, finished_job
    ):
        """ada-ml writes `features` beside the named properties when an instance
        backs the polygon. A response model that dropped it would delete evidence."""
        job, polygon = finished_job
        polygon.properties = {**polygon.properties, "change_type": "new_construction",
                              "features": {"height_delta": 3.25}}
        db.commit()

        body = client.get(f"/api/analyses/{job.id}/features").json()
        props = body["features"][0]["properties"]

        assert props["change_type"] == "new_construction"
        assert props["features"] == {"height_delta": 3.25}

    def test_the_route_documents_its_answer_instead_of_typing_it_unknown(self, client):
        """With no response_model the generated TypeScript client typed this
        `unknown` — `properties.change_type` included."""
        schema = client.get("/api/openapi.json").json()
        response = (schema["paths"]["/api/analyses/{job_id}/features"]["get"]
                    ["responses"]["200"]["content"]["application/json"]["schema"])
        named = schema["components"]["schemas"][response["$ref"].rsplit("/", 1)[-1]]

        assert set(named["properties"]) == {"type", "features", "metadata"}
        assert "change_type" in (
            schema["components"]["schemas"]["ChangeFeatureProps"]["properties"])


class TestOfficerReview:
    """The human-in-the-loop labels. These rows become training data, so a
    wrong write here is a wrong label in the next fine-tuning cycle."""

    def test_confirming_records_who_and_when(self, client, finished_job, db):
        from .conftest import OWNER

        job, polygon = finished_job
        response = client.patch(
            f"/api/analyses/{job.id}/polygons/{polygon.id}/review",
            json={"status": "confirmed", "note": "site visit 3 Sep"},
        )
        assert response.status_code == 200
        db.refresh(polygon)
        assert polygon.review_status == "confirmed"
        assert polygon.reviewed_by == OWNER
        assert polygon.reviewed_at is not None
        assert polygon.review_note == "site visit 3 Sep"

    def test_rejecting_is_recorded_too(self, client, finished_job, db):
        job, polygon = finished_job
        client.patch(f"/api/analyses/{job.id}/polygons/{polygon.id}/review",
                     json={"status": "rejected"})
        db.refresh(polygon)
        assert polygon.review_status == "rejected"

    def test_an_unknown_status_is_refused(self, client, finished_job, db):
        job, polygon = finished_job
        response = client.patch(f"/api/analyses/{job.id}/polygons/{polygon.id}/review",
                                json={"status": "maybe"})
        assert response.status_code == 422
        db.refresh(polygon)
        assert polygon.review_status == "pending"

    def test_reviewing_somebody_elses_polygon_is_404(self, client, db, foreign_project):
        job = models.AnalysisJob(project_id=foreign_project.id, raster_t1_id=1,
                                 raster_t2_id=2, status="done")
        db.add(job)
        db.commit()
        polygon = models.ChangePolygon(job_id=job.id, geometry={}, properties={})
        db.add(polygon)
        db.commit()
        response = client.patch(f"/api/analyses/{job.id}/polygons/{polygon.id}/review",
                                json={"status": "confirmed"})
        assert response.status_code == 404


def test_the_csv_register_is_downloadable(client, finished_job):
    job, _ = finished_job
    response = client.get(f"/api/analyses/{job.id}/report.csv")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert len(response.text.splitlines()) >= 2  # header plus the detection


def test_the_geojson_report_is_downloadable(client, finished_job):
    job, _ = finished_job
    response = client.get(f"/api/analyses/{job.id}/report.geojson")
    assert response.status_code == 200
    assert response.json()["type"] == "FeatureCollection"
