"""Every statement Batch 1 runs, in one place and parameter-bound.

No f-string reaches a query in this module and none ever will. The legacy
routers being replaced build SQL by concatenation — `zone_cd in
(${obj.zone_cd.join(',')})` in `complain.js` is injectable by anybody who can
post a complaint — and `SqlString.escape` is applied to some values and not
others, which is the worst of both worlds because it looks handled.

Here a filter is a bound parameter, a sort key is a whitelist lookup that yields
an ORM column, and a geometry is one bind whatever the backend. The repository
is also where the zone scope is applied, so that it is applied to the count as
well as to the page, and cannot be forgotten by a router.
"""

from __future__ import annotations

from datetime import datetime

from ada_core.datetimes import now_ist
from ada_core.models_icms import CodeValue, Zone, ZoneAssignment
from sqlalchemy import Select, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .collection import PageResult, Sortable, paginate, row_dict, search_clause
from .geo import as_geojson_column, geojson_value, parse_geojson
from .schemas import (
    CodeValueQuery,
    ZoneAssignmentCreate,
    ZoneAssignmentQuery,
    ZoneAssignmentTarget,
    ZoneCreate,
    ZoneQuery,
    ZoneUpdate,
)
from .security import ZoneScope

__all__ = [
    "create_zone",
    "create_zone_assignment",
    "get_zone",
    "list_code_values",
    "list_zone_assignments",
    "list_zones",
    "revoke_zone_assignment",
    "update_zone",
]


def _now() -> datetime:
    return now_ist()


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

CODE_VALUE_SORTS = Sortable(
    columns={
        "sort_order": CodeValue.sort_order,
        "code": CodeValue.code,
        "label": CodeValue.label,
        "domain": CodeValue.domain,
    },
    default="sort_order",
    tiebreaker=CodeValue.id,
)

_CODE_VALUE_COLUMNS = (
    CodeValue.id, CodeValue.domain, CodeValue.code, CodeValue.label,
    CodeValue.label_hi, CodeValue.parent_code, CodeValue.sort_order, CodeValue.active,
)


def list_code_values(db: Session, params: CodeValueQuery) -> PageResult:
    """The lookup vocabulary. Not zone-scoped: a code list is not geography."""
    statement: Select = select(*_CODE_VALUE_COLUMNS)

    # Repeated values of one parameter OR together (IN), different parameters
    # AND together (successive WHERE clauses). One rule, applied the same way to
    # every filter on every register.
    if params.domain:
        statement = statement.where(CodeValue.domain.in_(params.domain))
    if params.code:
        statement = statement.where(CodeValue.code.in_(params.code))
    if params.parent_code:
        statement = statement.where(CodeValue.parent_code.in_(params.parent_code))
    if params.active is not None:
        statement = statement.where(CodeValue.active.is_(params.active))
    if params.q:
        statement = statement.where(
            search_clause(params.q, [CodeValue.label, CodeValue.label_hi, CodeValue.code])
        )

    return paginate(db, statement, params, CODE_VALUE_SORTS)


# ---------------------------------------------------------------------------
# Zones
# ---------------------------------------------------------------------------

ZONE_SORTS = Sortable(
    columns={
        "zone_cd": Zone.zone_cd,
        "name": Zone.name,
        "created_at": Zone.created_at,
        "updated_at": Zone.updated_at,
    },
    default="zone_cd",
    tiebreaker=Zone.id,
)

_ZONE_COLUMNS = (
    Zone.id, Zone.zone_cd, Zone.name, Zone.name_hi, Zone.parent_cd, Zone.active,
    Zone.created_at, Zone.updated_at,
    # Cheaper than shipping the boundary, and it is what a client needs to know
    # whether asking for the detail is worth a round trip.
    Zone.geom.isnot(None).label("has_geometry"),
)


