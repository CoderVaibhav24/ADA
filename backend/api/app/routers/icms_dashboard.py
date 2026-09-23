"""ICMS Batch 5 — the dashboard panels and the case map.

Five reads. No writes, no transition and no schema change. The pipeline is
section 4 of the build-order document with the fifth step absent for the reason
Batch 1 gives: nothing here moves a case, so there is no transition to check.

    Pydantic request model -> require_user -> require_permission('dashboard.read')
    -> zone_scope(user) -> repository (parameter-bound) -> typed response model

`dashboard.read` is held by Super Admin, the PCS Nodal Officer and the ADA
Project Lead, and by the Field Surveyor nowhere in the seed — so a surveyor is
refused all five today. The narrowing in `icms/dashboard.py` is written anyway,
because the grant table is editable at runtime through
`PUT /admin/policy/roles/{role_cd}/permissions`, and a permission granted on a
Tuesday must not widen what the queries count.

The map read takes a required `bbox` and refuses one wider than `app/bbox.py`'s
cap. That is the standing rule — the build-order document says "bbox-bounded,
never unbounded" — and it is a rule about the server, not about the politeness
of clients.
"""

from __future__ import annotations

from typing import Annotated

from ada_core.database import get_db
from ada_platform import Principal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..icms import dashboard as repo
from ..icms.dashboard_schemas import (
    CaseFeature,
    CaseFeatureCollection,
    CaseMapQuery,
    DashboardSummary,
    DashboardTrend,
    MapWindow,
    TrendQuery,
    TypeCount,
    ZoneCount,
)
from ..icms.security import ZoneScope, require_permission, zone_scope

router = APIRouter(prefix="/icms", tags=["icms-dashboard"])

ReadsTheDashboard = require_permission("dashboard.read")


@router.get(
    "/dashboard/summary",
    response_model=DashboardSummary,
    summary="The counter cards — one grouped count over the caller's register",
)
def dashboard_summary(
    user: Principal = Depends(ReadsTheDashboard),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> DashboardSummary:
    """Every card on the dashboard head, from one statement.

    The legacy `getAllDashCount` asks for the same numbers with ten separate
    counts, each interpolating the caller's zone list into the SQL text. This is
    one GROUP BY, bound, and scoped to what the caller may read — so the total
    on the card and the total on the register cannot disagree.
    """
    return DashboardSummary(
        **repo.summary(db, scope, caller=user.subject, roles=user.roles)
    )


@router.get(
    "/dashboard/trend",
    response_model=DashboardTrend,
    summary="Cases raised per day, week or month across a bounded window",
)
def dashboard_trend(
    params: Annotated[TrendQuery, Query()],
    user: Principal = Depends(ReadsTheDashboard),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> DashboardTrend:
    """Thirty days by day unless asked otherwise, and never more than a year.

    There is no date dimension anywhere in the legacy reporting code — every
    count it produces is lifetime-to-date — so the window is a decision rather
    than a port. `resolved` is a cohort: of the cases raised inside a bucket,
    how many have since reached `closed` or `rejected`. Empty buckets come back
    as zeroes rather than omitted, because a chart that infers a gap from a
    missing key draws a line the data did not say.
    """
    return DashboardTrend(
        **repo.trend(db, params, scope, caller=user.subject, roles=user.roles)
    )


@router.get(
    "/dashboard/by-type",
    response_model=list[TypeCount],
    summary="The complaint-type breakdown, labelled from the lookup table",
)
def dashboard_by_type(
    user: Principal = Depends(ReadsTheDashboard),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> list[TypeCount]:
    """Grouped on `complaint_type_cd`, with the null group kept.

    A case filed before its type was chosen groups under a null code rather than
    dropping out of the chart — this panel and `/dashboard/summary` count the
    same rows and must agree.
    """
    return [
        TypeCount(**row)
        for row in repo.by_type(db, scope, caller=user.subject, roles=user.roles)
    ]


@router.get(
    "/dashboard/by-zone",
    response_model=list[ZoneCount],
    summary="The zone breakdown, over the zones the caller holds",
)
def dashboard_by_zone(
    user: Principal = Depends(ReadsTheDashboard),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> list[ZoneCount]:
    """One row per zone the caller can see, and no row for any other.

    An officer assigned to one zone gets one bar. That is not a degraded chart;
    it is the authority the register is read under, drawn.
    """
    return [
        ZoneCount(**row)
        for row in repo.by_zone(db, scope, caller=user.subject, roles=user.roles)
    ]


@router.get(
    "/cases.geojson",
    response_model=CaseFeatureCollection,
    summary="Case markers inside one bounding box — never the whole district",
)
def cases_geojson(
    params: Annotated[CaseMapQuery, Query()],
    user: Principal = Depends(ReadsTheDashboard),
    scope: ZoneScope = Depends(zone_scope),
    db: Session = Depends(get_db),
) -> CaseFeatureCollection:
    """A GeoJSON FeatureCollection, bounded by the extent and by `limit`.

    `bbox` is required, and is refused 422 `validation_failed` when it is
    absent, malformed, reversed or wider than the cap — the same code the
    request model answers with everywhere else, because this is the model
    refusing an input rather than a new kind of failure. `metadata.total` is the
    count inside the box before `limit`, so a client zoomed out over a dense
    ward can tell "these are all of them" from "this is the first page".

    Properties carry the reference, the zone, the status and the priority: what
    a marker needs in order to be drawn and clicked through. The complainant's
    name, phone number and address stay in the case file, which is read under
    `case.read`.
    """
    features, total = repo.case_map(
        db, params, scope, caller=user.subject, roles=user.roles
    )
    box = params.box
    return CaseFeatureCollection(
        features=[CaseFeature(**feature) for feature in features],
        metadata=MapWindow(
            count=len(features),
            total=total,
            limit=params.limit,
            offset=params.offset,
            bbox=[box.west, box.south, box.east, box.north],
        ),
    )
