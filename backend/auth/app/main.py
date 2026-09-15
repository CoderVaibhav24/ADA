"""The ada-auth HTTP service: phone plus one-time code, as a first factor.

## What this service is for

ADA has three sign-in mechanisms and this process implements exactly one of
them. The other two need no code at all:

  * username or email plus password  — Keycloak's own login page
  * TOTP                             — Keycloak, enforced as a required action
  * phone plus one-time code         — here

That asymmetry is the point. Anything Keycloak can do is left to Keycloak, and
this service exists only because Keycloak has no built-in grant for "this person
proved possession of a phone by a means outside your knowledge".

## What it holds

Nothing durable. There is no database and no migration: a pending code is worth
nothing five minutes after it was issued, so it lives in Redis with a TTL, and
every lasting fact about a person stays in Keycloak. A fork can therefore delete
this service entirely and lose no identity data.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import email_otp, health, otp
from app.config import get_settings
from app.email.registry import build_email_provider
from app.keycloak import KeycloakGateway
from app.logging_config import configure_logging
from app.otp import OtpService
from app.sms.registry import build_sms_provider
from app.store.factory import build_store
from app.throttle import OtpThrottle

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings)

    # One client for the lifetime of the process. A client per request would open
    # a new connection to Keycloak on every login attempt.
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(settings.sms_timeout_seconds, connect=2.0)
    )
    store = build_store(settings)

    app.state.http = client
    app.state.store = store
    app.state.keycloak = KeycloakGateway(settings, client)
    # OtpService raises on construction when ADA_OTP_HMAC_KEY is missing
    # outside local development, so that is a process that will not start rather
    # than one that stores reversible codes.
    app.state.otp = OtpService(settings, store)
    app.state.throttle = OtpThrottle(settings, store)
    app.state.sms = build_sms_provider(settings, client)
    app.state.email = build_email_provider(settings)

    logger.info(
        "service_starting",
        service=settings.service_name,
        env=settings.env,
        issuer=settings.issuer,
        sms_provider=settings.sms_provider,
        email_otp_provider=settings.email_otp_provider,
        # Worth one line in the log at every start: it is the single setting that
        # decides whether codes are real, and "why does any code work" is the
        # question it answers.
        dev_bypass=settings.dev_bypass_allowed,
    )

    try:
        yield
    finally:
        await client.aclose()
        await store.close()
        logger.info("service_stopped")


settings = get_settings()

DESCRIPTION = """
Phone plus one-time code, for the ADA platform. This is **one** of three
sign-in mechanisms, and the only one that needs a service.

| Mechanism | Where it lives |
| --- | --- |
| username or email + password | Keycloak's login page |
| TOTP (authenticator app) | Keycloak, a required action on every account |
| phone + one-time code | this service |

### Testing from this page

With the stack up and `ADA_ENV=local`:

1. Put a phone number on a Keycloak account — the `phoneNumber` attribute, or
   the username itself. Digits only, no `+` and no spaces.
2. `POST /v1/auth/request-otp` with that number. In local development the code
   is always `ADA_DEV_OTP` (`000000` unless you changed it) and the console
   SMS provider writes it to the service log: `make auth-logs`.
3. `POST /v1/auth/verify-otp` with the number and the code. You get real
   Keycloak tokens for that account.
4. Paste the `access_token` into any ADA service's **Authorize** box — it is
   an ordinary realm token and verifies against the same JWKS.

### Things worth trying

- Wrong code five times → `401`, then `429` with a 15-minute `Retry-After`.
  Three of those lockouts in a day → a 24-hour lock.
- `POST /v1/auth/request-otp` twice inside a minute → `429`. The cooldown is
  flat at 60 seconds, matching the countdown a login screen shows.
- An unregistered number → the **same** `202` and the same body as a registered
  one. That is deliberate; `ADA_OTP_REVEAL_UNKNOWN_PHONE=true` turns it into
  a `404` if an application would rather have the clearer error.

### What this mechanism does not do

It is a **first factor only**. TOTP is not evaluated on this path, because there
is no browser flow in which to prompt for it. An application that requires two
factors sends people through Keycloak's standard login instead.
"""

app = FastAPI(
    title="ADA — Authentication Service",
    version="0.1.0",
    summary="Phone plus one-time code, exchanged for ordinary Keycloak tokens.",
    description=DESCRIPTION,
    lifespan=lifespan,
    openapi_url="/openapi.json",
    docs_url="/docs",
    redoc_url=None,
    swagger_ui_parameters={
        "persistAuthorization": True,
        "displayRequestDuration": True,
        "defaultModelsExpandDepth": 2,
        "tryItOutEnabled": True,
    },
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Bind a request id and log the outcome with its duration."""
    incoming = request.headers.get("X-Request-ID", "")
    looks_like_an_id = 8 <= len(incoming) <= 64 and incoming.isprintable()
    request_id = incoming if looks_like_an_id else uuid.uuid4().hex

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)

    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.exception(
            "request_failed",
            method=request.method,
            path=request.url.path,
            duration_ms=round(elapsed_ms, 2),
        )
        raise

    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id

    if not request.url.path.startswith("/health"):
        logger.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(elapsed_ms, 2),
        )
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """One error shape across the platform: {"error": ..., "detail": ...}."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": _error_code(exc.status_code), "detail": exc.detail},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        # The literal, not the Starlette constant: it was renamed to
        # HTTP_422_UNPROCESSABLE_CONTENT and the old name now warns, while the
        # new one does not exist in older releases. 422 is 422 in both.
        status_code=422,
        content={
            "error": "validation_failed",
            "detail": "The request body does not satisfy the contract",
            "errors": [
                {
                    "field": ".".join(str(p) for p in error["loc"][1:]) or "body",
                    "message": error["msg"],
                }
                for error in exc.errors()
            ],
        },
    )


def _error_code(status_code: int) -> str:
    return {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_failed",
        429: "rate_limited",
        503: "unavailable",
    }.get(status_code, "error")


app.include_router(health.router)
app.include_router(otp.router)
app.include_router(email_otp.router)


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"service": settings.service_name, "version": "0.1.0", "docs": "/docs"}
