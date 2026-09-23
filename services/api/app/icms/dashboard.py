"""ICMS Batch 5 — one query per panel, and none of them unbounded.

The legacy `dashboard.js` is the requirements source and nothing else. Its
`getAllDashCount` fires ten separate `SELECT COUNT(...)` statements per page
load, each with `zone_cd in (${zone_cd.join(',')})` interpolated straight into
the SQL, and its map read is `SELECT longitude,latitude FROM complain WHERE
zone_cd=...` with no extent at all. Here a panel is a single grouped,
parameter-bound statement, and the map cannot be asked for more than one
bounding box of cases.

Two narrowings apply to every statement in this module, in this order:

  * `ZoneScope`, the register's own filter — a chart that counts cases outside
    the caller's zones is a leak wearing a chart;
  * the field-surveyor narrowing, which is `cases._own_cases_only` by another
    name. A surveyor reads the cases assigned to them and no others, so their
    dashboard counts those. Counting their zone instead would hand back in
    aggregate exactly what the audit of 23 September took away row by row.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta

from ada_core.datetimes import IST, IST_NAME, now_ist
from ada_core.models_icms import Case, CaseAssignment, CodeValue, Zone
from sqlalchemy import Select, and_, case, func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from .. import bbox as bbox_rules
from . import workflow as wf
from .collection import TOTAL_LABEL
from .dashboard_schemas import MAX_GROUPS, Bucket, CaseMapQuery, TrendQuery
from .geo import as_geojson_column, parse_geojson
from .security import ZoneScope

__all__ = ["by_type", "by_zone", "case_map", "summary", "trend"]

# A surveyor holding none of these sees their own cases and nobody else's. The
# same shape and the same set as `cases._own_cases_only`; a test pins the two
# together, so a role added to one cannot quietly widen the other.
_SUPERVISORY = frozenset({
    str(wf.Role.PCS_NODAL_OFFICER), str(wf.Role.ADA_PROJECT_LEAD), str(wf.Role.SUPER_ADMIN),
})

_TERMINAL = (str(wf.Status.CLOSED), str(wf.Status.REJECTED))

_HIGH = case((Case.priority == "high", 1), else_=0)
_RESOLVED = case((Case.status.in_(_TERMINAL), 1), else_=0)
_OPEN = case((Case.status.in_(_TERMINAL), 0), else_=1)

_TYPE_LABEL = and_(
    CodeValue.domain == "complaint_type",
    CodeValue.code == Case.complaint_type_cd,
)

# SQLite reaches a bucket boundary by date modifier; `weekday 0` is the next
# Sunday, so the Monday that starts the week is that less six days.
_SQLITE_BUCKET: dict[str, tuple[str, ...]] = {
    "day": (),
    "week": ("weekday 0", "-6 days"),
    "month": ("start of month",),
}


# The field app's dashboard is this one clause: their cases, not the district's.
def _own_cases_only(roles: Iterable[str]) -> bool:
    held = frozenset(str(role) for role in roles)
    return str(wf.Role.FIELD_SURVEYOR) in held and not (held & _SUPERVISORY)


# EXISTS rather than a join: a count must not double a case that has been
# assigned more than once, however the assignment rows happen to lie.
def _assigned_to(caller: str) -> ColumnElement:
    return (
        select(1)
        .where(
            CaseAssignment.case_id == Case.id,
            CaseAssignment.active.is_(True),
            CaseAssignment.assignment_type == "survey",
            CaseAssignment.assignee_user_id == caller,
        )
        .exists()
    )


def _scoped(
    statement: Select, scope: ZoneScope, *, caller: str, roles: Iterable[str]
) -> Select:
    """Both narrowings, applied to every panel before anything is counted."""
    if _own_cases_only(roles):
        statement = statement.where(_assigned_to(caller))
    return scope.apply(statement, Case.zone_id)


def summary(db: Session, scope: ZoneScope, *, caller: str, roles: Iterable[str]) -> dict:
    """The counter cards: one GROUP BY over the eleven statuses, summed in Python."""
    rows = db.execute(
        _scoped(
            select(
                Case.status,
                func.count().label("count"),
                func.sum(_HIGH).label("high_priority"),
            ).group_by(Case.status).order_by(Case.status),
            scope, caller=caller, roles=roles,
        )
    ).all()

    by_status = [
        {"status": row.status, "count": int(row.count),
         "high_priority": int(row.high_priority or 0)}
        for row in rows
    ]
    counts = {row["status"]: row["count"] for row in by_status}
    return {
        "total": sum(counts.values()),
        "open": sum(n for status, n in counts.items() if status not in _TERMINAL),
        "closed": counts.get(str(wf.Status.CLOSED), 0),
        "rejected": counts.get(str(wf.Status.REJECTED), 0),
        "high_priority": sum(row["high_priority"] for row in by_status),
        "by_status": by_status,
    }


# The unit is a bound parameter on both backends; no request value is ever text.
def _bucket_column(db: Session, column: ColumnElement, unit: Bucket) -> ColumnElement:
    if bbox_rules.dialect_of(db) == "postgresql":
        return func.to_char(
            func.date_trunc(unit, func.timezone(IST_NAME, column)), "YYYY-MM-DD"
        )
    return func.date(column, *_SQLITE_BUCKET[unit])


def _floor(day: date, unit: Bucket) -> date:
    if unit == "week":
        return day - timedelta(days=day.weekday())
    return day.replace(day=1) if unit == "month" else day


def _next(day: date, unit: Bucket) -> date:
    if unit == "day":
        return day + timedelta(days=1)
    if unit == "week":
        return day + timedelta(days=7)
    return date(day.year + day.month // 12, day.month % 12 + 1, 1)


# Every bucket in the window, the empty ones included: a chart that has to infer
# a gap from a missing key draws a different line from the one the data says.
def _bucket_starts(start: date, end: date, unit: Bucket) -> list[str]:
    starts: list[str] = []
    cursor = _floor(start, unit)
    while cursor <= end:
        starts.append(cursor.isoformat())
        cursor = _next(cursor, unit)
    return starts


def _midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=IST)


def trend(
    db: Session, params: TrendQuery, scope: ZoneScope, *, caller: str, roles: Iterable[str]
) -> dict:
    """Cases raised per bucket across the window, and how many of each cohort closed."""
    end = now_ist().date()
    start = end - timedelta(days=params.days - 1)
    bucket = _bucket_column(db, Case.raised_at, params.bucket)

    rows = db.execute(
        _scoped(
            select(
                bucket.label("period"),
                func.count().label("raised"),
                func.sum(_RESOLVED).label("resolved"),
            )
            .where(Case.raised_at >= _midnight(start))
            .where(Case.raised_at < _midnight(end + timedelta(days=1)))
            .group_by(bucket),
            scope, caller=caller, roles=roles,
        )
    ).all()

    counted = {str(row.period): (int(row.raised), int(row.resolved or 0)) for row in rows}
    points = [
        {"period": period,
         "raised": counted.get(period, (0, 0))[0],
         "resolved": counted.get(period, (0, 0))[1]}
        for period in _bucket_starts(start, end, params.bucket)
    ]
    return {
        "bucket": params.bucket,
        "days": params.days,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "points": points,
    }


def by_type(db: Session, scope: ZoneScope, *, caller: str, roles: Iterable[str]) -> list[dict]:
    """The complaint-type breakdown, labelled from `icms_code_value`."""
    rows = db.execute(
        _scoped(
            select(
                Case.complaint_type_cd,
                CodeValue.label,
                func.count().label("total"),
                func.sum(_OPEN).label("open"),
                func.sum(_RESOLVED).label("resolved"),
            )
            .select_from(Case)
            .outerjoin(CodeValue, _TYPE_LABEL)
            .group_by(Case.complaint_type_cd, CodeValue.label),
            scope, caller=caller, roles=roles,
        )
        .order_by(func.count().desc(), Case.complaint_type_cd)
        .limit(MAX_GROUPS)
    ).all()

    return [
        {"complaint_type_cd": row.complaint_type_cd, "label": row.label,
         "total": int(row.total), "open": int(row.open or 0),
         "resolved": int(row.resolved or 0)}
        for row in rows
    ]


def by_zone(db: Session, scope: ZoneScope, *, caller: str, roles: Iterable[str]) -> list[dict]:
    """The zone breakdown. Only zones the caller can see appear, which is the point."""
    rows = db.execute(
        _scoped(
            select(
                Zone.zone_cd,
                Zone.name.label("zone_name"),
                func.count().label("total"),
                func.sum(_OPEN).label("open"),
                func.sum(_RESOLVED).label("resolved"),
            )
            .select_from(Case)
            .join(Zone, Zone.id == Case.zone_id)
            .group_by(Zone.zone_cd, Zone.name),
            scope, caller=caller, roles=roles,
        )
        .order_by(func.count().desc(), Zone.zone_cd)
        .limit(MAX_GROUPS)
    ).all()

    return [
        {"zone_cd": row.zone_cd, "zone_name": row.zone_name, "total": int(row.total),
         "open": int(row.open or 0), "resolved": int(row.resolved or 0)}
        for row in rows
    ]


def case_map(
    db: Session, params: CaseMapQuery, scope: ZoneScope, *, caller: str, roles: Iterable[str]
) -> tuple[list[dict], int]:
    """The markers inside one bounding box, newest first, with the matching total."""
    statement = _scoped(
        select(
            Case.case_ref,
            Zone.zone_cd,
            Case.status,
            Case.stage_no,
            Case.priority,
            Case.complaint_type_cd,
            Case.raised_at,
            as_geojson_column(db, Case.location).label("location"),
        )
        .select_from(Case)
        .join(Zone, Zone.id == Case.zone_id)
        .where(
            bbox_rules.intersects(
                Case.location, params.box, dialect=bbox_rules.dialect_of(db)
            )
        ),
        scope, caller=caller, roles=roles,
    )

    rows = db.execute(
        statement.add_columns(func.count().over().label(TOTAL_LABEL))
        .order_by(Case.raised_at.desc(), Case.id)
        .offset(params.offset)
        .limit(params.limit)
    ).all()

    if rows:
        total = int(rows[0]._mapping[TOTAL_LABEL])
    else:
        # An offset past the end returns no row to read the window count off, and
        # a client that then believes the total is zero stops paging too early.
        total = int(
            db.execute(
                select(func.count()).select_from(statement.order_by(None).subquery())
            ).scalar_one()
        )

    features = [
        {
            "id": row.case_ref,
            "geometry": parse_geojson(row.location),
            "properties": {
                "case_ref": row.case_ref,
                "zone_cd": row.zone_cd,
                "status": row.status,
                "stage_no": row.stage_no,
                "priority": row.priority,
                "complaint_type_cd": row.complaint_type_cd,
                "raised_at": row.raised_at,
            },
        }
        for row in rows
    ]
    return features, total
