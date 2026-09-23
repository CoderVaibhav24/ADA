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


def test_the_worker_thread_binds_the_submitting_request(engine):
    """_pump binds the tagged id around each job; requeued plain ints get a fresh one."""
    from ada_platform.logging import get_request_id

    from app import jobs
    from app.api.v1.work import RequestScopedId

    seen: list[tuple[str, type]] = []

    def runner(item):
        seen.append((get_request_id(), type(item)))

    jobs._submit(runner, RequestScopedId(5, "officer-10"))
    jobs._submit(runner, 6)  # requeue_stale submits plain ints
    jobs._queue.join()

    assert seen[0] == ("officer-10", int)
    assert len(seen[1][0]) == 32 and seen[1][1] is int
    assert get_request_id() == ""


def test_a_job_logs_under_the_queued_request_id(engine):
    """A log line written inside the worker thread carries the RequestScopedId's id."""
    import io
    import json
    import logging

    from ada_platform.logging import configure

    from app import jobs
    from app.api.v1.work import RequestScopedId

    sink = io.StringIO()
    configure("ada-ml", "INFO", json=True, stream=sink)
    try:
        jobs._submit(
            lambda item: logging.getLogger("ada.jobs").info("job %s running", item),
            RequestScopedId(7, "officer-11"),
        )
        jobs._queue.join()
    finally:
        configure("ada-ml", "INFO")

    lines = [json.loads(line) for line in sink.getvalue().splitlines()]
    ours = [line for line in lines if line.get("event") == "job 7 running"]
    assert ours and ours[0]["request_id"] == "officer-11"


def test_main_no_longer_wraps_the_runners():
    from app import jobs, main  # noqa: F401

    assert not hasattr(main, "_carrying_request_id")
    assert not getattr(jobs._run_analysis_safe, "_ada_binds_request_id", False)


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
