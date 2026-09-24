"""Seed the ICMS deadline-reminder templates, en + hi.

Revision ID: 0006
Revises: 0005

Sent by services/api/app/icms/reminders.py (docs/icms/notifications.md, Reminders).
Only inspection_reminder reaches the handset, so only it has a push template.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels = None
depends_on = None

PROJECT_KEY = "ada"

# (key, channel, locale, subject, body). Every placeholder is supplied by reminders.py.
TEMPLATES: list[tuple[str, str, str, str, str]] = [
    # --- handset: the assigned surveyor -------------------------------------
    ("inspection_reminder", "inapp", "en", "Inspection not started",
     "The inspection for case {{ case_ref }} has not been started "
     "{{ days }} days after it was assigned to you."),
    ("inspection_reminder", "inapp", "hi", "निरीक्षण शुरू नहीं हुआ",
     "मामला {{ case_ref }} का निरीक्षण आपको सौंपे जाने के {{ days }} दिन बाद भी शुरू नहीं हुआ है।"),
    ("inspection_reminder", "push", "en", "Inspection reminder",
     "The inspection for case {{ case_ref }} is waiting to be started."),
    ("inspection_reminder", "push", "hi", "निरीक्षण की याद",
     "मामला {{ case_ref }} का निरीक्षण शुरू होने की प्रतीक्षा में है।"),
    # --- portal (web bell) ---------------------------------------------------
    ("inspection_overdue", "inapp", "en", "Survey overdue",
     "The survey for case {{ case_ref }} in {{ zone_name }} has not started "
     "{{ days }} days after assignment."),
    ("inspection_overdue", "inapp", "hi", "सर्वेक्षण में देरी",
     "{{ zone_name }} के मामला {{ case_ref }} का सर्वेक्षण सौंपे जाने के {{ days }} दिन बाद भी "
     "शुरू नहीं हुआ है।"),
    ("verification_pending", "inapp", "en", "Verification pending",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} has waited "
     "{{ days }} days for verification."),
    ("verification_pending", "inapp", "hi", "सत्यापन लंबित",
     "मामला {{ case_ref }} का निरीक्षण {{ inspection_ref }} {{ days }} दिन से सत्यापन की "
     "प्रतीक्षा में है।"),
    ("resurvey_decision_pending", "inapp", "en", "Re-survey decision pending",
     "The re-survey request for case {{ case_ref }} has waited {{ days }} days for a decision."),
    ("resurvey_decision_pending", "inapp", "hi", "पुनः सर्वेक्षण निर्णय लंबित",
     "मामला {{ case_ref }} का पुनः सर्वेक्षण अनुरोध {{ days }} दिन से निर्णय की प्रतीक्षा में है।"),
    ("notice_compliance_due", "inapp", "en", "Notice compliance date passed",
     "The compliance date {{ compliance_due }} for notice {{ notice_ref }} "
     "(case {{ case_ref }}) has passed."),
    ("notice_compliance_due", "inapp", "hi", "नोटिस अनुपालन तिथि बीत गई",
     "नोटिस {{ notice_ref }} (मामला {{ case_ref }}) की अनुपालन तिथि {{ compliance_due }} "
     "बीत चुकी है।"),
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
