"""Seed the ICMS workflow templates: in-app for every event, push for the field ones, en + hi.

Revision ID: 0005
Revises: 0004

The event matrix is docs/icms/notifications.md. The in-app row is what the inbox
renders (me.py _display_text prefers it over push), so it may carry the reason a
surveyor has to act on; push text carries references only, never case detail.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels = None
depends_on = None

PROJECT_KEY = "ada"

# (key, channel, locale, subject, body). Every placeholder is supplied by
# services/api/app/icms/notifier.py; a missing one fails that delivery permanently.
TEMPLATES: list[tuple[str, str, str, str, str]] = [
    # --- in-app, portal (web bell) ------------------------------------------
    ("case_raised", "inapp", "en", "New complaint {{ case_ref }}",
     "New complaint {{ case_ref }} in {{ zone_name }} needs assignment."),
    ("case_raised", "inapp", "hi", "नई शिकायत {{ case_ref }}",
     "{{ zone_name }} में नई शिकायत {{ case_ref }} को सौंपा जाना है।"),
    ("inspection_submitted", "inapp", "en", "Inspection submitted",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} was submitted. Please verify."),
    ("inspection_submitted", "inapp", "hi", "निरीक्षण जमा किया गया",
     "मामला {{ case_ref }} का निरीक्षण {{ inspection_ref }} जमा किया गया है। कृपया सत्यापित करें।"),
    ("resurvey_refused", "inapp", "en", "Re-survey refused",
     "Your re-survey request for case {{ case_ref }} was refused."),
    ("resurvey_refused", "inapp", "hi", "पुनः सर्वेक्षण अस्वीकृत",
     "मामला {{ case_ref }} के लिए आपका पुनः सर्वेक्षण अनुरोध अस्वीकार कर दिया गया।"),
    ("case_handed_over", "inapp", "en", "Case handed over",
     "Case {{ case_ref }} in {{ zone_name }} was handed over. Please confirm."),
    ("case_handed_over", "inapp", "hi", "मामला सौंपा गया",
     "{{ zone_name }} का मामला {{ case_ref }} आपको सौंपा गया है। कृपया पुष्टि करें।"),
    ("case_confirmed", "inapp", "en", "Case confirmed",
     "Case {{ case_ref }} is confirmed. Please issue the notice."),
    ("case_confirmed", "inapp", "hi", "मामले की पुष्टि हुई",
     "मामला {{ case_ref }} की पुष्टि हो गई है। कृपया नोटिस जारी करें।"),
    ("notice_issued", "inapp", "en", "Notice issued",
     "Notice {{ notice_ref }} was issued for case {{ case_ref }}."),
    ("notice_issued", "inapp", "hi", "नोटिस जारी किया गया",
     "मामला {{ case_ref }} के लिए नोटिस {{ notice_ref }} जारी किया गया।"),
    # --- in-app, handset (field inbox) --------------------------------------
    ("case_assigned", "inapp", "en", "New case assigned",
     "Case {{ case_ref }} has been assigned to you for inspection."),
    ("case_assigned", "inapp", "hi", "नया मामला सौंपा गया",
     "मामला {{ case_ref }} निरीक्षण के लिए आपको सौंपा गया है।"),
    ("case_unassigned", "inapp", "en", "Case reassigned",
     "Case {{ case_ref }} has been reassigned to another surveyor."),
    ("case_unassigned", "inapp", "hi", "मामला पुनः सौंपा गया",
     "मामला {{ case_ref }} किसी अन्य सर्वेक्षक को सौंप दिया गया है।"),
    ("inspection_assigned", "inapp", "en", "Inspection opened",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} has been opened for you."),
    ("inspection_assigned", "inapp", "hi", "निरीक्षण खोला गया",
     "मामला {{ case_ref }} का निरीक्षण {{ inspection_ref }} आपके लिए खोला गया है।"),
    ("findings_accepted", "inapp", "en", "Findings accepted",
     "Your findings for inspection {{ inspection_ref }} (case {{ case_ref }}) were accepted."),
    ("findings_accepted", "inapp", "hi", "निष्कर्ष स्वीकृत",
     "निरीक्षण {{ inspection_ref }} (मामला {{ case_ref }}) के आपके निष्कर्ष स्वीकार किए गए।"),
    ("resurvey_requested", "inapp", "en", "Inspection sent back",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} was sent back: {{ reason }}"),
    ("resurvey_requested", "inapp", "hi", "निरीक्षण वापस भेजा गया",
     "मामला {{ case_ref }} का निरीक्षण {{ inspection_ref }} वापस भेजा गया: {{ reason }}"),
    ("resurvey_request_raised", "inapp", "en", "Re-survey requested",
     "A re-survey has been requested for case {{ case_ref }}: {{ reason }}"),
    ("resurvey_request_raised", "inapp", "hi", "पुनः सर्वेक्षण का अनुरोध",
     "मामला {{ case_ref }} के पुनः सर्वेक्षण का अनुरोध किया गया है: {{ reason }}"),
    ("resurvey_approved", "inapp", "en", "Re-survey approved",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} is open for you."),
    ("resurvey_approved", "inapp", "hi", "पुनः सर्वेक्षण स्वीकृत",
     "मामला {{ case_ref }} का निरीक्षण {{ inspection_ref }} आपके लिए खुला है।"),
    # --- push (references only) ---------------------------------------------
    ("case_unassigned", "push", "en", "Case reassigned",
     "Case {{ case_ref }} has been reassigned to another surveyor."),
    ("case_unassigned", "push", "hi", "मामला पुनः सौंपा गया",
     "मामला {{ case_ref }} किसी अन्य सर्वेक्षक को सौंप दिया गया है।"),
    ("inspection_assigned", "push", "en", "Inspection opened",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} has been opened for you."),
    ("inspection_assigned", "push", "hi", "निरीक्षण खोला गया",
     "मामला {{ case_ref }} का निरीक्षण {{ inspection_ref }} आपके लिए खोला गया है।"),
    ("resurvey_requested", "push", "en", "Inspection sent back",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} needs a re-survey."),
    ("resurvey_requested", "push", "hi", "निरीक्षण वापस भेजा गया",
     "मामला {{ case_ref }} के निरीक्षण {{ inspection_ref }} का पुनः सर्वेक्षण आवश्यक है।"),
    ("resurvey_request_raised", "push", "en", "Re-survey requested",
     "A re-survey has been requested for case {{ case_ref }}."),
    ("resurvey_request_raised", "push", "hi", "पुनः सर्वेक्षण का अनुरोध",
     "मामला {{ case_ref }} के पुनः सर्वेक्षण का अनुरोध किया गया है।"),
    ("resurvey_approved", "push", "en", "Re-survey approved",
     "Inspection {{ inspection_ref }} for case {{ case_ref }} is open for you."),
    ("resurvey_approved", "push", "hi", "पुनः सर्वेक्षण स्वीकृत",
     "मामला {{ case_ref }} का निरीक्षण {{ inspection_ref }} आपके लिए खुला है।"),
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
