"""ICMS Batch 6 — the notice: generate it, register it, serve the document.

Four properties this module exists to hold, each of which has a test.

**The number is allocated inside the persisting transaction.** `allocate` bumps
`icms_notice_sequence` in the same transaction as the INSERT, so a refused issue
rolls the bump back and consumes nothing. A hole in the register is a question
in court about what happened to notice 47.

**An issued notice is immutable.** There is no PUT, no PATCH and no DELETE here,
and there is to be none later. A correction is a new notice.

**The PDF is stored, never re-rendered on read.** `/pdf` reads bytes off disk.
Re-rendering would serve today's template for a document served last year.

**`status` is derived, not stored.** `overdue` is computed from
`compliance_due` on every read. Stored, it would be right for one day.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from ada_core.datetimes import now_ist
from ada_core.models_icms import (
    Case,
    CaseAssignment,
    CodeValue,
    Inspection,
    InspectionFinding,
    Notice,
    Zone,
)
from sqlalchemy import Select, and_, insert, literal, select
from sqlalchemy import case as sql_case
from sqlalchemy.orm import Session

from ..config import settings
from ..errors import ApiError
from . import workflow as wf
from .cases import _event, move_case
from .collection import PageResult, Sortable, paginate, row_dict, search_clause
from .geo import as_geojson_column, parse_geojson
from .notice_schemas import (
    COMPLIANCE_DEFAULT_DAYS,
    COMPLIANCE_MAX_DAYS,
    COMPLIANCE_MIN_DAYS,
    REPRESENTATION_DAYS,
    NoticeCreate,
    NoticeQuery,
)
from .notice_template import DEFAULT_ISSUING_AUTHORITY, NoticeFacts, build_body, render
from .numbering import IST, Series, allocate
from .security import ZoneScope

__all__ = [
    "NOTICE_SORT_KEYS",
    "StoredNotice",
    "artefact",
    "issue",
    "notice_detail",
    "register",
    "rows_to_dicts",
]

log = logging.getLogger("ada.api.icms.notices")

ISSUED, OVERDUE = "issued", "overdue"
ACT, SECTION = "act", "section"

# A surveyor holding none of these sees notices on their own cases and no others.
# `notice.read` is granted to no surveyor in the seed, so this clause is reached
# only if an authority widens the grant — at which point it should still narrow.
_SUPERVISORY = frozenset({
    str(wf.Role.PCS_NODAL_OFFICER), str(wf.Role.ADA_PROJECT_LEAD), str(wf.Role.SUPER_ADMIN),
})


def _now() -> datetime:
    return now_ist()


def _today() -> date:
    return _now().astimezone(IST).date()


# --------------------------------------------------------------- the register
#
# `overdue` is a read, not a row. The CASE below is the one definition of it and
# is used for the column, the filter and the sort, so the register cannot show
# one answer and filter on another.
def _status_column(today: date):
    return sql_case(
        (
            and_(
                Notice.status == ISSUED,
                Notice.compliance_due.is_not(None),
                Notice.compliance_due < today,
            ),
            literal(OVERDUE),
        ),
        else_=Notice.status,
    )


NOTICE_SORT_KEYS: tuple[str, ...] = (
    "act_cd", "case_ref", "compliance_due", "issued_at", "notice_ref", "status", "zone_cd",
)


def _sortable(today: date) -> Sortable:
    return Sortable(
        columns={
            "act_cd": Notice.act_cd,
            "case_ref": Case.case_ref,
            "compliance_due": Notice.compliance_due,
            "issued_at": Notice.issued_at,
            "notice_ref": Notice.notice_ref,
            "status": _status_column(today),
            "zone_cd": Zone.zone_cd,
        },
        # Monotonic with the counter and never null, so the newest notice sorts
        # first whether or not it carries an issue timestamp.
        default="-notice_ref",
        tiebreaker=Notice.id,
    )


def _row_columns(today: date) -> tuple:
    return (
        Notice.notice_ref,
        Case.case_ref,
        Notice.act_cd,
        Notice.section_cds,
        _status_column(today).label("status"),
        Notice.issued_by,
        Notice.issued_at,
        Notice.compliance_due,
        Zone.zone_cd,
        Case.property_address,
        Notice.artefact_path.is_not(None).label("has_artefact"),
    )


def _register_select(today: date) -> Select:
    return (
        select(*_row_columns(today))
        .join(Case, Case.id == Notice.case_id)
        .join(Zone, Zone.id == Case.zone_id)
    )


def _day_bounds(low: date | None, high: date | None) -> tuple:
    start = datetime(low.year, low.month, low.day, tzinfo=IST) if low else None
    end = (datetime(high.year, high.month, high.day, tzinfo=IST) + timedelta(days=1)
           if high else None)
    return start, end


def _own_notices_only(roles) -> bool:
    held = frozenset(str(role) for role in roles)
    return str(wf.Role.FIELD_SURVEYOR) in held and not (held & _SUPERVISORY)


# The case register's rule: the OPEN survey assignment, not any row ever written.
def _assigned_to(user_id: str):
    return (
        select(CaseAssignment.id)
        .where(
            CaseAssignment.case_id == Case.id,
            CaseAssignment.active.is_(True),
            CaseAssignment.assignment_type == "survey",
            CaseAssignment.assignee_user_id == user_id,
        )
        .correlate(Case)
        .exists()
    )


def register(
    db: Session, params: NoticeQuery, scope: ZoneScope, *, caller: str, roles
) -> PageResult:
    today = _today()
    statement = _register_select(today)

    if params.case_ref:
        statement = statement.where(Case.case_ref.in_(params.case_ref))
    if params.status:
        statement = statement.where(_status_column(today).in_(params.status))
    if params.act_cd:
        statement = statement.where(Notice.act_cd.in_(params.act_cd))
    if params.zone_cd:
        statement = statement.where(
            Case.zone_id.in_(select(Zone.id).where(Zone.zone_cd.in_(params.zone_cd)))
        )
    if params.issued_by:
        statement = statement.where(Notice.issued_by.in_(params.issued_by))

    low, high = _day_bounds(params.issued_from, params.issued_to)
    if low is not None:
        statement = statement.where(Notice.issued_at >= low)
    if high is not None:
        statement = statement.where(Notice.issued_at < high)

    if params.q:
        statement = statement.where(
            search_clause(params.q, [Notice.notice_ref, Case.case_ref])
        )

    if _own_notices_only(roles):
        statement = statement.where(_assigned_to(caller))

    statement = scope.apply(statement, Case.zone_id)
    return paginate(db, statement, params, _sortable(today))


def rows_to_dicts(result: PageResult) -> list[dict]:
    return [_clean(row_dict(row)) for row in result.rows]


def _clean(data: dict) -> dict:
    data["section_cds"] = list(data.get("section_cds") or [])
    data["has_artefact"] = bool(data.get("has_artefact"))
    return data


# ------------------------------------------------------------------ the detail
def _locate(db: Session, notice_ref: str, scope: ZoneScope, *, roles, user_id: str):
    today = _today()
    statement = (
        select(
            *_row_columns(today),
            Notice.body,
            Notice.issuing_authority,
            Notice.artefact_sha256,
            Notice.artefact_path,
            Inspection.inspection_ref,
        )
        .join(Case, Case.id == Notice.case_id)
        .join(Zone, Zone.id == Case.zone_id)
        .outerjoin(Inspection, Inspection.id == Notice.inspection_id)
        .where(Notice.notice_ref == notice_ref)
    )
    if _own_notices_only(roles):
        statement = statement.where(_assigned_to(user_id))
    return db.execute(scope.apply(statement, Case.zone_id)).first()


def notice_detail(
    db: Session, notice_ref: str, scope: ZoneScope, *, roles, user_id: str
) -> dict | None:
    row = _locate(db, notice_ref, scope, roles=roles, user_id=user_id)
    if row is None:
        return None
    data = _clean(dict(row._mapping))
    data.pop("artefact_path", None)
    # Never populated here. `icms_notice_delivery` has a table and no endpoint;
    # the Parivartan App owns every status after issue. See section 3a.
    data["deliveries"] = []
    return data


PDF_MAGIC = b"%PDF-"


@dataclass(frozen=True)
class StoredNotice:
    content: bytes
    filename: str


def artefact(
    db: Session, notice_ref: str, scope: ZoneScope, *, roles, user_id: str
) -> StoredNotice | None:
    """The stored PDF, or None when the notice is not the caller's to read."""
    row = _locate(db, notice_ref, scope, roles=roles, user_id=user_id)
    if row is None:
        return None

    content = _read_verified(
        _resolve_stored(row.artefact_path, notice_ref=notice_ref), row.artefact_sha256)
    if content is None:
        log.error("notice %s is recorded at %r and is not in the store intact",
                  notice_ref, row.artefact_path)
        # Deliberately not a re-render. The document that was served is the only
        # document there is; drawing a new one would answer a different question.
        raise ApiError(
            404, "notice_artefact_missing",
            "the notice exists but its rendered document is not in the store, and a "
            "notice is never re-rendered: the artefact IS the instrument that was served",
        )
    return StoredNotice(content=content, filename=f"{notice_ref}.pdf")


