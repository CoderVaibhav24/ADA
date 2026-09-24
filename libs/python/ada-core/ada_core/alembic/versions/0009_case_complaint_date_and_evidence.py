"""case complaint_date and case evidence — icms_case.complaint_date, complaint_photo

The Create Complaint screen asks for the date of the complaint, which may be
earlier than the day it is keyed in, and lets the officer attach photographs at
filing time, before any inspection round exists.

  icms_case.complaint_date   DATE, nullable. Existing rows are backfilled from
                             created_at's IST calendar date; the touch trigger is
                             held off for the backfill so updated_at keeps
                             meaning "last changed by a person".
  icms_evidence.caption      TEXT, nullable. The officer's one-line note.
  complaint_photo            a new evidence kind, stored with inspection_id NULL.
                             It is a separate kind rather than 'photo' because
                             icms_evidence_geotag_ck holds a 'photo' to its capture
                             fields, and a complainant's picture has none.
                             Its upload policy row admits jpeg, png and webp.

Not an edit to 0001 or 0004, which are applied to databases already.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-23

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Restated as literals so this revision keeps meaning the same thing after the
# tuples in ada_core.models_icms move on.
BEFORE = ("photo", "video", "document", "signature")
AFTER = (*BEFORE, "complaint_photo")

MB = 1024 * 1024

UPLOAD_POLICY = sa.table(
    "icms_upload_policy",
    sa.column("kind", sa.String),
    sa.column("mime_types", postgresql.ARRAY(sa.Text())),
    sa.column("extensions", postgresql.ARRAY(sa.Text())),
    sa.column("max_bytes", sa.BigInteger),
    sa.column("max_pixels", sa.BigInteger),
    sa.column("storage_backend", sa.String),
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _kind_checks(kinds: tuple[str, ...]) -> None:
    for table, name in (("icms_evidence", "icms_evidence_kind_ck"),
                        ("icms_upload_policy", "icms_upload_policy_kind_ck")):
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, _in("kind", kinds))


def upgrade() -> None:
    op.add_column("icms_case", sa.Column("complaint_date", sa.Date(), nullable=True))
    op.execute("ALTER TABLE icms_case DISABLE TRIGGER trg_icms_case_touch")
    op.execute(
        "UPDATE icms_case "
        "SET complaint_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date "
        "WHERE complaint_date IS NULL"
    )
    op.execute("ALTER TABLE icms_case ENABLE TRIGGER trg_icms_case_touch")

    op.add_column("icms_evidence", sa.Column("caption", sa.Text(), nullable=True))

    _kind_checks(AFTER)
    op.execute(
        postgresql.insert(UPLOAD_POLICY)
        .values(kind="complaint_photo",
                mime_types=["image/jpeg", "image/png", "image/webp"],
                extensions=[".jpg", ".jpeg", ".png", ".webp"],
                max_bytes=15 * MB, max_pixels=40_000_000, storage_backend="local")
        .on_conflict_do_nothing(index_elements=["kind"])
    )


def downgrade() -> None:
    op.execute(UPLOAD_POLICY.delete().where(UPLOAD_POLICY.c.kind == "complaint_photo"))
    # Refused by the constraint while any complaint_photo row exists; evidence is
    # append-only, so that downgrade is one to make by hand, deliberately.
    _kind_checks(BEFORE)
    op.drop_column("icms_evidence", "caption")
    op.drop_column("icms_case", "complaint_date")
