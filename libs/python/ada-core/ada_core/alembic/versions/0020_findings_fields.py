"""inspection findings — the owner, beside the occupant

The legacy `inspection` row carried `owner_name` and `owner_mobile`; ADA's round
carried only `occupant_name` / `occupant_phone`, and the field form labelled one
pair "Owner / Occupant", so whichever the surveyor meant was lost. The person
who holds the property and the person found on site are different people on
most encroachments. Both nullable: no earlier round has an owner, and the owner
is required only when an owner's phone is given (docs/icms/inspection-findings-fields.md).

Revision ID: 0020_findings_fields
Revises: 0019_evidence_stamp
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_findings_fields"
down_revision: str | None = "0019_evidence_stamp"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("icms_inspection", sa.Column("owner_name", sa.Text(), nullable=True))
    op.add_column("icms_inspection", sa.Column("owner_phone", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("icms_inspection", "owner_phone")
    op.drop_column("icms_inspection", "owner_name")
