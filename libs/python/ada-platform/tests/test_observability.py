"""Structured logs and the request id: the shape every ADA service emits."""

from __future__ import annotations

import asyncio
import io
import json
import logging

import httpx
import pytest
import structlog

from ada_platform import ADANotify
from ada_platform.logging import configure, default_json, get_request_id, request_id_bound
from ada_platform.requestid import RequestIdMiddleware, clean_request_id, outbound_headers


@pytest.fixture
def captured():
    stream = io.StringIO()
    yield stream
    structlog.reset_defaults()
    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "_ada_logging", False):
            root.removeHandler(handler)


def lines(stream: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]


def test_a_structlog_line_is_json_with_the_request_id(captured):
    configure("ada-test", "INFO", json=True, stream=captured)
    with request_id_bound("req-1"):
        structlog.get_logger("ada.test").info("hello", job=3)

    (line,) = lines(captured)
    assert line["event"] == "hello"
    assert line["request_id"] == "req-1"
    assert line["service"] == "ada-test"
    assert line["level"] == "info"
    assert line["logger"] == "ada.test"
    assert line["job"] == 3
    assert line["timestamp"].endswith("Z")


def test_a_stdlib_line_goes_through_the_same_bridge(captured):
    """uvicorn, sqlalchemy and httpx log through the stdlib, not structlog."""
    configure("ada-test", "INFO", json=True, stream=captured)
    with request_id_bound("req-2"):
        logging.getLogger("uvicorn.access").warning("GET %s %s", "/x", 200)

    (line,) = lines(captured)
    assert line == line | {
        "event": "GET /x 200",
        "request_id": "req-2",
        "service": "ada-test",
        "level": "warning",
        "logger": "uvicorn.access",
    }


def test_an_exception_is_rendered_into_the_line(captured):
    configure("ada-test", "INFO", json=True, stream=captured)
    try:
        raise ValueError("boom")
    except ValueError:
        logging.getLogger("ada.test").exception("failed")

    (line,) = lines(captured)
    assert "ValueError: boom" in line["exception"]


def test_the_level_filters(captured):
    configure("ada-test", "WARNING", json=True, stream=captured)
    logging.getLogger("ada.test").info("quiet")
    structlog.get_logger().info("quiet too")
    assert lines(captured) == []


def test_a_notify_style_contextvar_binding_is_honoured(captured):
    """notify and auth-otp bind the id with structlog.contextvars; same key."""
    configure("ada-test", "INFO", json=True, stream=captured)
    structlog.contextvars.bind_contextvars(request_id="bound-by-notify")
    try:
        logging.getLogger("x").info("hi")
    finally:
        structlog.contextvars.clear_contextvars()
    assert lines(captured)[0]["request_id"] == "bound-by-notify"


@pytest.mark.parametrize(
    "env,expected",
    [
        ({"ADA_ENV": "local"}, False),
        ({"ADA_ENV": "production"}, True),
        ({}, True),
        ({"ADA_ENV": "local", "ADA_LOG_FORMAT": "json"}, True),
        ({"ADA_ENV": "production", "ADA_LOG_FORMAT": "console"}, False),
    ],
)
def test_json_is_the_default_away_from_local(monkeypatch, env, expected):
    monkeypatch.delenv("ADA_ENV", raising=False)
    monkeypatch.delenv("ADA_LOG_FORMAT", raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    assert default_json() is expected


def test_a_hostile_id_is_cleaned():
    assert clean_request_id("ok 1 <script>") == "ok1script"
    assert len(clean_request_id("")) == 32
    assert len(clean_request_id("x" * 500)) == 64


def test_outbound_headers_follow_the_bound_id():
    assert outbound_headers() == {}
    with request_id_bound("abc"):
        assert outbound_headers() == {"X-Request-ID": "abc"}
    assert outbound_headers("explicit") == {"X-Request-ID": "explicit"}


def _run(headers: list[tuple[bytes, bytes]]):
    sent: list[dict] = []
    seen: list[str] = []

    async def inner(scope, receive, send):
        seen.append(get_request_id())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        return {"type": "http.request"}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "headers": headers}
    asyncio.run(RequestIdMiddleware(inner)(scope, receive, send))
    return seen[0], dict(sent[0]["headers"])


def test_the_middleware_keeps_an_inbound_id_and_echoes_it():
    seen, headers = _run([(b"x-request-id", b"trace-7")])
    assert seen == "trace-7"
    assert headers[b"x-request-id"] == b"trace-7"


def test_the_middleware_mints_one_when_none_arrives():
    seen, headers = _run([])
    assert len(seen) == 32
    assert headers[b"x-request-id"] == seen.encode()


def test_notify_forwards_the_request_id():
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/protocol/openid-connect/token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        seen.append(request)
        return httpx.Response(202, json={"id": "8f14e45f-ceea-467a-9f5a-000000000000"})

    notify = ADANotify(
        base_url="https://notify.test",
        issuer="https://auth.test/realms/ada",
        client_id="svc",
        client_secret="not-a-real-secret",
        client=httpx.Client(transport=httpx.MockTransport(handle)),
    )
    with request_id_bound("job-trace"):
        assert notify.send(idempotency_key="k1", recipient="u", template_key="t")
    assert notify.send(idempotency_key="k2", recipient="u", template_key="t", request_id="given")
    assert notify.send(idempotency_key="k3", recipient="u", template_key="t")

    assert seen[0].headers["X-Request-ID"] == "job-trace"
    assert seen[1].headers["X-Request-ID"] == "given"
    assert "X-Request-ID" not in seen[2].headers