def list_zones(db: Session, params: ZoneQuery, scope: ZoneScope) -> PageResult:
    statement: Select = select(*_ZONE_COLUMNS)

    if params.zone_cd:
        statement = statement.where(Zone.zone_cd.in_(params.zone_cd))
    if params.parent_cd:
        statement = statement.where(Zone.parent_cd.in_(params.parent_cd))
    if params.active is not None:
        statement = statement.where(Zone.active.is_(params.active))
    if params.q:
        statement = statement.where(
            search_clause(params.q, [Zone.name, Zone.name_hi, Zone.zone_cd])
        )

    # Applied last and to the same statement the count is taken over, so `total`
    # describes the caller's zones rather than the authority's.
    statement = scope.apply(statement, Zone.id)
    return paginate(db, statement, params, ZONE_SORTS)


def get_zone(db: Session, zone_cd: str, scope: ZoneScope) -> dict | None:
    """One zone with its boundary, or None when the caller may not see it.

    Out of scope is indistinguishable from absent on purpose. A 403 that
    separates "no such zone" from "a zone you may not read" tells an officer
    which zone codes exist, which is a small leak repeated over a whole
    district.
    """
    statement = select(*_ZONE_COLUMNS, as_geojson_column(db, Zone.geom).label("geometry"))
    statement = statement.where(Zone.zone_cd == zone_cd)
    statement = scope.apply(statement, Zone.id)

    row = db.execute(statement).first()
    if row is None:
        return None
    data = dict(row._mapping)
    data["geometry"] = parse_geojson(data.get("geometry"))
    return data


def zone_id_for(db: Session, zone_cd: str) -> int | None:
    return db.execute(select(Zone.id).where(Zone.zone_cd == zone_cd)).scalar_one_or_none()


def create_zone(db: Session, body: ZoneCreate) -> dict | None:
    """Insert a zone. Returns None when `zone_cd` is already taken.

    The uniqueness is the database's — `icms_zone.zone_cd` is UNIQUE — rather
    than a SELECT followed by an INSERT, which is a race that produces the
    duplicate it was written to prevent.
    """
    values = {
        "zone_cd": body.zone_cd,
        "name": body.name,
        "name_hi": body.name_hi,
        "parent_cd": body.parent_cd,
        "active": body.active,
        "geom": geojson_value(db, body.geometry.model_dump() if body.geometry else None),
    }
    try:
        db.execute(insert(Zone).values(**values))
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return get_zone(db, body.zone_cd, _UNRESTRICTED)


def update_zone(db: Session, zone_cd: str, body: ZoneUpdate) -> dict | None:
    """Replace a zone's mutable attributes. Returns None when it does not exist.

    `icms_zone` carries no BEFORE UPDATE touch trigger — only `icms_case`,
    `icms_inspection` and `icms_notice` do (0001_baseline.py TRIGGERS) — so
    `updated_at` is set here. Leaving it to the ORM's `default=` would not do
    it: that applies on INSERT only.
    """
    values: dict = {
        "name": body.name,
        "name_hi": body.name_hi,
        "parent_cd": body.parent_cd,
        "active": body.active,
        "updated_at": _now(),
    }
    if body.geometry_supplied:
        values["geom"] = geojson_value(
            db, body.geometry.model_dump() if body.geometry else None
        )

    # The WHERE guard is the point. The legacy `zone.js` issues an UPDATE whose
    # predicate comes from the same unvalidated blob as its values.
    result = db.execute(update(Zone).where(Zone.zone_cd == zone_cd).values(**values))
    if result.rowcount == 0:
        db.rollback()
        return None
    db.commit()
    return get_zone(db, zone_cd, _UNRESTRICTED)


# Zone administration is Super Admin only, and Super Admin is unrestricted by
# definition, so the write paths read back through a scope that filters nothing.
# Spelled out rather than implied: a future caller reusing these functions has
# to pass a scope, and will notice that it must decide what it is.
_UNRESTRICTED = ZoneScope(user_id="", roles=frozenset(), unrestricted=True,
                          zone_ids=frozenset())


# ---------------------------------------------------------------------------
# Zone assignment
# ---------------------------------------------------------------------------

ZONE_ASSIGNMENT_SORTS = Sortable(
    columns={
        "created_at": ZoneAssignment.created_at,
        "user_id": ZoneAssignment.user_id,
        "zone_cd": Zone.zone_cd,
    },
    default="-created_at",
    tiebreaker=ZoneAssignment.id,
)

