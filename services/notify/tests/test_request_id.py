"""X-Request-ID from a caller (ada-api, ada-ml via the SDK) survives into ada-notify.

In-process and stack-free: /health/live touches neither the database nor
Keycloak, and the lifespan is not entered.
"""

from __future__ import annotations

import os

os.environ.setdefault("ADA_ISSUER", "http://keycloak.test/realms/pcsmcpl")
os.environ.setdefault("ADA_DATABASE_URL", "postgresql+asyncpg://u:p@127.0.0.1:1/unused")

import structlog  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _client() -> TestClient:
    from app.main import app

    return TestClient(app)


def test_an_inbound_request_id_is_echoed():
    response = _client().get("/health/live", headers={"X-Request-ID": "api-trace-42"})
    assert response.headers["x-request-id"] == "api-trace-42"


def test_one_that_does_not_look_like_an_id_is_replaced():
    response = _client().get("/health/live", headers={"X-Request-ID": "x"})
    assert response.headers["x-request-id"] != "x"


def test_the_id_is_bound_for_structlog():
    from app.main import app

    seen: list[str | None] = []

    @app.get("/__request_id_probe", include_in_schema=False)
    async def probe() -> dict:
        seen.append(structlog.contextvars.get_contextvars().get("request_id"))
        return {}

    try:
        TestClient(app).get("/__request_id_probe", headers={"X-Request-ID": "api-trace-43"})
    finally:
        app.router.routes[:] = [
            r for r in app.router.routes if getattr(r, "path", "") != "/__request_id_probe"
        ]
    assert seen == ["api-trace-43"]
