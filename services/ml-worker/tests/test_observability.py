"""Request ids across the ada-api -> ada-ml hop, and the migrations switch."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

TOKEN = {"X-ADA-Service-Token": "service-token"}


@pytest.fixture
def submitted(monkeypatch):
    from app import jobs

    calls: list[int] = []
    monkeypatch.setattr(jobs, "submit_analysis", calls.append)
    monkeypatch.setattr(jobs, "submit_ingest", calls.append)
    monkeypatch.setattr(jobs, "requeue_stale", lambda: None)
    return calls


@pytest.fixture
def client(engine, db, submitted):
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def test_an_inbound_request_id_is_echoed(client):
    response = client.get("/health/live", headers={"X-Request-ID": "api-trace-1"})
    assert response.headers["x-request-id"] == "api-trace-1"


def test_a_missing_request_id_is_minted(client):
    assert len(client.get("/health/live").headers["x-request-id"]) == 32


def test_the_queued_id_carries_the_submitting_request(client, job, submitted):
    response = client.post(
        "/v1/analyses", json={"job_id": job.id}, headers={**TOKEN, "X-Request-ID": "officer-9"}
    )

    assert response.status_code == 202
    assert submitted == [job.id]
    assert submitted[0].request_id == "officer-9"


def test_the_worker_thread_logs_under_the_submitting_request(engine):
    """The dequeue is in jobs.py; main.py's wrapper binds the id around each job."""
    from ada_platform.logging import get_request_id

    from app import jobs, main
    from app.api.v1.work import RequestScopedId

    seen: list[tuple[str, type]] = []
    runner = main._carrying_request_id(lambda item: seen.append((get_request_id(), type(item))))

    jobs._submit(runner, RequestScopedId(5, "officer-10"))
    jobs._submit(runner, 6)  # requeue_stale submits plain ints
    jobs._queue.join()

    assert seen[0] == ("officer-10", int)
    assert len(seen[1][0]) == 32 and seen[1][1] is int


def test_the_job_runners_are_wrapped():
    from app import jobs, main  # noqa: F401 - importing main installs the wrapper

    assert getattr(jobs._run_analysis_safe, "_ada_binds_request_id", False)
    assert getattr(jobs._run_ingest_safe, "_ada_binds_request_id", False)


@pytest.mark.parametrize("value,expected", [("false", False), ("0", False), ("true", True)])
def test_migrations_on_startup_follow_the_environment(
    engine, db, submitted, monkeypatch, value, expected
):
    from app import main

    ran: list[bool] = []
    monkeypatch.setattr(main, "run_migrations", lambda: ran.append(True))
    monkeypatch.setenv("RUN_MIGRATIONS_ON_STARTUP", value)

    with TestClient(main.app):
        pass

    assert bool(ran) is expected
