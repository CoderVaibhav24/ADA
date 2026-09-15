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
