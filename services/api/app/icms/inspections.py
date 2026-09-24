from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from ada_core.datetimes import now_ist
from ada_core.models_icms import (
    Case,
    CaseEvent,
    CheckIn,
    CodeValue,
    Evidence,
    Inspection,
    InspectionFinding,
    InspectionSection,
    ResurveyRequest,
    Zone,
    ZoneAssignment,
)
from fastapi import UploadFile
from sqlalchemy import Select, delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..errors import ApiError
from . import runtime_settings
from . import workflow as wf
from .cases import current_assignee, move_case
from .collection import PageResult, Sortable, paginate, row_dict, search_clause
from .evidence_stamp import StampFacts, exif_gps, haversine_m, write_stamped
from .evidence_store import StoredEvidence, stored_file
from .evidence_store import discard_stored as _discard_stored
from .evidence_store import resolve_stored as _resolve_stored  # noqa: F401
from .evidence_store import store as _store
from .geo import as_geojson_column, parse_geojson, point_value
from .inspection_rules import (
    area_mismatch,
    derive,
    inconsistencies,
    missing_for_submit,
    side_area,
)
from .inspection_schemas import (
    OBSERVED_COLUMNS,
    CheckInCreate,
    EvidenceCreate,
    FindingsPut,
    InspectionOpen,
    InspectionQuery,
    ResurveyCreate,
    ResurveyDecide,
    SubmitRequest,
    VerifyRequest,
)
from .numbering import IST, Series, allocate
from .security import ZoneScope

__all__ = [
    "EVIDENCE_CONTENT_PATH",
    "EVIDENCE_STAMPED_PATH",
    "INSPECTION_SORTS",
    "add_evidence",
    "check_in",
    "decide_resurvey",
    "evidence_content",
    "evidence_for",
    "inspection_detail",
    "open_round",
    "record_findings",
    "register",
    "request_resurvey",
    "resurvey_detail",
    "resurvey_requests_for",
    "rows_to_dicts",
    "submit",
    "verify",
]

log = logging.getLogger("ada.api.icms.inspections")

EVIDENCE_CONTENT_PATH = "/api/icms/evidence/{evidence_id}/content"
EVIDENCE_STAMPED_PATH = "/api/icms/evidence/{evidence_id}/stamped"

SCHEDULED, IN_PROGRESS, SUBMITTED, ACCEPTED, REJECTED = (
    "scheduled", "in_progress", "submitted", "accepted", "rejected")

PENDING, APPROVED, REFUSED = "pending", "approved", "rejected"

# Only a photograph is refused outright without its capture fields, because that
# is what icms_evidence_geotag_ck says. Everything else is stored and flagged.
GEOTAGGED_KINDS = frozenset({"photo"})

_KNOWN_ROLES = frozenset(str(role) for role in wf.Role)
# A surveyor holding none of these sees their own rounds and nobody else's.
_SUPERVISORY = frozenset({
    str(wf.Role.PCS_NODAL_OFFICER), str(wf.Role.ADA_PROJECT_LEAD), str(wf.Role.SUPER_ADMIN),
})


def _now() -> datetime:
    return now_ist()


# --------------------------------------------------------------- the register
_EVIDENCE_COUNT = (
    select(func.count())
    .select_from(Evidence)
    .where(Evidence.inspection_id == Inspection.id)
    .correlate(Inspection)
    .scalar_subquery()
)

_FINDING_COUNT = (
    select(func.count())
    .select_from(InspectionFinding)
    .where(InspectionFinding.inspection_id == Inspection.id)
    .correlate(Inspection)
    .scalar_subquery()
)

_HAS_CHECK_IN = (
    select(CheckIn.id)
    .where(CheckIn.inspection_id == Inspection.id)
    .correlate(Inspection)
    .exists()
)

_ROW_COLUMNS = (
    Inspection.inspection_ref,
    Case.case_ref,
    Case.property_address.label("case_title"),
    Inspection.round_no,
    Inspection.status,
    Zone.zone_cd,
    Zone.name.label("zone_name"),
    Case.priority,
    Inspection.surveyor_user_id,
    Inspection.scheduled_for,
    Inspection.started_at,
    Inspection.submitted_at,
    _EVIDENCE_COUNT.label("evidence_count"),
    _FINDING_COUNT.label("finding_count"),
    _HAS_CHECK_IN.label("has_check_in"),
)

INSPECTION_SORTS = Sortable(
    columns={
        "case_ref": Case.case_ref,
        "inspection_ref": Inspection.inspection_ref,
        "round_no": Inspection.round_no,
        "scheduled_for": Inspection.scheduled_for,
        "started_at": Inspection.started_at,
        "status": Inspection.status,
        "submitted_at": Inspection.submitted_at,
        "surveyor_user_id": Inspection.surveyor_user_id,
        "zone_cd": Zone.zone_cd,
    },
    # Monotonic with the counter and never null, so the newest round sorts first
    # whether or not it has been scheduled, started or submitted.
    default="-inspection_ref",
    tiebreaker=Inspection.id,
)


def _register_select() -> Select:
    return (
        select(*_ROW_COLUMNS)
        .join(Case, Case.id == Inspection.case_id)
        .join(Zone, Zone.id == Case.zone_id)
    )


def _day_bounds(low: date | None, high: date | None) -> tuple:
    start = datetime(low.year, low.month, low.day, tzinfo=IST) if low else None
    end = (datetime(high.year, high.month, high.day, tzinfo=IST) + timedelta(days=1)
           if high else None)
    return start, end


# The field app's work list is this one clause: their rounds, not the district's.
def _own_rounds_only(roles) -> bool:
    held = frozenset(str(role) for role in roles)
    return str(wf.Role.FIELD_SURVEYOR) in held and not (held & _SUPERVISORY)


def register(
    db: Session, params: InspectionQuery, scope: ZoneScope, *, caller: str, roles
) -> PageResult:
    statement = _register_select()

    if params.case_ref:
        statement = statement.where(Case.case_ref.in_(params.case_ref))
    if params.status:
        statement = statement.where(Inspection.status.in_(params.status))
    if params.round_no:
        statement = statement.where(Inspection.round_no.in_(params.round_no))
    if params.surveyor_user_id:
        statement = statement.where(
            Inspection.surveyor_user_id.in_(params.surveyor_user_id))
    if params.zone_cd:
        statement = statement.where(
            Case.zone_id.in_(select(Zone.id).where(Zone.zone_cd.in_(params.zone_cd)))
        )
    if params.priority:
        statement = statement.where(Case.priority.in_(params.priority))

    low, high = _day_bounds(params.submitted_from, params.submitted_to)
    if low is not None:
        statement = statement.where(Inspection.submitted_at >= low)
    if high is not None:
        statement = statement.where(Inspection.submitted_at < high)

    if params.q:
        statement = statement.where(
            search_clause(params.q, [Inspection.inspection_ref, Case.case_ref])
        )

    if _own_rounds_only(roles):
        statement = statement.where(Inspection.surveyor_user_id == caller)

    statement = scope.apply(statement, Case.zone_id)
    return paginate(db, statement, params, INSPECTION_SORTS)