_ASSIGNMENT_COLUMNS = (
    ZoneAssignment.id, ZoneAssignment.zone_id, Zone.zone_cd, Zone.name.label("zone_name"),
    ZoneAssignment.user_id, ZoneAssignment.active, ZoneAssignment.assigned_by,
    ZoneAssignment.created_at, ZoneAssignment.revoked_at,
)


def _assignment_select() -> Select:
    # An inner join: an assignment without its zone is not a row anybody can act
    # on, and the FK is ON DELETE CASCADE so it cannot exist anyway.
    return select(*_ASSIGNMENT_COLUMNS).join(Zone, Zone.id == ZoneAssignment.zone_id)


def list_zone_assignments(db: Session, params: ZoneAssignmentQuery) -> PageResult:
    statement = _assignment_select()

    if params.zone_cd:
        statement = statement.where(Zone.zone_cd.in_(params.zone_cd))
    if params.user_id:
        statement = statement.where(ZoneAssignment.user_id.in_(params.user_id))
    if params.active is not None:
        statement = statement.where(ZoneAssignment.active.is_(params.active))
    if params.q:
        statement = statement.where(
            search_clause(params.q, [Zone.zone_cd, Zone.name, ZoneAssignment.user_id])
        )

    return paginate(db, statement, params, ZONE_ASSIGNMENT_SORTS)


def _open_assignment(db: Session, zone_id: int, user_id: str) -> dict | None:
    row = db.execute(
        _assignment_select().where(
            ZoneAssignment.zone_id == zone_id,
            ZoneAssignment.user_id == user_id,
            ZoneAssignment.active.is_(True),
        )
    ).first()
    return dict(row._mapping) if row is not None else None


def create_zone_assignment(
    db: Session, body: ZoneAssignmentCreate, actor: str
) -> tuple[dict | None, bool]:
    """Grant a zone to an officer. Returns (row, created).

    Idempotent, because the portal will be clicked twice and a mobile client
    will retry. A second grant of an assignment that is already open returns the
    open one with `created` false rather than raising on
    `uq_icms_zone_assignment_active`, and the caller answers 200 instead of 201.

    A revoked assignment is history, so re-granting opens a NEW row rather than
    reviving the old one. The partial unique index permits exactly that, and it
    is what keeps "granted, revoked, granted again" readable afterwards.
    """
    zone_id = zone_id_for(db, body.zone_cd)
    if zone_id is None:
        return None, False

    existing = _open_assignment(db, zone_id, body.user_id)
    if existing is not None:
        return existing, False

    try:
        db.execute(
            insert(ZoneAssignment).values(
                zone_id=zone_id, user_id=body.user_id, active=True, assigned_by=actor
            )
        )
        db.commit()
    except IntegrityError:
        # Lost a race against another grant of the same pair. The index did its
        # job; read back what the winner wrote.
        db.rollback()
        return _open_assignment(db, zone_id, body.user_id), False

    return _open_assignment(db, zone_id, body.user_id), True


def revoke_zone_assignment(
    db: Session, target: ZoneAssignmentTarget
) -> tuple[bool, datetime | None] | None:
    """Close an open assignment. Returns (revoked, revoked_at), or None for an
    unknown zone.

    A revoke is an UPDATE, never a DELETE: who could see which zone, and until
    when, is part of the record an enforcement system has to be able to show.
    Replaying it is a no-op with a 200, not a 404 — the second attempt of a
    retried request should not read as a failure.
    """
    zone_id = zone_id_for(db, target.zone_cd)
    if zone_id is None:
        return None

    revoked_at = _now()
    result = db.execute(
        update(ZoneAssignment)
        .where(
            ZoneAssignment.zone_id == zone_id,
            ZoneAssignment.user_id == target.user_id,
            ZoneAssignment.active.is_(True),
        )
        .values(active=False, revoked_at=revoked_at)
    )
    if result.rowcount == 0:
        db.rollback()
        return False, None
    db.commit()
    return True, revoked_at


def rows_to_dicts(result: PageResult) -> list[dict]:
    return [row_dict(row) for row in result.rows]