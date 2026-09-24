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
from uuid import UUID

from ada_core.database import get_db
from ada_core.validation import CaseRef
from ada_platform import Principal
from fastapi import APIRouter, BackgroundTasks, Depends, Form, Header, Path, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin, get_admin_client
from ..errors import ApiError
from ..icms import case_evidence as evidence_repo
from ..icms import cases as repo
from ..icms import notifier
from ..icms.actors import actor_directory, fill_actor_names
from ..icms.case_schemas import (
    AssigneeOptions,
    CaseAmend,
    CaseAssign,
    CaseClose,
    CaseConfirm,
    CaseCreate,
    CaseDetail,
    CaseEvidenceCreate,
    CaseEvidenceList,
    CaseEvidenceOut,
    CaseEvidenceWritten,
    CaseHandover,
    CaseQuery,
    CaseReject,
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
    db: Session, case_ref: str, scope: ZoneScope, user: Principal,
    directory: KeycloakAdmin | None, *, own_only: bool = True,
) -> CaseDetail:
    data = repo.case_detail(
        db, case_ref, scope, roles=user.roles, user_id=user.subject, own_only=own_only)
    if data is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    detail = CaseDetail(**data)
    fill_actor_names(directory, [detail], {"created_by": "created_by_name",
                                           "closed_by": "closed_by_name"})
    fill_actor_names(directory, [detail.assignment], {
        "assignee_user_id": "assignee_name", "assigned_by": "assigned_by_name"})
    fill_actor_names(directory, detail.rounds, {"surveyor_user_id": "surveyor_name"})
    return detail

