"""The ADA API service: projects, imagery, red zones, analyses and map tiles.

This process answers the browser and nothing else. It validates a request,
decides whether the project belongs to the officer making it, writes or reads a
row, and — for work that takes minutes — hands an id to ada-ml and returns. It
imports no model and holds no GPU.

## Authentication

Keycloak, verified locally. A request arrives with an RS256 access token; the
signature is checked against the realm's JWKS, which is cached, so there is no
call to Keycloak on the request path. The practical consequence is worth stating
plainly: while Keycloak is down, nobody can sign in and everybody already signed
in keeps working.

It is a floor, not an opt-in: JWTMiddleware refuses anything outside the four
paths in app/security.py PUBLIC_PATHS before it reaches a router, so an endpoint
added without its `Depends(...)` answers 401 rather than serving anonymously.
The per-endpoint role, permission and workflow checks are unchanged and still
decide what a verified caller may do.

This replaced SuperTokens, which verified a session cookie against a SuperTokens
core. The user identifier therefore changed shape — from a SuperTokens user id
to a Keycloak subject — and `projects.user_id` rows written before the swap name
an account this service can no longer authenticate. scripts/remap_user_ids.py
matches them up by email address; until it is run, those projects are invisible
rather than lost.

## Schema ownership

ada-ml creates and migrates the tables (see its main.py). This service maps them
and does not issue DDL — two processes racing to ALTER the same table on boot is
a deadlock that appears only under a simultaneous restart, which is exactly when
nobody wants to be reading a stack trace.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from ada_core.database import SessionLocal, get_engine
from ada_platform.logging import configure as configure_logging
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import sweeper
from .clients import ml as ml_client
from .config import settings
from .deps import require_imagery
from .errors import install_error_handlers
from .icms import policy, reminders
from .routers import (
    analysis,
    app_screens,
    icms,
    icms_admin,
    icms_cases,
    icms_dashboard,
    icms_geo,
    icms_inspections,
    icms_notices,
    icms_users,
    projects,
    rasters,
    redzones,
    tiles,
    uploads,
)
from .security import JWTMiddleware, auth

# JSON unless ADA_ENV=local (or ADA_LOG_FORMAT says otherwise); uvicorn's own
# loggers are re-pointed at the same handler, so access lines are JSON too.
configure_logging("ada-api", settings.log_level)
log = logging.getLogger("ada.api")


# A worker that starts serving before it has read the policy answers from the
# code seed, which is the wrong answer the moment an officer has edited a grant.
def _load_policy() -> None:
    try:
        with SessionLocal() as db:
            policy.reload(db)
    except Exception:
        log.warning("ICMS policy tables unreadable; serving the code seed", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load the policy once, then keep it current for the life of the worker."""
    watcher: policy.PolicyWatcher | None = None
    if settings.icms_policy_watch:
        await asyncio.to_thread(_load_policy)
        watcher = policy.PolicyWatcher(
            get_engine(), poll_seconds=settings.icms_policy_poll_seconds
        )
        watcher.start()
    sweep_task = asyncio.create_task(sweeper.run_forever()) if settings.sweeper_enabled else None
    remind_task = (asyncio.create_task(reminders.run_forever())
                   if settings.reminders_enabled else None)
    try:
        yield
    finally:
        if remind_task is not None:
            reminders.stop_event.set()
            remind_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await remind_task
        if sweep_task is not None:
            sweeper.stop_event.set()
            sweep_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sweep_task
        if watcher is not None:
            await watcher.stop()


app = FastAPI(
    lifespan=lifespan,
    title="ADA Change Detection API",
    version="0.1.0",
    summary="Projects, imagery and change analyses for the ADA officer console.",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url=None,
    swagger_ui_parameters={"persistAuthorization": True},
)

