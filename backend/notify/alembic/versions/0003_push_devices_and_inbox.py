"""Push device registry, per-device push deliveries, and the inbox read flag.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "push_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_sub", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform", sa.String(length=16), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("apns_environment", sa.String(length=16), nullable=True),
        sa.Column("app_version", sa.String(length=64), nullable=True),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("deactivated_reason", sa.Text(), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
        sa.CheckConstraint(
            "(platform = 'ios' AND apns_environment IN ('sandbox', 'production'))"
            " OR (platform = 'android' AND apns_environment IS NULL)",
            name="ck_push_devices_apns_environment",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_push_devices_token"),
    )
    op.create_index("ix_push_devices_created_at", "push_devices", ["created_at"])
    op.create_index(
        "ix_push_devices_user_active",
        "push_devices",
        ["user_sub"],
        postgresql_where=sa.text("active"),
    )

    op.add_column(
        "deliveries", sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_deliveries_device_id",
        "deliveries",
        "push_devices",
        ["device_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    # Existing rows all have device_id NULL, so NULLS NOT DISTINCT keeps the old
    # one-row-per-channel guarantee for them and cannot fail on existing data.
    op.drop_constraint("uq_deliveries_notification_channel", "deliveries", type_="unique")
    op.execute(
        "ALTER TABLE deliveries ADD CONSTRAINT uq_deliveries_notification_channel_device "
        "UNIQUE NULLS NOT DISTINCT (notification_id, channel, device_id)"
    )

    op.add_column("notifications", sa.Column("read_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_notifications_inbox", "notifications", ["recipient_id", "created_at", "id"])


def downgrade() -> None:
    connection = op.get_bind()
    # Per-device push history cannot be squeezed back into one row per channel,
    # so this refuses rather than deleting it.
    held = connection.execute(
        sa.text("SELECT count(*) FROM deliveries WHERE device_id IS NOT NULL")
    ).scalar_one()
    if held:
        raise RuntimeError(
            f"{held} push delivery row(s) reference devices. Remove them deliberately "
            "before downgrading below 0003."
        )

    op.drop_index("ix_notifications_inbox", table_name="notifications")
    op.drop_column("notifications", "read_at")

    op.drop_constraint("uq_deliveries_notification_channel_device", "deliveries", type_="unique")
    op.create_unique_constraint(
        "uq_deliveries_notification_channel", "deliveries", ["notification_id", "channel"]
    )
    op.drop_constraint("fk_deliveries_device_id", "deliveries", type_="foreignkey")
    op.drop_column("deliveries", "device_id")

    op.drop_index("ix_push_devices_user_active", table_name="push_devices")
    op.drop_index("ix_push_devices_created_at", table_name="push_devices")
    op.drop_table("push_devices")
