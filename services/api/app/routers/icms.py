"""ICMS Batch 1 — reference data and geography.

The endpoints in `docs/ICMS-API-Build-Order-and-Workflow.md` section 3, Batch 1.
Read-mostly, and the batch every form and the map wait on.

Each handler is the pipeline from section 4 of that document, with the steps in
that order and none of them skipped:

    Pydantic request model -> require_user -> require_role -> zone_scope
    -> repository (parameter-bound) -> typed response model

`workflow.check` does not appear, and its absence is not an omission: Batch 1
moves no case, so there is no transition to check. Super Admin holds no
transition either (section 6), so it may not ACT on a case — which is not the
same as not seeing one. By the decision of 2026-09-23 it holds every
enforcement read, district-wide, and administration of zones and lookups on top
of that. The two authorities are separate and this batch is entirely on the
administrative side of the line.

No `icms_case_event` row is written here for the same reason. Rule 1 binds a
domain write to the event that records the case it moved; a zone rename moves no
case. When Batch 2 adds one, the event row is written in the same transaction as
the row it describes, and `docs` says so in a way that is checkable.
"""

from __future__ import annotations

from typing import Annotated

from ada_core.database import get_db
from ada_core.validation import MAX_CLOCK_SKEW
from ada_platform import Principal
from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from ..config import settings
from ..errors import ApiError
from ..icms import repository as repo
from ..icms.collection import Page
from ..icms.schemas import (
    AppConfigOut,
    CodeValueOut,
    CodeValueQuery,
    ZoneAssignmentCreate,
    ZoneAssignmentOut,
    ZoneAssignmentQuery,
    ZoneAssignmentRevoked,
    ZoneAssignmentTarget,
    ZoneCode,
    ZoneCreate,
    ZoneDetail,
    ZoneOut,
    ZoneQuery,
    ZoneUpdate,
)
from ..icms.security import (
    ZoneScope,
    require_icms_user,
    require_permission,
    zone_scope,
)

router = APIRouter(prefix="/icms", tags=["icms-reference"])

ZoneCdPath = Annotated[
    ZoneCode,
    Path(description="The zone's natural key, as `icms_zone.zone_cd` holds it."),
]

# Read from the setting and the constant the enforcing code reads, never copied:
# a second literal here is the drift this endpoint exists to end.
@router.get(
    "/app-config",
    response_model=AppConfigOut,
    summary="The server-side rules a field client must not duplicate",
)
def get_app_config(
    user: Principal = Depends(require_icms_user),
) -> AppConfigOut:
    """Readable by every ICMS role, with no extra permission and no database.

    The field app had a copy of the accuracy rule in its own source, and the copy
    went stale the moment one threshold became a gate and a flag. A client that
    reads this cannot drift; a client that hard-codes it will, and silently.

    Five fields since 2026-09-23, when the photograph counts joined the three
    that were here: they are published because they are now enforced — `submit`
    refuses a round below the minimum 422 `missing_payload` and `add_evidence`
    refuses a photograph past the maximum 422 `too_many_photos`. Enforcement
    first, then publication; a count nobody is held to would make this endpoint
    the very thing it replaces.
    """
    return AppConfigOut(
        gps_accuracy_gate_m=settings.icms_accuracy_gate_m,
        gps_accuracy_flag_m=settings.icms_accuracy_flag_m,
        device_timestamp_max_age_hours=MAX_CLOCK_SKEW.total_seconds() / 3600,
        minimum_photo_count=settings.icms_min_photos_per_round,
        maximum_photo_count=settings.icms_max_photos_per_round,
    )


@router.get(
    "/code-values",
    response_model=Page[CodeValueOut],
    summary="The lookup vocabulary for a domain",
)
def list_code_values(
    params: Annotated[CodeValueQuery, Query()],
    user: Principal = Depends(require_permission("reference.read")),
    db: Session = Depends(get_db),
) -> Page[CodeValueOut]:
    """`complaint_type`, `property_type`, `area_type`, `delivery_mode`.

    Readable by every ICMS role: a Field Surveyor whose app cannot load its
    complaint types has no usable form, and the vocabulary is not sensitive.
    """
    result = repo.list_code_values(db, params)
    items = [CodeValueOut(**row) for row in repo.rows_to_dicts(result)]
    return Page[CodeValueOut].of(items, result)