# add_middleware PREPENDS, so these three read inside-out: the last one added is
# the outermost. The resulting order is RequestId -> CORS -> JWT -> router, and
# both of the outer two are outside the floor for a reason:
#
#   * RequestId sets the contextvar the refusal envelope's `request_id` comes
#     from. Outside the floor, a 401 carries an id somebody can find in a log;
#     inside it, that field is empty on exactly the responses people ask about.
#   * CORS answers the browser's preflight itself — an OPTIONS carrying no
#     Authorization header, which the floor would otherwise refuse — and puts
#     Access-Control-Allow-Origin on the 401, without which the SPA sees an
#     opaque network error rather than "refresh your token".
app.add_middleware(JWTMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.website_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)

install_error_handlers(app)

API = "/api"
app.include_router(projects.router, prefix=API)
app.include_router(rasters.router, prefix=API)
app.include_router(uploads.router, prefix=API)
app.include_router(redzones.router, prefix=API)
app.include_router(analysis.router, prefix=API)
app.include_router(tiles.router, prefix=API)
app.include_router(icms.router, prefix=API)
app.include_router(icms_cases.router, prefix=API)
app.include_router(icms_inspections.router, prefix=API)
app.include_router(icms_notices.router, prefix=API)
app.include_router(icms_dashboard.router, prefix=API)
app.include_router(icms_admin.router, prefix=API)
app.include_router(icms_users.router, prefix=API)
app.include_router(icms_geo.router, prefix=API)
app.include_router(app_screens.router, prefix=API)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}


def _check_database() -> None:
    with get_engine().connect() as conn:
        conn.execute(text("SELECT 1"))


# Ready when a signing key is cached or can be fetched now; see ADAAuth.ready.
def _check_jwks() -> None:
    if not auth.ready():
        raise RuntimeError("no JWKS signing key cached or fetchable")


@app.get("/api/health/ready")
async def ready(response: Response) -> dict:
    """Readiness: the database answers and tokens can be verified.

    /api/health stays liveness. Reasons go to the log, not the body: this path
    is anonymous and a driver error names hosts and users.
    """
    checks: dict[str, str] = {}
    for name, check in (("database", _check_database), ("jwks", _check_jwks)):
        try:
            await asyncio.to_thread(check)
            checks[name] = "ok"
        except Exception:
            log.warning("readiness check %s failed", name, exc_info=True)
            checks[name] = "unavailable"
    ok = all(value == "ok" for value in checks.values())
    if not ok:
        response.status_code = 503
    try:
        disk = "low" if await asyncio.to_thread(sweeper.disk_low) else "ok"
    except OSError:
        disk = "unknown"
    last = sweeper.last_report
    return {
        "status": "ok" if ok else "unavailable",
        "service": settings.service_name,
        "checks": checks,
        "disk": disk,
        "sweeper_last_run": last.at.isoformat() if last else None,
    }


_RUNTIME_FIELDS = ("backend", "tier", "device_name", "fp16", "ort_provider", "gpu_budget_gb",
                   "grid_cap_px", "eta_s_per_mpx", "eta_s_at_grid_cap", "queue_depth",
                   "building_backend", "landcover_backend")


# Proxies ada-ml's readiness, whitelisted, so the console can show the tier and a CPU-mode ETA.
@app.get("/api/ml/runtime", dependencies=[Depends(require_imagery)],
         responses={503: {"description": "model service unavailable"}})
def ml_runtime() -> dict:
    try:
        body = ml_client.runtime(timeout=3.0)
    except ml_client.MLUnavailable as exc:
        log.info("ml runtime unavailable: %s", exc)
        raise HTTPException(503, "model service unavailable") from exc
    return {key: body[key] for key in _RUNTIME_FIELDS if key in body}


@app.get("/api/auth/config")
async def auth_config() -> dict:
    """What the single-page app needs to start an OIDC login.

    Served rather than baked into the build. A built bundle is the one artefact
    that is identical in every environment, so a realm URL compiled into it is a
    separate build per environment — and the usual symptom of getting that wrong
    is a production bundle redirecting people to the staging login page.

    Everything here is public by definition: it is what the browser sends to
    Keycloak in the clear. There is no secret in a PKCE public client.
    """
    return {
        "issuer": settings.oidc_issuer,
        "client_id": settings.oidc_client_id,
    }