@router.post(
    "/cases",
    response_model=CaseDetail,
    status_code=201,
    summary="Raise a case — allocates CMP-YYYY-NNNN",
)
def create_case(
    body: CaseCreate,
    response: Response,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
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
    else:
        notifier.case_raised(background, db, directory,
                             case_ref=created["case_ref"], actor=user.subject)
    return _detail_or_404(db, created["case_ref"], scope, user, directory, own_only=False)

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
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> CaseDetail:
    return _detail_or_404(db, case_ref, scope, user, directory)

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
    directory: KeycloakAdmin | None = Depends(actor_directory),
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
    return _detail_or_404(db, case_ref, scope, user, directory)

@router.get(
    "/cases/{case_ref}/assignees",
    response_model=AssigneeOptions,
    summary="Who this case may be assigned to — the roles, then the officers",
)
def list_case_assignees(
    case_ref: CaseRefPath,
    user: Principal = Depends(require_permission("case.assign", "case.reassign")),
    scope: ZoneScope = Depends(zone_scope),
    admin: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> AssigneeOptions:
    """The roles whose grants admit the assignee's first step, and the enabled
    officers holding one of them with an active assignment to the case's zone —
    the same two checks `POST /assign` makes, so every name offered is accepted."""
    options = repo.assignee_options(db, case_ref, scope, admin)
    if options is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return options


@router.post(
    "/cases/{case_ref}/assign",
    response_model=CaseDetail,
    summary="Assign or reassign a case to a surveyor — PCS Nodal Officer",
)
def assign_case(
    case_ref: CaseRefPath,
    body: CaseAssign,
    response: Response,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    admin: KeycloakAdmin | None = Depends(officer_directory),
    directory: KeycloakAdmin | None = Depends(actor_directory),
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
    assignment_id = repo.assign_case(db, case_ref, body, scope, actor=user.subject,
                                     roles=user.roles, admin=admin)
    if assignment_id is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    # After the commit and after the response: a notify outage never fails an assignment.
    notifier.case_assigned(background, db, directory, case_ref=case_ref,
                           assignment_id=assignment_id, actor=user.subject)
    return _detail_or_404(db, case_ref, scope, user, directory)

@router.post(
    "/cases/{case_ref}/handover",
    response_model=CaseDetail,
    summary="Hand a verified case to the ADA Project Lead — PCS Nodal Officer",
)
def hand_over_case(
    case_ref: CaseRefPath,
    background: BackgroundTasks,
    body: CaseHandover | None = None,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
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
    notifier.case_handed_over(background, db, directory, case_ref=case_ref, actor=user.subject)
    return _detail_or_404(db, case_ref, scope, user, directory)

@router.post(
    "/cases/{case_ref}/confirm",
    response_model=CaseDetail,
    summary="Confirm a handed-over case — ADA Project Lead",
)
def confirm_case(
    case_ref: CaseRefPath,
    background: BackgroundTasks,
    body: CaseConfirm | None = None,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
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
    notifier.case_confirmed(background, db, directory, case_ref=case_ref, actor=user.subject)
    return _detail_or_404(db, case_ref, scope, user, directory)


@router.post(
    "/cases/{case_ref}/reject",
    response_model=CaseDetail,
    summary="Reject a raised or assigned case — PCS Nodal Officer",
)
def reject_case(
    case_ref: CaseRefPath,
    body: CaseReject,
    response: Response,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> CaseDetail:
    """Terminal. Legal from `raised` and `assigned` only (409 otherwise); releases
    the survey assignment, so the case leaves the surveyor's worklist."""
    result = repo.reject_case(db, case_ref, body, scope, actor=user.subject, roles=user.roles)
    if result is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    if result["replayed"]:
        response.status_code = 200
    else:
        notifier.case_rejected(background, db, directory, case_ref=case_ref,
                               released_assignee=result["released_assignee"],
                               actor=user.subject)
    return _detail_or_404(db, case_ref, scope, user, directory, own_only=False)


@router.post(
    "/cases/{case_ref}/close",
    response_model=CaseDetail,
    summary="Close a case after its notice — ADA Project Lead",
)
def close_case(
    case_ref: CaseRefPath,
    body: CaseClose,
    response: Response,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> CaseDetail:
    """Terminal. Legal from `notice_issued` only (409 otherwise)."""
    result = repo.close_case(db, case_ref, body, scope, actor=user.subject, roles=user.roles)
    if result is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    if result["replayed"]:
        response.status_code = 200
    else:
        notifier.case_closed(background, db, directory, case_ref=case_ref, actor=user.subject)
    return _detail_or_404(db, case_ref, scope, user, directory, own_only=False)


@router.post(
    "/cases/{case_ref}/evidence",
    response_model=CaseEvidenceWritten,
    status_code=201,
    summary="Attach a photograph to a complaint while it is raised — append-only",
)
def add_case_evidence(
    case_ref: CaseRefPath,
    response: Response,
    meta: Annotated[CaseEvidenceCreate, Form(media_type="multipart/form-data")],
    idempotency_key: Annotated[UUID | None, Header(alias="Idempotency-Key")] = None,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseEvidenceWritten:
    """JPEG, PNG or WebP, judged by its bytes against the `complaint_photo` upload
    policy. Admitted to the roles that may raise a case, while it is `raised`.
    A replayed `Idempotency-Key` returns the first row with 200."""
    result = evidence_repo.add_case_evidence(
        db, case_ref, meta, meta.file, scope, actor=user.subject, roles=user.roles,
        idempotency_key=idempotency_key)
    if result is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    if result["replayed"]:
        response.status_code = 200
    return CaseEvidenceWritten(
        evidence=CaseEvidenceOut(**result["evidence"]), replayed=result["replayed"])


@router.get(
    "/cases/{case_ref}/evidence",
    response_model=CaseEvidenceList,
    summary="The photographs attached to a complaint at filing time",
)
def list_case_evidence(
    case_ref: CaseRefPath,
    user: Principal = Depends(require_permission("case.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseEvidenceList:
    rows = evidence_repo.case_evidence(
        db, case_ref, scope, roles=user.roles, user_id=user.subject)
    if rows is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return CaseEvidenceList(items=[CaseEvidenceOut(**row) for row in rows])


@router.get(
    "/cases/{case_ref}/evidence/{evidence_id}/content",
    response_class=FileResponse,
    summary="One complaint photograph, inline",
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}},
                     "description": "The stored bytes."}},
)
def get_case_evidence_content(
    case_ref: CaseRefPath,
    evidence_id: Annotated[int, Path(ge=1, description="The evidence row's id.")],
    user: Principal = Depends(require_permission("case.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Inline because the upload policy admits sniffed raster images only."""
    stored = evidence_repo.case_evidence_content(
        db, case_ref, evidence_id, scope, roles=user.roles, user_id=user.subject)
    if stored is None:
        raise ApiError(404, "evidence_not_found", f"no evidence {evidence_id}")
    return FileResponse(
        stored.path,
        media_type=stored.content_type or "application/octet-stream",
        filename=stored.filename,
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )
