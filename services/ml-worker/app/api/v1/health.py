"""Liveness and readiness.

Split, because they answer different questions and a container orchestrator
acts on them differently. Liveness is "this process is not wedged" and must not
touch the database — a database outage that restarts every worker turns a
recoverable incident into an outage of its own. Readiness is "this process can
do work", and for a worker that means the database it writes progress into.
"""

from __future__ import annotations

import shutil

from ada_core.database import get_engine
from fastapi import APIRouter, Response
from sqlalchemy import text

from ... import jobs
from ...config import settings
from ...ml import gpu

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
    tier = gpu.select_tier()
    missing = missing_ada_weights()
    body = {
        "status": "degraded" if missing else "ok",
        "queue_depth": jobs.queue_depth(),
        "in_flight": jobs.in_flight(),
        **gpu.runtime_info(),
        "building_backend": settings.building_backend,
        "landcover_backend": settings.landcover_backend,
        "disk_free_gb": _disk_free_gb(),
        "grid_cap_px": tier.grid_cap_px,
        "eta_s_per_mpx": jobs.eta_s_per_mpx(tier),
        "eta_s_at_grid_cap": jobs.estimate_seconds(tier, tier.grid_cap_px),
    }
    if missing:
        body["weights_missing"] = missing
        body["detail"] = (f"ADA weights missing in {settings.weights_dir}: "
                          f"{', '.join(missing)}. Run services/ml-worker/scripts/"
                          f"convert_ada_checkpoint.py, or set BUILDING_BACKEND=changestar / "
                          f"LANDCOVER_BACKEND=loveda.")
    return body


# Selected ADA backends whose converted weights are not on disk, by directory name.
def missing_ada_weights() -> list[str]:
    from ...ml.ada_backends import CONFIG_FILE, MODEL_FILE

    selected = [(settings.building_backend, settings.ada_footprint_local),
                (settings.landcover_backend, settings.ada_landcover_local)]
    return [local for backend, local in selected if backend == "ada" and not all(
        (settings.weights_dir / local / name).is_file() for name in (MODEL_FILE, CONFIG_FILE))]


# None rather than a 503: a missing data dir is the sweeper's alarm, not readiness.
def _disk_free_gb() -> float | None:
    try:
        return round(shutil.disk_usage(settings.data_dir).free / (1 << 30), 1)
    except OSError:
        return None
