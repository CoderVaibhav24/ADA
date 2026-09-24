"""scheme plots — parcels keyed by sector + plot number as well as village + khasra

A development authority's parcel layer is scheme plots (sector, plot number),
not revenue khasras. `icms_parcel` now takes either key: `village_lgd` and
`khasra_no` become nullable, the scheme columns are added, the single unique
constraint becomes one partial unique index per key, and a check requires one
complete key on every row. `icms_boundary_import` gains the importer's display
name. docs/icms/kml-import.md has the rules.

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REVENUE_KEY = "village_lgd IS NOT NULL AND khasra_no IS NOT NULL"
SCHEME_KEY = "sector IS NOT NULL AND plot_no IS NOT NULL"


def upgrade() -> None:
    op.alter_column("icms_parcel", "village_lgd", existing_type=sa.String(length=12),
                    nullable=True)
    op.alter_column("icms_parcel", "khasra_no", existing_type=sa.String(length=24),
                    nullable=True)
    op.add_column("icms_parcel", sa.Column("sector", sa.String(length=40), nullable=True))
    op.add_column("icms_parcel", sa.Column("sector_name", sa.Text(), nullable=True))
    op.add_column("icms_parcel", sa.Column("plot_no", sa.String(length=40), nullable=True))
    op.add_column("icms_parcel", sa.Column("plot_type", sa.Text(), nullable=True))
    op.add_column("icms_parcel", sa.Column("tenure", sa.Text(), nullable=True))
    op.add_column("icms_parcel", sa.Column("registration_no", sa.Text(), nullable=True))
    op.add_column("icms_parcel", sa.Column("sanctioned_area_sqm",
                                           sa.Numeric(precision=14, scale=2), nullable=True))

    op.drop_constraint("uq_icms_parcel_village_khasra", "icms_parcel", type_="unique")
    op.create_index("uq_icms_parcel_village_khasra", "icms_parcel",
                    ["village_lgd", "khasra_no"], unique=True,
                    postgresql_where=sa.text(REVENUE_KEY))
    op.create_index("uq_icms_parcel_sector_plot", "icms_parcel", ["sector", "plot_no"],
                    unique=True, postgresql_where=sa.text(SCHEME_KEY))
    op.create_check_constraint("icms_parcel_key_ck", "icms_parcel",
                               f"({REVENUE_KEY}) OR ({SCHEME_KEY})")
    op.create_check_constraint("icms_parcel_sanctioned_area_ck", "icms_parcel",
                               "sanctioned_area_sqm IS NULL OR sanctioned_area_sqm >= 0")

    op.add_column("icms_boundary_import",
                  sa.Column("imported_by_name", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("icms_boundary_import", "imported_by_name")

    # Scheme plots have no khasra; the NOT NULLs cannot come back while they exist.
    op.execute("DELETE FROM icms_parcel WHERE village_lgd IS NULL OR khasra_no IS NULL")
    op.drop_constraint("icms_parcel_sanctioned_area_ck", "icms_parcel", type_="check")
    op.drop_constraint("icms_parcel_key_ck", "icms_parcel", type_="check")
    op.drop_index("uq_icms_parcel_sector_plot", table_name="icms_parcel")
    op.drop_index("uq_icms_parcel_village_khasra", table_name="icms_parcel")
    op.create_unique_constraint("uq_icms_parcel_village_khasra", "icms_parcel",
                                ["village_lgd", "khasra_no"])
    op.drop_column("icms_parcel", "sanctioned_area_sqm")
    op.drop_column("icms_parcel", "registration_no")
    op.drop_column("icms_parcel", "tenure")
    op.drop_column("icms_parcel", "plot_type")
    op.drop_column("icms_parcel", "plot_no")
    op.drop_column("icms_parcel", "sector_name")
    op.drop_column("icms_parcel", "sector")
    op.alter_column("icms_parcel", "khasra_no", existing_type=sa.String(length=24),
                    nullable=False)
    op.alter_column("icms_parcel", "village_lgd", existing_type=sa.String(length=12),
                    nullable=False)
