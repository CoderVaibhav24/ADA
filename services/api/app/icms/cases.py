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
    PolicyRole,
    Zone,
    ZoneAssignment,
)
from sqlalchemy import Select, and_, case, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin
from ..errors import ApiError
from . import policy
from . import workflow as wf
from .actors import display_name
from .case_schemas import (
    AssigneeCandidate,
    AssigneeOptions,
    AssigneeRole,
    CaseAmend,
    CaseAssign,
    CaseClose,
    CaseConfirm,
    CaseCreate,
    CaseHandover,
    CaseQuery,
    CaseReject,
    today_ist,
)
from .collection import PageResult, Sortable, paginate, row_dict, search_clause
from .geo import as_geojson_column, parse_geojson, point_value, zone_containing
from .numbering import IST, Series, allocate
from .security import ZoneScope, icms_roles

__all__ = [
    "CASE_SORTS",
    "amend_case",
    "assignee_options",
    "assign_case",
    "case_detail",
    "close_case",
    "confirm_case",
    "current_assignee",
    "hand_over_case",
    "locate_case",
    "move_case",
    "raise_case",
    "register",
    "reject_case",
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
    Case.complaint_date,
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


# The detail route's visibility rule for one case, without the detail's joins.
def locate_case(
    db: Session, case_ref: str, scope: ZoneScope, *, roles, user_id: str,
    own_only: bool = True,
):
    statement = (
        select(Case.id, Case.case_ref, Case.status, Case.zone_id, Case.source)
        .outerjoin(CaseAssignment, _OPEN_SURVEY)
        .where(Case.case_ref == case_ref)
    )
    if own_only and _own_cases_only(roles):
        statement = statement.where(CaseAssignment.assignee_user_id == user_id)
    return db.execute(scope.apply(statement, Case.zone_id)).first()


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
            Case.closed_by,
            Case.outcome_cd,
            Case.outcome_reason,
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
                Inspection.occupant_name, Inspection.occupant_phone,
                Inspection.property_type_cd, Inspection.floor_count,
                Inspection.police_station,
            )
            .where(Inspection.case_id == case_id)
            .order_by(Inspection.round_no)
        ).all()
    ]

    data["outcome_label"], data["outcome_label_hi"] = outcome_labels(
        db, data["status"], data["outcome_cd"])

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
            "complaint_date": body.complaint_date or today_ist(),
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


# Compare-and-set: the row moves only if it is still where the caller read it.
def move_case(
    db: Session, case_id: int, from_status: str, values: dict | None = None,
    *, round_no: int | None = None,
) -> None:
    """UPDATE ... WHERE status = :from [AND current_round = :round]; 409 on a lost race.

    With no values it is a no-op write that still takes the row lock, which is
    how a self-transition (check-in, evidence, amend) proves the case has not moved.
    """
    statement = update(Case).where(Case.id == case_id, Case.status == str(from_status))
    if round_no is not None:
        statement = statement.where(Case.current_round == round_no)
    moved = db.execute(statement.values(**(values or {"status": str(from_status)})))
    if moved.rowcount != 1:
        raise ApiError(
            409,
            "invalid_transition",
            f"the case is no longer {from_status}"
            + ("" if round_no is None else f" on round {round_no}")
            + "; read it again before moving it",
        )


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
        move_case(db, case_id, status, {**changes, "updated_at": _now()})
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


# The permission the first assignee-only step needs; whoever holds it may be assigned.
SURVEYOR_PERMISSION = "inspection.check_in"


# Roles from the loaded policy, users from Keycloak, narrowed to the case's zone.
def assignee_options(
    db: Session, case_ref: str, scope: ZoneScope, admin: KeycloakAdmin | None,
) -> AssigneeOptions | None:
    row = db.execute(
        scope.apply(select(Case.zone_id).where(Case.case_ref == case_ref), Case.zone_id)
    ).first()
    if row is None:
        return None
    if admin is None:
        raise ApiError(503, "officer_directory_unavailable",
                       "the officer directory is not configured, so no officer can be listed")

    eligible = policy.snapshot().roles_holding({SURVEYOR_PERMISSION}) & icms_roles()
    # A role with no `icms_role` row (an unmigrated database) keeps its code as label.
    rows = {r.role_cd: r for r in db.execute(
        select(PolicyRole).where(PolicyRole.role_cd.in_(eligible))
    ).scalars()}
    roles = [
        AssigneeRole(role_cd=code, label=rows[code].label, label_hi=rows[code].label_hi)
        if code in rows else AssigneeRole(role_cd=code, label=code)
        for code in sorted(eligible, key=lambda c: (rows[c].sort_order if c in rows else 0, c))
        if code not in rows or rows[code].active
    ]

    in_zone = set(db.execute(
        select(ZoneAssignment.user_id).where(
            ZoneAssignment.zone_id == row.zone_id, ZoneAssignment.active.is_(True))
    ).scalars())

    found: dict[str, AssigneeCandidate] = {}
    for role in roles:
        for member in admin.role_members(role.role_cd):
            user_id = str(member.get("id") or "")
            if not user_id or user_id not in in_zone or member.get("enabled") is False:
                continue
            if user_id in found:
                found[user_id].role_cds.append(role.role_cd)
                continue
            found[user_id] = AssigneeCandidate(
                user_id=user_id, name=display_name(member),
                username=member.get("username"), role_cds=[role.role_cd],
            )
    candidates = sorted(found.values(), key=lambda c: (c.name or c.username or c.user_id).lower())
    return AssigneeOptions(roles=roles, candidates=candidates)


