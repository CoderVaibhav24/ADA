"""inspection findings — construction stage, length × width, and where they came from

Decision 2026-09-25: a round records how far the construction had got and the
encroachment's length and width, all optional. It also records which client
last saved the findings (`findings_source`, from the token's `azp`), because a
round filled from the web portal is not held to the notice-citation and owner
rules a surveyor on site is (docs/icms/inspection-findings-fields.md).

`construction_stage` is a code domain rather than a CHECK, as `area_type` is, so
ADA can correct it without a release. Each `label_hi` is a GUESS awaiting the
same reviewer as apps/web/src/i18n/hi.ts.

Revision ID: 0023_findings_stage
Revises: 0022_case_outcome
Create Date: 2026-09-25

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from ada_core.migrate import CodeValueSeed

revision: str = "0023_findings_stage"
down_revision: str | None = "0022_case_outcome"
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

SEED = [
    CodeValueSeed("construction_stage", code, label, order, label_hi)
    for order, (code, label, label_hi) in enumerate([
        ("foundation_plinth", "Foundation / Plinth", "नींव / कुर्सी"),
        ("under_construction", "Under Construction", "निर्माणाधीन"),
        ("structure_complete", "Structure Complete", "ढाँचा पूरा"),
        ("finishing", "Finishing", "फिनिशिंग का काम"),
        ("completed_occupied", "Completed – Occupied", "पूरा - कब्ज़े में"),
        ("completed_vacant", "Completed – Vacant", "पूरा - खाली"),
    ], start=1)
]

CHECKS = [
    ("icms_inspection_length_ck", "length_m > 0 AND length_m <= 10000"),
    ("icms_inspection_width_ck", "width_m > 0 AND width_m <= 10000"),
    ("icms_inspection_findings_source_ck", "findings_source IN ('field', 'web')"),
]


def upgrade() -> None:
    op.add_column("icms_inspection",
                  sa.Column("construction_stage_cd", sa.String(40), nullable=True))
    op.add_column("icms_inspection", sa.Column("length_m", sa.Numeric(8, 2), nullable=True))
    op.add_column("icms_inspection", sa.Column("width_m", sa.Numeric(8, 2), nullable=True))
    op.add_column("icms_inspection",
                  sa.Column("findings_source", sa.String(10), nullable=True))
    for name, condition in CHECKS:
        op.create_check_constraint(name, "icms_inspection", condition)

    # One statement per row: offline mode cannot render an executemany list.
    for row in SEED:
        op.execute(
            postgresql.insert(TABLE)
            .values(**row._asdict())
            .on_conflict_do_nothing(index_elements=["domain", "code"])
        )


def downgrade() -> None:
    for row in SEED:
        op.execute(TABLE.delete().where(
            sa.and_(TABLE.c.domain == row.domain, TABLE.c.code == row.code)))
    for name, _ in reversed(CHECKS):
        op.drop_constraint(name, "icms_inspection", type_="check")
    for column in ("findings_source", "width_m", "length_m", "construction_stage_cd"):
        op.drop_column("icms_inspection", column)
