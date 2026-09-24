"""raster lifecycle — resumable uploads, archive master, cold tier

`rasters` gains the columns the chunked upload, the lossless archive master,
the cold-storage tier and the sweeper need. All are nullable or defaulted, so
existing rows keep their processing/ready/failed status unchanged.

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("size_bytes", sa.BigInteger()),
    ("fingerprint", sa.String(length=80)),
    ("sha256", sa.String(length=64)),
    ("chunk_size", sa.Integer()),
    ("received_chunks", sa.Text()),
    ("chunk_count", sa.Integer()),
    ("last_chunk_at", sa.DateTime(timezone=True)),
    ("last_progress_at", sa.DateTime(timezone=True)),
    ("last_used_at", sa.DateTime(timezone=True)),
    ("archive_path", sa.Text()),
    ("archive_sha256", sa.String(length=64)),
    ("archive_bytes", sa.BigInteger()),
    ("cold_key", sa.Text()),
    ("cold_at", sa.DateTime(timezone=True)),
    ("restore_requested_at", sa.DateTime(timezone=True)),
    ("restore_eta_hours", sa.Float()),
    ("reject_reason", sa.Text()),
    ("tier", sa.String(length=12)),
)


def upgrade() -> None:
    for name, type_ in COLUMNS:
        op.add_column("rasters", sa.Column(name, type_, nullable=True))
    op.add_column("rasters", sa.Column("retry_count", sa.Integer(), nullable=False,
                                       server_default=sa.text("0")))
    op.create_index("ix_rasters_fingerprint", "rasters", ["fingerprint"])
    op.execute("UPDATE rasters SET last_used_at = uploaded_at WHERE last_used_at IS NULL")


def downgrade() -> None:
    # Dropping cold_key would orphan archives that exist only in the bucket.
    cold = op.get_bind().execute(
        sa.text("SELECT count(*) FROM rasters WHERE cold_key IS NOT NULL")).scalar()
    if cold:
        raise RuntimeError(f"{cold} raster(s) live only in the cold store; restore them "
                           "before downgrading past 0017")
    # The old code knows only processing|ready|failed; anything else would strand the row.
    op.execute("UPDATE rasters SET status = 'failed' "
               "WHERE status NOT IN ('processing', 'ready', 'failed')")
    op.drop_index("ix_rasters_fingerprint", table_name="rasters")
    op.drop_column("rasters", "retry_count")
    for name, _ in reversed(COLUMNS):
        op.drop_column("rasters", name)
