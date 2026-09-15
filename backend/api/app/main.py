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

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# .config FIRST — it builds the settings and binds the engine, and the routers
# below open sessions. `isort: skip` is what stops an import sorter reordering
# a line whose position is the behaviour.
from .config import settings  # isort: skip

from .routers import analysis, projects, rasters, redzones, tiles

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
log = logging.getLogger("ada.api")

app = FastAPI(
    title="ADA Change Detection API",
    version="0.1.0",
    summary="Projects, imagery and change analyses for the ADA officer console.",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url=None,
    swagger_ui_parameters={"persistAuthorization": True},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.website_origin],
    # Still true with bearer tokens rather than cookies: the frontend sends the
    # Authorization header, and a preflight has to be told the header is allowed.
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

API = "/api"
app.include_router(projects.router, prefix=API)
app.include_router(rasters.router, prefix=API)
app.include_router(redzones.router, prefix=API)
app.include_router(analysis.router, prefix=API)
app.include_router(tiles.router, prefix=API)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}


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