def rows_to_dicts(result: PageResult) -> list[dict]:
    return [row_dict(row) for row in result.rows]


# ------------------------------------------------------------------ the detail
def inspection_detail(
    db: Session, inspection_ref: str, scope: ZoneScope, *, roles, user_id: str
) -> dict | None:
    statement = (
        select(
            *_ROW_COLUMNS,
            Inspection.id.label("_id"),
            Case.status.label("case_status"),
            Inspection.occupant_name,
            Inspection.occupant_phone,
            Inspection.owner_name,
            Inspection.owner_phone,
            Inspection.property_type_cd,
            Inspection.floor_count,
            Inspection.police_station,
            Inspection.encroachment_confirmed_cd,
            Inspection.area_type_cd,
            Inspection.measured_area_sqm,
            Inspection.external_support_cd,
            Inspection.recommendation_cd,
            Inspection.notice_required,
            Inspection.notice_act_cd,
            Inspection.officer_note,
            Inspection.construction_stage_cd,
            Inspection.length_m,
            Inspection.width_m,
            Inspection.findings_source,
            Inspection.location_accuracy_m,
            as_geojson_column(db, Inspection.location).label("_location"),
        )
        .join(Case, Case.id == Inspection.case_id)
        .join(Zone, Zone.id == Case.zone_id)
        .where(Inspection.inspection_ref == inspection_ref)
    )
    # The work list hides a colleague's round; reading it by reference must hide
    # it too, or the narrowing is a filter rather than a boundary. This detail
    # carries the occupant's name and telephone number.
    if _own_rounds_only(roles):
        statement = statement.where(Inspection.surveyor_user_id == user_id)

    row = db.execute(scope.apply(statement, Case.zone_id)).first()
    if row is None:
        return None

    data = dict(row._mapping)
    inspection_id = data.pop("_id")
    latitude, longitude = _latlon(data.pop("_location"))
    data["location"] = None if latitude is None else {"lat": latitude, "lon": longitude}
    data["area_mismatch"] = area_mismatch(data)

    data["findings"] = [
        dict(item._mapping)
        for item in db.execute(
            select(InspectionFinding.seq, InspectionFinding.finding,
                   InspectionFinding.created_at)
            .where(InspectionFinding.inspection_id == inspection_id)
            .order_by(InspectionFinding.seq)
        ).all()
    ]
    data["sections"] = [
        dict(item._mapping)
        for item in db.execute(
            select(InspectionSection.act_cd, InspectionSection.section_cd)
            .where(InspectionSection.inspection_id == inspection_id)
            .order_by(InspectionSection.act_cd, InspectionSection.section_cd)
        ).all()
    ]
    data["check_ins"] = _check_ins_of(db, inspection_id)
    data["evidence"] = [
        _evidence_dict(item)
        for item in db.execute(
            _evidence_select(db)
            .where(Evidence.inspection_id == inspection_id)
            .order_by(Evidence.id)
        ).all()
    ]

    data["available_actions"] = [
        str(action)
        for action in wf.allowed_actions(
            data["case_status"], roles,
            is_assignee=data["surveyor_user_id"] == user_id,
        )
    ]
    return data


def _check_ins_of(db: Session, inspection_id: int) -> list[dict]:
    rows = db.execute(
        _check_in_select(db).where(CheckIn.inspection_id == inspection_id)
        .order_by(CheckIn.id)
    ).all()
    return [_check_in_dict(row) for row in rows]


def _check_in_select(db: Session) -> Select:
    return (
        select(
            CheckIn.id,
            Inspection.inspection_ref,
            CheckIn.user_id,
            CheckIn.accuracy_m,
            CheckIn.device_timestamp,
            CheckIn.server_timestamp,
            CheckIn.capture_source,
            CheckIn.inside_zone,
            as_geojson_column(db, CheckIn.location).label("_location"),
        )
        .join(Inspection, Inspection.id == CheckIn.inspection_id)
    )


def _check_in_dict(row) -> dict:
    data = dict(row._mapping)
    data["lat"], data["lon"] = _latlon(data.pop("_location"))
    return data


# A point comes back as GeoJSON from both backends — the column itself on SQLite,
# ST_AsGeoJSON on PostGIS — and its coordinates are [lon, lat], always.
def _latlon(value) -> tuple[float | None, float | None]:
    geometry = parse_geojson(value)
    coordinates = (geometry or {}).get("coordinates") or []
    if len(coordinates) < 2:
        return None, None
    return float(coordinates[1]), float(coordinates[0])


# ---------------------------------------------------------------- the evidence
def _evidence_select(db: Session) -> Select:
    return (
        select(
            Evidence.id,
            Case.case_ref,
            Inspection.inspection_ref,
            Evidence.round_no,
            Evidence.kind,
            Evidence.doc_type_cd,
            Evidence.original_filename,
            Evidence.content_type,
            Evidence.byte_size,
            Evidence.sha256,
            Evidence.accuracy_m,
            Evidence.device_timestamp,
            Evidence.capture_source,
            Evidence.captured_at,
            Evidence.uploaded_by,
            Evidence.uploaded_at,
            Evidence.distance_to_site_m,
            Evidence.exif_lat,
            Evidence.exif_lon,
            Evidence.geotag_flagged.label("_stored_flag"),
            Evidence.stamped_storage_key.label("_stamped"),
            as_geojson_column(db, Evidence.location).label("_location"),
        )
        .join(Case, Case.id == Evidence.case_id)
        .outerjoin(Inspection, Inspection.id == Evidence.inspection_id)
    )


def _evidence_dict(row) -> dict:
    data = dict(row._mapping)
    data["lat"], data["lon"] = _latlon(data.pop("_location"))
    data["content_url"] = EVIDENCE_CONTENT_PATH.format(evidence_id=data["id"])
    data["stamped_url"] = (
        EVIDENCE_STAMPED_PATH.format(evidence_id=data["id"])
        if data.pop("_stamped") else None
    )
    data["geotag_flagged"] = bool(data.pop("_stored_flag")) or _is_flagged(
        data["lat"], data["lon"], data["accuracy_m"])
    return data


def evidence_for(
    db: Session, inspection_ref: str, scope: ZoneScope, *, roles, user_id: str
) -> list[dict] | None:
    found = _locate(db, inspection_ref, scope, own_of=_own_of(roles, user_id))
    if found is None:
        return None
    rows = db.execute(
        _evidence_select(db)
        .where(Evidence.inspection_id == found.inspection_id)
        .order_by(Evidence.id)
    ).all()
    return [_evidence_dict(row) for row in rows]


