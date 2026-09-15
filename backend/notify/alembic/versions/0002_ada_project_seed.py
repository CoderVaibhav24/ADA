"""Register ADA as a project and store the templates its pipeline sends.

Revision ID: 0002
Revises: 0001

A project row is not configuration an operator can be expected to insert by
hand: without it every notification ada-ml submits is rejected with a 403 saying
the caller is not a registered project, and the cause — one missing row — is
invisible from the error. So the row that makes the service usable ships with
the schema that requires it.

client_id is 'ada-ml' because the ML service is the only process that submits:
an analysis finishing is the only event ADA notifies anyone about, and only the
worker knows when that happened. The API process holds no notify credential at
all, which is the smaller blast radius of the two.

Templates are seeded at version 1 and are ordinary rows. An administrator
editing the wording later inserts a new version through the templates API; this
migration does not own them after the first boot, and re-running it does not
overwrite an edit.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels = None
depends_on = None

PROJECT_KEY = "ada"
CLIENT_ID = "ada-ml"

# One template per outcome. Both are addressed to the officer who owns the
# project, and both name the project rather than the job id: an id is what the
# support channel needs and a name is what the recipient recognises.
TEMPLATES = [
    {
        "key": "analysis-complete",
        "subject": "ADA: change analysis finished for {{ project_name }}",
        "body": (
            "The change analysis for {{ project_name }} has finished.\n"
            "\n"
            "Detected changes: {{ polygon_count }}\n"
            "Total changed area: {{ changed_area_m2 }} m2\n"
            "Mode: {{ mode }}\n"
            "\n"
            "Open the project to review each detection and mark it confirmed or "
            "rejected:\n"
            "{{ project_url }}\n"
        ),
    },
    {
        "key": "analysis-failed",
        "subject": "ADA: change analysis failed for {{ project_name }}",
        "body": (
            "The change analysis for {{ project_name }} did not finish.\n"
            "\n"
            "Reason: {{ error }}\n"
            "\n"
            "The imagery is unchanged and the analysis can be started again "
            "from the project page:\n"
            "{{ project_url }}\n"
        ),
    },
]


def upgrade() -> None:
    connection = op.get_bind()

    # ON CONFLICT DO NOTHING rather than a plain INSERT: `alembic upgrade head`
    # runs on every boot of the migrate container, and a project that has since
    # been renamed through the admin API must not be reverted by a redeploy.
    connection.execute(
        sa.text(
            """
            INSERT INTO projects (id, key, name, client_id, enabled)
            VALUES (gen_random_uuid(), :key, :name, :client_id, true)
            ON CONFLICT (key) DO NOTHING
            """
        ),
        {"key": PROJECT_KEY, "name": "ADA Change Detection", "client_id": CLIENT_ID},
    )

    project_id = connection.execute(
        sa.text("SELECT id FROM projects WHERE key = :key"), {"key": PROJECT_KEY}
    ).scalar_one()

    for template in TEMPLATES:
        connection.execute(
            sa.text(
                """
                INSERT INTO templates
                    (id, project_id, key, channel, locale, version, subject, body, active)
                VALUES
                    (gen_random_uuid(), :project_id, :key, 'email', 'en', 1,
                     :subject, :body, true)
                ON CONFLICT ON CONSTRAINT uq_templates_identity DO NOTHING
                """
            ),
            {"project_id": project_id, **template},
        )


def downgrade() -> None:
    connection = op.get_bind()
    # Templates go with the project through ON DELETE CASCADE, but the
    # notifications a project has already sent do not — so this refuses to run
    # rather than cascading into delivery history.
    sent = connection.execute(
        sa.text(
            "SELECT count(*) FROM notifications n JOIN projects p ON p.id = n.project_id"
            " WHERE p.key = :key"
        ),
        {"key": PROJECT_KEY},
    ).scalar_one()
    if sent:
        raise RuntimeError(
            f"The '{PROJECT_KEY}' project has {sent} notification(s) on record. "
            "Downgrading would take their history with it; remove them "
            "deliberately first if that is really what you want."
        )
    connection.execute(sa.text("DELETE FROM projects WHERE key = :key"), {"key": PROJECT_KEY})
