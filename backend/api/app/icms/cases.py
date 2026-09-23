from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from ada_core.datetimes import now_ist
from ada_core.models_icms import (
    Case,
    CaseAssignment,
    CaseEvent,
    CodeValue,
    Evidence,
    Inspection,
    Zone,
    ZoneAssignment,
)
from sqlalchemy import Select, and_, case, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin
from ..errors import ApiError
from . import workflow as wf
from .case_schemas import (
    CaseAmend,
    CaseAssign,
    CaseConfirm,
    CaseCreate,
    CaseHandover,
    CaseQuery,
)
from .collection import PageResult, Sortable, paginate, row_dict, search_clause
from .geo import as_geojson_column, parse_geojson, point_value, zone_containing
from .numbering import IST, Series, allocate
from .security import ZoneScope

__all__ = [
    "CASE_SORTS",
    "amend_case",
    "assign_case",
    "case_detail",
    "confirm_case",
    "current_assignee",
    "hand_over_case",
    "raise_case",
    "register",
]


log = logging.getLogger("ada.api.icms.cases")


def _now() -> datetime:
    return now_ist()


# A surveyor holding none of these sees their own cases and nobody else's.
_SUPERVISORY = frozenset({
    str(wf.Role.PCS_NODAL_OFFICER), str(wf.Role.ADA_PROJECT_LEAD), str(wf.Role.SUPER_ADMIN),
})

_OPEN_SURVEY = and_(
    CaseAssignment.case_id == Case.id,
    CaseAssignment.active.is_(True),
    CaseAssignment.assignment_type == "survey",
)

# The one resolution of "who is this case assigned to", read by the register, the
# detail and the inspection loop off the single open survey row `assign` maintains.
def current_assignee(db: Session, case_id: int) -> str | None:
    """The assignee_user_id of the case's open survey assignment, or None."""
    return db.execute(
        select(CaseAssignment.assignee_user_id)
        .join(Case, _OPEN_SURVEY)
        .where(Case.id == case_id)
        .order_by(CaseAssignment.assigned_at.desc())
        .limit(1)
    ).scalar_one_or_none()


_TYPE_LABEL = and_(
    CodeValue.domain == "complaint_type",
    CodeValue.code == Case.complaint_type_cd,
)

_LATEST_AREA = (
    select(Inspection.measured_area_sqm)
    .where(Inspection.case_id == Case.id)
    .order_by(Inspection.round_no.desc())
    .limit(1)
    .correlate(Case)
    .scalar_subquery()
)

_PRIORITY_ORDER = case(
    {"high": 1, "medium": 2, "low": 3}, value=Case.priority, else_=99
)

CASE_SORTS = Sortable(
    columns={
        "case_ref": Case.case_ref,
        "raised_at": Case.raised_at,
        "status": Case.status,
        "stage_no": Case.stage_no,
        "complainant_name": Case.complainant_name,
        "property_address": Case.property_address,
        "complaint_type_cd": Case.complaint_type_cd,
        "priority": _PRIORITY_ORDER,
        "ulpin": Case.ulpin,
        "khasra_no": Case.khasra_no,
        "zone_cd": Zone.zone_cd,
        "updated_at": Case.updated_at,
    },
    default="-raised_at",
    tiebreaker=Case.id,
)

_ROW_COLUMNS = (
    Case.case_ref,
    Zone.zone_cd,
    Zone.name.label("zone_name"),
    Case.property_address,
    Case.landmark,
    Case.complainant_name,
    Case.complaint_type_cd,
    CodeValue.label.label("complaint_type_label"),
    Case.other_type,
    _LATEST_AREA.label("measured_area_sqm"),
    Case.priority,
    Case.ulpin,
    Case.khasra_no,
    Case.village_lgd_code,
    Case.status,
    Case.stage_no,
    Case.current_round,
    Case.source,
    CaseAssignment.assignee_user_id.label("assignee_user_id"),
    Case.raised_at,
)


def _register_select() -> Select:
    return (
        select(*_ROW_COLUMNS)
        .join(Zone, Zone.id == Case.zone_id)
        .outerjoin(CaseAssignment, _OPEN_SURVEY)
        .outerjoin(CodeValue, _TYPE_LABEL)
    )


def _day_bounds(filed_from: date | None, filed_to: date | None) -> tuple:
    low = datetime(filed_from.year, filed_from.month, filed_from.day, tzinfo=IST) \
        if filed_from else None
    high = datetime(filed_to.year, filed_to.month, filed_to.day, tzinfo=IST) \
        + timedelta(days=1) if filed_to else None
    return low, high


# The field app's work list is this one clause: their cases, not the district's.
def _own_cases_only(roles) -> bool:
    held = frozenset(str(role) for role in roles)
    return str(wf.Role.FIELD_SURVEYOR) in held and not (held & _SUPERVISORY)


