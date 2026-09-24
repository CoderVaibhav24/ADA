"""Server-driven screens for the field app: read the published ones, author new ones.

Reads are for any ICMS officer and are capability-checked per screen. Writes are
Super Admin only, and every write re-validates the tree against the contract, so
a definition the app cannot render never becomes the served version. The path is
outside /api/icms, where the global handlers do not envelope a validation error,
so this router's route class does it. Design: docs/Agents-Mobile/sdui.md.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from ada_core.database import get_db
from ada_core.models_app import AppScreen
from ada_platform import Principal
from fastapi import APIRouter, Depends, Header, Path, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from ..errors import ApiError, envelope
from ..icms import policy, screens
from ..icms.screen_schemas import (
    PublishIn,
    RollbackIn,
    ScreenDraftIn,
    ScreenIndexItem,
    ScreenIndexOut,
    ScreenOut,
    ScreenVersionOut,
)
from ..icms.security import icms_roles, require_icms_user, require_super_admin

# Revalidate on every use and never share: the answer depends on the caller's capabilities.
CACHE_CONTROL = "private, no-cache"
RUNTIME_PATTERN = r"^\d{1,3}(\.\d{1,3}){0,2}$"


class _EnvelopedRoute(APIRoute):
    """Answers a request-validation failure with the house error envelope."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def enveloped(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                errors = jsonable_encoder(exc.errors())
                first = errors[0] if errors else {}
                location = [str(p) for p in first.get("loc", ()) if p not in ("body", "query",
                                                                             "path", "header")]
                return JSONResponse(
                    status_code=422,
                    content=envelope(
                        "validation_failed",
                        first.get("msg", "the request could not be validated"),
                        field=".".join(location) or None,
                    ),
                )

        return enveloped


router = APIRouter(prefix="/app", tags=["app-screens"], route_class=_EnvelopedRoute)

ScreenId = Annotated[str, Path(pattern=screens.SCREEN_ID_PATTERN)]


def _permissions_of(user: Principal) -> frozenset[str]:
    return policy.snapshot().permitted(user.roles)


# The permission codes a definition may name: every code the loaded policy knows.
def _known_permissions() -> frozenset[str]:
    return frozenset(policy.snapshot().permissions)


def _may_see(row: AppScreen, held: frozenset[str]) -> bool:
    return row.required_capability is None or row.required_capability in held


def _cache_headers(response: Response, etag: str) -> None:
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = CACHE_CONTROL
    response.headers["Vary"] = "Authorization"


def _not_modified(etag: str) -> Response:
    response = Response(status_code=304)
    _cache_headers(response, etag)
    return response


def _version_out(row: AppScreen, serving_version: int | None) -> ScreenVersionOut:
    return ScreenVersionOut(
        screen_id=row.screen_id,
        version=row.version,
        status=row.status,
        serving=row.version == serving_version,
        schema_version=row.schema_version,
        min_app_runtime=row.min_app_runtime,
        title=row.title,
        required_capability=row.required_capability,
        source_version=row.source_version,
        definition=row.definition,
        created_at=row.created_at,
        created_by=row.created_by,
        published_at=row.published_at,
        published_by=row.published_by,
    )


@router.get(
    "/screens",
    response_model=ScreenIndexOut,
    summary="The published screens this officer may open, for server-driven menus",
)
def screen_index(
    response: Response,
    runtime: Annotated[str | None, Query(pattern=RUNTIME_PATTERN)] = None,
    if_none_match: Annotated[str | None, Header()] = None,
    user: Principal = Depends(require_icms_user),
    db: Session = Depends(get_db),
):
    """Newest published version of each screen; filtered by capability, and by runtime when sent."""
    held = _permissions_of(user)
    floor = screens.parse_runtime(runtime)
    items = [
        ScreenIndexItem(
            screen_id=row.screen_id,
            version=row.version,
            title=row.title,
            min_app_runtime=row.min_app_runtime,
            etag=screens.etag_of(row),
        )
        for row in screens.published_index(db)
        if _may_see(row, held)
        and (floor is None or screens.parse_runtime(row.min_app_runtime) <= floor)
    ]
    digest = hashlib.sha256("|".join(item.etag for item in items).encode()).hexdigest()[:16]
    etag = f'"index-{digest}"'
    if screens.etag_matches(if_none_match, etag):
        return _not_modified(etag)
    _cache_headers(response, etag)
    return ScreenIndexOut(items=items)


