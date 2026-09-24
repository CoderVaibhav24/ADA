"""ICMS Batch 3 — the inspection loop, stages 3 to 5.

Open a round, stand at the property and check in, upload what was photographed,
record what was found, submit it, and have a nodal officer accept it or send it
back for another round. The field app depends on this batch entirely.

Every handler is the pipeline from section 4 of the build-order document:

    Pydantic request model -> require_user -> require_role -> zone_scope
    -> workflow.check -> repository -> BEGIN write rows + event + reference
    COMMIT -> typed response model

Two things the routers here deliberately do NOT do.

They do not decide the next status. `workflow.check` returns the `Transition`
and the repository reads `target` and `stage_no` off it — including the two
different targets of `POST /verify`, where the router's only judgement is which
ACTION the decision names. A router that picks the status itself is a router
that will eventually disagree with the table.

They do not decide who may act. The route-level dependency answers only "is this
an ICMS caller at all"; which roles may make a given move is in the transition
table, and four of this batch's moves are assignee-only on top of that — a Field
Surveyor may submit an inspection and may not submit somebody else's. That
distinction is what decides whether a photograph is attributable to the person
who took it, and the legacy system never drew it.

Three properties worth knowing before reading the handlers.

**Evidence is append-only.** There is no PUT and no DELETE on it here, and there
is to be none in a later batch either. A re-survey adds a round; it never
replaces one, so round 1 stays readable after round 2 exists.

**A replay is not an error.** `check-in`, `evidence` and `submit` each answer a
repeated request with the row the first attempt wrote, under 200 rather than 201
— never a duplicate and never a 409. That is what lets a handset on a bad
connection retry an upload it cannot tell landed.

**A poor fix is recorded, not hidden.** A check-in worse than the configured
accuracy threshold is refused outright; evidence worse than it, or with no
position at all, is stored flagged. The one thing that cannot happen is a
capture with no fix quietly becoming geo-tagged evidence.
"""

from __future__ import annotations

from typing import Annotated

from ada_core.database import get_db
from ada_core.validation import CaseRef, InspectionRef
from ada_platform import Principal
from fastapi import APIRouter, BackgroundTasks, Depends, Form, Path, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin
from ..config import settings
from ..errors import ApiError
from ..icms import inspections as repo
from ..icms import notifier
from ..icms.actors import actor_directory, fill_actor_names
from ..icms.collection import Page
from ..icms.inspection_schemas import (
    CheckInCreate,
    CheckInOut,
    EvidenceCreate,
    EvidenceOut,
    FindingsPut,
    InspectionDetail,
    InspectionOpen,
    InspectionQuery,
    InspectionRow,
    ResurveyCreate,
    ResurveyDecide,
    ResurveyRequestOut,
    SubmitRequest,
    VerifyRequest,
)
from ..icms.security import ZoneScope, require_icms_user, require_permission, zone_scope

router = APIRouter(prefix="/icms", tags=["icms-inspections"])

CaseRefPath = Annotated[
    CaseRef, Path(description="The case reference, e.g. `CMP-2026-0001`.")
]
InspectionRefPath = Annotated[
    InspectionRef, Path(description="The inspection reference, e.g. `INS-2026-0001`.")
]

RESURVEY_NAMES = {"requested_by": "requested_by_name", "decided_by": "decided_by_name"}


def _detail_or_404(
    db: Session, inspection_ref: str, scope: ZoneScope, user: Principal,
    directory: KeycloakAdmin | None,
) -> InspectionDetail:
    data = repo.inspection_detail(
        db, inspection_ref, scope, roles=user.roles, user_id=user.subject)
    if data is None:
        raise ApiError(404, "inspection_not_found", f"no inspection {inspection_ref}")
    detail = InspectionDetail(**data)
    fill_actor_names(directory, [detail], {"surveyor_user_id": "surveyor_name"})
    fill_actor_names(directory, detail.check_ins, {"user_id": "user_name"})
    fill_actor_names(directory, detail.evidence, {"uploaded_by": "uploaded_by_name"})
    return detail


def _resurvey_or_404(
    db: Session, request_id: int, scope: ZoneScope, directory: KeycloakAdmin | None,
) -> ResurveyRequestOut:
    data = repo.resurvey_detail(db, request_id, scope)
    if data is None:
        raise ApiError(
            404, "resurvey_request_not_found", f"no re-survey request {request_id}")
    out = ResurveyRequestOut(**data)
    fill_actor_names(directory, [out], RESURVEY_NAMES)
    return out


