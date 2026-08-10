"""Additive schema migrations.

`Base.metadata.create_all` creates missing tables but never alters existing
ones, so columns added after a table already exists have to be applied here.
Every statement is idempotent (`IF NOT EXISTS`), so this runs safely on every
startup and on a fresh database alike — no Alembic setup needed for the POC.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from .database import engine

log = logging.getLogger("ada.migrate")

_STATEMENTS = [
    # Per-run execution mode: AI Mode (full pipeline) vs Diff Mode (fast).
    "ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'ai'",
    # Officer review / feedback loop on each detected change polygon.
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS review_status VARCHAR(12) DEFAULT 'pending'",
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS review_note TEXT",
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(64)",
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS ix_change_polygons_review_status "
    "ON change_polygons (review_status)",
    # Backfill rows that predate the columns.
    "UPDATE analysis_jobs SET mode = 'ai' WHERE mode IS NULL",
    "UPDATE change_polygons SET review_status = 'pending' WHERE review_status IS NULL",
]


def run_migrations() -> None:
    with engine.begin() as conn:
        for stmt in _STATEMENTS:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover - defensive
                log.warning("migration skipped (%s): %s", stmt[:60], exc)
    log.info("Schema migrations applied")