@router.get(
    "/screens/{screen_id}",
    response_model=ScreenOut,
    responses={304: {"description": "The copy the app holds is current."}},
    summary="The published screen, if this officer may see it and this app can render it",
)
def get_screen(
    screen_id: ScreenId,
    response: Response,
    runtime: Annotated[str, Query(pattern=RUNTIME_PATTERN,
                                  description="The app's SDUI runtime, e.g. 1.0.")],
    have_version: Annotated[int | None, Query(
        ge=1, description="The version the app has cached; 304 when it is still current. "
                          "For clients that cannot send If-None-Match.")] = None,
    if_none_match: Annotated[str | None, Header()] = None,
    user: Principal = Depends(require_icms_user),
    db: Session = Depends(get_db),
):
    row = screens.latest_published(db, screen_id)
    if row is None:
        raise ApiError(404, "screen_not_found", f"no published screen '{screen_id}'")
    if not _may_see(row, _permissions_of(user)):
        allowed = policy.snapshot().roles_holding({row.required_capability}) & icms_roles()
        raise ApiError(403, "role_not_permitted",
                       f"this screen requires one of: {', '.join(sorted(allowed)) or 'none'}",
                       allowed=allowed)
    if screens.parse_runtime(runtime) < screens.parse_runtime(row.min_app_runtime):
        raise ApiError(426, "app_update_required",
                       f"this screen needs app runtime {row.min_app_runtime}; update the app",
                       field="runtime", allowed=[row.min_app_runtime])

    etag = screens.etag_of(row)
    if screens.etag_matches(if_none_match, etag) or have_version == row.version:
        return _not_modified(etag)
    _cache_headers(response, etag)
    return ScreenOut(
        screen_id=row.screen_id,
        version=row.version,
        schema_version=row.schema_version,
        min_app_runtime=row.min_app_runtime,
        title=row.title,
        definition=row.definition,
        etag=etag,
        published_at=row.published_at,
    )


@router.get(
    "/screens/{screen_id}/versions",
    response_model=list[ScreenVersionOut],
    summary="Every stored version of a screen, newest first (Super Admin)",
)
def screen_versions(
    screen_id: ScreenId,
    user: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> list[ScreenVersionOut]:
    rows = screens.list_versions(db, screen_id)
    if not rows:
        raise ApiError(404, "screen_not_found", f"no screen '{screen_id}'")
    serving = next((row.version for row in rows if row.status == "published"), None)
    return [_version_out(row, serving) for row in rows]


@router.put(
    "/screens/{screen_id}",
    response_model=ScreenVersionOut,
    status_code=201,
    summary="Store a new draft version of a screen (Super Admin)",
)
def put_screen(
    screen_id: ScreenId,
    body: ScreenDraftIn,
    user: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ScreenVersionOut:
    row = screens.create_draft(
        db,
        screen_id=screen_id,
        definition=body.definition,
        schema_version=body.schema_version,
        min_app_runtime=body.min_app_runtime,
        required_capability=body.required_capability,
        permissions=_known_permissions(),
        actor=user.subject,
    )
    current = screens.latest_published(db, screen_id)
    return _version_out(row, current.version if current else None)


@router.post(
    "/screens/{screen_id}/publish",
    response_model=ScreenVersionOut,
    summary="Publish a draft; it becomes the served version (Super Admin)",
)
def publish_screen(
    screen_id: ScreenId,
    body: PublishIn | None = None,
    user: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ScreenVersionOut:
    row = screens.publish(
        db,
        screen_id=screen_id,
        version=body.version if body else None,
        permissions=_known_permissions(),
        actor=user.subject,
    )
    return _version_out(row, row.version)


@router.post(
    "/screens/{screen_id}/rollback",
    response_model=ScreenVersionOut,
    status_code=201,
    summary="Serve an earlier published version again, as a new version (Super Admin)",
)
def rollback_screen(
    screen_id: ScreenId,
    body: RollbackIn,
    user: Principal = Depends(require_super_admin),
    db: Session = Depends(get_db),
) -> ScreenVersionOut:
    row = screens.rollback(
        db,
        screen_id=screen_id,
        to_version=body.to_version,
        permissions=_known_permissions(),
        actor=user.subject,
    )
    return _version_out(row, row.version)
