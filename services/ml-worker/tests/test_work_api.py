"""The two instructions ada-api gives this service.

The pipeline itself is never entered: jobs.submit_* is replaced, because what
is under test is the door and the row check, not ChangeStar.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

TOKEN = {"X-ADA-Service-Token": "service-token"}


@pytest.fixture
def submitted(monkeypatch):
    """Record what would have been queued."""
    from app import jobs

    calls: dict[str, list[int]] = {"ingest": [], "analysis": []}
    monkeypatch.setattr(jobs, "submit_ingest", calls["ingest"].append)
    monkeypatch.setattr(jobs, "submit_analysis", calls["analysis"].append)
    monkeypatch.setattr(jobs, "queue_depth", lambda: len(calls["ingest"]) + len(calls["analysis"]))
    return calls


@pytest.fixture
def client(engine, db, submitted, monkeypatch):
    # requeue_stale runs in the lifespan and would sweep the fixtures' rows
    # into the queue, which is a different test.
    from app import jobs
    from app.main import app

    monkeypatch.setattr(jobs, "requeue_stale", lambda: None)
    with TestClient(app) as test_client:
        yield test_client


class TestIngest:
    def test_a_real_raster_is_accepted_and_queued(self, client, raster, submitted):
        response = client.post("/v1/ingests", json={"raster_id": raster.id}, headers=TOKEN)
        assert response.status_code == 202
        assert response.json()["accepted"] is True
        assert submitted["ingest"] == [raster.id]

    def test_an_unknown_raster_is_404(self, client, submitted):
        assert client.post("/v1/ingests", json={"raster_id": 99999},
                           headers=TOKEN).status_code == 404
        assert submitted["ingest"] == []

    def test_resubmitting_is_allowed(self, client, raster, submitted):
        """Ingest is idempotent — it rewrites the COG from the original upload
        — so refusing a repeat would break the retry the officer expects from
        the UI, at the cost of repeating work rather than corrupting it."""
        for _ in range(2):
            assert client.post("/v1/ingests", json={"raster_id": raster.id},
                               headers=TOKEN).status_code == 202
        assert submitted["ingest"] == [raster.id, raster.id]


class TestAnalysis:
    def test_a_real_job_is_accepted_and_queued(self, client, job, submitted):
        response = client.post("/v1/analyses", json={"job_id": job.id}, headers=TOKEN)
        assert response.status_code == 202
        assert submitted["analysis"] == [job.id]

    def test_an_unknown_job_is_404(self, client, submitted):
        assert client.post("/v1/analyses", json={"job_id": 99999},
                           headers=TOKEN).status_code == 404
        assert submitted["analysis"] == []


class TestTheDoor:
    def test_no_token_is_refused(self, client, raster, submitted):
        assert client.post("/v1/ingests", json={"raster_id": raster.id}).status_code == 401
        assert submitted["ingest"] == []

    def test_a_wrong_token_is_refused(self, client, raster, submitted):
        response = client.post("/v1/ingests", json={"raster_id": raster.id},
                               headers={"X-ADA-Service-Token": "guessed"})
        assert response.status_code == 401
        assert submitted["ingest"] == []

    def test_the_check_happens_before_the_database_is_touched(self, client, submitted):
        """An unauthenticated caller must not be able to probe which job ids
        exist by comparing a 401 against a 404."""
        response = client.post("/v1/analyses", json={"job_id": 99999},
                               headers={"X-ADA-Service-Token": "guessed"})
        assert response.status_code == 401


class TestValidation:
    @pytest.mark.parametrize("body", [{}, {"raster_id": 0}, {"raster_id": -1},
                                      {"raster_id": "abc"}, {"job_id": 1}])
    def test_a_bad_ingest_body_is_422(self, client, body, submitted):
        assert client.post("/v1/ingests", json=body, headers=TOKEN).status_code == 422
        assert submitted["ingest"] == []

    @pytest.mark.parametrize("body", [{}, {"job_id": 0}, {"job_id": -5}, {"raster_id": 1}])
    def test_a_bad_analysis_body_is_422(self, client, body, submitted):
        assert client.post("/v1/analyses", json=body, headers=TOKEN).status_code == 422


class TestHealth:
    def test_liveness_needs_no_database(self, client):
        """A database outage that restarts every worker turns a recoverable
        incident into an outage of its own."""
        response = client.get("/health/live")
        assert response.status_code == 200
        assert response.json()["service"] == "ada-ml"

    def test_liveness_needs_no_token(self, client):
        assert client.get("/health/live").status_code == 200

    def test_readiness_reports_the_queue(self, client, monkeypatch):
        from app.api.v1 import health

        monkeypatch.setattr(health, "missing_ada_weights", lambda: [])
        body = client.get("/health/ready").json()
        assert body["status"] == "ok"
        assert "queue_depth" in body

    def test_readiness_is_503_when_the_database_is_gone(self, client, monkeypatch):
        from app.api.v1 import health

        def broken():
            raise RuntimeError("could not connect to PostgreSQL")

        monkeypatch.setattr(health, "get_engine", broken)
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert "could not connect" in response.json()["detail"]
