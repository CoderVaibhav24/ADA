"""inspection property facts — property type, floors and police station

Decision 2026-09-24: who holds a property is established on site by the
surveyor, not typed in at complaint creation. The round already carried
`occupant_name` / `occupant_phone`; it now also carries the property type, the
number of floors and the police station, under the same names `icms_case` uses.
All nullable: every earlier round has none of them, and none is required at
submit.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FLOORS_CHECK = "icms_inspection_floor_count_ck"


def upgrade() -> None:
    op.add_column("icms_inspection",
                  sa.Column("property_type_cd", sa.String(40), nullable=True))
    op.add_column("icms_inspection",
                  sa.Column("floor_count", sa.SmallInteger(), nullable=True))
    op.add_column("icms_inspection", sa.Column("police_station", sa.Text(), nullable=True))
    op.create_check_constraint(
        FLOORS_CHECK, "icms_inspection", "floor_count BETWEEN 0 AND 200")


def downgrade() -> None:
    op.drop_constraint(FLOORS_CHECK, "icms_inspection", type_="check")
    op.drop_column("icms_inspection", "police_station")
    op.drop_column("icms_inspection", "floor_count")
    op.drop_column("icms_inspection", "property_type_cd")