# Read once, then checked: a PDF, and the bytes whose digest was recorded at issue.
def _read_verified(path: Path | None, sha256: str | None) -> bytes | None:
    if path is None or not path.is_file():
        return None
    try:
        content = path.read_bytes()
    except OSError:
        return None
    if not content.startswith(PDF_MAGIC):
        return None
    if sha256 and hashlib.sha256(content).hexdigest() != sha256:
        return None
    return content


# Resolved (symlinks included) and required to sit inside this notice's own folder.
def _resolve_stored(
    artefact_path: str | None, *, notice_ref: str | None = None
) -> Path | None:
    if not artefact_path:
        return None
    root = settings.icms_notice_dir.resolve()
    folder = (root / notice_ref).resolve() if notice_ref else root
    if not folder.is_relative_to(root):
        return None
    candidate = (root / artefact_path).resolve()
    return candidate if candidate.is_relative_to(folder) and candidate != folder else None


# ------------------------------------------------------------------- the write
def _legal(db: Session, act_cd: str, section_cds: list[str]) -> tuple[str, tuple]:
    """The act label and (code, label) per section, or a refusal naming what exists."""
    act_label = db.execute(
        select(CodeValue.label).where(
            CodeValue.domain == ACT, CodeValue.code == act_cd, CodeValue.active.is_(True)
        )
    ).scalar_one_or_none()
    if act_label is None:
        known = db.execute(
            select(CodeValue.code)
            .where(CodeValue.domain == ACT, CodeValue.active.is_(True))
            .order_by(CodeValue.sort_order, CodeValue.code)
        ).scalars().all()
        raise ApiError(
            422, "unknown_act",
            f"{act_cd} is not an act this authority issues under",
            field="act_cd", allowed=list(known),
        )

    rows = db.execute(
        select(CodeValue.code, CodeValue.label)
        .where(
            CodeValue.domain == SECTION,
            CodeValue.parent_code == act_cd,
            CodeValue.active.is_(True),
        )
        .order_by(CodeValue.sort_order, CodeValue.code)
    ).all()
    labels = {row.code: row.label for row in rows}

    missing = [code for code in section_cds if code not in labels]
    if missing:
        raise ApiError(
            422, "unknown_section",
            f"{', '.join(missing)} is not a section of {act_cd}; a notice citing a "
            "section that does not exist is a defective instrument, so it is refused "
            "rather than stored",
            field="section_cds", allowed=[row.code for row in rows],
        )
    # The act's own order (14, 26, 27, 28, 28-A), not the order the form happened
    # to collect them in, so the citation on the document and the citation the
    # portal renders are the same string. `rows` is already ordered by sort_order.
    cited = frozenset(section_cds)
    return act_label, tuple(
        (row.code, row.label) for row in rows if row.code in cited
    )


