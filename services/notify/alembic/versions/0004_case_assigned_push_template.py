"""Seed the ICMS `case_assigned` push template, English and Hindi.

Revision ID: 0004
Revises: 0003

The push row is also what the inbox renders (me.py _display_text), so one row
per locale serves both. Key uses an underscore: the field app matches `type`
against NOTIFICATION_TYPES in apps/field/src/services/push/constants.ts.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels = None
depends_on = None

PROJECT_KEY = "ada"
KEY = "case_assigned"

# Only case_ref is substituted: push text must never carry case detail.
TEMPLATES = [
    {
        "locale": "en",
        "subject": "New case assigned",
        "body": "Case {{ case_ref }} has been assigned to you for inspection.",
    },
    {
        "locale": "hi",
        "subject": "नया मामला सौंपा गया",
        "body": "मामला {{ case_ref }} निरीक्षण के लिए आपको सौंपा गया है।",
    },
]


def upgrade() -> None:
    connection = op.get_bind()
    project_id = connection.execute(
        sa.text("SELECT id FROM projects WHERE key = :key"), {"key": PROJECT_KEY}
    ).scalar_one()
    for template in TEMPLATES:
        # Idempotent, and never overwrites a later version posted through the API.
        connection.execute(
            sa.text(
                """
                INSERT INTO templates
                    (id, project_id, key, channel, locale, version, subject, body, active)
                VALUES
                    (gen_random_uuid(), :project_id, :key, 'push', :locale, 1,
                     :subject, :body, true)
                ON CONFLICT ON CONSTRAINT uq_templates_identity DO NOTHING
                """
            ),
            {"project_id": project_id, "key": KEY, **template},
        )


def downgrade() -> None:
    # Keeps any version a delivery already points at, so sent history survives.
    op.get_bind().execute(
        sa.text(
            """
            DELETE FROM templates t
            USING projects p
            WHERE p.id = t.project_id AND p.key = :project AND t.key = :key
              AND t.channel = 'push' AND t.version = 1
              AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.template_id = t.id)
            """
        ),
        {"project": PROJECT_KEY, "key": KEY},
    )
