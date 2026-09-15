"""The ADA model service: ingestion, change detection and refinement.

This is the process that holds torch, onnxruntime and GDAL. It answers two
instructions from ada-api, runs them on a single worker thread, and writes what
it finds into the rows ada-api created. It serves no browser, verifies no user
token and makes no authorisation decision about a project — by the time work
arrives here, that has already happened.

## Why this is a separate process

Three reasons, in the order they were felt:

  * A ViT-B tile costs ~13 s on CPU with every core pinned, and an analysis is
    hundreds of tiles. Inside the API process that is a map that will not pan
    and a tile route that times out while a job runs.
  * The API image does not need CUDA. Splitting takes several gigabytes of
    torch, CUDA and cuDNN wheels out of the process that answers HTTP requests,
    which is also the process most exposed to the network.
  * The GPU is one device on one machine. The API scales with officers; this
    scales with cards, and they are not the same number.

## The worker is still in-process

One daemon thread fed by a queue, exactly as it was before the split (see
jobs.py for why a daemon thread and not a ThreadPoolExecutor). Moving to a
durable broker is a real improvement and a separate change: it needs the queue
to survive a restart, which the `requeue_stale` sweep below approximates and
does not replace.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

# .config FIRST, and the isort directive above is what keeps it there.
#
# Importing it builds the settings and binds the engine, and importing ada_core
# purges any inherited PROJ_* variables before anything geospatial loads. An
# import sorter moving this below `from . import jobs` happens to keep working
# — jobs imports .config itself — but only by accident, and the failure when
# that accident stops holding is an unbound engine at first query.
from .config import settings  # isort: skip

from ada_core.database import get_engine
from ada_core.migrate import run_migrations
from fastapi import FastAPI
from sqlalchemy import text

from . import jobs
from .api.v1 import health, work

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
log = logging.getLogger("ada.ml")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The schema is migrated HERE, not in ada-api. Both services map the same
    # tables, so exactly one of them has to own the DDL, and the ML service is
    # the one that cannot function against a stale schema — it writes to every
    # column. ada-api waits for this service to become healthy.
    for attempt in range(30):
        try:
            with get_engine().connect() as conn:
                conn.execute(text("SELECT 1"))
            run_migrations()
            log.info("Database ready")
            break
        except Exception as exc:  # noqa: BLE001 - retried, then raised below
            log.warning("DB not ready (attempt %s): %s", attempt + 1, exc)
            # await, not time.sleep: this runs inside the lifespan, on the
            # event loop. A blocking sleep here holds the loop for up to a
            # minute while Postgres comes up, which means the container
            # ignores SIGTERM for that whole window and `docker compose down`
            # has to kill it.
            await asyncio.sleep(2)
    else:
        raise RuntimeError("Could not connect to PostgreSQL")

    if not settings.ml_service_token:
        log.warning(
            "ML_SERVICE_TOKEN is unset — anything that can reach this port can "
            "queue work on it. Acceptable on a loopback-only local run; set it "
            "anywhere else."
        )

    # Anything left mid-flight by the previous process (restart, crash) is
    # stranded otherwise — the worker is in-process, so its queue does not
    # survive, but the "processing" row does.
    jobs.requeue_stale()

    yield


app = FastAPI(
    title="ADA — Model Service",
    version="0.1.0",
    summary="Raster ingestion and bi-temporal change detection, off the request path.",
    lifespan=lifespan,
    openapi_url="/openapi.json",
    docs_url="/docs",
    redoc_url=None,
)

app.include_router(health.router)
app.include_router(work.router)


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"service": settings.service_name, "version": "0.1.0", "docs": "/docs"}
