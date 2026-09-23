"""Liveness and readiness.

Separate endpoints because they answer different questions, and conflating them
is how a rolling deploy takes an estate down: a readiness probe that checks a
dependency fails the whole fleet when that dependency blips, and a liveness probe
that checks one then restarts every process.

/health/live   — is this process running? No dependencies.
/health/ready  — can it serve? Checks the OTP store.

Keycloak is deliberately NOT part of readiness. This service cannot issue tokens
without it, but taking every replica out of the load balancer during a Keycloak
restart converts a brief 503 on the login path into a service that is gone.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Request, Response, status

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", summary="Process liveness")
async def live() -> dict:
    return {"status": "alive"}


@router.get("/ready", summary="Readiness, including the OTP store")
async def ready(request: Request, response: Response) -> dict:
    checks: dict[str, str] = {}
    healthy = True

    try:
        await request.app.state.store.exists("otp:readiness-probe")
        checks["store"] = "ok"
    except Exception as exc:
        logger.warning("readiness_store_failed", error=str(exc))
        checks["store"] = "failed"
        healthy = False

    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if healthy else "degraded", "checks": checks}
