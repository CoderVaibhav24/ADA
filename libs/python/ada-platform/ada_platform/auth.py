"""Two decorators, and no other work for an integrating application.

    auth = ADAAuth(issuer=os.environ["ADA_ISSUER"])

    @app.get("/leave")
    async def my_leave(user: Principal = Depends(auth.require_user)):
        ...

    @app.post("/leave/{id}/approve")
    async def approve(user: Principal = Depends(auth.require_scope("leave:approve"))):
        ...

That is the whole integration surface for authentication. Everything underneath —
discovery, key caching, rotation, algorithm refusal, clock skew — happens without
the application knowing, which is the point: every application getting this right
independently is how an estate ends up with one that does not.

## FastAPI without depending on FastAPI

`fastapi` and `starlette` are imported lazily inside the dependency factories, so
a Celery worker or a script can use ADANotify and Principal without installing
a web framework. An application that does use the decorators has FastAPI already.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from typing import Any

import httpx

from ada_platform.errors import (
    ADAAuthError,
    ADAConfigError,
    ADAScopeError,
    JwksUnavailableError,
)
from ada_platform.verify import JWKSCache, Principal, TokenVerifier

log = logging.getLogger("ada_platform.auth")

_WWW_AUTHENTICATE = {"WWW-Authenticate": 'Bearer realm="ada"'}


class ADAAuth:
    """Verifies ADA tokens locally and turns them into FastAPI dependencies."""

    def __init__(
        self,
        *,
        issuer: str | None = None,
        internal_issuer_url: str | None = None,
        jwks_cache_seconds: int = 3600,
        jwks_hard_ttl_seconds: int = 86_400,
        leeway_seconds: int = 10,
        timeout_seconds: float = 5.0,
        client: httpx.Client | None = None,
        require_typ: str | None = "Bearer",
        allowed_azp: frozenset[str] | None = None,
        reject_service_accounts: bool = False,
    ) -> None:
        issuer = issuer or os.environ.get("ADA_ISSUER", "")
        if not issuer:
            # At construction, not at first request. A deployment with the wrong
            # environment should fail to start rather than fail the first login.
            raise ADAConfigError(
                "No issuer. Pass issuer=... or set ADA_ISSUER, e.g. "
                "https://auth.pcsmcpl.net/realms/pcsmcpl"
            )

        self.issuer = issuer.rstrip("/")
        self._client = client or httpx.Client(timeout=timeout_seconds)
        self._jwks = JWKSCache(
            self.issuer,
            self._client,
            cache_seconds=jwks_cache_seconds,
            hard_ttl_seconds=jwks_hard_ttl_seconds,
            internal_issuer_url=internal_issuer_url
            or os.environ.get("ADA_INTERNAL_ISSUER_URL"),
        )
        self._verifier = TokenVerifier(
            self.issuer,
            self._jwks,
            leeway_seconds=leeway_seconds,
            require_typ=require_typ,
            allowed_azp=allowed_azp,
            reject_service_accounts=reject_service_accounts,
        )

    # --- framework-free ------------------------------------------------------

    def verify(self, token: str) -> Principal:
        """Verify a raw token. Raises ADAAuthError. No network call per call."""
        return self._verifier.verify(token)

    def ready(self) -> bool:
        """True when a signing key verify() would still serve is cached, or can be
        fetched now. Never raises.

        Keys past the hard TTL do not count: verify() refuses them too. A probe
        that has to fetch tries at most once per _READY_RETRY_SECONDS, so a
        readiness check every second cannot turn a Keycloak outage into load.
        """
        cache = self._jwks
        try:
            with cache._lock:
                if self._servable(cache):
                    return True
                now = time.monotonic()
                if now - self._ready_attempt_at < self._READY_RETRY_SECONDS:
                    return False
                self._ready_attempt_at = now
                cache._refresh()
                return self._servable(cache)
        except Exception:
            log.warning("JWKS not ready", exc_info=True)
            return False

    _READY_RETRY_SECONDS = 10.0
    _ready_attempt_at = float("-inf")

    @staticmethod
    def _servable(cache: JWKSCache) -> bool:
        age = time.monotonic() - cache._fetched_at
        return bool(cache._keys) and age < cache._hard_ttl_seconds

    # --- FastAPI -------------------------------------------------------------

    def _bearer(self) -> Any:
        from fastapi.security import HTTPBearer

        # auto_error=False so the 401 below is ours: FastAPI's own is a bare
        # {"detail": ...} with no WWW-Authenticate header, and a client with a
        # 60-second token needs that header to know to refresh rather than stop.
        return HTTPBearer(
            scheme_name="ADA token",
            bearerFormat="JWT",
            auto_error=False,
            description="An RS256 access token issued by the ADA realm.",
        )

    @property
    def require_user(self) -> Callable[..., Any]:
        """A FastAPI dependency yielding the Principal, or answering 401."""
        from fastapi import Depends, HTTPException

        bearer = self._bearer()

        def dependency(credentials: Any = Depends(bearer)) -> Principal:
            if credentials is None or not credentials.credentials:
                raise HTTPException(
                    status_code=401,
                    detail="A bearer token is required: Authorization: Bearer <token>",
                    headers=_WWW_AUTHENTICATE,
                )
            try:
                return self.verify(credentials.credentials)
            except JwksUnavailableError as exc:
                # 503, not 401: the token may well be fine and we could not
                # check it. A 401 would have the client discard a good token.
                raise HTTPException(status_code=503, detail=exc.detail) from exc
            except ADAAuthError as exc:
                # The reason is for a log; the caller is told only that the token
                # is not acceptable. Telling an attacker which of 'unknown key'
                # and 'bad signature' they achieved is telling them where they got to.
                raise HTTPException(
                    status_code=401, detail=exc.detail, headers=_WWW_AUTHENTICATE
                ) from exc

        return dependency

    def require_scope(self, scope: str) -> Callable[..., Any]:
        """A FastAPI dependency requiring one scope. 403 when it is absent."""
        from fastapi import Depends, HTTPException

        user_dependency = self.require_user

        def dependency(user: Principal = Depends(user_dependency)) -> Principal:
            if not user.has_scope(scope):
                # 403 rather than 401 — see errors.py. A 401 would send the
                # client to fetch an identical token, forever.
                error = ADAScopeError(scope, user.scopes)
                raise HTTPException(status_code=403, detail=error.detail)
            return user

        return dependency

    def close(self) -> None:
        self._client.close()
