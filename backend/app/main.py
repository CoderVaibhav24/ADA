import os

# Fix PROJ conflict: Unset any PROJ_* env vars to avoid picking up old system proj.db
for key in list(os.environ.keys()):
    if key.startswith("PROJ_"):
        del os.environ[key]

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supertokens_python import get_all_cors_headers
from supertokens_python.framework.fastapi import get_middleware

from .auth import init_supertokens
from .config import settings
from .database import Base, engine
from .migrate import run_migrations
from .routers import analysis, projects, rasters, redzones, tiles
from .services import jobs

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ada")

init_supertokens()


@asynccontextmanager
async def lifespan(app: FastAPI):
    for attempt in range(30):
        try:
            Base.metadata.create_all(bind=engine)
            run_migrations()
            log.info("Database ready")
            # Anything left mid-flight by the previous process (restart, crash)
            # is stranded otherwise — the worker is in-process, so its queue
            # does not survive, but the "processing" row does.
            jobs.requeue_stale()
            break
        except Exception as exc:
            log.warning("DB not ready (attempt %s): %s", attempt + 1, exc)
            time.sleep(2)
    else:
        raise RuntimeError("Could not connect to PostgreSQL")
    yield


app = FastAPI(title="ADA Change Detection API", lifespan=lifespan)

app.add_middleware(get_middleware())

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.website_domain],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"] + get_all_cors_headers(),
)

API = "/api"
app.include_router(projects.router, prefix=API)
app.include_router(rasters.router, prefix=API)
app.include_router(redzones.router, prefix=API)
app.include_router(analysis.router, prefix=API)
app.include_router(tiles.router, prefix=API)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
