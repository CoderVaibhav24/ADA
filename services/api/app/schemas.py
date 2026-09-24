from datetime import datetime
from typing import Any, Literal

from ada_core.models import RASTER_STATUSES
from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import uploads_bitmap


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
    status: Literal[RASTER_STATUSES]  # type: ignore[valid-type]
    progress: float = 0.0        # 0.0 - 1.0, meaningful while status=processing
    stage: str | None = None     # human-readable current step
    error: str | None
    uploaded_at: datetime
    size_bytes: int | None = None
    fingerprint: str | None = None
    sha256: str | None = None
    tier: str | None = None
    last_used_at: datetime | None = None
    cold_at: datetime | None = None
    restore_eta_hours: float | None = None
    reject_reason: str | None = None
    archive_bytes: int | None = None
    chunk_count: int | None = None
    received_count: int = 0

    # The bitmap stays server-side; the console only needs how many chunks have landed.
    @model_validator(mode="before")
    @classmethod
    def _count_received(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "received_count" in data:
                return data
            return {**data, "received_count": uploads_bitmap.count(data.get("received_chunks"))}
        values = {name: getattr(data, name) for name in cls.model_fields
                  if name != "received_count" and hasattr(data, name)}
        values["received_count"] = uploads_bitmap.count(getattr(data, "received_chunks", None))
        return values


class UploadCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    size_bytes: int = Field(gt=0)
    # `{size}:{sha256(first 1 MiB + last 1 MiB)[:32]}`, computed by the browser.
    fingerprint: str = Field(min_length=1, max_length=80)
    captured_at: datetime | None = None
    crs_epsg: int | None = Field(default=None, gt=0)
    has_tfw: bool = False
    has_prj: bool = False


class UploadSessionOut(BaseModel):
    upload_id: int
    name: str
    fingerprint: str | None
    size_bytes: int
    chunk_size: int
    chunk_count: int
    received: list[int]
    status: str
    reject_reason: str | None = None


class UploadComplete(BaseModel):
    sha256: str | None = Field(default=None, pattern="^[0-9a-fA-F]{64}$")


class UploadDuplicate(BaseModel):
    detail: str
    existing_raster_id: int


class UploadRejected(BaseModel):
    detail: str
    raster_id: int


class RestoreOut(BaseModel):
    status: Literal["restoring"]
    eta_hours: float


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
