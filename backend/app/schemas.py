from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    created_at: datetime


class RasterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    captured_at: datetime | None
    crs: str | None
    bounds_4326: list[float] | None
    resolution_m: float | None
    status: str
    progress: float = 0.0        # 0.0 - 1.0, meaningful while status=processing
    stage: str | None = None     # human-readable current step
    error: str | None
    uploaded_at: datetime


class RedZoneCreate(BaseModel):
    name: str = "Red zone"
    geometry: dict[str, Any]  # GeoJSON Polygon/MultiPolygon, EPSG:4326


class RedZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    geometry: dict[str, Any]
    created_at: datetime


class AnalysisCreate(BaseModel):
    raster_t1_id: int
    raster_t2_id: int
    # ai   -> full pipeline: building seg-diff + vegetation logic + SAM2 refine
    #         + zone check. Authoritative, evidence-grade. Minutes.
    # diff -> classical colour/structure difference only, no neural inference.
    #         Fast visual triage. Seconds.
    mode: Literal["ai", "diff"] = "ai"


class AnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    raster_t1_id: int
    raster_t2_id: int
    mode: str
    status: str
    progress: float
    stage: str | None
    error: str | None
    stats: dict[str, Any] | None
    created_at: datetime
    finished_at: datetime | None


class PolygonReview(BaseModel):
    """Officer adjudication of one detected change (feeds the retraining set)."""

    status: Literal["pending", "confirmed", "rejected"]
    note: str | None = None


class PolygonReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    review_status: str
    review_note: str | None
    reviewed_by: str | None
    reviewed_at: datetime | None