def _compliance(issued_on: date, requested: date | None) -> tuple[date, int]:
    if requested is None:
        return issued_on + timedelta(days=COMPLIANCE_DEFAULT_DAYS), COMPLIANCE_DEFAULT_DAYS

    days = (requested - issued_on).days
    if not COMPLIANCE_MIN_DAYS <= days <= COMPLIANCE_MAX_DAYS:
        raise ApiError(
            422, "compliance_window",
            f"Section 27 allows not less than {COMPLIANCE_MIN_DAYS} and not more than "
            f"{COMPLIANCE_MAX_DAYS} days; {requested.isoformat()} is {days} days from "
            "the date of issue",
            field="compliance_due",
        )
    return requested, days


_CASE_COLUMNS = (
    Case.id.label("case_id"),
    Case.case_ref,
    Case.status,
    Case.zone_id,
    Case.owner_name,
    Case.property_address,
    Case.landmark,
    Case.khasra_no,
    Case.village_lgd_code,
    Case.ulpin,
    Case.police_station,
    Case.district,
    Case.state,
    Case.pin_code,
    Zone.zone_cd,
    Zone.name.label("zone_name"),
)


def _latlon(value) -> tuple[float | None, float | None]:
    geometry = parse_geojson(value)
    if not geometry or geometry.get("type") != "Point":
        return None, None
    coordinates = geometry.get("coordinates") or []
    if len(coordinates) < 2:
        return None, None
    return float(coordinates[1]), float(coordinates[0])


