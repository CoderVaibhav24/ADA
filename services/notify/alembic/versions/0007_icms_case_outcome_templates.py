"""Seed the ICMS case-ending templates (rejected, closed), en + hi.

Revision ID: 0007
Revises: 0006

Sent by services/api/app/icms/notifier.py (docs/icms/notifications.md).
Only case_rejected reaches the handset (the released surveyor), so only it has push.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels = None
depends_on = None

PROJECT_KEY = "ada"

# (key, channel, locale, subject, body). Every placeholder is supplied by notifier.py.
TEMPLATES: list[tuple[str, str, str, str, str]] = [
    ("case_rejected", "inapp", "en", "Case rejected",
     "Case {{ case_ref }} in {{ zone_name }} was rejected: {{ outcome_label }}."),
    ("case_rejected", "inapp", "hi", "मामला अस्वीकृत",
     "{{ zone_name }} का मामला {{ case_ref }} अस्वीकृत किया गया: {{ outcome_label_hi }}।"),
    ("case_rejected", "push", "en", "Case rejected",
     "Case {{ case_ref }} was rejected and removed from your worklist."),
    ("case_rejected", "push", "hi", "मामला अस्वीकृत",
     "मामला {{ case_ref }} अस्वीकृत कर आपकी कार्यसूची से हटा दिया गया है।"),
    ("case_closed", "inapp", "en", "Case closed",
     "Case {{ case_ref }} in {{ zone_name }} was closed: {{ outcome_label }}."),
    ("case_closed", "inapp", "hi", "मामला बंद",
     "{{ zone_name }} का मामला {{ case_ref }} बंद किया गया: {{ outcome_label_hi }}।"),
]


def upgrade() -> None:
    connection = op.get_bind()
    project_id = connection.execute(
        sa.text("SELECT id FROM projects WHERE key = :key"), {"key": PROJECT_KEY}
    ).scalar_one()
    for key, channel, locale, subject, body in TEMPLATES:
        # Idempotent, and never overwrites a later version posted through the API.
        connection.execute(
            sa.text(
                """
                INSERT INTO templates
                    (id, project_id, key, channel, locale, version, subject, body, active)
                VALUES
                    (gen_random_uuid(), :project_id, :key, CAST(:channel AS channel), :locale,
                     1, :subject, :body, true)
                ON CONFLICT ON CONSTRAINT uq_templates_identity DO NOTHING
                """
            ),
            {
                "project_id": project_id,
                "key": key,
                "channel": channel,
                "locale": locale,
                "subject": subject,
                "body": body,
            },
        )


def downgrade() -> None:
    # Keeps any version a delivery already points at, so sent history survives.
    connection = op.get_bind()
    for key, channel, locale, _subject, _body in TEMPLATES:
        connection.execute(
            sa.text(
                """
                DELETE FROM templates t
                USING projects p
                WHERE p.id = t.project_id AND p.key = :project AND t.key = :key
                  AND t.channel = CAST(:channel AS channel) AND t.locale = :locale
                  AND t.version = 1
                  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.template_id = t.id)
                """
            ),
            {"project": PROJECT_KEY, "key": key, "channel": channel, "locale": locale},
        )
