"""Request dependencies: the bearer token, the principal, and the project.

The tenancy boundary lives here. Every handler that touches project-scoped data
depends on CurrentProject, and the project it returns comes from the token's azp
claim — never from the request body, a path parameter or a header. There is no
code path by which a caller names the project it is acting as.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import structlog
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.models import Project
from app.security import Principal, TokenError, TokenVerifier

logger = structlog.get_logger(__name__)

# WWW-Authenticate on a 401 is what tells a client to refresh rather than to give
# up. With a 60-second token lifetime, clients hit this constantly and correct
# behaviour depends on it.
_BEARER = {"WWW-Authenticate": 'Bearer realm="ada"'}

# Declared as a security scheme rather than read as a plain header, because that
# is what puts the Authorize button on the /docs page and marks every endpoint
# below as protected in the OpenAPI document. Generated clients read the same
# thing.
#
# auto_error=False: FastAPI's own 401 is a bare {"detail": ...} with no
# WWW-Authenticate header. The handling stays here so the error shape is the one
# the rest of the API uses.
bearer_scheme = HTTPBearer(
    scheme_name="Machine token",
    bearerFormat="JWT",
    auto_error=False,
    description=(
        "An RS256 access token from the realm, carrying the notify:send scope.\n\n"
        "Get one with `make token`, then paste it here — Swagger adds the "
        "`Bearer ` prefix itself, so paste the token alone.\n\n"
        "Tokens are short-lived. If calls start returning 401, fetch a new one."
    ),
)


def get_verifier(request: Request) -> TokenVerifier:
    verifier = getattr(request.app.state, "verifier", None)
    if verifier is None:  # pragma: no cover — only reachable on a broken startup
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Token verification is not initialised",
        )
    return verifier


async def get_principal(
    verifier: Annotated[TokenVerifier, Depends(get_verifier)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> Principal:
    # None covers both "no Authorization header" and "a scheme that is not
    # Bearer" — HTTPBearer collapses the two when auto_error is off. They get
    # the same answer anyway: this API takes a bearer token or nothing.
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A bearer token is required: Authorization: Bearer <token>",
            headers=_BEARER,
        )

    try:
        return await verifier.verify(credentials.credentials)
    except TokenError as exc:
        # The reason is logged; the caller is told only that the token is not
        # acceptable. Distinguishing 'unknown_kid' from 'bad signature' in the
        # response tells an attacker which of the two they achieved.
        logger.info("token_rejected", reason=exc.reason)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.detail, headers=_BEARER
        ) from exc


async def get_project(
    principal: Annotated[Principal, Depends(get_principal)],
    session: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Project:
    if not principal.has_scope(settings.required_scope):
        # 403, not 401: the token is valid, it simply does not carry this. A 401
        # would send the client off to fetch another identical token.
        logger.info("scope_missing", azp=principal.azp, scopes=sorted(principal.scopes))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Token lacks the required scope '{settings.required_scope}'",
        )

    project = await session.scalar(select(Project).where(Project.client_id == principal.azp))

    if project is None:
        logger.warning("project_not_registered", azp=principal.azp)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Client '{principal.azp}' is not registered as an ADA project. "
                "Register it before sending notifications."
            ),
        )

    if not project.enabled:
        logger.warning("project_disabled", project=project.key)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=f"Project '{project.key}' is disabled"
        )

    return project


user_bearer_scheme = HTTPBearer(
    scheme_name="User token",
    bearerFormat="JWT",
    auto_error=False,
    description="The signed-in user's own Keycloak access token (the field app's token).",
)


async def get_user_principal(
    verifier: Annotated[TokenVerifier, Depends(get_verifier)],
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(user_bearer_scheme)
    ] = None,
) -> Principal:
    return await get_principal(verifier, credentials)


async def get_user_subject(
    principal: Annotated[Principal, Depends(get_user_principal)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> uuid.UUID:
    """The Keycloak sub of an end user calling /v1/me; machine tokens are refused."""
    # An ID token is RS256 from the same issuer; only access tokens may call in.
    if principal.claims.get("typ", "Bearer") != "Bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="An access token is required",
            headers=_BEARER,
        )
    if principal.is_service_account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint takes a user's token, not a service account's",
        )
    if principal.azp not in settings.user_clients:
        logger.info("user_client_refused", azp=principal.azp)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Client '{principal.azp}' may not call user endpoints",
        )
    try:
        return uuid.UUID(principal.subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Token subject is not a user id"
        ) from exc


CurrentUserSub = Annotated[uuid.UUID, Depends(get_user_subject)]
CurrentPrincipal = Annotated[Principal, Depends(get_principal)]
CurrentProject = Annotated[Project, Depends(get_project)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]
