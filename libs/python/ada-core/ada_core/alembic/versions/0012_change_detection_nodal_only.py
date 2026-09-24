"""change detection belongs to the PCS Nodal Officer

Decision of 2026-09-24: only the PCS Nodal Officer works the Change Detection
screen and runs analyses. Who may do so is a grant, not a role check, so this
revision only revokes the default grants the other roles were seeded with.
An administrator can hand any of them back from Administration > Roles.

  change_detection.access   nodal officer only
  imagery.run               nodal officer only (POST /projects/{id}/analyses)
  imagery.write             nodal officer only
  imagery.export            nodal officer only

`imagery.read` stays as 0008 granted it.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS: list[tuple[str, str, str, str]] = []
GRANTS: dict[str, list[str]] = {}

REVOKES = {
    "super-admin": [
        "change_detection.access", "imagery.run", "imagery.write", "imagery.export",
    ],
    "ada-project-lead": [
        "change_detection.access", "imagery.run", "imagery.write", "imagery.export",
    ],
    "field-surveyor": ["change_detection.access", "imagery.export"],
}

ROLE_PERMISSION = sa.table(
    "icms_role_permission",
    sa.column("role_cd", sa.String),
    sa.column("permission_cd", sa.String),
)


def upgrade() -> None:
    for role_cd, codes in REVOKES.items():
        op.execute(
            ROLE_PERMISSION.delete().where(
                ROLE_PERMISSION.c.role_cd == role_cd,
                ROLE_PERMISSION.c.permission_cd.in_(codes),
            )
        )
    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")


def downgrade() -> None:
    # One statement per row: offline mode renders an executemany list as NULLs.
    for role_cd, codes in REVOKES.items():
        for code in codes:
            op.execute(
                postgresql.insert(ROLE_PERMISSION)
                .values(role_cd=role_cd, permission_cd=code)
                .on_conflict_do_nothing()
            )
    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")
