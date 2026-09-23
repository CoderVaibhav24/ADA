"""ICMS Batch 6 — the notice, stage 7 and the end of this system's authority.

Four routes and no fifth. `POST /notices/{ref}/deliveries` is cut by section 3a
of the build-order document: the Parivartan App owns delivery tracking and every
status a case takes on after the notice exists. `icms_notice_delivery` keeps its
table and gains no endpoint, and `NoticeDetail.deliveries` is `[]` by design so
the shape does not change on the day Parivartan starts writing rows.

Three things these handlers deliberately do NOT do.

They do not number the notice. `numbering.allocate` mints `NTC-YYYY-NNNN` inside
the transaction that writes the row, so a refused issue consumes nothing. A
client that proposed a number would be proposing a gap.

They do not re-render the document. `/pdf` streams the artefact stored at
generation. A reprint has to reproduce the instrument that was served, and the
template is provisional — re-rendering would quietly reissue every old notice in
whatever layout ADA confirms next.

They do not let a notice be edited. There is no PUT, no PATCH and no DELETE. A
correction is a new notice that names the one it supersedes.
"""

from __future__ import annotations

from typing import Annotated

from ada_core.database import get_db
from ada_core.validation import CaseRef, NoticeRef
from ada_platform import Principal
from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..icms import notices as repo
from ..icms.collection import Page
from ..icms.notice_schemas import NoticeCreate, NoticeDetail, NoticeQuery, NoticeRow
from ..icms.security import ZoneScope, require_icms_user, require_permission, zone_scope

router = APIRouter(prefix="/icms", tags=["icms-notices"])

CaseRefPath = Annotated[
    CaseRef, Path(description="The case reference, e.g. `CMP-2026-0001`.")
]
NoticeRefPath = Annotated[
    NoticeRef, Path(description="The notice reference, e.g. `NTC-2026-0001`.")
]


def _detail_or_404(
    db: Session, notice_ref: str, scope: ZoneScope, user: Principal
) -> NoticeDetail:
    data = repo.notice_detail(
        db, notice_ref, scope, roles=user.roles, user_id=user.subject)
    if data is None:
        raise ApiError(404, "notice_not_found", f"no notice {notice_ref}")
    return NoticeDetail(**data)


@router.post(
    "/cases/{case_ref}/notices",
    response_model=NoticeDetail,
    status_code=201,
    summary="Issue the notice — allocates NTC-YYYY-NNNN and stores the document",
)
def issue_notice(
    case_ref: CaseRefPath,
    body: NoticeCreate,
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> NoticeDetail:
    """The `issue_notice` transition: `confirmed` -> `notice_issued`, ADA Project
    Lead only, and the table says so rather than this handler.

    Issuing from any other status is a 409 from `workflow.check`, and an act or
    section that is not an active `icms_code_value` row is a 422 — a notice
    citing a section that does not exist is a defective legal instrument, so it
    is refused rather than stored and corrected later.
    """
    data = repo.issue(db, case_ref, body, scope, actor=user.subject, roles=user.roles)
    if data is None:
        raise ApiError(404, "case_not_found", f"no case {case_ref}")
    return NoticeDetail(**data)


@router.get(
    "/notices",
    response_model=Page[NoticeRow],
    summary="The notice register",
)
def list_notices(
    params: Annotated[NoticeQuery, Query()],
    response: Response,
    user: Principal = Depends(require_permission("notice.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> Page[NoticeRow]:
    """`status` here is computed, not read: a notice whose compliance date has
    passed reports `overdue` while the stored row still says `issued`.

    Nothing sweeps a stored status, so one written on the day it became true
    would be wrong the following morning and wrong for ever after. The filter
    and the sort use the same expression as the column, so the register cannot
    show one answer and filter on another.
    """
    result = repo.register(db, params, scope, caller=user.subject, roles=user.roles)
    response.headers["X-Total-Count"] = str(result.total)
    return Page[NoticeRow].of(
        [NoticeRow(**row) for row in repo.rows_to_dicts(result)], result
    )


@router.get(
    "/notices/{notice_ref}",
    response_model=NoticeDetail,
    summary="One notice, with the document as data",
)
def get_notice(
    notice_ref: NoticeRefPath,
    user: Principal = Depends(require_permission("notice.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> NoticeDetail:
    """`body` is the whole document as JSON, written once at generation.

    It is in the payload rather than behind a second call because the Notice
    view screen renders from it, and because it is the only record of what the
    notice actually said: the case moves on and a legal instrument does not.
    """
    return _detail_or_404(db, notice_ref, scope, user)


@router.get(
    "/notices/{notice_ref}/pdf",
    response_class=Response,
    summary="The stored document, as served",
    responses={200: {"content": {"application/pdf": {}},
                     "description": "The artefact written at generation."}},
)
def get_notice_pdf(
    notice_ref: NoticeRefPath,
    user: Principal = Depends(require_permission("notice.read")),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> Response:
    """The bytes stored at generation, never a fresh render.

    A missing artefact is a 404 and not a re-render. The template is provisional
    and will be swapped; a reprint drawn from today's template would be a
    different document from the one served, which is the one thing a reprint
    must not be.

    `attachment`, never `inline`: the browser saves the file rather than
    rendering it inside the application's own origin. The bytes are served only
    if they still start `%PDF-` and still hash to `artefact_sha256`.
    """
    stored = repo.artefact(db, notice_ref, scope, roles=user.roles, user_id=user.subject)
    if stored is None:
        raise ApiError(404, "notice_not_found", f"no notice {notice_ref}")
    return Response(
        content=stored.content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{stored.filename}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