def evidence_content(
    db: Session, evidence_id: int, scope: ZoneScope, *, roles, user_id: str,
    stamped: bool = False,
) -> StoredEvidence | None:
    """The file behind one evidence row, or None when it is not the caller's to read."""
    path_column = Evidence.stamped_storage_key if stamped else Evidence.storage_path
    statement = (
        select(
            path_column.label("storage_path"), Evidence.original_filename,
            Evidence.content_type, Evidence.sha256, Case.zone_id,
        )
        .join(Case, Case.id == Evidence.case_id)
        .where(Evidence.id == evidence_id)
    )
    # A geo-located site photograph is the strongest thing in the record. Sight
    # of the zone is not sight of a colleague's round, and evidence hanging off
    # no round at all belongs to no surveyor.
    if _own_rounds_only(roles):
        statement = statement.where(
            Evidence.inspection_id.in_(
                select(Inspection.id).where(Inspection.surveyor_user_id == user_id)
            )
        )

    row = db.execute(scope.apply(statement, Case.zone_id)).first()
    if row is None:
        return None
    if not stamped:
        return stored_file(row, evidence_id)
    if row.storage_path is None:
        raise ApiError(404, "evidence_not_stamped",
                       "this evidence has no server-stamped copy")
    found = stored_file(row, evidence_id)
    stem = Path(row.original_filename or row.sha256 or str(evidence_id)).stem
    return StoredEvidence(path=found.path, filename=f"{stem}-stamped.jpg",
                          content_type="image/jpeg")


# ------------------------------------------------------------------ the writes
@dataclass(frozen=True)
class _Round:
    inspection_id: int
    inspection_ref: str
    round_no: int
    inspection_status: str
    surveyor_user_id: str
    case_id: int
    case_ref: str
    case_status: str
    zone_id: int
    current_round: int


# The user id a plain field surveyor is narrowed to, or None for everyone else.
def _own_of(roles, user_id: str) -> str | None:
    return user_id if _own_rounds_only(roles) else None


# `own_of` is opt-in and the write paths deliberately pass nothing: a surveyor
# checking in on somebody else's round must be refused 403 `not_the_assignee` by
# the transition, and narrowing here would turn that into a 404 that says the
# round does not exist.
def _locate(
    db: Session, inspection_ref: str, scope: ZoneScope, *, own_of: str | None = None
) -> _Round | None:
    statement = (
        select(
            Inspection.id, Inspection.inspection_ref, Inspection.round_no,
            Inspection.status, Inspection.surveyor_user_id,
            Case.id.label("case_id"), Case.case_ref,
            Case.status.label("case_status"), Case.zone_id, Case.current_round,
        )
        .join(Case, Case.id == Inspection.case_id)
        .where(Inspection.inspection_ref == inspection_ref)
    )
    if own_of is not None:
        statement = statement.where(Inspection.surveyor_user_id == own_of)

    row = db.execute(scope.apply(statement, Case.zone_id)).first()
    if row is None:
        return None
    return _Round(
        inspection_id=row.id, inspection_ref=row.inspection_ref, round_no=row.round_no,
        inspection_status=row.status, surveyor_user_id=row.surveyor_user_id,
        case_id=row.case_id, case_ref=row.case_ref, case_status=row.case_status,
        zone_id=row.zone_id, current_round=row.current_round,
    )


# Reads through a superseded round stay open; writes land on the current round only.
def _refuse_unless_current(row: _Round) -> None:
    if row.round_no != row.current_round:
        raise ApiError(
            409,
            "invalid_transition",
            f"{row.inspection_ref} is round {row.round_no} and the case is on round "
            f"{row.current_round}; read the case again and write to its current round",
        )


def _round_lock(inspection_id: int) -> Select:
    return select(Inspection.id).with_for_update().where(Inspection.id == inspection_id)


# Serialises the photo count and the insert per round (a no-op on SQLite).
def _lock_round(db: Session, inspection_id: int) -> None:
    db.execute(_round_lock(inspection_id))


def _locate_case(db: Session, case_ref: str, scope: ZoneScope):
    return db.execute(
        scope.apply(
            select(Case.id, Case.case_ref, Case.status, Case.stage_no,
                   Case.zone_id, Case.current_round)
            .where(Case.case_ref == case_ref),
            Case.zone_id,
        )
    ).first()


