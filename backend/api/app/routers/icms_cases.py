"""ICMS Batch 2 — the case spine, stages 1 and 2.

The first real product surface: raise a complaint, list the register, read one
case, correct its descriptive fields, and assign it to a surveyor.

Every handler is the pipeline from section 4 of the build-order document, and
this is the batch where the fifth step finally does something:

    Pydantic request model -> require_user -> require_role -> zone_scope
    -> workflow.check -> repository -> BEGIN write rows + event + reference
    COMMIT -> typed response model

Two things the routers here deliberately do NOT do.

They do not decide the next status. `workflow.check` returns the `Transition`
and the repository reads `target` and `stage_no` off it. A router that picks the
status itself is a router that will eventually disagree with the table, and the
legacy system is the worked example: `complain.js` sets `status` by string
assignment in eleven places and the register ends up spelling one state
`In Progress`, `IN PROGRESS` and `INSPECTION REPORT SUBMITED`.

They do not decide who may act. The route-level `require_role` answers only "is
this an ICMS caller at all"; which roles may make a given move is in the
transition table. That is why a Super Admin reaches `POST /cases` and is then
refused by the policy with a 403 — Super Admin holds no transition, by design,
and so may not act on a case. It may still READ every one: `case.read` and
`case.export` are its by the decision of 2026-09-23, recorded at
`icms/policy.py`'s DEFAULT_GRANTS. The line is drawn at the write, not the read.
"""

from __future__ import annotations

from typing import Annotated

from ada_core.database import get_db
from ada_core.validation import CaseRef
from ada_platform import Principal
from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin, get_admin_client
from ..errors import ApiError
from ..icms import cases as repo
from ..icms.case_schemas import (
    CaseAmend,
    CaseAssign,
    CaseConfirm,
    CaseCreate,
    CaseDetail,
    CaseHandover,
    CaseQuery,
    CaseRow,
)
from ..icms.collection import Page
from ..icms.security import ZoneScope, require_icms_user, require_permission, zone_scope

router = APIRouter(prefix="/icms", tags=["icms-cases"])

CaseRefPath = Annotated[
    CaseRef, Path(description="The case reference, e.g. `CMP-2026-0001`.")
]


# None where administration is unconfigured; assignment must not stop with it.
def officer_directory() -> KeycloakAdmin | None:
    try:
        return get_admin_client()
    except ApiError:
        return None


def _detail_or_404(
    db: Session, case_ref: str, scope: ZoneScope, user: Principal, *,
    own_only: bool = True,
) -> CaseDetail:
    data = repo.case_detail(
        db, case_ref, scope, roles=user.roles, user_id=user.subject, own_only=own_only)
    if data is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return CaseDetail(**data)