def _last_round(db: Session, case_id: int):
    return db.execute(
        select(
            Inspection.id, Inspection.inspection_ref, Inspection.measured_area_sqm,
            Inspection.occupant_name, Inspection.police_station,
        )
        .where(Inspection.case_id == case_id)
        .order_by(Inspection.round_no.desc(), Inspection.id.desc())
        .limit(1)
    ).first()


def _findings(db: Session, inspection_id: int) -> tuple[str, ...]:
    return tuple(
        db.execute(
            select(InspectionFinding.finding)
            .where(InspectionFinding.inspection_id == inspection_id)
            .order_by(InspectionFinding.seq, InspectionFinding.id)
        ).scalars().all()
    )


# The owner or the recorded occupant, and never the complainant: an enforcement
# notice is served on the person who must act, not the person who reported it.
def _recipient_name(row, round_row, override: str | None) -> str | None:
    if override:
        return override
    return row.owner_name or (round_row.occupant_name if round_row is not None else None)


def _recipient_address(row, override: str | None) -> str | None:
    if override:
        return override
    parts = [row.property_address, row.landmark, row.district, row.state, row.pin_code]
    return ", ".join(part for part in parts if part) or None


# Content-addressed under the notice's own folder, so two renders of the same
# bytes occupy one file and a reprint cannot pick up a neighbour's document.
def _store_artefact(notice_ref: str, content: bytes) -> tuple[str, str]:
    digest = hashlib.sha256(content).hexdigest()
    folder = settings.icms_notice_dir / notice_ref
    folder.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(dir=folder, suffix=".part", delete=False)
    try:
        with handle as sink:
            sink.write(content)
        os.replace(handle.name, folder / f"{digest}.pdf")
    except BaseException:
        Path(handle.name).unlink(missing_ok=True)
        raise
    return f"{notice_ref}/{digest}.pdf", digest


def _area_of(round_row, override) -> float | None:
    if override is not None:
        return float(override)
    if round_row is None or round_row.measured_area_sqm is None:
        return None
    return float(round_row.measured_area_sqm)


