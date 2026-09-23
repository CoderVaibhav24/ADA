"""server-driven screens for the field app, append-only, with the Home proof seeded

One table, `app_screen`: every row is one version of one screen. A trigger
refuses any UPDATE of a published row, any UPDATE of a draft other than its
one-way promotion to published, and any DELETE of a published row — so the
history a rollback copies from cannot be edited out from under it. The seed is
`home_sdui` version 1, stated as a literal because a migration must keep meaning
what it meant when it was written. Additive; downgrade drops the table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-23

"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_PUBLISHER = "migration:0005"

# Home as a screen definition: the three counts, Next Up and recent notifications.
# Overdue and notifications have no API yet, so they are in-progress blocks, exactly
# as the coded screens render them — nothing sampled, nothing invented.
HOME_SDUI: dict = {
    "title": "Home",
    "body": [
        {
            "type": "screen_header",
            "props": {"title": "Home"},
            "children": [
                {
                    "type": "icon_button",
                    "id": "open_notifications",
                    "props": {"icon": "bell", "label": "Notifications"},
                    "action": {"type": "navigate", "route": "notifications"},
                }
            ],
        },
        {
            "type": "stat_strip",
            "children": [
                {
                    "type": "stat_card",
                    "id": "assigned_count",
                    "data": {
                        "source": "api",
                        "path": "/api/icms/cases",
                        "query": {
                            "mine": True,
                            "status": ["assigned", "under_inspection"],
                            "size": 1,
                        },
                        "select": "total",
                    },
                    "props": {"label": "Assigned", "value": "{{data|number}}", "icon": "complaints"},
                    "action": {"type": "navigate", "route": "complaints"},
                },
                {
                    "type": "stat_card",
                    "id": "completed_today_count",
                    "data": {
                        "source": "api",
                        "path": "/api/icms/inspections",
                        "query": {
                            "submitted_from": "{{today}}",
                            "submitted_to": "{{today}}",
                            "size": 1,
                        },
                        "select": "total",
                    },
                    "props": {
                        "label": "Completed today",
                        "value": "{{data|number}}",
                        "icon": "success",
                        "tone": "statusDone",
                    },
                },
                {"type": "in_progress", "props": {"title": "Overdue", "compact": True}},
            ],
        },
        {
            "type": "section",
            "props": {"title": "Next up"},
            "children": [
                {
                    "type": "list",
                    "id": "next_up",
                    "data": {
                        "source": "api",
                        "path": "/api/icms/cases",
                        "query": {
                            "mine": True,
                            "status": ["assigned", "under_inspection"],
                            "sort": "raised_at",
                            "size": 1,
                        },
                        "select": "items",
                    },
                    "props": {"limit": 1},
                    "item": {
                        "type": "card",
                        "children": [
                            {
                                "type": "list_row",
                                "props": {
                                    "label": "{{item.case_ref}}",
                                    "value": "{{item.status|label:case_status}}",
                                    "monospace": False,
                                },
                                "action": {
                                    "type": "navigate",
                                    "route": "complaint_detail",
                                    "params": {"caseRef": "{{item.case_ref}}"},
                                },
                            },
                            {
                                "type": "text",
                                "props": {
                                    "text": "{{item.property_address}}",
                                    "variant": "body",
                                    "color": "ink1",
                                },
                            },
                            {
                                "type": "text",
                                "props": {
                                    "text": "{{item.zone_name}} · filed {{item.raised_at|date}}",
                                    "variant": "caption",
                                    "color": "ink3",
                                },
                            },
                        ],
                    },
                    "empty": {
                        "type": "state_message",
                        "props": {
                            "tone": "empty",
                            "title": "Nothing assigned",
                            "message": "Cases the nodal officer assigns to you appear here.",
                        },
                    },
                }
            ],
        },
        {
            "type": "section",
            "props": {"title": "Recent notifications"},
            "children": [{"type": "in_progress", "props": {"title": "Recent notifications"}}],
        },
    ],
}

# UTF-8, not \u escapes: `--sql` renders literals with backslashes doubled, which would
# turn an escape into literal text on a database seeded from the reviewed SQL.
HOME_SDUI_JSON = json.dumps(HOME_SDUI, ensure_ascii=False)
if "\\" in HOME_SDUI_JSON:
    raise RuntimeError("0005 seed must not contain a backslash; it would not survive --sql")

GUARD_FUNCTION = """
CREATE OR REPLACE FUNCTION app_screen_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'published' THEN
            RAISE EXCEPTION 'app_screen % version % is published and cannot be deleted',
                OLD.screen_id, OLD.version USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'published' THEN
        RAISE EXCEPTION 'app_screen % version % is published and cannot be changed',
            OLD.screen_id, OLD.version USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.status <> 'published'
       OR NEW.screen_id <> OLD.screen_id
       OR NEW.version <> OLD.version
       OR NEW.schema_version <> OLD.schema_version
       OR NEW.min_app_runtime <> OLD.min_app_runtime
       OR NEW.title <> OLD.title
       OR NEW.definition <> OLD.definition
       OR NEW.required_capability IS DISTINCT FROM OLD.required_capability
       OR NEW.source_version IS DISTINCT FROM OLD.source_version
       OR NEW.created_at <> OLD.created_at
       OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'a draft app_screen may only be promoted to published'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""


def upgrade() -> None:
    op.create_table(
        "app_screen",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("screen_id", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.SmallInteger(), nullable=False),
        sa.Column("min_app_runtime", sa.String(16), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("definition", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("required_capability", sa.String(64), nullable=True),
        sa.Column("source_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_by", sa.String(64), nullable=True),
        sa.UniqueConstraint("screen_id", "version", name="app_screen_version_uq"),
        sa.CheckConstraint("status IN ('draft', 'published')", name="app_screen_status_ck"),
        sa.CheckConstraint("version > 0", name="app_screen_version_ck"),
        sa.CheckConstraint("schema_version > 0", name="app_screen_schema_version_ck"),
        sa.CheckConstraint(
            "status = 'draft' OR (published_at IS NOT NULL AND published_by IS NOT NULL)",
            name="app_screen_published_ck",
        ),
    )
    op.create_index("ix_app_screen_served", "app_screen", ["screen_id", "status", "version"])

    op.execute(GUARD_FUNCTION)
    op.execute(
        "CREATE TRIGGER app_screen_guard BEFORE UPDATE OR DELETE ON app_screen "
        "FOR EACH ROW EXECUTE FUNCTION app_screen_guard()"
    )

    # Values bound into the statement, not passed beside it: `op.execute` renders a
    # bound statement with literal_binds under `--sql`, where a separate parameter
    # dict is never materialised and the row would render as all NULLs.
    op.execute(
        sa.text(
            "INSERT INTO app_screen (screen_id, version, schema_version, min_app_runtime, "
            "title, definition, status, created_by, published_at, published_by) "
            "VALUES (:screen_id, 1, 1, '1.0', :title, CAST(:definition AS JSONB), "
            "'published', :who, now(), :who)"
        ).bindparams(
            sa.bindparam("screen_id", "home_sdui", type_=sa.String()),
            sa.bindparam("title", HOME_SDUI["title"], type_=sa.String()),
            sa.bindparam("definition", HOME_SDUI_JSON, type_=sa.String()),
            sa.bindparam("who", SEED_PUBLISHER, type_=sa.String()),
        )
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS app_screen_guard ON app_screen")
    op.execute("DROP FUNCTION IF EXISTS app_screen_guard()")
    op.drop_index("ix_app_screen_served", table_name="app_screen")
    op.drop_table("app_screen")
