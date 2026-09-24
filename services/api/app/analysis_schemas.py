"""The GeoJSON one analysis run answers with, declared rather than implied.

`/analyses/{job_id}/features` carried no response model, so `/api/openapi.json`
documented nothing for it and the generated TypeScript client typed the whole
payload as `unknown` — `properties.change_type` included, which the Change
Detection screen reads on every row.

`properties` allows extra keys on purpose: ada-ml writes `features` beside the
named ones when an instance backs the polygon, and a model that dropped it would
quietly delete evidence on its way to the browser.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ChangeFeature",
    "ChangeFeatureCollection",
    "ChangeFeatureProps",
    "FeatureWindow",
]


class ChangeFeatureProps(BaseModel):
    model_config = ConfigDict(extra="allow")

    label: str | None = None
    status: str | None = None
    area_m2: float | None = None
    confidence: float | None = None
    brightness_delta: float | None = None
    red_zone_overlap_pct: float | None = None
    change_type: str | None = Field(
        default=None,
        description="new_construction, extension or demolition, from T1<->T2 instance "
                    "geometry. Null where no instance backs the polygon.",
    )
    review_status: str = "pending"
    review_note: str | None = None
    reviewed_by: str | None = None
    reviewed_by_name: str | None = Field(
        default=None, description="From Keycloak at read time; null when it cannot say.")
    reviewed_at: str | None = None
    case_ref: str | None = Field(
        default=None, description="Newest complaint raised from this polygon, if any.")
    case_status: str | None = Field(
        default=None, description="That complaint's workflow status (icms_case.status).")


class ChangeFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: dict[str, Any] | None
    properties: ChangeFeatureProps


class FeatureWindow(BaseModel):
    """What came back and what exists — the half a bare feature list cannot say."""

    count: int
    total: int
    limit: int
    offset: int
    bbox: list[float] | None


class ChangeFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[ChangeFeature]
    metadata: FeatureWindow
