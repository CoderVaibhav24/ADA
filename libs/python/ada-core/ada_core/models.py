from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .datetimes import now_ist

# JSONB on PostgreSQL, which is the only backend ADA runs on, and plain JSON on
# SQLite, which is the only backend the test suite can create a schema on
# without a server. Without the variant SQLAlchemy raises
#   UnsupportedCompilationError: can't render element of type JSONB
# at create_all, so every test touching a table would need a live PostgreSQL.
#
# This changes NOTHING in production: the variant is selected per dialect, so
# PostgreSQL still gets a real JSONB column with its indexing and operators.
Json = JSONB().with_variant(JSON(), "sqlite")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_ist)

    rasters: Mapped[list["Raster"]] = relationship(
        back_populates="project", cascade="all, delete-orphan")
    red_zones: Mapped[list["RedZone"]] = relationship(
        back_populates="project", cascade="all, delete-orphan")
    jobs: Mapped[list["AnalysisJob"]] = relationship(
        back_populates="project", cascade="all, delete-orphan")


# Raster lifecycle; the sweeper deletes rows in a terminal status after 7 days.
RASTER_STATUSES = (
    "uploading", "completing", "rejected", "processing", "failed_retryable", "failed",
    "ready", "cold", "restoring", "expired",
)
RASTER_TERMINAL_STATUSES = ("rejected", "failed", "expired")


class Raster(Base):
    """One uploaded map (drone or satellite orthophoto). Any number per project."""

    __tablename__ = "rasters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    original_path: Mapped[str] = mapped_column(Text)
    cog_path: Mapped[str | None] = mapped_column(Text, nullable=True)   # 8-bit display COG
    crs: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bounds_4326: Mapped[dict | None] = mapped_column(Json, nullable=True)  # [w, s, e, n]
    resolution_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    # One of RASTER_STATUSES; 'completing' is the complete-endpoint compare-and-set lock.
    status: Mapped[str] = mapped_column(String(20), default="processing")
    # Ingest progress, mirroring what analysis_jobs already exposes. A grid tile
    # takes many minutes to ingest, and "processing" alone cannot distinguish
    # slow from stuck — which is the whole question an officer has while waiting.
    progress: Mapped[float] = mapped_column(Float, default=0.0)   # 0.0 - 1.0
    stage: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_ist)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    fingerprint: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    chunk_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    received_chunks: Mapped[str | None] = mapped_column(Text, nullable=True)  # hex bitmap
    chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_chunk_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_progress_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=now_ist)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    archive_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    archive_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    archive_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cold_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    cold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restore_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    restore_eta_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    tier: Mapped[str | None] = mapped_column(String(12), nullable=True)  # cuda|metal|cpu

    project: Mapped[Project] = relationship(back_populates="rasters")


# What a KML `reserved` placemark may be (docs/icms/kml-import-spec.md).
RESERVED_FEATURE_TYPES = ("park", "water", "road", "heritage", "scheme", "other")


class RedZone(Base):
    """Restricted area. Any change inside it is flagged illegal.

    Drawn ones belong to a project. KML ones (`source = 'kml'`) have no project,
    apply to every analysis, and are keyed by `import_key` so a re-import upserts.
    """

    __tablename__ = "red_zones"
    __table_args__ = (
        CheckConstraint("source IN ('drawn', 'kml')", name="red_zones_source_ck"),
        CheckConstraint("project_id IS NOT NULL OR source = 'kml'",
                        name="red_zones_project_ck"),
        Index("uq_red_zones_import_key", "import_key", unique=True,
              postgresql_where=text("import_key IS NOT NULL"),
              sqlite_where=text("import_key IS NOT NULL")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(200), default="Red zone")
    geometry: Mapped[dict] = mapped_column(Json)  # GeoJSON geometry, EPSG:4326
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_ist)
    source: Mapped[str] = mapped_column(
        String(10), default="drawn", server_default=text("'drawn'"))
    feature_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    import_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    attributes: Mapped[dict | None] = mapped_column(Json, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))

    project: Mapped[Project | None] = relationship(back_populates="red_zones")


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    raster_t1_id: Mapped[int] = mapped_column(ForeignKey("rasters.id", ondelete="CASCADE"))
    raster_t2_id: Mapped[int] = mapped_column(ForeignKey("rasters.id", ondelete="CASCADE"))
    # ai   -> full pipeline (building seg-diff + vegetation logic + SAM2 refine)
    # diff -> fast classical pixel/structure difference, no neural inference
    mode: Mapped[str] = mapped_column(String(10), default="ai")
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|done|failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    stage: Mapped[str | None] = mapped_column(String(200), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict | None] = mapped_column(Json, nullable=True)
    mask_cog_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    stats: Mapped[dict | None] = mapped_column(Json, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_ist)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project] = relationship(back_populates="jobs")
    polygons: Mapped[list["ChangePolygon"]] = relationship(
        back_populates="job", cascade="all, delete-orphan")


class ChangePolygon(Base):
    __tablename__ = "change_polygons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), index=True)
    geometry: Mapped[dict] = mapped_column(Json)    # GeoJSON geometry, EPSG:4326
    properties: Mapped[dict] = mapped_column(Json)  # label/status/area_m2/confidence/...

    # --- officer review (human-in-the-loop active learning) ---
    # pending -> not yet adjudicated; confirmed -> real violation;
    # rejected -> false positive. Confirmed/rejected rows are the labelled
    # examples exported for the next fine-tuning cycle.
    review_status: Mapped[str] = mapped_column(String(12), default="pending", index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped[AnalysisJob] = relationship(back_populates="polygons")
