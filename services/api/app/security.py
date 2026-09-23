"""Authentication as a floor rather than an opt-in.

Every endpoint used to carry its own `Depends(...)`. All forty-three of them
did, so nothing was open — but the next one added without it would have been
public and no test would have said so. `JWTMiddleware` inverts that: a request
to anything outside `PUBLIC_PATHS` does not reach a router without a verified
RS256 token, so forgetting the dependency now costs a 401 rather than a leak.

The per-endpoint dependencies stay exactly where they are. This says there is a
caller; `require_role`, `require_permission` and the workflow checks still say
what that caller may do.

One verifier serves both. The middleware puts the Principal on `request.state`
and `require_user` reads it back, so there is no second implementation that
could come to a different answer, and no token is verified twice per request.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from ada_platform import ADAAuth, ADAAuthError, JwksUnavailableError, Principal
from anyio import to_thread
from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.datastructures import Headers

from .config import settings
from .errors import REQUEST_ID_HEADER, current_request_id, envelope

log = logging.getLogger("ada.api.security")

# Without it a client holding a short-lived token is told "no" with no hint that
# refreshing and retrying is the fix.
WWW_AUTHENTICATE = {"WWW-Authenticate": 'Bearer realm="ada"'}

# Exact paths, never prefixes. A prefix match on "/api/health" would also open
# every path that happens to begin with it, which is how allowlists rot.
PUBLIC_PATHS: frozenset[str] = frozenset({
    # The container healthcheck and anything in front of it, neither of which
    # holds a token. Gating it makes an unauthenticated 401 read as an unhealthy
    # service, and the orchestrator restarts a working process.
    "/api/health",
    # Readiness (database + JWKS). Same reasoning: the probe holds no token,
    # and a 401 here would read as "not ready" and pull a healthy replica out.
    "/api/health/ready",
    # The issuer and client id the SPA needs BEFORE it can obtain a token.
    # Gating it is a deadlock: the page cannot learn where to send the user.
    "/api/auth/config",
    # Swagger UI and the schema it renders. The schema is the shape of the API,
    # not its data, and apps/web/src/api/generated is built from it.
    "/api/docs",
    "/api/openapi.json",
})

def build_auth(client: httpx.Client | None = None) -> ADAAuth:
    """The verifier as configured for this API; tests pass a client."""
    return ADAAuth(
        issuer=settings.oidc_issuer,
        internal_issuer_url=settings.oidc_internal_issuer_url,
        jwks_cache_seconds=settings.jwks_soft_ttl_seconds,
        jwks_hard_ttl_seconds=settings.jwks_hard_ttl_seconds,
        client=client,
        # Access tokens only, from ADA's own user-facing clients, for a person.
        require_typ="Bearer",
        allowed_azp=frozenset(settings.oidc_allowed_azp),
        reject_service_accounts=True,
    )


# One verifier for the process. It owns the JWKS cache, so constructing it per
# request would refetch the realm's keys on every call — which is the coupling
# local verification exists to remove.
auth = build_auth()

# Declared so the schema documents the scheme and Swagger UI keeps its Authorize
# button; auto_error=False because the refusal below is ours, with the header.
_bearer = HTTPBearer(
    scheme_name="ADA token",
    bearerFormat="JWT",
    auto_error=False,
    description="An RS256 access token issued by the ADA realm.",
)


def _bearer_token(header: str) -> str:
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def require_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Principal:
    """The verified caller. The floor has normally already done the work."""
    stashed = getattr(request.state, "principal", None)
    if stashed is not None:
        return stashed
    # Reached only when the floor is not installed on this app, so the
    # dependency stays a complete guard on its own rather than a formality.
    token = credentials.credentials if credentials else ""
    if not token:
        raise HTTPException(
            status_code=401,
            detail="A bearer token is required: Authorization: Bearer <token>",
            headers=WWW_AUTHENTICATE,
        )
    try:
        return auth.verify(token)
    except JwksUnavailableError as exc:
        log.error("cannot verify tokens: %s", exc)
        raise HTTPException(status_code=503, detail=exc.detail) from exc
    except ADAAuthError as exc:
        raise HTTPException(
            status_code=401, detail=exc.detail, headers=WWW_AUTHENTICATE
        ) from exc


# The project envelope, not FastAPI's {"detail": ...}: a console that cannot read
# a refusal cannot tell the officer anything. request_id comes from
# RequestIdMiddleware, which must therefore wrap this one — see main.py.
def _refusal(status: int, code: str, message: str) -> JSONResponse:
    headers = {REQUEST_ID_HEADER: current_request_id()}
    if status == 401:
        headers.update(WWW_AUTHENTICATE)
    return JSONResponse(
        status_code=status, content=envelope(code, message), headers=headers
    )


class JWTMiddleware:
    """Deny by default: no verified token, no router, except on PUBLIC_PATHS.

    Pure ASGI rather than BaseHTTPMiddleware so the Principal can go straight
    into `scope["state"]`, which is what `Request.state` reads.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Normalised, because the router would 307 "/api/health/" onto the
        # public route and a literal comparison refuses it before it gets there.
        path = scope.get("path", "")
        if (path.rstrip("/") or "/") in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return

        # The floor and the endpoints resolve the same callable, so a suite that
        # replaces authentication with a dependency override moves both at once.
        # dependency_overrides is empty in a served process.
        app = scope.get("app")
        if app is not None and require_user in getattr(app, "dependency_overrides", {}):
            await self.app(scope, receive, send)
            return

        token = _bearer_token(Headers(scope=scope).get("authorization", ""))
        if not token:
            response = _refusal(
                401,
                "unauthenticated",
                "A bearer token is required: Authorization: Bearer <token>",
            )
            await response(scope, receive, send)
            return

        try:
            # Off the event loop: verification is synchronous and a cold JWKS
            # cache makes an HTTP call, which would stall every other request.
            principal = await to_thread.run_sync(auth.verify, token)
        except JwksUnavailableError as exc:
            # 503 and not 401. The token may be perfectly good and we could not
            # check it; a 401 has the client discard a valid token and send the
            # user back to a Keycloak that is also down.
            log.error("cannot verify tokens: %s", exc)
            response = _refusal(503, "unavailable", exc.detail)
            await response(scope, receive, send)
            return
        except ADAAuthError as exc:
            # The reason is for the log. The caller is told only that the token
            # is unacceptable: naming the check it failed tells an attacker how
            # far they got.
            log.info("refused a token on %s: %s", path, exc.reason)
            response = _refusal(401, "unauthenticated", exc.detail)
            await response(scope, receive, send)
            return

        scope.setdefault("state", {})["principal"] = principal
        await self.app(scope, receive, send)
