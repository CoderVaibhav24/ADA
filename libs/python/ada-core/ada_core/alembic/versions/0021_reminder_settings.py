"""deadline reminders — the sent ledger and the Super Admin settings

Seeds the reminder switches read by services/api/app/icms/reminders.py
(docs/icms/notifications.md, Reminders).

Revision ID: 0021_reminder_settings
Revises: 0020_findings_fields
Create Date: 2026-09-24

"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_reminder_settings"
down_revision: str | None = "0020_findings_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED = [
    ("reminders.enabled", True, "Send deadline reminders for open cases"),
    ("reminders.interval_minutes", 30, "Minutes between reminder scans"),
    ("reminders.quiet_start_hour", 21, "IST hour at which reminders stop for the night"),
    ("reminders.quiet_end_hour", 8, "IST hour at which reminders resume in the morning"),
    ("reminders.survey_due_days", 2,
     "Days after assignment before an unstarted survey reminds the surveyor"),
    ("reminders.survey_overdue_days", 5,
     "Days after assignment before an unstarted survey is escalated to the zone"),
    ("reminders.verification_due_days", 3,
     "Days a submitted inspection may wait for verification before the zone is reminded"),
    ("reminders.resurvey_decision_days", 3,
     "Days a re-survey request may wait for a decision before the zone is reminded"),
]


def upgrade() -> None:
    op.create_table(
        "icms_reminder_sent",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("rule", sa.String(40), nullable=False),
        sa.Column("subject", sa.String(64), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("recipients", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint("rule", "subject", "stage", name="icms_reminder_sent_uq"),
    )
    # Literal SQL so the offline (--sql) render works; an admin's earlier value is kept.
    for key, value, description in SEED:
        op.execute(
            "INSERT INTO icms_runtime_setting (key, value, description) VALUES "
            f"('{key}', '{json.dumps(value)}'::jsonb, '{description}') "
            "ON CONFLICT (key) DO NOTHING"
        )


def downgrade() -> None:
    keys = ", ".join(f"'{key}'" for key, _value, _description in SEED)
    op.execute(f"DELETE FROM icms_runtime_setting WHERE key IN ({keys})")
    op.drop_table("icms_reminder_sent")
