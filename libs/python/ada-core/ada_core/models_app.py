"""Tables the field app is driven from, as opposed to the case data it shows.

`app_screen` holds server-driven UI definitions (docs/Agents-Mobile/sdui.md).
Every row is one version of one screen. A draft row may be promoted to
published once; a published row is never edited or deleted again — revision
0005 installs a trigger that refuses both — so every screen an officer has ever
been shown can be read back, and a rollback is a new version, not a rewrite.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .datetimes import now_ist
from .models import Json

__all__ = ["SCREEN_STATUSES", "AppScreen"]

SCREEN_STATUSES = ("draft", "published")


class AppScreen(Base):
    """One version of one server-driven screen."""

    __tablename__ = "app_screen"
    __table_args__ = (
        UniqueConstraint("screen_id", "version", name="app_screen_version_uq"),
        CheckConstraint("status IN ('draft', 'published')", name="app_screen_status_ck"),
        CheckConstraint("version > 0", name="app_screen_version_ck"),
        CheckConstraint("schema_version > 0", name="app_screen_schema_version_ck"),
        CheckConstraint(
            "status = 'draft' OR (published_at IS NOT NULL AND published_by IS NOT NULL)",
            name="app_screen_published_ck",
        ),
        Index("ix_app_screen_served", "screen_id", "status", "version"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    screen_id: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer)
    schema_version: Mapped[int] = mapped_column(SmallInteger)
    min_app_runtime: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(120))
    definition: Mapped[dict] = mapped_column(Json)
    status: Mapped[str] = mapped_column(String(10), default="draft")
    required_capability: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # The version this row was copied from by a rollback; null for an authored row.
    source_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    created_by: Mapped[str] = mapped_column(String(64))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
