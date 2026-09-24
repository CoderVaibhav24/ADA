"""runtime settings — Super Admin toggles held in the database

Seeds the check-in geofence: enforced, 30 m around the case point.

Revision ID: 0018_runtime_setting
Revises: 0017
Create Date: 2026-09-24

"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018_runtime_setting"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED = [
    ("checkin.geofence_enforced", True,
     "Refuse a check-in whose fix is farther than checkin.geofence_radius_m from the case point"),
    ("checkin.geofence_radius_m", 30,
     "Check-in geofence radius around the case point, in metres"),
]


def upgrade() -> None:
    op.create_table(
        "icms_runtime_setting",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    # Literal SQL so the offline (--sql) render works; JSONB has no literal renderer.
    for key, value, description in SEED:
        op.execute(
            "INSERT INTO icms_runtime_setting (key, value, description) VALUES "
            f"('{key}', '{json.dumps(value)}'::jsonb, '{description}')"
        )


def downgrade() -> None:
    op.drop_table("icms_runtime_setting")
