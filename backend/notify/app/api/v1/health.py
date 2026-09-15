"""Liveness and readiness.

Separate endpoints because they answer different questions and because
conflating them is how a rolling deploy takes an estate down: a readiness probe
that checks a dependency will fail the whole fleet when that dependency blips,
and a liveness probe that checks a dependency will then restart every process.

/health/live   — is this process running? No dependencies. Never fails on a blip.
/health/ready  — can it serve? Checks the database and the JWKS.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.dependencies import DbSession

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", summary="Process liveness")
async def live() -> dict:
    return {"status": "alive"}


@router.get("/ready", summary="Readiness, including dependencies")
async def ready(session: DbSession, response: Response) -> dict:
    checks: dict[str, str] = {}
    healthy = True

    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        logger.warning("readiness_database_failed", error=str(exc))
        checks["database"] = "failed"
        healthy = False

    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if healthy else "degraded", "checks": checks}