def register(
    db: Session, params: CaseQuery, scope: ZoneScope, *, caller: str, roles
) -> PageResult:
    statement = _register_select()

    if params.status:
        statement = statement.where(Case.status.in_(params.status))
    if params.stage_no:
        statement = statement.where(Case.stage_no.in_(params.stage_no))
    if params.zone_cd:
        statement = statement.where(
            Case.zone_id.in_(select(Zone.id).where(Zone.zone_cd.in_(params.zone_cd)))
        )
    if params.complaint_type_cd:
        statement = statement.where(Case.complaint_type_cd.in_(params.complaint_type_cd))
    if params.source:
        statement = statement.where(Case.source.in_(params.source))
    if params.priority:
        statement = statement.where(Case.priority.in_(params.priority))
    if params.ulpin:
        statement = statement.where(Case.ulpin.in_(params.ulpin))
    if params.khasra_no:
        statement = statement.where(Case.khasra_no.in_(params.khasra_no))
    if params.village_lgd_code:
        statement = statement.where(Case.village_lgd_code.in_(params.village_lgd_code))
    if params.assignee_user_id:
        statement = statement.where(
            CaseAssignment.assignee_user_id.in_(params.assignee_user_id))
    if params.mine:
        statement = statement.where(CaseAssignment.assignee_user_id == caller)

    low, high = _day_bounds(params.filed_from, params.filed_to)
    if low is not None:
        statement = statement.where(Case.raised_at >= low)
    if high is not None:
        statement = statement.where(Case.raised_at < high)

    if params.q:
        statement = statement.where(
            search_clause(params.q, [
                Case.case_ref,
                Case.ulpin,
                Case.khasra_no,
                Case.property_address,
                Case.landmark,
                Case.complainant_name,
                Case.owner_name,
            ])
        )

    if _own_cases_only(roles):
        statement = statement.where(CaseAssignment.assignee_user_id == caller)

    statement = scope.apply(statement, Case.zone_id)
    return paginate(db, statement, params, CASE_SORTS)


# `own_only=False` is the creator reading back their own write, and nothing else.
def case_detail(
    db: Session, case_ref: str, scope: ZoneScope, *, roles, user_id: str,
    own_only: bool = True,
) -> dict | None:
    statement = (
        select(
            *_ROW_COLUMNS,
            Case.id.label("_id"),
            Case.detail,
            Case.complainant_phone,
            Case.complainant_email,
            Case.owner_name,
            Case.owner_phone,
            Case.police_station,
            Case.pin_code,
            Case.district,
            Case.state,
            Case.country,
            Case.property_type_cd,
            Case.floor_count,
            Case.detection_id,
            Case.district_lgd_code,
            Case.idempotency_key,
            Case.closed_at,
            Case.created_by,
            Case.updated_at,
            as_geojson_column(db, Case.location).label("location"),
        )
        .join(Zone, Zone.id == Case.zone_id)
        .outerjoin(CaseAssignment, _OPEN_SURVEY)
        .outerjoin(CodeValue, _TYPE_LABEL)
        .where(Case.case_ref == case_ref)
    )
    if own_only and _own_cases_only(roles):
        statement = statement.where(CaseAssignment.assignee_user_id == user_id)

    row = db.execute(scope.apply(statement, Case.zone_id)).first()
    if row is None:
        return None

    data = dict(row._mapping)
    case_id = data.pop("_id")
    data["location"] = parse_geojson(data.get("location"))

    assignment = db.execute(
        select(
            CaseAssignment.assignee_user_id, CaseAssignment.assigned_by,
            CaseAssignment.assignment_type, CaseAssignment.note,
            CaseAssignment.assigned_at, CaseAssignment.active, CaseAssignment.released_at,
        )
        .where(CaseAssignment.case_id == case_id, CaseAssignment.active.is_(True))
        .order_by(CaseAssignment.assigned_at.desc())
        .limit(1)
    ).first()
    data["assignment"] = dict(assignment._mapping) if assignment is not None else None

    data["rounds"] = [
        dict(r._mapping)
        for r in db.execute(
            select(
                Inspection.inspection_ref, Inspection.round_no,
                Inspection.surveyor_user_id, Inspection.status,
                Inspection.submitted_at, Inspection.measured_area_sqm,
            )
            .where(Inspection.case_id == case_id)
            .order_by(Inspection.round_no)
        ).all()
    ]

    data["evidence_count"] = int(
        db.execute(
            select(func.count()).select_from(Evidence).where(Evidence.case_id == case_id)
        ).scalar_one()
    )

    is_assignee = (
        data["assignee_user_id"] is not None and data["assignee_user_id"] == user_id
    )
    data["allowed_actions"] = [
        str(a) for a in wf.allowed_actions(data["status"], roles, is_assignee=is_assignee)
    ]
    return data


