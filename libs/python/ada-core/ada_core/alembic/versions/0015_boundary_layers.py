"""boundary layers — villages, parcels, the import log, and KML red zones

The authority's KML (docs/icms/kml-import-spec.md) carries four folders. Zones
land in `icms_zone.geom`, which the baseline already created. Villages and
parcels get their own tables here. Reserved features become `red_zones` rows
with no project and `source = 'kml'`, so the change-detection worker applies
them to every analysis. `icms_boundary_import` records each import.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from ada_core.types import Geometry

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "icms_village",
        sa.Column("village_lgd", sa.String(length=12), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("name_hi", sa.Text(), nullable=True),
        sa.Column("tehsil", sa.Text(), nullable=True),
        sa.Column("district_lgd", sa.String(length=12), nullable=True),
        sa.Column("geom", Geometry("MultiPolygon", srid=4326), nullable=False),
        sa.Column("attributes", JSON, nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("village_lgd"),
    )
    op.create_index("ix_icms_village_geom", "icms_village", ["geom"], unique=False,
                    postgresql_using="gist")

    op.create_table(
        "icms_parcel",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("village_lgd", sa.String(length=12), nullable=False),
        sa.Column("khasra_no", sa.String(length=24), nullable=False),
        sa.Column("ulpin", sa.String(length=14), nullable=True),
        sa.Column("land_use", sa.Text(), nullable=True),
        sa.Column("owner_name", sa.Text(), nullable=True),
        sa.Column("area_sqm", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("geom", Geometry("MultiPolygon", srid=4326), nullable=False),
        sa.Column("attributes", JSON, nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("ulpin IS NULL OR length(ulpin) = 14",
                           name="icms_parcel_ulpin_ck"),
        sa.CheckConstraint("area_sqm IS NULL OR area_sqm >= 0", name="icms_parcel_area_ck"),
        sa.ForeignKeyConstraint(["village_lgd"], ["icms_village.village_lgd"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("village_lgd", "khasra_no", name="uq_icms_parcel_village_khasra"),
    )
    op.create_index("ix_icms_parcel_geom", "icms_parcel", ["geom"], unique=False,
                    postgresql_using="gist")
    op.create_index("ix_icms_parcel_ulpin", "icms_parcel", ["ulpin"], unique=False,
                    postgresql_where=sa.text("ulpin IS NOT NULL"))

    op.create_table(
        "icms_boundary_import",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("imported_by", sa.String(length=64), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("counts", JSON, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_icms_boundary_import_at", "icms_boundary_import", ["imported_at"],
                    unique=False)

    op.alter_column("red_zones", "project_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("red_zones", sa.Column("source", sa.String(length=10),
                                         server_default=sa.text("'drawn'"), nullable=False))
    op.add_column("red_zones", sa.Column("feature_type", sa.String(length=20), nullable=True))
    op.add_column("red_zones", sa.Column("source_ref", sa.Text(), nullable=True))
    op.add_column("red_zones", sa.Column("import_key", sa.String(length=300), nullable=True))
    op.add_column("red_zones", sa.Column("attributes", JSON, nullable=True))
    op.add_column("red_zones", sa.Column("active", sa.Boolean(),
                                         server_default=sa.text("true"), nullable=False))
    op.create_check_constraint("red_zones_source_ck", "red_zones",
                               "source IN ('drawn', 'kml')")
    op.create_check_constraint("red_zones_project_ck", "red_zones",
                               "project_id IS NOT NULL OR source = 'kml'")
    op.create_index("uq_red_zones_import_key", "red_zones", ["import_key"], unique=True,
                    postgresql_where=sa.text("import_key IS NOT NULL"))


def downgrade() -> None:
    # KML red zones have no project; the NOT NULL cannot come back while they exist.
    op.execute("DELETE FROM red_zones WHERE project_id IS NULL")
    op.drop_index("uq_red_zones_import_key", table_name="red_zones")
    op.drop_constraint("red_zones_project_ck", "red_zones", type_="check")
    op.drop_constraint("red_zones_source_ck", "red_zones", type_="check")
    op.drop_column("red_zones", "active")
    op.drop_column("red_zones", "attributes")
    op.drop_column("red_zones", "import_key")
    op.drop_column("red_zones", "source_ref")
    op.drop_column("red_zones", "feature_type")
    op.drop_column("red_zones", "source")
    op.alter_column("red_zones", "project_id", existing_type=sa.Integer(), nullable=False)

    op.drop_index("ix_icms_boundary_import_at", table_name="icms_boundary_import")
    op.drop_table("icms_boundary_import")
    op.drop_index("ix_icms_parcel_ulpin", table_name="icms_parcel")
    op.drop_index("ix_icms_parcel_geom", table_name="icms_parcel")
    op.drop_table("icms_parcel")
    op.drop_index("ix_icms_village_geom", table_name="icms_village")
    op.drop_table("icms_village")