# ------------------------------------------------------------------ the loop
@router.post(
    "/cases/{case_ref}/inspections",
    response_model=InspectionDetail,
    status_code=201,
    summary="Open a round — allocates INS-YYYY-NNNN",
)
def open_round(
    case_ref: CaseRefPath,
    body: InspectionOpen,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> InspectionDetail:
    """Stage 3, and the only way an inspection comes into existence.

    Reachable from `assigned` and from `resurvey_requested`, which is the whole
    of the re-survey loop: round n+1 is a new numbered row, and `UNIQUE
    (case_id, round_no)` makes a duplicate round impossible rather than merely
    discouraged. The legacy schema stored a second inspection with nothing
    distinguishing it from the first.

    The surveyor must hold an active assignment to the case's zone. A round
    opened for an officer who cannot see the zone is work allocated into a hole.

    Two roles reach this, with two different authorities. A PCS Nodal Officer
    allocates work: any case in their zones, named to any surveyor who holds the
    zone. A Field Surveyor starts their own visit: their own case, in their own
    name, and anything else is 403 `not_the_assignee`.
    """
    inspection_ref = repo.open_round(
        db, case_ref, body, scope, actor=user.subject, roles=user.roles)
    if inspection_ref is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    notifier.round_opened(background, db, directory, inspection_ref=inspection_ref,
                          actor=user.subject)
    return _detail_or_404(db, inspection_ref, scope, user, directory)


@router.post(
    "/inspections/{ref}/check-in",
    response_model=CheckInOut,
    status_code=201,
    summary="Record the surveyor at the property — the accuracy gate",
)
def check_in(
    ref: InspectionRefPath,
    body: CheckInCreate,
    response: Response,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CheckInOut:
    """A fix worse than the configured threshold is refused with `poor_accuracy`.

    The point of a check-in is the claim "this officer stood at this property at
    this time", and a 400-metre fix does not support it. Refusing is the honest
    answer; storing it and hoping nobody asks is what makes an enforcement
    record unusable in front of a tribunal.

    Idempotent on `idempotency_key`, which the database holds unique: a replay
    returns the original check-in with 200.
    """
    result = repo.check_in(db, ref, body, scope, actor=user.subject, roles=user.roles)
    if result is None:
        raise ApiError(404, "inspection_not_found", f"no inspection {ref}")
    if result["replayed"]:
        response.status_code = 200
    return CheckInOut(**result["check_in"])


@router.post(
    "/inspections/{ref}/evidence",
    response_model=EvidenceOut,
    status_code=201,
    summary="Upload one piece of evidence — append-only",
)
def add_evidence(
    ref: InspectionRefPath,
    response: Response,
    meta: Annotated[EvidenceCreate, Form(media_type="multipart/form-data")],
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> EvidenceOut:
    """The file is judged before anything writes it: the allowlist comes from
    `icms_upload_policy` and the type from the file's own magic bytes, never
    from the Content-Type the handset sent.

    A photograph arrives with its position, accuracy, device clock and capture
    source or it is refused — `icms_evidence_geotag_ck` says the same thing in
    the database. Any evidence with no position, or one worse than the accuracy
    threshold, is stored `geotag_flagged` and the gallery shows it as such.

    Idempotent on `idempotency_key`; a replay returns the original row with 200.
    """
    result = repo.add_evidence(
        db, ref, meta, meta.file, scope, actor=user.subject, roles=user.roles)
    if result is None:
        raise ApiError(404, "inspection_not_found", f"no inspection {ref}")
    if result["replayed"]:
        response.status_code = 200
    return EvidenceOut(**result["evidence"])


@router.put(
    "/inspections/{ref}/findings",
    response_model=InspectionDetail,
    summary="Record what was found — replaces the round's findings",
)
def record_findings(
    ref: InspectionRefPath,
    body: FindingsPut,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> InspectionDetail:
    """Stage 4. A PUT because it is the form's whole content, saved as often as
    the surveyor likes until the round is submitted.

    The findings list replaces what was there; the sections replace only when
    the form carried them, so a save from a screen without the sections field
    does not silently drop citations entered on another one.
    """
    source = "field" if user.azp == settings.oidc_field_client_id else "web"
    if not repo.record_findings(
        db, ref, body, scope, actor=user.subject, roles=user.roles, source=source
    ):
        raise ApiError(404, "inspection_not_found", f"no inspection {ref}")
    return _detail_or_404(db, ref, scope, user, directory)


@router.post(
    "/inspections/{ref}/submit",
    response_model=InspectionDetail,
    summary="Submit the round for verification — idempotent",
)
def submit(
    ref: InspectionRefPath,
    body: SubmitRequest,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> InspectionDetail:
    """A round already submitted is itself the answer to submitting it again, so
    a replay returns it with 200 rather than a 409 the handset cannot act on."""
    if repo.submit(db, ref, body, scope, actor=user.subject, roles=user.roles) is None:
        raise ApiError(404, "inspection_not_found", f"no inspection {ref}")
    notifier.inspection_submitted(background, db, directory, inspection_ref=ref,
                                  actor=user.subject)
    return _detail_or_404(db, ref, scope, user, directory)


@router.post(
    "/inspections/{ref}/verify",
    response_model=InspectionDetail,
    summary="Accept the round or send it back — PCS Nodal Officer",
)
def verify(
    ref: InspectionRefPath,
    body: VerifyRequest,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> InspectionDetail:
    """Stage 5. The router chooses the ACTION the decision names and nothing
    else: `verify_accept` and `verify_reject` carry their own targets and
    stages, and a rejection carries the reason the surveyor has to act on."""
    if not repo.verify(db, ref, body, scope, actor=user.subject, roles=user.roles):
        raise ApiError(404, "inspection_not_found", f"no inspection {ref}")
    notifier.inspection_verified(background, db, directory, inspection_ref=ref,
                                 decision=body.decision, reason=body.reason,
                                 actor=user.subject)
    return _detail_or_404(db, ref, scope, user, directory)


@router.post(
    "/cases/{case_ref}/resurvey-requests",
    response_model=ResurveyRequestOut,
    status_code=201,
    summary="Ask for another round — PCS Nodal Officer",
)
def request_resurvey(
    case_ref: CaseRefPath,
    body: ResurveyCreate,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> ResurveyRequestOut:
    """One open request per case, enforced by a partial unique index rather than
    by a check in this function: a second request is a question already asked."""
    request_id = repo.request_resurvey(
        db, case_ref, body, scope, actor=user.subject, roles=user.roles)
    if request_id is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    notifier.resurvey_requested(background, db, directory, request_id=request_id,
                                actor=user.subject)
    return _resurvey_or_404(db, request_id, scope, directory)


@router.post(
    "/resurvey-requests/{request_id}/decide",
    response_model=ResurveyRequestOut,
    summary="Approve a re-survey, which opens the next round, or refuse it",
)
def decide_resurvey(
    request_id: Annotated[int, Path(ge=1, description="The re-survey request's id.")],
    body: ResurveyDecide,
    background: BackgroundTasks,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> ResurveyRequestOut:
    """Approving runs `open_round` in the same transaction as the decision, so a
    request recorded as approved and a round that never opened cannot both be
    true. Refusing records the decision on the request row and moves no case —
    the authority to decide is the authority to open the round being asked for,
    read off that same transition."""
    if not repo.decide_resurvey(
        db, request_id, body, scope, actor=user.subject, roles=user.roles
    ):
        raise ApiError(
            404, "resurvey_request_not_found", f"no re-survey request {request_id}")
    notifier.resurvey_decided(background, db, directory, request_id=request_id,
                              actor=user.subject)
    return _resurvey_or_404(db, request_id, scope, directory)


# ----------------------------------------------------------------- the reads
@router.get(
    "/inspections",
    response_model=Page[InspectionRow],
    summary="The inspections register — paginated, filtered, zone-scoped",
)
def list_inspections(
    params: Annotated[InspectionQuery, Query()],
    user: Principal = Depends(require_permission("inspection.read")),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> Page[InspectionRow]:
    """Scoped to the caller's zones, counted over the scoped selectable, paged at
    the database. A Field Surveyor holding no supervisory role sees their own
    rounds and nobody else's — that narrowing is the field app's work list."""
    result = repo.register(db, params, scope, caller=user.subject, roles=user.roles)
    items = [InspectionRow(**row) for row in repo.rows_to_dicts(result)]
    fill_actor_names(directory, items, {"surveyor_user_id": "surveyor_name"})
    return Page[InspectionRow].of(items, result)


@router.get(
    "/inspections/{ref}",
    response_model=InspectionDetail,
    summary="One round, with its findings, check-ins and evidence",
)
def get_inspection(
    ref: InspectionRefPath,
    user: Principal = Depends(require_permission("inspection.read")),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> InspectionDetail:
    return _detail_or_404(db, ref, scope, user, directory)


@router.get(
    "/inspections/{ref}/evidence",
    response_model=list[EvidenceOut],
    summary="Everything captured on this round, oldest first",
)
def list_evidence(
    ref: InspectionRefPath,
    user: Principal = Depends(require_permission("evidence.read")),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> list[EvidenceOut]:
    """A Field Surveyor sees their own rounds; a colleague's round is a 404.

    `evidence.read` is granted to all four roles because a verifier who cannot
    see the photograph cannot verify anything. That grant is about the ROLE, and
    it is not sight of every round in the zone.
    """
    rows = repo.evidence_for(db, ref, scope, roles=user.roles, user_id=user.subject)
    if rows is None:
        raise ApiError(404, "inspection_not_found", f"no inspection {ref}")
    items = [EvidenceOut(**row) for row in rows]
    fill_actor_names(directory, items, {"uploaded_by": "uploaded_by_name"})
    return items


@router.get(
    "/cases/{case_ref}/resurvey-requests",
    response_model=list[ResurveyRequestOut],
    summary="Every re-survey request raised on the case, newest first",
)
def list_resurvey_requests(
    case_ref: CaseRefPath,
    user: Principal = Depends(require_permission("inspection.read")),
    scope: ZoneScope = Depends(zone_scope),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> list[ResurveyRequestOut]:
    """The officer who decides a re-survey is not the one who asked for it, so
    the `id` `POST /decide` needs has to outlive the response that minted it.

    Decided requests stay in the list beside the pending one: a refusal is the
    record of why round n+1 never happened, and it is not history to drop.
    """
    rows = repo.resurvey_requests_for(db, case_ref, scope)
    if rows is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    items = [ResurveyRequestOut(**row) for row in rows]
    fill_actor_names(directory, items, RESURVEY_NAMES)
    return items


@router.get(
    "/evidence/{evidence_id}/content",
    response_class=FileResponse,
    summary="The evidence file itself, as an attachment",
    responses={200: {"content": {"application/octet-stream": {}},
                     "description": "The stored bytes."}},
)
def get_evidence_content(
    evidence_id: Annotated[int, Path(ge=1, description="The evidence row's id.")],
    user: Principal = Depends(require_permission("evidence.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Served through the API rather than from a bucket URL: evidence is
    zone-scoped like everything else, and a link that works for anybody holding
    it is not a link this system can issue.

    `attachment`, never `inline`: the browser saves the file rather than
    rendering officer-supplied content inside the application's own origin.
    """
    stored = repo.evidence_content(
        db, evidence_id, scope, roles=user.roles, user_id=user.subject)
    if stored is None:
        raise ApiError(404, "evidence_not_found", f"no evidence {evidence_id}")
    return FileResponse(
        stored.path,
        media_type=stored.content_type or "application/octet-stream",
        filename=stored.filename,
    )


@router.get(
    "/evidence/{evidence_id}/stamped",
    response_class=FileResponse,
    summary="The server-stamped copy of an evidence photograph, as an attachment",
    responses={200: {"content": {"image/jpeg": {}},
                     "description": "The original with the API's location bar added."}},
)
def get_evidence_stamped(
    evidence_id: Annotated[int, Path(ge=1, description="The evidence row's id.")],
    user: Principal = Depends(require_permission("evidence.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Same scope as `/content`; 404 `evidence_not_stamped` when no copy was made."""
    stored = repo.evidence_content(
        db, evidence_id, scope, roles=user.roles, user_id=user.subject, stamped=True)
    if stored is None:
        raise ApiError(404, "evidence_not_found", f"no evidence {evidence_id}")
    return FileResponse(
        stored.path, media_type="image/jpeg", filename=stored.filename,
    )
