"""ICMS Batch 5 — the request and response shapes of the dashboard and the map.

Aggregates only. Nothing here carries a complainant's name, a phone number or an
address: a dashboard is read by more people than a case file is, and the count is
the whole product. The one exception is the map, which carries a `case_ref` so a
marker can be clicked through to a case the caller is separately entitled to read.
"""

from __future__ import annotations

from typing import Any, Literal

from ada_core.datetimes import IstDateTime
from ada_core.validation import BBox
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .. import bbox as bbox_rules

__all__ = [
    "CaseFeature",
    "CaseFeatureCollection",
    "CaseFeatureProps",
    "CaseMapQuery",
    "DashboardSummary",
    "DashboardTrend",
    "MapWindow",
    "StatusCount",
    "TrendPoint",
    "TrendQuery",
    "TypeCount",
    "ZoneCount",
]

Bucket = Literal["day", "week", "month"]

# Bounded twice over: a year of days is 365 points, and the cap on `days` is what
# stops a chart asking the register for its whole history in one call.
MAX_TREND_DAYS = 365
DEFAULT_TREND_DAYS = 30

# Both breakdowns group over a closed vocabulary — four complaint types are seeded
# and a district holds a handful of zones — so this is a backstop, not a paging
# surface. Rows come back by descending count, so a truncation drops the smallest.
MAX_GROUPS = 100

DEFAULT_MAP_LIMIT = 500
MAX_MAP_LIMIT = 2000


class TrendQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days: int = Field(
        default=DEFAULT_TREND_DAYS,
        ge=1,
        le=MAX_TREND_DAYS,
        description="How many days back from today the window reaches, counted in IST.",
    )
    bucket: Bucket = Field(
        default="day",
        description="The width of one point. A week starts on Monday, a month on the 1st.",
    )


class StatusCount(BaseModel):
    status: str
    count: int
    high_priority: int


class DashboardSummary(BaseModel):
    """The counter cards, and the per-status table they are summed from."""

    total: int
    open: int
    closed: int
    rejected: int
    high_priority: int
    by_status: list[StatusCount]


class TrendPoint(BaseModel):
    period: str = Field(description="The first day of the bucket, `YYYY-MM-DD` in IST.")
    raised: int
    resolved: int = Field(
        description="Of the cases raised in this bucket, how many have since reached "
                    "`closed` or `rejected`. A cohort, not the closures of that day.",
    )


class DashboardTrend(BaseModel):
    bucket: Bucket
    days: int
    start: str
    end: str
    points: list[TrendPoint]


class TypeCount(BaseModel):
    complaint_type_cd: str | None
    label: str | None
    total: int
    open: int
    resolved: int


class ZoneCount(BaseModel):
    zone_cd: str
    zone_name: str
    total: int
    open: int
    resolved: int


class CaseMapQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bbox: str = Field(
        max_length=200,
        description="`west,south,east,north` in EPSG:4326. Required, and no wider than "
                    f"{bbox_rules.MAX_SPAN_DEGREES} degrees a side.",
    )
    limit: int = Field(default=DEFAULT_MAP_LIMIT, ge=1, le=MAX_MAP_LIMIT)
    offset: int = Field(default=0, ge=0, le=100_000)

    # Refused here so a bad extent is a 422 naming `bbox` rather than a driver error.
    @field_validator("bbox")
    @classmethod
    def _within_the_cap(cls, value: str) -> str:
        try:
            bbox_rules.parse(value)
        except ValidationError as error:
            # NaN or an infinity fails a corner's bound; name `bbox`, not `bbox.west`.
            raise ValueError(f"not a finite extent: {error.errors()[0]['msg']}") from None
        return value

    @property
    def box(self) -> BBox:
        return bbox_rules.parse(self.bbox)


class MapWindow(BaseModel):
    """What a client needs to page honestly: how many came back, and how many exist."""

    count: int
    total: int
    limit: int
    offset: int
    bbox: list[float]


class CaseFeatureProps(BaseModel):
    case_ref: str
    zone_cd: str
    status: str
    stage_no: int
    priority: str | None
    complaint_type_cd: str | None
    raised_at: IstDateTime


class CaseFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: str
    geometry: dict[str, Any] | None
    properties: CaseFeatureProps


class CaseFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[CaseFeature]
    metadata: MapWindow