# A surveyor is whoever the realm roles make hold inspection.check_in.
def _refuse_unless_surveyor(admin: KeycloakAdmin | None, user_id: str) -> None:
    if admin is None:
        return
    try:
        held = {str(role.get("name")) for role in admin.user_realm_roles(user_id)}
    except ApiError:
        log.warning("the officer directory is unreachable; assignee %s unchecked", user_id)
        return
    if SURVEYOR_PERMISSION not in policy.snapshot().permitted(held):
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
) -> int | None:
    row = db.execute(
        scope.apply(
            select(Case.id, Case.status, Case.zone_id).where(Case.case_ref == case_ref),
            Case.zone_id,
        )
    ).first()
    if row is None:
        return None

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
        # First, so the lost race refuses before the assignment rows are touched.
        move_case(db, row.id, row.status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "updated_at": _now(),
        })
        db.execute(
            update(CaseAssignment)
            .where(
                CaseAssignment.case_id == row.id,
                CaseAssignment.assignment_type == "survey",
                CaseAssignment.active.is_(True),
            )
            .values(active=False, released_at=_now())
        )
        assignment_id = db.execute(
            insert(CaseAssignment).values(
                case_id=row.id,
                assignee_user_id=body.assignee_user_id,
                assigned_by=actor,
                assignment_type="survey",
                note=body.note,
                active=True,
            ).returning(CaseAssignment.id)
        ).scalar_one()
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
    return assignment_id


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
        move_case(db, case_id, status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "updated_at": _now(),
        })
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


_OUTCOME_DOMAIN = {
    str(wf.Status.REJECTED): "case_reject_reason",
    str(wf.Status.CLOSED): "case_close_outcome",
}


# The en and hi labels of a terminal case's outcome code; the code itself when unseeded.
def outcome_labels(db: Session, status: str, code: str | None) -> tuple[str | None, str | None]:
    domain = _OUTCOME_DOMAIN.get(str(status))
    if code is None or domain is None:
        return None, None
    row = db.execute(
        select(CodeValue.label, CodeValue.label_hi)
        .where(CodeValue.domain == domain, CodeValue.code == code)
    ).first()
    if row is None:
        return code, code
    return row.label, row.label_hi or row.label


def _replayed_ending(db: Session, case_id: int, action: wf.Action, key: str | None) -> bool:
    if key is None:
        return False
    payload = db.execute(
        select(CaseEvent.payload)
        .where(CaseEvent.case_id == case_id, CaseEvent.action == str(action))
        .order_by(CaseEvent.id.desc()).limit(1)
    ).scalar_one_or_none()
    return isinstance(payload, dict) and payload.get("idempotency_key") == key


# Reject (stages 1-2) and close (stage 7): terminal, stamps the outcome, releases every assignment.
def _end_case(
    db: Session, case_ref: str, action: wf.Action, scope: ZoneScope, *,
    outcome_cd: str, remarks: str | None, key: str | None, actor: str, roles,
) -> dict | None:
    found = _case_for_update(db, case_ref, scope)
    if found is None:
        return None
    case_id, status = found
    if _replayed_ending(db, case_id, action, key):
        return {"replayed": True, "released_assignee": None}

    transition = wf.check(status, action, roles, payload={"reason": outcome_cd})
    released = current_assignee(db, case_id)
    now = _now()
    try:
        move_case(db, case_id, status, {
            "status": str(transition.target),
            "stage_no": transition.stage_no,
            "outcome_cd": outcome_cd,
            "outcome_reason": remarks,
            "closed_by": actor,
            "closed_at": now,
            "updated_at": now,
        })
        # A terminal case is nobody's work: it leaves every worklist that reads the open row.
        db.execute(
            update(CaseAssignment)
            .where(CaseAssignment.case_id == case_id, CaseAssignment.active.is_(True))
            .values(active=False, released_at=now)
        )
        _event(
            db, case_id=case_id, action=str(action), actor=actor, roles=roles,
            from_status=status, to_status=str(transition.target), note=remarks,
            payload={"outcome_cd": outcome_cd, "idempotency_key": key,
                     "released_assignee": released},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"replayed": False, "released_assignee": released}


def reject_case(
    db: Session, case_ref: str, body: CaseReject, scope: ZoneScope, *, actor: str, roles
) -> dict | None:
    return _end_case(
        db, case_ref, wf.Action.REJECT, scope, outcome_cd=body.reason_cd,
        remarks=body.remarks,
        key=str(body.idempotency_key) if body.idempotency_key else None,
        actor=actor, roles=roles)


def close_case(
    db: Session, case_ref: str, body: CaseClose, scope: ZoneScope, *, actor: str, roles
) -> dict | None:
    return _end_case(
        db, case_ref, wf.Action.CLOSE, scope, outcome_cd=body.outcome_cd,
        remarks=body.remarks,
        key=str(body.idempotency_key) if body.idempotency_key else None,
        actor=actor, roles=roles)


def rows_to_dicts(result: PageResult) -> list[dict]:
    return [row_dict(row) for row in result.rows]
