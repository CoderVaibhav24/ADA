from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    rasters: Mapped[list["Raster"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    red_zones: Mapped[list["RedZone"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    jobs: Mapped[list["AnalysisJob"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Raster(Base):
    """One uploaded map (drone or satellite orthophoto). Any number per project."""

    __tablename__ = "rasters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    original_path: Mapped[str] = mapped_column(Text)
    cog_path: Mapped[str | None] = mapped_column(Text, nullable=True)   # 8-bit display COG
    crs: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bounds_4326: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # [w, s, e, n]
    resolution_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="processing")  # processing|ready|failed
    # Ingest progress, mirroring what analysis_jobs already exposes. A grid tile
    # takes many minutes to ingest, and "processing" alone cannot distinguish
    # slow from stuck — which is the whole question an officer has while waiting.
    progress: Mapped[float] = mapped_column(Float, default=0.0)   # 0.0 - 1.0
    stage: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="rasters")


class RedZone(Base):
    """User-defined restricted area. Any change inside it is flagged illegal."""

    __tablename__ = "red_zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), default="Red zone")
    geometry: Mapped[dict] = mapped_column(JSONB)  # GeoJSON geometry, EPSG:4326
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="red_zones")


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    raster_t1_id: Mapped[int] = mapped_column(ForeignKey("rasters.id", ondelete="CASCADE"))
    raster_t2_id: Mapped[int] = mapped_column(ForeignKey("rasters.id", ondelete="CASCADE"))
    # ai   -> full pipeline (building seg-diff + vegetation logic + SAM2 refine)
    # diff -> fast classical pixel/structure difference, no neural inference
    mode: Mapped[str] = mapped_column(String(10), default="ai")
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|done|failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    stage: Mapped[str | None] = mapped_column(String(200), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    mask_cog_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    stats: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="jobs")
    polygons: Mapped[list["ChangePolygon"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class ChangePolygon(Base):
    __tablename__ = "change_polygons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="CASCADE"), index=True)
    geometry: Mapped[dict] = mapped_column(JSONB)    # GeoJSON geometry, EPSG:4326
    properties: Mapped[dict] = mapped_column(JSONB)  # label/status/area_m2/confidence/...

    # --- officer review (human-in-the-loop active learning) ---
    # pending -> not yet adjudicated; confirmed -> real violation;
    # rejected -> false positive. Confirmed/rejected rows are the labelled
    # examples exported for the next fine-tuning cycle.
    review_status: Mapped[str] = mapped_column(String(12), default="pending", index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped[AnalysisJob] = relationship(back_populates="polygons")
