"""Liveness and readiness.

Split, because they answer different questions and a container orchestrator
acts on them differently. Liveness is "this process is not wedged" and must not
touch the database — a database outage that restarts every worker turns a
recoverable incident into an outage of its own. Readiness is "this process can
do work", and for a worker that means the database it writes progress into.
"""

from __future__ import annotations

from ada_core.database import get_engine
from fastapi import APIRouter, Response
from sqlalchemy import text

from ... import jobs
from ...config import settings

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict:
    return {"status": "ok", "service": settings.service_name}


@router.get("/health/ready")
async def ready(response: Response) -> dict:
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - the reason belongs in the body
        response.status_code = 503
        return {"status": "unavailable", "detail": str(exc)}
    return {"status": "ok", "queue_depth": jobs.queue_depth()}