@router.get("/zones", response_model=Page[ZoneOut], summary="Zones, without geometry")
def list_zones(
    params: Annotated[ZoneQuery, Query()],
    user: Principal = Depends(require_permission("zone.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> Page[ZoneOut]:
    """Scoped to the caller's zone assignments. Super Admin sees all of them."""
    result = repo.list_zones(db, params, scope)
    items = [ZoneOut(**row) for row in repo.rows_to_dicts(result)]
    return Page[ZoneOut].of(items, result)

@router.get(
    "/zones/{zone_cd}",
    response_model=ZoneDetail,
    summary="One zone, with its boundary as GeoJSON",
)
def get_zone(
    zone_cd: ZoneCdPath,
    user: Principal = Depends(require_permission("zone.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> ZoneDetail:
    zone = repo.get_zone(db, zone_cd, scope)
    if zone is None:
        raise ApiError(404, "zone_not_found", f"no zone {zone_cd}")
    return ZoneDetail(**zone)

@router.post(
    "/zones",
    response_model=ZoneDetail,
    status_code=201,
    summary="Create a zone — Super Admin only",
)
def create_zone(
    body: ZoneCreate,
    user: Principal = Depends(require_permission("zone.manage")),
    db: Session = Depends(get_db),
) -> ZoneDetail:
    zone = repo.create_zone(db, body)
    if zone is None:
        raise ApiError(
            409, "zone_exists", f"a zone {body.zone_cd} already exists", field="zone_cd"
        )
    return ZoneDetail(**zone)


@router.put(
    "/zones/{zone_cd}",
    response_model=ZoneDetail,
    summary="Replace a zone's attributes — Super Admin only",
)
def update_zone(
    zone_cd: ZoneCdPath,
    body: ZoneUpdate,
    user: Principal = Depends(require_permission("zone.manage")),
    db: Session = Depends(get_db),
) -> ZoneDetail:
    """`zone_cd` is the key and is not rewritable.

    Renaming a natural key that `icms_case.zone_id` was resolved through, and
    that the legacy register still joins on, is a migration rather than an edit.
    A zone that should no longer be used is deactivated.
    """
    zone = repo.update_zone(db, zone_cd, body)
    if zone is None:
        raise ApiError(404, "zone_not_found", f"no zone {zone_cd}")
    return ZoneDetail(**zone)

@router.get(
    "/zone-assignments",
    response_model=Page[ZoneAssignmentOut],
    summary="Who may see which zone — Super Admin only",
)
def list_zone_assignments(
    params: Annotated[ZoneAssignmentQuery, Query()],
    user: Principal = Depends(require_permission("zone_assignment.manage")),
    db: Session = Depends(get_db),
) -> Page[ZoneAssignmentOut]:
    """Not zone-scoped, and deliberately so.

    The register of who can see what is administration of the permission system
    itself. Scoping it to the caller's own assignments would make it answer a
    different question, and the only role that can reach it is unrestricted
    anyway.
    """
    result = repo.list_zone_assignments(db, params)
    items = [ZoneAssignmentOut(**row) for row in repo.rows_to_dicts(result)]
    return Page[ZoneAssignmentOut].of(items, result)


@router.post(
    "/zone-assignments",
    response_model=ZoneAssignmentOut,
    status_code=201,
    summary="Grant an officer sight of a zone — Super Admin only",
)
def create_zone_assignment(
    body: ZoneAssignmentCreate,
    response: Response,
    user: Principal = Depends(require_permission("zone_assignment.manage")),
    db: Session = Depends(get_db),
) -> ZoneAssignmentOut:
    """201 when it opened an assignment, 200 when one was already open."""
    row, created = repo.create_zone_assignment(db, body, actor=user.subject)
    if row is None:
        raise ApiError(
            404, "zone_not_found", f"no zone {body.zone_cd}", field="zone_cd"
        )
    if not created:
        response.status_code = 200
    return ZoneAssignmentOut(**row)


@router.delete(
    "/zone-assignments",
    response_model=ZoneAssignmentRevoked,
    summary="Revoke an officer's sight of a zone — Super Admin only",
)
def revoke_zone_assignment(
    target: Annotated[ZoneAssignmentTarget, Query()],
    user: Principal = Depends(require_permission("zone_assignment.manage")),
    db: Session = Depends(get_db),
) -> ZoneAssignmentRevoked:
    outcome = repo.revoke_zone_assignment(db, target)
    if outcome is None:
        raise ApiError(
            404, "zone_not_found", f"no zone {target.zone_cd}", field="zone_cd"
        )
    revoked, revoked_at = outcome
    return ZoneAssignmentRevoked(
        zone_cd=target.zone_cd,
        user_id=target.user_id,
        revoked=revoked,
        revoked_at=revoked_at,
    )