def issue(
    db: Session, case_ref: str, body: NoticeCreate, scope: ZoneScope, *, actor: str, roles
) -> dict | None:
    """Stage 7 — mint NTC-YYYY-NNNN, draw the document, move the case.

    Every refusal below happens before `allocate`, so a rejected issue consumes
    no reference and the register stays gapless.
    """
    row = db.execute(
        scope.apply(
            select(*_CASE_COLUMNS, as_geojson_column(db, Case.location).label("_location"))
            .join(Zone, Zone.id == Case.zone_id)
            .where(Case.case_ref == case_ref),
            Case.zone_id,
        )
    ).first()
    if row is None:
        return None

    transition = wf.check(
        row.status, wf.Action.ISSUE_NOTICE, roles,
        payload={"act_cd": body.act_cd, "section_cds": body.section_cds},
    )

    act_label, sections = _legal(db, body.act_cd, body.section_cds)
    issued_on = _today()
    compliance_due, compliance_days = _compliance(issued_on, body.compliance_due)

    overrides = body.body_overrides
    round_row = _last_round(db, row.case_id)
    grounds = (
        tuple(overrides.grounds) if overrides and overrides.grounds
        else (_findings(db, round_row.id) if round_row is not None else ())
    )
    latitude, longitude = _latlon(row._mapping["_location"])

    issued_at = _now()
    authority = body.issuing_authority or DEFAULT_ISSUING_AUTHORITY
    artefact_path: str | None = None

    # One transaction from the case move to the commit (Rules 1 and 2): the move,
    # the reference, the notice row and the event land together or not at all.
    try:
        # Compare-and-set first, so a second issuer racing this one gets 409 before
        # a reference is minted or a document drawn.
        move_case(db, row.case_id, row.status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "updated_at": issued_at,
        })
        notice_ref = allocate(db, Series.NOTICE)
        artefact_path, notice_id, digest = _issue_rows(
            db, row, body, notice_ref,
            actor=actor, issued_on=issued_on, issued_at=issued_at, authority=authority,
            compliance_due=compliance_due, compliance_days=compliance_days,
            act_label=act_label, sections=sections, overrides=overrides,
            round_row=round_row, grounds=grounds, latitude=latitude, longitude=longitude,
        )
        _event(
            db, case_id=row.case_id, action=str(wf.Action.ISSUE_NOTICE), actor=actor,
            roles=roles, from_status=row.status, to_status=str(transition.target),
            payload={
                "notice_id": notice_id,
                "notice_ref": notice_ref,
                "act_cd": body.act_cd,
                "section_cds": list(body.section_cds),
                "compliance_due": compliance_due.isoformat(),
                "artefact_sha256": digest,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        # The row is gone and so is the number; the file would otherwise be an
        # orphan nothing points at.
        stored = _resolve_stored(artefact_path)
        if stored is not None:
            stored.unlink(missing_ok=True)
        raise

    return notice_detail(db, notice_ref, scope, roles=roles, user_id=actor)


# No commit of its own: `issue` owns the transaction these writes belong to.
def _issue_rows(
    db: Session, row, body: NoticeCreate, notice_ref: str, *, actor: str,
    issued_on: date, issued_at: datetime, authority: str, compliance_due: date,
    compliance_days: int, act_label: str, sections, overrides, round_row, grounds,
    latitude, longitude,
) -> tuple[str, int, str]:
    document = build_body(NoticeFacts(
        notice_ref=notice_ref,
        case_ref=row.case_ref,
        issued_on=issued_on,
        compliance_due=compliance_due,
        compliance_days=compliance_days,
        representation_days=REPRESENTATION_DAYS,
        issued_by=actor,
        issuing_authority=authority,
        act_cd=body.act_cd,
        act_label=act_label,
        sections=sections,
        notice_type=overrides.notice_type if overrides else None,
        recipient_name=_recipient_name(
            row, round_row, overrides.recipient_name if overrides else None),
        recipient_address=_recipient_address(
            row, overrides.recipient_address if overrides else None),
        property_address=row.property_address,
        landmark=row.landmark,
        khasra_no=(overrides.khasra_no if overrides and overrides.khasra_no
                   else row.khasra_no),
        village_lgd_code=row.village_lgd_code,
        ulpin=row.ulpin,
        police_station=row.police_station or (
            round_row.police_station if round_row is not None else None),
        district=row.district,
        pin_code=row.pin_code,
        zone_cd=row.zone_cd,
        zone_name=row.zone_name,
        encroached_area_sqm=_area_of(
            round_row, overrides.encroached_area_sqm if overrides else None),
        latitude=latitude,
        longitude=longitude,
        inspection_ref=round_row.inspection_ref if round_row is not None else None,
        grounds=grounds,
    ))

    artefact_path, digest = _store_artefact(notice_ref, render(document))
    try:
        notice_id = db.execute(
            insert(Notice)
            .values(
                notice_ref=notice_ref,
                case_id=row.case_id,
                inspection_id=round_row.id if round_row is not None else None,
                act_cd=body.act_cd,
                section_cds=list(body.section_cds),
                body=document,
                issuing_authority=authority,
                status=ISSUED,
                issued_by=actor,
                issued_at=issued_at,
                compliance_due=compliance_due,
                artefact_path=artefact_path,
                artefact_sha256=digest,
                created_at=issued_at,
                updated_at=issued_at,
            )
            .returning(Notice.id)
        ).scalar_one()
    except Exception:
        stored = _resolve_stored(artefact_path)
        if stored is not None:
            stored.unlink(missing_ok=True)
        raise
    return artefact_path, notice_id, digest
