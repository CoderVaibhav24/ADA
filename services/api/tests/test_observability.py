"""The observability floor: request ids end to end, JSON logs, readiness."""

from __future__ import annotations

import io
import json
import logging

import httpx
import pytest
from ada_platform import ADAAuth
from ada_platform.logging import configure, request_id_bound

from app.clients import ml
from app.clients.keycloak import KeycloakAdmin

from .conftest import ISSUER


def _mounted(app, path: str, endpoint) -> None:
    app.get(path)(endpoint)


def _unmount(app, path: str) -> None:
    app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", "") != path]


# ------------------------------------------------------------------ outbound
def test_the_ml_client_forwards_the_request_id(monkeypatch):
    sent: list[dict] = []

    def fake_post(url, *, json, headers, timeout):
        sent.append(headers)
        return httpx.Response(202, json={"accepted": True, "queue_depth": 0})

    monkeypatch.setattr(ml.httpx, "post", fake_post)
    with request_id_bound("officer-req-1"):
        ml.submit_analysis(7)

    assert sent[0]["X-Request-ID"] == "officer-req-1"
    assert sent[0]["X-ADA-Service-Token"] == "service-token"


def test_outside_a_request_no_id_is_invented(monkeypatch):
    sent: list[dict] = []

    def fake_post(url, *, json, headers, timeout):
        sent.append(headers)
        return httpx.Response(202, json={})

    monkeypatch.setattr(ml.httpx, "post", fake_post)
    ml.submit_ingest(1)
    assert "X-Request-ID" not in sent[0]


def test_the_keycloak_client_forwards_the_request_id():
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 300})
        return httpx.Response(200, json=3)

    admin = KeycloakAdmin(
        "https://kc.test", "pcsmcpl", "ada-api", "not-a-real-secret",
        timeout=1.0, client=httpx.Client(transport=httpx.MockTransport(handle)),
    )
    with request_id_bound("kc-trace"):
        assert admin.count_users() == 3

    assert [r.headers.get("X-Request-ID") for r in seen] == ["kc-trace", "kc-trace"]


# --------------------------------------------------------------- error bodies
def test_a_non_icms_error_keeps_detail_and_adds_the_request_id(client):
    from fastapi import HTTPException

    from app.main import app

    path = "/api/__observability_missing"

    def missing():
        raise HTTPException(404, "Project not found")

    _mounted(app, path, missing)
    try:
        response = client.get(path, headers={"X-Request-ID": "trace-404"})
    finally:
        _unmount(app, path)

    assert response.status_code == 404
    assert response.json() == {"detail": "Project not found", "request_id": "trace-404"}
    assert response.headers["x-request-id"] == "trace-404"


def test_a_non_icms_validation_error_carries_the_request_id(client):
    from app.main import app

    path = "/api/__observability_typed/{item_id}"

    def typed(item_id: int) -> dict:
        return {}

    _mounted(app, path, typed)
    try:
        response = client.get(
            "/api/__observability_typed/not-a-number", headers={"X-Request-ID": "v-1"}
        )
    finally:
        _unmount(app, path)

    assert response.status_code == 422
    body = response.json()
    assert isinstance(body["detail"], list)
    assert body["request_id"] == "v-1"


def test_an_unhandled_non_icms_error_carries_the_request_id(engine, db, principal):
    from ada_core.database import get_db
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app

    path = "/api/__observability_boom"

    def boom():
        raise RuntimeError("driver said something private")

    _mounted(app, path, boom)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[deps.require_user] = lambda: principal
    try:
        with TestClient(app, raise_server_exceptions=False) as failing:
            response = failing.get(path, headers={"X-Request-ID": "boom-2"})
    finally:
        app.dependency_overrides.clear()
        _unmount(app, path)

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal Server Error", "request_id": "boom-2"}
    assert response.headers["x-request-id"] == "boom-2"


# ----------------------------------------------------------------------- logs
def test_a_log_line_during_a_request_carries_its_id(client):
    from app.main import app

    path = "/api/__observability_log"

    def log_something() -> dict:
        logging.getLogger("ada.api.test").info("inside the request")
        return {}

    stream = io.StringIO()
    configure("ada-api", "INFO", json=True, stream=stream)
    _mounted(app, path, log_something)
    try:
        client.get(path, headers={"X-Request-ID": "log-1"})
    finally:
        _unmount(app, path)
        configure("ada-api", "INFO", json=True)

    records = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    ours = [r for r in records if r.get("event") == "inside the request"]
    assert ours, records
    assert ours[0]["request_id"] == "log-1"
    assert ours[0]["service"] == "ada-api"
    assert ours[0]["level"] == "info"
    assert ours[0]["logger"] == "ada.api.test"


# ------------------------------------------------------------------ readiness
@pytest.fixture
def keys_cached(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "_check_jwks", lambda: None)


def test_ready_is_200_when_the_database_answers(client, keys_cached):
    response = client.get("/api/health/ready")

    assert response.status_code == 200
    assert response.json()["checks"] == {"database": "ok", "jwks": "ok"}


def test_ready_is_503_when_the_database_is_down(client, keys_cached, monkeypatch):
    from app import main

    class Down:
        def connect(self):
            raise ConnectionError("password authentication failed for user 'ada'")

    monkeypatch.setattr(main, "get_engine", lambda: Down())
    response = client.get("/api/health/ready")

    assert response.status_code == 503
    assert response.json()["checks"]["database"] == "unavailable"
    assert "password" not in response.text


def test_ready_is_503_when_no_keys_can_be_fetched(client, monkeypatch):
    from app import main

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("keycloak down", request=request)

    unreachable = ADAAuth(
        issuer=ISSUER, client=httpx.Client(transport=httpx.MockTransport(refuse))
    )
    monkeypatch.setattr(main, "auth", unreachable)
    response = client.get("/api/health/ready")

    assert response.status_code == 503
    assert response.json()["checks"] == {"database": "ok", "jwks": "unavailable"}


def test_ready_fetches_keys_when_the_cache_is_cold(client, realm_transport, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "auth", ADAAuth(issuer=ISSUER, client=httpx.Client(
        transport=realm_transport)))
    response = client.get("/api/health/ready")

    assert response.status_code == 200
    assert any(call.endswith("/certs") for call in realm_transport.calls)