def _event(
    db: Session,
    *,
    case_id: int,
    action: str,
    actor: str,
    roles,
    inspection_id: int | None = None,
    from_status: str | None = None,
    to_status: str | None = None,
    round_no: int | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> None:
    db.execute(
        insert(CaseEvent).values(
            case_id=case_id,
            inspection_id=inspection_id,
            action=action,
            from_status=from_status,
            to_status=to_status,
            round_no=round_no,
            actor_user_id=actor,
            actor_role=",".join(sorted(frozenset(roles) & _KNOWN_ROLES)) or None,
            note=note,
            payload=payload,
        )
    )


def _in_progress(row: _Round) -> dict:
    """Field activity starts a round; `scheduled` is only ever the state before it."""
    values: dict = {"status": IN_PROGRESS, "updated_at": _now()}
    if row.inspection_status == SCHEDULED:
        values["started_at"] = _now()
    return values


def _refuse_unless_in_zone(db: Session, zone_id: int, user_id: str) -> None:
    assigned = db.execute(
        select(ZoneAssignment.id)
        .where(
            ZoneAssignment.zone_id == zone_id,
            ZoneAssignment.user_id == user_id,
            ZoneAssignment.active.is_(True),
        )
        .limit(1)
    ).scalar_one_or_none()
    if assigned is None:
        raise ApiError(
            422,
            "assignee_not_in_zone",
            "the surveyor has no active assignment to this case's zone, so the round "
            "would be invisible to them",
            field="surveyor_user_id",
        )


# Role-dependent, so it is here and not in the transition: OPEN_ROUND keeps
# assignee_only=False because the nodal branch below depends on it.
def _refuse_unless_own_round(
    db: Session, *, case_id: int, surveyor: str, actor: str, roles
) -> None:
    """A nodal officer opens any round in the zone; a surveyor only their own."""
    if _SUPERVISORY & frozenset(str(role) for role in roles):
        return
    if current_assignee(db, case_id) != actor:
        raise ApiError(
            403,
            "not_the_assignee",
            "open_round is permitted only to the officer the case is assigned to",
        )
    if surveyor != actor:
        raise ApiError(
            403,
            "not_the_assignee",
            "a field surveyor may open a round only in their own name; naming "
            "another surveyor is the nodal officer's to do",
            field="surveyor_user_id",
        )


# Stage 3 — open a round ------------------------------------------------------
def open_round(
    db: Session, case_ref: str, body: InspectionOpen, scope: ZoneScope,
    *, actor: str, roles,
) -> str | None:
    """Mints INS-YYYY-NNNN and moves the case to the transition's target."""
    row = _locate_case(db, case_ref, scope)
    if row is None:
        return None

    transition = wf.check(
        row.status, wf.Action.OPEN_ROUND, roles,
        payload={"surveyor_user_id": body.surveyor_user_id},
    )
    _refuse_unless_own_round(
        db, case_id=row.id, surveyor=body.surveyor_user_id, actor=actor, roles=roles)
    _refuse_unless_in_zone(db, row.zone_id, body.surveyor_user_id)

    try:
        inspection_ref, _, _ = _open_round_rows(
            db, case_id=row.id, from_status=row.status, from_round=row.current_round,
            surveyor=body.surveyor_user_id, transition=transition,
            actor=actor, roles=roles, scheduled_for=body.scheduled_for,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return inspection_ref


# No commit of its own: an approved re-survey writes its decision row in the same
# transaction as the round it opens.
def _open_round_rows(
    db: Session,
    *,
    case_id: int,
    from_status: str,
    from_round: int,
    surveyor: str,
    transition: wf.Transition,
    actor: str,
    roles,
    scheduled_for: datetime | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> tuple[str, int, int]:
    next_round = int(
        db.execute(
            select(func.coalesce(func.max(Inspection.round_no), 0))
            .where(Inspection.case_id == case_id)
        ).scalar_one()
    ) + 1

    # Compare-and-set before anything is minted: a second opener racing this one
    # finds the case already moved and gets 409 rather than a duplicate round.
    move_case(db, case_id, from_status, {
        "status": str(transition.target),
        "stage_no": transition.stage_no,
        "current_round": next_round,
        "updated_at": _now(),
    }, round_no=from_round)

    inspection_ref = allocate(db, Series.INSPECTION)
    inspection_id = db.execute(
        insert(Inspection)
        .values(
            inspection_ref=inspection_ref,
            case_id=case_id,
            round_no=next_round,
            surveyor_user_id=surveyor,
            scheduled_for=scheduled_for,
            status=SCHEDULED,
        )
        .returning(Inspection.id)
    ).scalar_one()

    _event(
        db, case_id=case_id, inspection_id=inspection_id,
        action=str(wf.Action.OPEN_ROUND), actor=actor, roles=roles,
        from_status=from_status, to_status=str(transition.target),
        round_no=next_round, note=note,
        payload={"inspection_ref": inspection_ref, "surveyor_user_id": surveyor,
                 **(payload or {})},
    )
    return inspection_ref, next_round, inspection_id


# Stage 3 — check in ----------------------------------------------------------
def _refuse_poor_accuracy(accuracy_m: float) -> None:
    gate = settings.icms_accuracy_gate_m
    if float(accuracy_m) > gate:
        raise ApiError(
            422,
            "poor_accuracy",
            f"the fix is accurate to {float(accuracy_m):g} m and a check-in must be "
            f"within {gate:g} m; wait for a better fix or move into the open",
            field="accuracy_m",
        )


def _check_in_by_key(db: Session, key: str):
    return db.execute(
        select(CheckIn.id, CheckIn.inspection_id).where(CheckIn.idempotency_key == key)
    ).first()


def _one_check_in(db: Session, check_in_id: int) -> dict:
    row = db.execute(_check_in_select(db).where(CheckIn.id == check_in_id)).first()
    return _check_in_dict(row)


# True or False on PostGIS; None where there is no boundary to test against.
def _inside_zone(
    db: Session, zone_id: int, latitude: float, longitude: float
) -> bool | None:
    if db.get_bind().dialect.name != "postgresql":
        return None
    return db.execute(
        select(func.ST_Contains(Zone.geom, point_value(db, latitude, longitude)))
        .where(Zone.id == zone_id, Zone.geom.is_not(None))
    ).scalar_one_or_none()


# Great-circle metres; the same on SQLite and PostGIS, so the gate never depends on the dialect.
def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_008.8 * math.asin(math.sqrt(min(1.0, a)))


def _case_point(db: Session, case_id: int) -> tuple[float | None, float | None]:
    value = db.execute(
        select(as_geojson_column(db, Case.location)).where(Case.id == case_id)
    ).scalar_one_or_none()
    return _latlon(value)


# Distance from the case point, or None when the case has no point; refuses outside the fence.
def _refuse_outside_geofence(db: Session, row: _Round, latitude: float, longitude: float,
                             ) -> float | None:
    site_lat, site_lon = _case_point(db, row.case_id)
    if site_lat is None or site_lon is None:
        log.warning("check-in on %s: case %s has no location, geofence not applied",
                    row.inspection_ref, row.case_ref)
        return None
    distance = _haversine_m(site_lat, site_lon, latitude, longitude)
    radius = runtime_settings.geofence_radius_m(db)
    if runtime_settings.geofence_enforced(db) and distance > radius:
        raise ApiError(
            422,
            "outside_geofence",
            f"the fix is {distance:.0f} m from the case location and a check-in must be "
            f"within {radius:g} m; move closer to the site",
            field="latitude",
            details={"distance_m": round(distance, 1), "radius_m": radius},
        )
    return distance


def check_in(
    db: Session, inspection_ref: str, body: CheckInCreate, scope: ZoneScope,
    *, actor: str, roles,
) -> dict | None:
    """The accuracy gate. A replayed key returns the original row, never a second one."""
    row = _locate(db, inspection_ref, scope)
    if row is None:
        return None

    key = str(body.idempotency_key)
    wf.check(
        row.case_status, wf.Action.CHECK_IN, roles,
        is_assignee=row.surveyor_user_id == actor,
        payload={
            "latitude": body.latitude, "longitude": body.longitude,
            "accuracy_m": body.accuracy_m, "device_timestamp": body.device_timestamp,
            "idempotency_key": key,
        },
    )

    replayed = _replayed_check_in(db, key, row)
    if replayed is not None:
        return replayed

    _refuse_unless_current(row)
    _refuse_poor_accuracy(body.accuracy_m)
    distance_m = _refuse_outside_geofence(db, row, body.latitude, body.longitude)

    try:
        move_case(db, row.case_id, row.case_status, round_no=row.round_no)
        check_in_id = db.execute(
            insert(CheckIn)
            .values(
                inspection_id=row.inspection_id,
                user_id=actor,
                location=point_value(db, body.latitude, body.longitude),
                accuracy_m=body.accuracy_m,
                device_timestamp=body.device_timestamp,
                capture_source=body.capture_source,
                inside_zone=_inside_zone(db, row.zone_id, body.latitude, body.longitude),
                idempotency_key=key,
            )
            .returning(CheckIn.id)
        ).scalar_one()

        db.execute(
            update(Inspection).where(Inspection.id == row.inspection_id)
            .values(**_in_progress(row),
                    location=point_value(db, body.latitude, body.longitude),
                    location_accuracy_m=body.accuracy_m)
        )
        _event(
            db, case_id=row.case_id, inspection_id=row.inspection_id,
            action=str(wf.Action.CHECK_IN), actor=actor, roles=roles,
            from_status=row.case_status, to_status=row.case_status,
            round_no=row.round_no,
            payload={
                "check_in_id": check_in_id, "accuracy_m": float(body.accuracy_m),
                "distance_m": None if distance_m is None else round(distance_m, 1),
                "site_located": distance_m is not None,
                "geofence_enforced": runtime_settings.geofence_enforced(db),
                "geofence_radius_m": runtime_settings.geofence_radius_m(db),
            },
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        replayed = _replayed_check_in(db, key, row)
        if replayed is not None:
            log.info("check-in %s raced its own replay on %s", key, inspection_ref)
            return replayed
        raise
    except Exception:
        db.rollback()
        raise

    return {"check_in": _one_check_in(db, check_in_id), "replayed": False}


# The key is unique across the table, so the same one on a second round is a client
# bug that would otherwise hand back another round's check-in.
def _replayed_check_in(db: Session, key: str, row: _Round) -> dict | None:
    existing = _check_in_by_key(db, key)
    if existing is None:
        return None
    if existing.inspection_id != row.inspection_id:
        raise ApiError(
            409, "idempotency_key_reused",
            "this idempotency_key already belongs to a check-in on another inspection",
            field="idempotency_key",
        )
    return {"check_in": _one_check_in(db, existing.id), "replayed": True}


# Stage 3 — evidence ----------------------------------------------------------
def _is_flagged(latitude, longitude, accuracy_m) -> bool:
    if latitude is None or longitude is None or accuracy_m is None:
        return True
    return float(accuracy_m) > settings.icms_accuracy_flag_m


# Photographs alone: a round carries documents and signatures too, and neither
# of them is what a photograph count is counting.
def _photo_count(db: Session, inspection_id: int) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Evidence)
            .where(
                Evidence.inspection_id == inspection_id,
                Evidence.kind.in_(sorted(GEOTAGGED_KINDS)),
            )
        ).scalar_one()
    )


# Evidence is append-only, so the ceiling is final and the message says what the
# round already holds: there is no way back under it.
def _refuse_a_full_round(db: Session, meta: EvidenceCreate, inspection_id: int) -> None:
    if meta.kind not in GEOTAGGED_KINDS:
        return
    ceiling = settings.icms_max_photos_per_round
    held = _photo_count(db, inspection_id)
    if held >= ceiling:
        raise ApiError(
            422,
            "too_many_photos",
            f"this round already holds {held} photograph{'' if held == 1 else 's'} and "
            f"a round carries at most {ceiling}; evidence is never removed, so this "
            "one has nowhere to go",
            field="kind",
        )


def _refuse_untagged_photo(meta: EvidenceCreate) -> None:
    if meta.kind not in GEOTAGGED_KINDS:
        return
    missing = [
        name for name, value in (
            ("latitude", meta.latitude), ("longitude", meta.longitude),
            ("accuracy_m", meta.accuracy_m), ("device_timestamp", meta.device_timestamp),
            ("capture_source", meta.capture_source),
        ) if value is None
    ]
    if missing:
        raise ApiError(
            422,
            "geotag_required",
            "a photograph is evidence of a place and a time: it is stored with its "
            f"position and capture fields or not at all (missing: {', '.join(missing)})",
            field=missing[0],
            allowed=missing,
        )


def _evidence_by_key(db: Session, key: str):
    return db.execute(
        select(Evidence.id, Evidence.inspection_id).where(Evidence.idempotency_key == key)
    ).first()


def _one_evidence(db: Session, evidence_id: int) -> dict:
    row = db.execute(_evidence_select(db).where(Evidence.id == evidence_id)).first()
    return _evidence_dict(row)


def _replayed_evidence(db: Session, key: str, row: _Round) -> dict | None:
    existing = _evidence_by_key(db, key)
    if existing is None:
        return None
    if existing.inspection_id != row.inspection_id:
        raise ApiError(
            409, "idempotency_key_reused",
            "this idempotency_key already belongs to evidence on another inspection",
            field="idempotency_key",
        )
    return {"evidence": _one_evidence(db, existing.id), "replayed": True}


def _discard_stamped(stamped_key: str | None) -> None:
    path = _resolve_stored(stamped_key)
    if path is not None:
        path.unlink(missing_ok=True)


# EXIF cross-check, distance to site and the stamped copy; never fails the upload.
def _photo_checks(
    db: Session, row: _Round, meta: EvidenceCreate, storage_path: str, sha256: str,
    key: str,
) -> dict:
    out = {"_flagged": False, "stamped_storage_key": None, "distance_to_site_m": None,
           "exif_lat": None, "exif_lon": None}
    if meta.kind not in GEOTAGGED_KINDS or not meta.located:
        return out
    lat, lon = float(meta.latitude), float(meta.longitude)
    site_lat, site_lon = _case_point(db, row.case_id)
    if site_lat is not None and site_lon is not None:
        out["distance_to_site_m"] = round(haversine_m(lat, lon, site_lat, site_lon), 1)

    original = _resolve_stored(storage_path)
    try:
        exif_lat, exif_lon = exif_gps(original)
    except Exception:
        log.info("evidence %s is not a decodable image; EXIF and stamp skipped", key)
        return out
    out["exif_lat"], out["exif_lon"] = exif_lat, exif_lon
    out["_flagged"] = (
        exif_lat is None or exif_lon is None
        or haversine_m(lat, lon, exif_lat, exif_lon) > settings.icms_exif_mismatch_m
    )

    stamped_key = f"{row.case_ref}/{sha256}-{key}.stamped.jpg"
    facts = StampFacts(
        case_ref=row.case_ref, inspection_ref=row.inspection_ref,
        latitude=lat, longitude=lon,
        accuracy_m=None if meta.accuracy_m is None else float(meta.accuracy_m),
        device_timestamp=meta.device_timestamp, received_at=_now(),
        distance_to_site_m=out["distance_to_site_m"],
    )
    try:
        out["stamped_storage_key"] = write_stamped(original, stamped_key, facts)
    except Exception:
        log.warning("could not stamp evidence %s; the original stands alone", key,
                    exc_info=True)
    return out


def add_evidence(
    db: Session, inspection_ref: str, meta: EvidenceCreate, upload: UploadFile,
    scope: ZoneScope, *, actor: str, roles,
) -> dict | None:
    """Append-only: the row is never updated and never deleted, and a re-survey
    adds a round rather than replacing one."""
    row = _locate(db, inspection_ref, scope)
    if row is None:
        return None

    key = str(meta.idempotency_key)
    wf.check(
        row.case_status, wf.Action.ADD_EVIDENCE, roles,
        is_assignee=row.surveyor_user_id == actor,
        payload={"kind": meta.kind, "idempotency_key": key},
    )

    replayed = _replayed_evidence(db, key, row)
    if replayed is not None:
        return replayed

    _refuse_unless_current(row)
    _refuse_untagged_photo(meta)
    # Early, so a full round is refused before the file is written to disk.
    _refuse_a_full_round(db, meta, row.inspection_id)
    flagged = _is_flagged(meta.latitude, meta.longitude, meta.accuracy_m)

    result, storage_path, created = _store(db, row.case_ref, meta.kind, upload)
    checks = _photo_checks(db, row, meta, storage_path, result.sha256, key)
    flagged = checks.pop("_flagged") or flagged
    stamped = checks["stamped_storage_key"]

    try:
        move_case(db, row.case_id, row.case_status, round_no=row.round_no)
        # Authoritative: the count and the insert under the round's row lock.
        _lock_round(db, row.inspection_id)
        _refuse_a_full_round(db, meta, row.inspection_id)
        evidence_id = db.execute(
            insert(Evidence)
            .values(
                case_id=row.case_id,
                inspection_id=row.inspection_id,
                round_no=row.round_no,
                kind=meta.kind,
                doc_type_cd=meta.doc_type_cd,
                storage_path=storage_path,
                original_filename=upload.filename,
                content_type=result.media_type,
                byte_size=result.byte_size,
                sha256=result.sha256,
                location=(
                    point_value(db, meta.latitude, meta.longitude)
                    if meta.located else None
                ),
                accuracy_m=meta.accuracy_m,
                device_timestamp=meta.device_timestamp,
                capture_source=meta.capture_source,
                captured_at=meta.device_timestamp,
                uploaded_by=actor,
                idempotency_key=key,
                geotag_flagged=flagged,
                **checks,
            )
            .returning(Evidence.id)
        ).scalar_one()

        db.execute(
            update(Inspection).where(Inspection.id == row.inspection_id)
            .values(**_in_progress(row))
        )
        _event(
            db, case_id=row.case_id, inspection_id=row.inspection_id,
            action=str(wf.Action.ADD_EVIDENCE), actor=actor, roles=roles,
            from_status=row.case_status, to_status=row.case_status,
            round_no=row.round_no,
            payload={"evidence_id": evidence_id, "kind": meta.kind,
                     "sha256": result.sha256, "geotag_flagged": flagged},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        _discard_stored(db, storage_path, created)
        _discard_stamped(stamped)
        replayed = _replayed_evidence(db, key, row)
        if replayed is not None:
            log.info("evidence %s raced its own replay on %s", key, inspection_ref)
            return replayed
        raise
    except Exception:
        db.rollback()
        _discard_stored(db, storage_path, created)
        _discard_stamped(stamped)
        raise

    return {"evidence": _one_evidence(db, evidence_id), "replayed": False}


# Stage 4 — findings ----------------------------------------------------------
# The round's stored answers, keyed by column name.
def _stored_answers(db: Session, inspection_id: int) -> dict:
    row = db.execute(
        select(*(getattr(Inspection, name) for name in OBSERVED_COLUMNS),
               Inspection.findings_source)
        .where(Inspection.id == inspection_id)
    ).one()
    return dict(row._mapping)


# A newly written code must be active in its domain; the round's own legacy code may stay.
def _refuse_unknown_code(
    db: Session, carried: dict, stored: dict, column: str, domain: str
) -> None:
    code = carried.get(column)
    if code is None or code == stored.get(column):
        return
    active = db.execute(
        select(CodeValue.code)
        .where(CodeValue.domain == domain, CodeValue.active.is_(True))
        .order_by(CodeValue.sort_order, CodeValue.code)
    ).scalars().all()
    if code not in active:
        raise ApiError(
            422, "validation_failed",
            f"{code!r} is not an active {domain} code value",
            field=column, allowed=active,
        )


# Each newly cited (act, section) must be an active section under an active act; the round's own pairs may stay.
def _refuse_unknown_sections(
    db: Session, inspection_id: int, sections: list | None
) -> None:
    if not sections:
        return
    held = set(_sections_of(db, inspection_id))
    wanted = {(s.act_cd, s.section_cd) for s in sections} - held
    if not wanted:
        return
    acts = set(db.execute(
        select(CodeValue.code)
        .where(CodeValue.domain == "act", CodeValue.active.is_(True))
    ).scalars().all())
    active = db.execute(
        select(CodeValue.parent_code, CodeValue.code)
        .where(CodeValue.domain == "section", CodeValue.active.is_(True))
        .order_by(CodeValue.parent_code, CodeValue.sort_order, CodeValue.code)
    ).all()
    known = {(act, code) for act, code in active if act in acts}
    for act_cd, section_cd in sorted(wanted):
        if (act_cd, section_cd) not in known:
            raise ApiError(
                422, "validation_failed",
                f"{section_cd!r} is not an active section of act {act_cd!r}",
                field="sections",
                allowed=[code for act, code in active if act == act_cd] or sorted(acts),
            )


def _sections_of(db: Session, inspection_id: int) -> list[tuple[str, str]]:
    return [
        (act_cd, section_cd)
        for act_cd, section_cd in db.execute(
            select(InspectionSection.act_cd, InspectionSection.section_cd)
            .where(InspectionSection.inspection_id == inspection_id)
        ).all()
    ]


def _refuse_inconsistent(values: dict) -> None:
    problems = inconsistencies(values)
    if problems:
        first = problems[0]
        raise ApiError(422, "validation_failed", first.message,
                       field=first.field, allowed=first.allowed)


# length × width when no area was sent and none is stored, or the stored one was itself derived.
def _derive_area(observed: dict, stored: dict) -> dict:
    if observed.get("measured_area_sqm") is not None:
        return observed
    held = stored.get("measured_area_sqm")
    if held is not None and "measured_area_sqm" not in observed and (
            side_area(stored) is None or float(held) != side_area(stored)):
        return observed
    area = side_area({**stored, **observed})
    if area is None or area <= 0:
        return observed
    return {**observed, "measured_area_sqm": area}


def record_findings(
    db: Session, inspection_ref: str, body: FindingsPut, scope: ZoneScope,
    *, actor: str, roles, source: str,
) -> bool:
    """Replaces the round's findings; the sections only when the form carried them."""
    row = _locate(db, inspection_ref, scope)
    if row is None:
        return False

    transition = wf.check(
        row.case_status, wf.Action.RECORD_FINDINGS, roles,
        is_assignee=row.surveyor_user_id == actor,
        payload={"findings": body.findings},
    )
    _refuse_unless_current(row)

    stored = _stored_answers(db, row.inspection_id)
    observed = _derive_area(derive(body.observations()), stored)
    _refuse_unknown_code(db, observed, stored, "area_type_cd", "area_type")
    _refuse_unknown_code(db, observed, stored, "property_type_cd", "property_type")
    _refuse_unknown_code(db, observed, stored, "construction_stage_cd", "construction_stage")
    _refuse_unknown_code(db, observed, stored, "notice_act_cd", "act")
    _refuse_unknown_sections(db, row.inspection_id, body.sections)
    _refuse_inconsistent({**stored, **observed})

    try:
        move_case(db, row.case_id, row.case_status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "updated_at": _now(),
        }, round_no=row.round_no)
        db.execute(
            delete(InspectionFinding)
            .where(InspectionFinding.inspection_id == row.inspection_id)
        )
        db.execute(
            insert(InspectionFinding),
            [
                {"inspection_id": row.inspection_id, "seq": seq, "finding": finding}
                for seq, finding in enumerate(body.findings, start=1)
            ],
        )
        if body.sections is not None:
            db.execute(
                delete(InspectionSection)
                .where(InspectionSection.inspection_id == row.inspection_id)
            )
            unique = sorted({(s.act_cd, s.section_cd) for s in body.sections})
            if unique:
                db.execute(
                    insert(InspectionSection),
                    [
                        {"inspection_id": row.inspection_id,
                         "act_cd": act_cd, "section_cd": section_cd}
                        for act_cd, section_cd in unique
                    ],
                )

        db.execute(
            update(Inspection).where(Inspection.id == row.inspection_id)
            .values(**observed, findings_source=source, **_in_progress(row))
        )
        _event(
            db, case_id=row.case_id, inspection_id=row.inspection_id,
            action=str(wf.Action.RECORD_FINDINGS), actor=actor, roles=roles,
            from_status=row.case_status, to_status=str(transition.target),
            round_no=row.round_no,
            payload={"findings": len(body.findings),
                     "fields": sorted(observed), "source": source},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return True


# Stage 4 — submit ------------------------------------------------------------
# `missing_payload` rather than a code of its own: what the transition needs is
# not in the round, which is the refusal that code already names in section 6.
def _refuse_too_few_photos(db: Session, inspection_id: int) -> None:
    floor = settings.icms_min_photos_per_round
    held = _photo_count(db, inspection_id)
    if held < floor:
        raise ApiError(
            422,
            "missing_payload",
            f"this round carries {held} photograph{'' if held == 1 else 's'} and a "
            f"submitted round must carry at least {floor}; upload the rest before "
            "submitting",
            field="evidence",
        )


# R1-R6 on what the round holds; `missing_payload` lists every field still owed.
def _refuse_unanswered(db: Session, inspection_id: int) -> None:
    if not settings.icms_require_inspection_answers:
        return
    stored = _stored_answers(db, inspection_id)
    _refuse_inconsistent(stored)
    findings = db.execute(
        select(func.count()).select_from(InspectionFinding)
        .where(InspectionFinding.inspection_id == inspection_id)
    ).scalar_one()
    check_ins = db.execute(
        select(func.count()).select_from(CheckIn)
        .where(CheckIn.inspection_id == inspection_id)
    ).scalar_one()
    missing = missing_for_submit(stored, findings=findings, check_ins=check_ins,
                                 sections=_sections_of(db, inspection_id),
                                 origin=stored.get("findings_source"))
    if missing:
        raise ApiError(
            422, "missing_payload",
            f"the round cannot be submitted until it carries: {', '.join(missing)}",
            field=missing[0], allowed=missing,
        )


# The idempotency key the round's latest submit event was written with.
def _submitted_with(db: Session, inspection_id: int) -> str | None:
    payload = db.execute(
        select(CaseEvent.payload)
        .where(CaseEvent.inspection_id == inspection_id,
               CaseEvent.action == str(wf.Action.SUBMIT))
        .order_by(CaseEvent.id.desc()).limit(1)
    ).scalar_one_or_none()
    return payload.get("idempotency_key") if isinstance(payload, dict) else None


def submit(
    db: Session, inspection_ref: str, body: SubmitRequest, scope: ZoneScope,
    *, actor: str, roles,
) -> dict | None:
    """Idempotent by state rather than by a stored key: a round already submitted is
    itself the answer to submitting it again."""
    row = _locate(db, inspection_ref, scope)
    if row is None:
        return None

    payload = {"idempotency_key": str(body.idempotency_key)}
    is_assignee = row.surveyor_user_id == actor

    if row.inspection_status == SUBMITTED:
        # Authorised against the status the round was submitted FROM, so the replay
        # is refused to exactly the callers the first attempt would have been.
        wf.check(wf.Status.UNDER_INSPECTION, wf.Action.SUBMIT, roles,
                 is_assignee=is_assignee, payload=payload)
        return {"replayed": True}

    transition = wf.check(
        row.case_status, wf.Action.SUBMIT, roles,
        is_assignee=is_assignee, payload=payload,
    )
    _refuse_unless_current(row)

    try:
        move_case(db, row.case_id, row.case_status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "updated_at": _now(),
        }, round_no=row.round_no)
        # After the replay branch above and before any state change: a round already
        # submitted is answered with itself whatever the count rule says today.
        _lock_round(db, row.inspection_id)
        _refuse_too_few_photos(db, row.inspection_id)
        _refuse_unanswered(db, row.inspection_id)
        db.execute(
            update(Inspection).where(Inspection.id == row.inspection_id)
            .values(status=SUBMITTED, submitted_at=_now(), updated_at=_now())
        )
        _event(
            db, case_id=row.case_id, inspection_id=row.inspection_id,
            action=str(wf.Action.SUBMIT), actor=actor, roles=roles,
            from_status=row.case_status, to_status=str(transition.target),
            round_no=row.round_no, payload=payload,
        )
        db.commit()
    except ApiError as refused:
        db.rollback()
        # A retry that lost the race to its own first attempt is still a replay;
        # losing to a different submit (another key) is not.
        if refused.code == "invalid_transition":
            again = _locate(db, inspection_ref, scope)
            if (again is not None and again.inspection_status == SUBMITTED
                    and _submitted_with(db, row.inspection_id) == payload["idempotency_key"]):
                return {"replayed": True}
        raise
    except Exception:
        db.rollback()
        raise
    return {"replayed": False}


# Stage 5 — verify ------------------------------------------------------------
_VERIFY_ACTIONS = {
    "accept": (wf.Action.VERIFY_ACCEPT, ACCEPTED),
    "reject": (wf.Action.VERIFY_REJECT, REJECTED),
}


def verify(
    db: Session, inspection_ref: str, body: VerifyRequest, scope: ZoneScope,
    *, actor: str, roles,
) -> bool:
    row = _locate(db, inspection_ref, scope)
    if row is None:
        return False

    action, round_status = _VERIFY_ACTIONS[body.decision]
    transition = wf.check(row.case_status, action, roles, payload={"reason": body.reason})
    _refuse_unless_current(row)

    try:
        move_case(db, row.case_id, row.case_status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "updated_at": _now(),
        }, round_no=row.round_no)
        db.execute(
            update(Inspection).where(Inspection.id == row.inspection_id)
            .values(status=round_status, updated_at=_now())
        )
        _event(
            db, case_id=row.case_id, inspection_id=row.inspection_id,
            action=str(action), actor=actor, roles=roles,
            from_status=row.case_status, to_status=str(transition.target),
            round_no=row.round_no, note=body.reason,
            payload={"inspection_ref": row.inspection_ref, "decision": body.decision},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return True


# Stages 4 and 5 — the re-survey loop -----------------------------------------
def _resurvey_select() -> Select:
    return select(
        ResurveyRequest.id, Case.case_ref, ResurveyRequest.from_round,
        ResurveyRequest.reason, ResurveyRequest.requested_by,
        ResurveyRequest.requested_at, ResurveyRequest.decision,
        ResurveyRequest.decided_by, ResurveyRequest.decided_at,
        ResurveyRequest.decision_note, ResurveyRequest.resulting_round,
    ).join(Case, Case.id == ResurveyRequest.case_id)


def resurvey_detail(db: Session, request_id: int, scope: ZoneScope) -> dict | None:
    row = db.execute(
        scope.apply(
            _resurvey_select().where(ResurveyRequest.id == request_id), Case.zone_id)
    ).first()
    return None if row is None else dict(row._mapping)


# None is a case the caller cannot see; an empty list is one that was never re-surveyed.
def resurvey_requests_for(
    db: Session, case_ref: str, scope: ZoneScope
) -> list[dict] | None:
    """Every request raised on the case, decided and pending alike, newest first."""
    case = _locate_case(db, case_ref, scope)
    if case is None:
        return None
    rows = db.execute(
        _resurvey_select()
        .where(ResurveyRequest.case_id == case.id)
        .order_by(ResurveyRequest.requested_at.desc(), ResurveyRequest.id.desc())
    ).all()
    return [dict(row._mapping) for row in rows]


def request_resurvey(
    db: Session, case_ref: str, body: ResurveyCreate, scope: ZoneScope,
    *, actor: str, roles,
) -> int | None:
    row = _locate_case(db, case_ref, scope)
    if row is None:
        return None

    transition = wf.check(
        row.status, wf.Action.REQUEST_RESURVEY, roles, payload={"reason": body.reason})

    from_round = int(
        db.execute(
            select(func.coalesce(func.max(Inspection.round_no), 0))
            .where(Inspection.case_id == row.id)
        ).scalar_one()
    )

    try:
        move_case(db, row.id, row.status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "updated_at": _now(),
        }, round_no=row.current_round)
        request_id = db.execute(
            insert(ResurveyRequest)
            .values(
                case_id=row.id,
                from_round=from_round,
                reason=body.reason,
                requested_by=actor,
                decision=PENDING,
            )
            .returning(ResurveyRequest.id)
        ).scalar_one()
        _event(
            db, case_id=row.id, action=str(wf.Action.REQUEST_RESURVEY),
            actor=actor, roles=roles,
            from_status=row.status, to_status=str(transition.target),
            round_no=from_round, note=body.reason,
            payload={"resurvey_request_id": request_id, "from_round": from_round},
        )
        db.commit()
    except IntegrityError:
        # uq_icms_resurvey_pending: one open request per case, so a second one is a
        # question already asked rather than a new one.
        db.rollback()
        log.info("a re-survey request is already pending on %s", case_ref)
        raise ApiError(
            409, "resurvey_already_pending",
            "this case already has a re-survey request awaiting a decision",
        ) from None
    except Exception:
        db.rollback()
        raise
    return request_id


