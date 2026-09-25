"""analysis_parcel_result: built area per cadastral parcel, per analysis run

The ml-worker parcel stage measures, for every active `icms_parcel` under the
scene, the built area in each epoch, a tolerance verdict against the sanctioned
area, and a change class from the bias-corrected difference. One row per
(analysis, parcel); a re-run of the analysis replaces its rows.

Revision ID: 0024_analysis_parcel_result
Revises: 0023_findings_stage
Create Date: 2026-09-25

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_analysis_parcel_result"
down_revision: str | None = "0023_findings_stage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VERDICTS = ("over_tolerance", "within_tolerance", "vacant", "insufficient_imagery",
            "not_assessable")
CHANGE_CLASSES = ("new_build", "extension", "demolition", "unchanged", "unassessable")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "analysis_parcel_result",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("parcel_id", sa.BigInteger(), nullable=False),
        sa.Column("parcel_key", sa.Text(), nullable=True),
        sa.Column("sanctioned_area_sqm", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("parcel_area_sqm", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("tolerance_frac", sa.Float(), nullable=False),
        sa.Column("imagery_frac_t1", sa.Float(), nullable=False),
        sa.Column("imagery_frac_t2", sa.Float(), nullable=False),
        sa.Column("built_frac_t1", sa.Float(), nullable=False),
        sa.Column("built_frac_t2", sa.Float(), nullable=False),
        sa.Column("built_sqm_t1", sa.Float(), nullable=False),
        sa.Column("built_sqm_t2", sa.Float(), nullable=False),
        sa.Column("delta_sqm", sa.Float(), nullable=True),
        sa.Column("delta_sqm_corrected", sa.Float(), nullable=True),
        sa.Column("verdict_t1", sa.String(length=24), nullable=False),
        sa.Column("verdict_t2", sa.String(length=24), nullable=False),
        sa.Column("change_class", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(_in("verdict_t1", VERDICTS),
                           name="analysis_parcel_result_verdict_t1_ck"),
        sa.CheckConstraint(_in("verdict_t2", VERDICTS),
                           name="analysis_parcel_result_verdict_t2_ck"),
        sa.CheckConstraint(_in("change_class", CHANGE_CLASSES),
                           name="analysis_parcel_result_change_class_ck"),
        sa.ForeignKeyConstraint(["job_id"], ["analysis_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parcel_id"], ["icms_parcel.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "parcel_id", name="uq_analysis_parcel_result_job_parcel"),
    )
    op.create_index("ix_analysis_parcel_result_job_id", "analysis_parcel_result", ["job_id"],
                    unique=False)
    op.create_index("ix_analysis_parcel_result_parcel_id", "analysis_parcel_result",
                    ["parcel_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_analysis_parcel_result_parcel_id", table_name="analysis_parcel_result")
    op.drop_index("ix_analysis_parcel_result_job_id", table_name="analysis_parcel_result")
    op.drop_table("analysis_parcel_result")
