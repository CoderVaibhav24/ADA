"""evidence stamp — server-stamped photo derivative and location checks

The original file and its sha256 are never touched; the stamped copy is a
separate file beside it.

Revision ID: 0019_evidence_stamp
Revises: 0018_runtime_setting
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_evidence_stamp"
down_revision: str | None = "0018_runtime_setting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("icms_evidence", sa.Column("stamped_storage_key", sa.String(), nullable=True))
    op.add_column("icms_evidence", sa.Column(
        "geotag_flagged", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("icms_evidence", sa.Column("distance_to_site_m", sa.Float(), nullable=True))
    op.add_column("icms_evidence", sa.Column("exif_lat", sa.Float(), nullable=True))
    op.add_column("icms_evidence", sa.Column("exif_lon", sa.Float(), nullable=True))


def downgrade() -> None:
    for name in ("exif_lon", "exif_lat", "distance_to_site_m", "geotag_flagged",
                 "stamped_storage_key"):
        op.drop_column("icms_evidence", name)