@router.post(
    "/cases",
    response_model=CaseDetail,
    status_code=201,
    summary="Raise a case — allocates CMP-YYYY-NNNN",
)
def create_case(
    body: CaseCreate,
    response: Response,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseDetail:
    """Stage 1.

    The zone is resolved by `ST_Contains` when a location is given, the
    reference is allocated from the year's counter row, and the `icms_case_event`
    row is written — all three inside one transaction. A rollback anywhere gives
    the reference back rather than leaving a hole in the register.

    The zone must be one the caller already has sight of, whether they named it
    or a location resolved it, so a case cannot be filed into a register its
    author cannot read. The read-back is the caller's own scope for the same
    reason, less the assignment narrowing: the author is not the assignee.

    Not open to Super Admin: administration is a different authority from
    enforcement, and the refusal comes from the transition table rather than from
    this function.
    """
    created = repo.raise_case(db, body, scope, actor=user.subject, roles=user.roles)
    if created["replayed"]:
        response.status_code = 200
    return _detail_or_404(db, created["case_ref"], scope, user, own_only=False)

@router.get(
    "/cases",
    response_model=Page[CaseRow],
    summary="The complaints register — paginated, filtered, zone-scoped",
)
def list_cases(
    params: Annotated[CaseQuery, Query()],
    user: Principal = Depends(require_permission("case.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> Page[CaseRow]:
    """Everything the Complaints grid renders, from one call.

    Scoped to the caller's zones, counted over the scoped selectable, and paged
    at the database. A Field Surveyor holding no supervisory role is narrowed
    again, to their own open assignments, whether or not they send `mine=true` —
    which stays a filter for the officers who legitimately see more.
    """
    result = repo.register(db, params, scope, caller=user.subject, roles=user.roles)
    items = [CaseRow(**row) for row in repo.rows_to_dicts(result)]
    return Page[CaseRow].of(items, result)


@router.get(
    "/cases/{case_ref}",
    response_model=CaseDetail,
    summary="One case, with its assignment, rounds and evidence count",
)
def get_case(
    case_ref: CaseRefPath,
    user: Principal = Depends(require_permission("case.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseDetail:
    return _detail_or_404(db, case_ref, scope, user)

@router.patch(
    "/cases/{case_ref}",
    response_model=CaseDetail,
    summary="Correct a case's descriptive fields — PCS Nodal Officer only",
)
def amend_case(
    case_ref: CaseRefPath,
    body: CaseAmend,
    user: Principal = Depends(require_permission("case.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseDetail:
    """Descriptive fields only; the status does not move and no stage changes.

    `status`, `stage_no`, `zone_id` and `case_ref` are not fields of the request
    model, so `extra="forbid"` refuses them by name. The legacy route this
    replaces — `PUT /icms/complain/updateComplainStatus` — accepts a
    client-supplied status and a client-supplied id on an unauthenticated route.

    A closed or rejected case is refused with a 409 by `workflow.check_amendable`:
    once a case is closed its record is the record.
    """
    if not repo.amend_case(db, case_ref, body, scope, actor=user.subject, roles=user.roles):
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return _detail_or_404(db, case_ref, scope, user)

@router.post(
    "/cases/{case_ref}/assign",
    response_model=CaseDetail,
    summary="Assign or reassign a case to a surveyor — PCS Nodal Officer",
)
def assign_case(
    case_ref: CaseRefPath,
    body: CaseAssign,
    response: Response,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    admin: KeycloakAdmin | None = Depends(officer_directory),
    db: Session = Depends(get_db),
) -> CaseDetail:
    """Stage 2.

    One endpoint for `assign` and `reassign`: the case's current status decides
    which transition applies, read off the table. A reassignment closes the open
    assignment row and opens a new one rather than updating the assignee, so
    "who held this case, and when" stays answerable afterwards.

    The assignee must have an active zone assignment for the case's zone. An
    officer who cannot see the zone cannot see the case, and a case assigned into
    that hole is work nobody is looking at. They must also hold `field-surveyor`:
    every transition this assignment opens is an assignee-only one that the
    transition table admits to that role alone.
    """
    if not repo.assign_case(db, case_ref, body, scope, actor=user.subject,
                            roles=user.roles, admin=admin):
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return _detail_or_404(db, case_ref, scope, user)

@router.post(
    "/cases/{case_ref}/handover",
    response_model=CaseDetail,
    summary="Hand a verified case to the ADA Project Lead — PCS Nodal Officer",
)
def hand_over_case(
    case_ref: CaseRefPath,
    body: CaseHandover | None = None,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseDetail:
    """Stage 6 — internal, from the nodal officer to the project lead.

    Not the Parivartan seam. That is after `issue_notice`, it belongs to Batch 6,
    and nothing here reaches outside this service — the decision of 2026-09-23,
    recorded at `ICMS-API-Build-Order-and-Workflow.md` section 3a.

    Zone scope decides whether the case exists for this caller, the transition
    table decides that only a PCS Nodal Officer may make the move, and there is
    no ownership constraint beyond those two: no row binds a nodal officer to a
    case, so "the officer who verified it" is not a thing the schema can name.
    """
    if not repo.hand_over_case(db, case_ref, body or CaseHandover(), scope,
                               actor=user.subject, roles=user.roles):
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return _detail_or_404(db, case_ref, scope, user)

@router.post(
    "/cases/{case_ref}/confirm",
    response_model=CaseDetail,
    summary="Confirm a handed-over case — ADA Project Lead",
)
def confirm_case(
    case_ref: CaseRefPath,
    body: CaseConfirm | None = None,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseDetail:
    """Stage 7 — the move that unlocks the notice, and the last one before it.

    A confirmation before a handover is a 409 from the transition table rather
    than a silent no-op: `confirm` is legal from `handed_over` and from nothing
    else, so the two compose in one direction only.
    """
    if not repo.confirm_case(db, case_ref, body or CaseConfirm(), scope,
                             actor=user.subject, roles=user.roles):
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return _detail_or_404(db, case_ref, scope, user)
