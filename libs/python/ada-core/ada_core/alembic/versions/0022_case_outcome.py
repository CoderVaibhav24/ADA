"""case outcome — why a case was rejected or how it was closed

Adds the outcome columns the reject and close actions write
(POST /api/icms/cases/{ref}/reject and /close) and seeds their two vocabularies.
`closed_at` already exists on icms_case and is stamped by both endings.

Revision ID: 0022_case_outcome
Revises: 0021_reminder_settings
Create Date: 2026-09-25

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from ada_core.migrate import CodeValueSeed

revision: str = "0022_case_outcome"
down_revision: str | None = "0021_reminder_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = sa.table(
    "icms_code_value",
    sa.column("domain", sa.String),
    sa.column("code", sa.String),
    sa.column("label", sa.Text),
    sa.column("label_hi", sa.Text),
    sa.column("parent_code", sa.String),
    sa.column("sort_order", sa.SmallInteger),
)


def _values(domain: str, rows: list[tuple[str, str, str]]) -> list[CodeValueSeed]:
    return [
        CodeValueSeed(domain, code, label, order, label_hi)
        for order, (code, label, label_hi) in enumerate(rows, start=1)
    ]


REJECT_REASON = _values("case_reject_reason", [
    ("false_complaint", "False complaint", "झूठी शिकायत"),
    ("duplicate", "Duplicate complaint", "दोहरी शिकायत"),
    ("outside_jurisdiction", "Outside jurisdiction", "अधिकार क्षेत्र से बाहर"),
    ("no_violation_found", "No violation found", "कोई उल्लंघन नहीं पाया गया"),
    ("other", "Other", "अन्य"),
])

CLOSE_OUTCOME = _values("case_close_outcome", [
    ("demolished_by_owner", "Demolished by owner", "स्वामी द्वारा ध्वस्त"),
    ("demolished_by_authority", "Demolished by authority", "प्राधिकरण द्वारा ध्वस्त"),
    ("regularised", "Regularised", "नियमितीकृत"),
    ("court_case_filed", "Court case filed", "न्यायालय में वाद दायर"),
    ("sealed", "Sealed", "सील किया गया"),
    ("other", "Other", "अन्य"),
])

SEED = [*REJECT_REASON, *CLOSE_OUTCOME]


def upgrade() -> None:
    op.add_column("icms_case", sa.Column("outcome_cd", sa.String(40), nullable=True))
    op.add_column("icms_case", sa.Column("outcome_reason", sa.Text(), nullable=True))
    op.add_column("icms_case", sa.Column("closed_by", sa.String(64), nullable=True))
    for row in SEED:
        op.execute(
            postgresql.insert(TABLE)
            .values(**row._asdict())
            .on_conflict_do_nothing(index_elements=["domain", "code"])
        )


def downgrade() -> None:
    for row in SEED:
        op.execute(
            TABLE.delete().where(
                sa.and_(TABLE.c.domain == row.domain, TABLE.c.code == row.code)
            )
        )
    op.drop_column("icms_case", "closed_by")
    op.drop_column("icms_case", "outcome_reason")
    op.drop_column("icms_case", "outcome_cd")
