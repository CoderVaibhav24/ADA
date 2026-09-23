"""upload rules per evidence kind, in the database rather than in source

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-22

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mirrors ada_core.models_icms.EVIDENCE_KINDS, restated as a literal so this revision keeps
# meaning the same thing after that tuple moves on.
EVIDENCE_KINDS = ("photo", "video", "document", "signature")

MB = 1024 * 1024

# kind, mime types, extensions, max bytes, max pixels
SEED = [
    ("photo", ["image/jpeg", "image/png", "image/heic"],
     [".jpg", ".jpeg", ".png", ".heic", ".heif"], 15 * MB, 40_000_000),
    ("video", ["video/mp4", "video/quicktime"], [".mp4", ".mov"], 200 * MB, None),
    ("document", ["application/pdf"], [".pdf"], 25 * MB, None),
    ("signature", ["image/png"], [".png"], 2 * MB, 4_000_000),
]


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "icms_upload_policy",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(20), nullable=False, unique=True),
        sa.Column("mime_types", postgresql.ARRAY(sa.Text()), nullable=False,
                  server_default=sa.text("'{}'")),
        sa.Column("extensions", postgresql.ARRAY(sa.Text()), nullable=False,
                  server_default=sa.text("'{}'")),
        sa.Column("max_bytes", sa.BigInteger(), nullable=False),
        sa.Column("max_pixels", sa.BigInteger(), nullable=True),
        sa.Column("storage_backend", sa.String(20), nullable=False,
                  server_default=sa.text("'local'")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_by", sa.String(64), nullable=True),
        sa.CheckConstraint(_in("kind", EVIDENCE_KINDS), name="icms_upload_policy_kind_ck"),
        sa.CheckConstraint("max_bytes > 0", name="icms_upload_policy_max_bytes_ck"),
        sa.CheckConstraint("max_pixels IS NULL OR max_pixels > 0",
                           name="icms_upload_policy_max_pixels_ck"),
    )

    # All four kinds icms_evidence allows are seeded: a kind with no row rejects every
    # upload, so a missing one is an evidence type the field app simply cannot send.
    op.bulk_insert(
        sa.table(
            "icms_upload_policy",
            sa.column("kind", sa.String),
            sa.column("mime_types", postgresql.ARRAY(sa.Text())),
            sa.column("extensions", postgresql.ARRAY(sa.Text())),
            sa.column("max_bytes", sa.BigInteger),
            sa.column("max_pixels", sa.BigInteger),
            sa.column("storage_backend", sa.String),
        ),
        [
            {"kind": kind, "mime_types": mimes, "extensions": exts,
             "max_bytes": max_bytes, "max_pixels": max_pixels, "storage_backend": "local"}
            for kind, mimes, exts, max_bytes, max_pixels in SEED
        ],
    )


def downgrade() -> None:
    op.drop_table("icms_upload_policy")