# Deciding is the authority to open the round the request asks for, read off the
# same table; refusing is that authority declining, so it is checked the same way.
def _refuse_unless_may_open_round(status: str, roles) -> None:
    transition = next(
        (t for t in wf.transitions_for(status) if t.action == wf.Action.OPEN_ROUND), None)
    if transition is None:
        raise wf.UnknownTransition(wf.Status(status), wf.Action.OPEN_ROUND)
    wf.require_permission(wf.Action.OPEN_ROUND, transition.permission, roles)


def decide_resurvey(
    db: Session, request_id: int, body: ResurveyDecide, scope: ZoneScope,
    *, actor: str, roles,
) -> bool:
    """Approving opens round n+1; refusing records the decision and moves no case."""
    row = db.execute(
        scope.apply(
            select(
                ResurveyRequest.id, ResurveyRequest.decision, ResurveyRequest.from_round,
                Case.id.label("case_id"), Case.case_ref, Case.status, Case.zone_id,
                Case.current_round,
            )
            .join(Case, Case.id == ResurveyRequest.case_id)
            .where(ResurveyRequest.id == request_id),
            Case.zone_id,
        )
    ).first()
    if row is None:
        return False

    if row.decision != PENDING:
        raise ApiError(
            409, "resurvey_already_decided",
            f"this re-survey request was already {row.decision}",
        )

    decided = {"decided_by": actor, "decided_at": _now(), "decision_note": body.note}
    refusing = body.decision == "refuse"

    # Both branches are one authority — the decision to open the round the
    # request asks for — so both get the same two checks in the same order the
    # rest of the module uses: the transition first, then whose round it may be.
    if refusing:
        _refuse_unless_may_open_round(row.status, roles)
    else:
        transition = wf.check(
            row.status, wf.Action.OPEN_ROUND, roles,
            payload={"surveyor_user_id": body.surveyor_user_id},
        )
    # Refusing names nobody to a round, so there the subject is the actor. A
    # refusal on a colleague's case is not a smaller act than an approval: the
    # only transition out of `resurvey_requested` is `open_round`, so refusing
    # strands the case where no further request can be raised.
    _refuse_unless_own_round(
        db, case_id=row.case_id, actor=actor, roles=roles,
        surveyor=actor if refusing else body.surveyor_user_id,
    )

    if refusing:
        try:
            _decide_pending(db, request_id, {"decision": REFUSED, **decided})
            move_case(db, row.case_id, row.status, round_no=row.current_round)
            _event(
                db, case_id=row.case_id, action=RESURVEY_REFUSED, actor=actor,
                roles=roles, from_status=row.status, to_status=row.status,
                round_no=row.from_round, note=body.note,
                payload={"resurvey_request_id": request_id, "decision": REFUSED},
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
        return True

    _refuse_unless_in_zone(db, row.zone_id, body.surveyor_user_id)

    try:
        _decide_pending(db, request_id, {"decision": APPROVED, **decided})
        _, next_round, _ = _open_round_rows(
            db, case_id=row.case_id, from_status=row.status,
            from_round=row.current_round,
            surveyor=body.surveyor_user_id, transition=transition,
            actor=actor, roles=roles, note=body.note,
            payload={"resurvey_request_id": request_id},
        )
        db.execute(
            update(ResurveyRequest).where(ResurveyRequest.id == request_id)
            .values(resulting_round=next_round)
        )
        db.commit()
    except IntegrityError:
        # icms_inspection_round_uq: a concurrent opener minted this round first.
        db.rollback()
        raise ApiError(
            409, "invalid_transition",
            "another round was opened on this case at the same moment; read it again",
        ) from None
    except Exception:
        db.rollback()
        raise
    return True


# Not a workflow action: a refusal moves no case, but Rule 1 still wants its row.
RESURVEY_REFUSED = "refuse_resurvey"


# Compare-and-set on the decision: two deciders racing get one decision and one 409.
def _decide_pending(db: Session, request_id: int, values: dict) -> None:
    decided = db.execute(
        update(ResurveyRequest)
        .where(ResurveyRequest.id == request_id, ResurveyRequest.decision == PENDING)
        .values(**values)
    )
    if decided.rowcount != 1:
        raise ApiError(
            409, "resurvey_already_decided",
            "this re-survey request was decided by someone else a moment ago",
        )
