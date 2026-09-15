"""The ada-notify HTTP service: ingestion, templates and diagnostics.

This process accepts notifications, authorises them against the token's azp
claim, and writes each one durably together with the outbox row that will cause
it to be delivered. It manages templates, and it reports what happened to a
delivery.

It deliberately does NOT deliver anything, and it holds no broker connection.
Delivery is the worker process (`python -m app.worker`), and keeping the two
apart is what lets ingestion keep answering 202 while Redis is down: the outbox
row is durable in PostgreSQL, and the dispatcher publishes it whenever Redis
returns. An API that published inline would fail the request instead.
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

from app.api.v1 import health, notifications, templates
from app.config import get_settings
from app.db import dispose_engine, get_engine
from app.logging_config import configure_logging
from app.security import JWKSCache, TokenVerifier

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings)

    # One client for the lifetime of the process. A client per request would
    # open a new connection to Keycloak for every JWKS refresh, and the refresh
    # is the one Keycloak call on the critical path.
    client = httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0))
    app.state.http = client
    app.state.jwks = JWKSCache(settings, client)
    app.state.verifier = TokenVerifier(settings, app.state.jwks)

    get_engine()

    logger.info(
        "service_starting",
        service=settings.service_name,
        env=settings.env,
        issuer=settings.issuer,
    )

    # JWKS is NOT prefetched here on purpose. Making startup depend on Keycloak
    # being reachable means a Keycloak restart takes this service down with it,
    # which is precisely the coupling AD-4 exists to avoid. The first request
    # fetches it, and a failure then is a 401 for that request rather than a
    # process that will not start.

    try:
        yield
    finally:
        await client.aclose()
        await dispose_engine()
        logger.info("service_stopped")


settings = get_settings()

DESCRIPTION = """
Ingestion for the ADA notification platform. Submit a notification with a
machine token; delivery happens asynchronously.

### Testing from this page

1. Get a token — from the repository root:

   ```
   make token
   ```

   It prints a token and copies it to the clipboard where one is available.

2. Press **Authorize**, paste the token, press Authorize again. Paste the token
   on its own — Swagger adds the `Bearer ` prefix.

3. Open `POST /v1/notifications`, press **Try it out**, and send the example
   body. You should get `202 Accepted`.

4. Send the **same body a second time**. You get the same `202` with an
   identical body and an `Idempotent-Replay: true` response header — the
   idempotency key made the retry a no-op rather than a second notification.

### Things worth trying

- Change `recipient.type` to `"email"` → `422`. The recipient space is closed to
  Keycloak subject ids on purpose.
- Change `channels` to `["sms"]` → `422`. SMS is a known channel that this
  release cannot deliver, so it is refused at the door rather than accepted and
  silently dropped.
- Wait for the token to expire and retry → `401`. Access tokens are deliberately
  short-lived.

### Following a message to its conclusion

`202` means *durably accepted*, not *sent*. Delivery happens in the worker
process, usually within a second or two:

1. `POST /v1/templates` first — a notification with no matching template has
   nothing to say. The example body stores a `welcome` template for email.
2. `POST /v1/notifications` with `template_key: "welcome"`.
3. `GET /v1/notifications/{id}/deliveries` — one row per channel, with its
   status, attempt count, provider message id and last error.

A delivery moves `pending -> sending -> sent`. A failure it can recover from goes
to `retrying` with a `next_attempt_at`, and the ladder allows five attempts
spread over roughly an hour before the delivery is marked `dead` and its final
error is written to the dead-letter queue. A failure it cannot recover from — no
such mailbox, an unrenderable payload — goes straight to `failed` with the reason
in `last_error`, because retrying it for an hour would change nothing.

### The recipient is a Keycloak subject

Not an email address. ADA reads the address from the account at delivery time,
so a person who changes their email in Keycloak receives the next notification at
the new one, and no caller has to be told about the change.
"""

app = FastAPI(
    title="ADA — Notification Service",
    version="0.1.0",
    summary="Submit a notification with a machine token; delivery is asynchronous.",
    description=DESCRIPTION,
    lifespan=lifespan,
    # Nothing else is mounted at the root, and a versioned path in the OpenAPI
    # document is what integrating clients generate against.
    openapi_url="/openapi.json",
    docs_url="/docs",
    redoc_url=None,
    swagger_ui_parameters={
        # Survive a page reload. Without it every refresh drops the token, which
        # with a short lifetime is already the thing you are re-entering most.
        "persistAuthorization": True,
        "displayRequestDuration": True,
        "defaultModelsExpandDepth": 2,
        "tryItOutEnabled": True,
    },
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Bind a request id and log the outcome with its duration.

    The duration matters here more than usual: ingestion has a 200 ms budget
    (Friday's definition of done), and a budget nobody measures is a budget
    nobody meets.
    """
    # Honour an inbound id so a trace survives across services, but only if it
    # looks like one — an unbounded header value would otherwise end up in every
    # log line for that request.
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

    # Health checks run every few seconds and would otherwise be the majority of
    # the log volume.
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
    """One error shape for the whole API: {"error": ..., "detail": ...}.

    FastAPI's default is {"detail": ...} alone, which gives a client nothing
    stable to branch on.
    """
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
        # The literal, not status.HTTP_422_UNPROCESSABLE_ENTITY: Starlette
        # renamed that constant to HTTP_422_UNPROCESSABLE_CONTENT and emits a
        # DeprecationWarning on the old name, while the new one does not exist
        # in older releases. 422 is 422 in both.
        status_code=422,
        content={
            "error": "validation_failed",
            "detail": "The request body does not satisfy the contract",
            # jsonable: a ValueError raised inside a validator is not
            # JSON-serialisable, and the default handler returns a 500 that
            # hides the actual validation message.
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
        413: "payload_too_large",
        422: "validation_failed",
        503: "unavailable",
    }.get(status_code, "error")


app.include_router(health.router)
app.include_router(notifications.router)
app.include_router(templates.router)


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"service": settings.service_name, "version": "0.1.0", "docs": "/docs"}