def _event(
    db: Session,
    *,
    case_id: int,
    action: str,
    actor: str,
    roles,
    from_status: str | None = None,
    to_status: str | None = None,
    round_no: int | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> None:
    db.execute(
        insert(CaseEvent).values(
            case_id=case_id,
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


_KNOWN_ROLES = frozenset(str(r) for r in wf.Role)


_NO_ZONE = "no active zone you may file a case into"


# One answer for absent, inactive and not-yours, so this enumerates no zones.
def _no_zone(field: str) -> ApiError:
    return ApiError(404, "zone_not_found", _NO_ZONE, field=field)


def _zone_for(db: Session, body: CaseCreate, scope: ZoneScope) -> int:
    if body.location is not None:
        resolved = zone_containing(db, body.location.latitude, body.location.longitude)
        if resolved is not None:
            if not scope.allows(resolved):
                raise _no_zone("location")
            return resolved

    if body.zone_cd is None:
        raise ApiError(
            422,
            "zone_unresolved",
            "the location is not inside any active zone boundary; send zone_cd",
            field="zone_cd",
        )

    zone_id = db.execute(
        scope.apply(
            select(Zone.id).where(Zone.zone_cd == body.zone_cd, Zone.active.is_(True)),
            Zone.id,
        )
    ).scalar_one_or_none()
    if zone_id is None:
        raise _no_zone("zone_cd")
    return zone_id


def _by_idempotency_key(db: Session, key: str) -> str | None:
    return db.execute(
        select(Case.case_ref).where(Case.idempotency_key == key)
    ).scalar_one_or_none()


def raise_case(
    db: Session, body: CaseCreate, scope: ZoneScope, *, actor: str, roles
) -> dict:
    key = str(body.idempotency_key) if body.idempotency_key else None
    if key:
        replayed = _by_idempotency_key(db, key)
        if replayed is not None:
            return {"case_ref": replayed, "replayed": True}

    zone_id = _zone_for(db, body, scope)

    transition = wf.check(
        None, wf.Action.RAISE, roles,
        payload={"zone_id": zone_id, "source": body.source},
    )

    try:
        case_ref = allocate(db, Series.CASE)
        values = {
            "case_ref": case_ref,
            "zone_id": zone_id,
            "source": body.source,
            "detection_id": body.detection_id,
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "created_by": actor,
            "idempotency_key": key,
        }
        for field in (
            "complaint_type_cd", "other_type", "detail",
            "complainant_name", "complainant_phone", "complainant_email",
            "owner_name", "owner_phone", "property_address", "landmark",
            "police_station", "pin_code", "district", "state", "country",
            "property_type_cd", "floor_count",
            "ulpin", "khasra_no", "village_lgd_code", "district_lgd_code", "priority",
        ):
            values[field] = getattr(body, field)
        if body.location is not None:
            values["location"] = point_value(
                db, body.location.latitude, body.location.longitude)

        case_id = db.execute(
            insert(Case).values(**values).returning(Case.id)
        ).scalar_one()

        _event(
            db, case_id=case_id, action=str(wf.Action.RAISE), actor=actor, roles=roles,
            from_status=None, to_status=str(transition.target),
            payload={"source": body.source, "zone_id": zone_id},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        if key:
            replayed = _by_idempotency_key(db, key)
            if replayed is not None:
                return {"case_ref": replayed, "replayed": True}
        raise
    except Exception:
        db.rollback()
        raise

    return {"case_ref": case_ref, "case_id": case_id, "replayed": False}


def _case_for_update(db: Session, case_ref: str, scope: ZoneScope) -> tuple[int, str] | None:
    row = db.execute(
        scope.apply(
            select(Case.id, Case.status).where(Case.case_ref == case_ref), Case.zone_id
        )
    ).first()
    return (row.id, row.status) if row is not None else None


def amend_case(
    db: Session, case_ref: str, body: CaseAmend, scope: ZoneScope, *, actor: str, roles
) -> bool:
    found = _case_for_update(db, case_ref, scope)
    if found is None:
        return False
    case_id, status = found

    wf.check_amendable(status, roles)

    changes = body.changes()
    try:
        db.execute(
            update(Case)
            .where(Case.id == case_id)
            .values(**changes, updated_at=_now())
        )
        _event(
            db, case_id=case_id, action=str(wf.Action.AMEND), actor=actor, roles=roles,
            from_status=status, to_status=status,
            payload={"fields": sorted(changes)},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return True


def _assignable(db: Session, zone_id: int, user_id: str) -> bool:
    return db.execute(
        select(ZoneAssignment.id).where(
            ZoneAssignment.zone_id == zone_id,
            ZoneAssignment.user_id == user_id,
            ZoneAssignment.active.is_(True),
        ).limit(1)
    ).scalar_one_or_none() is not None


# The realm is the only record of who holds field-surveyor; docs carry the rest.
def _refuse_unless_surveyor(admin: KeycloakAdmin | None, user_id: str) -> None:
    if admin is None:
        return
    try:
        held = {str(role.get("name")) for role in admin.user_realm_roles(user_id)}
    except ApiError:
        log.warning("the officer directory is unreachable; assignee %s unchecked", user_id)
        return
    if str(wf.Role.FIELD_SURVEYOR) not in held:
        raise ApiError(
            422,
            "assignee_not_a_surveyor",
            "the officer named is not a Field Surveyor, so every transition this "
            "assignment opens would refuse them",
            field="assignee_user_id",
        )


def assign_case(
    db: Session, case_ref: str, body: CaseAssign, scope: ZoneScope,
    *, actor: str, roles, admin: KeycloakAdmin | None = None,
) -> bool:
    row = db.execute(
        scope.apply(
            select(Case.id, Case.status, Case.zone_id).where(Case.case_ref == case_ref),
            Case.zone_id,
        )
    ).first()
    if row is None:
        return False

    candidates = {
        t.action for t in wf.transitions_for(row.status)
        if t.action in (wf.Action.ASSIGN, wf.Action.REASSIGN)
    }
    action = candidates.pop() if len(candidates) == 1 else wf.Action.ASSIGN

    transition = wf.check(
        row.status, action, roles,
        payload={"assignee_user_id": body.assignee_user_id, "reason": body.reason},
    )

    if not _assignable(db, row.zone_id, body.assignee_user_id):
        raise ApiError(
            422,
            "assignee_not_in_zone",
            "the officer has no active assignment to this case's zone, so the case "
            "would be invisible to them",
            field="assignee_user_id",
        )
    _refuse_unless_surveyor(admin, body.assignee_user_id)

    try:
        db.execute(
            update(CaseAssignment)
            .where(
                CaseAssignment.case_id == row.id,
                CaseAssignment.assignment_type == "survey",
                CaseAssignment.active.is_(True),
            )
            .values(active=False, released_at=_now())
        )
        db.execute(
            insert(CaseAssignment).values(
                case_id=row.id,
                assignee_user_id=body.assignee_user_id,
                assigned_by=actor,
                assignment_type="survey",
                note=body.note,
                active=True,
            )
        )
        db.execute(
            update(Case)
            .where(Case.id == row.id)
            .values(
                status=str(transition.target),
                stage_no=transition.stage_no,
                updated_at=_now(),
            )
        )
        _event(
            db, case_id=row.id, action=str(action), actor=actor, roles=roles,
            from_status=row.status, to_status=str(transition.target),
            note=body.reason,
            payload={"assignment_type": "survey"},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return True


# Stages 6 and 7: the status, the stage and the roles all come off the transition.
def _advance(
    db: Session, case_ref: str, action: wf.Action, scope: ZoneScope,
    *, actor: str, roles, note: str | None = None,
) -> bool:
    found = _case_for_update(db, case_ref, scope)
    if found is None:
        return False
    case_id, status = found

    transition = wf.check(status, action, roles)

    try:
        moved = db.execute(
            update(Case)
            .where(Case.id == case_id, Case.status == status)
            .values(
                status=str(transition.target),
                stage_no=transition.stage_no,
                updated_at=_now(),
            )
        )
        if moved.rowcount != 1:
            raise ApiError(
                409,
                "invalid_transition",
                f"the case is no longer {status}; read it again before moving it",
            )
        _event(
            db, case_id=case_id, action=str(action), actor=actor, roles=roles,
            from_status=status, to_status=str(transition.target), note=note,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return True


# Stage 6 — the nodal officer passes a verified case to the ADA Project Lead.
def hand_over_case(
    db: Session, case_ref: str, body: CaseHandover, scope: ZoneScope, *, actor: str, roles
) -> bool:
    return _advance(
        db, case_ref, wf.Action.HAND_OVER, scope, actor=actor, roles=roles, note=body.note)


# Stage 7 — the Project Lead confirms, which is what unlocks the notice.
def confirm_case(
    db: Session, case_ref: str, body: CaseConfirm, scope: ZoneScope, *, actor: str, roles
) -> bool:
    return _advance(
        db, case_ref, wf.Action.CONFIRM, scope, actor=actor, roles=roles, note=body.note)


def rows_to_dicts(result: PageResult) -> list[dict]:
    return [row_dict(row) for row in result.rows]
