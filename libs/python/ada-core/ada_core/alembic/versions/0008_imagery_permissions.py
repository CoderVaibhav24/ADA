"""imagery permissions — imagery.read, imagery.write

The change-detection routers (projects, rasters, redzones, analysis, tiles)
admitted any authenticated realm subject. They now require `imagery.read` for
GET and `imagery.write` for everything else, granted as follows:

  super-admin, pcs-nodal-officer, ada-project-lead   read + write
  field-surveyor                                     read
  public                                             nothing

Not an edit to 0003, which is applied to databases already. Every insert is
`ON CONFLICT DO NOTHING`, so a database where an operator already granted one of
these by hand is left as it is. The policy revision is bumped so running workers
reload their snapshot.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-23

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS = [
    ("imagery.read",  "imagery", "read",  "Read change-detection projects, rasters and results"),
    ("imagery.write", "imagery", "write", "Create and change change-detection projects and runs"),
]

GRANTS = {
    "super-admin": ["imagery.read", "imagery.write"],
    "pcs-nodal-officer": ["imagery.read", "imagery.write"],
    "ada-project-lead": ["imagery.read", "imagery.write"],
    "field-surveyor": ["imagery.read"],
}

PERMISSION = sa.table(
    "icms_permission",
    sa.column("permission_cd", sa.String),
    sa.column("resource", sa.String),
    sa.column("action", sa.String),
    sa.column("label", sa.Text),
    sa.column("is_system", sa.Boolean),
)

ROLE_PERMISSION = sa.table(
    "icms_role_permission",
    sa.column("role_cd", sa.String),
    sa.column("permission_cd", sa.String),
)


def upgrade() -> None:
    # One statement per row: offline mode renders an executemany list as NULLs.
    for cd, resource, action, label in PERMISSIONS:
        op.execute(
            postgresql.insert(PERMISSION)
            .values(permission_cd=cd, resource=resource, action=action,
                    label=label, is_system=True)
            .on_conflict_do_nothing()
        )
    for role_cd, codes in GRANTS.items():
        for code in codes:
            op.execute(
                postgresql.insert(ROLE_PERMISSION)
                .values(role_cd=role_cd, permission_cd=code)
                .on_conflict_do_nothing()
            )
    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")


def downgrade() -> None:
    codes = [cd for cd, *_ in PERMISSIONS]
    op.execute(ROLE_PERMISSION.delete().where(ROLE_PERMISSION.c.permission_cd.in_(codes)))
    op.execute(PERMISSION.delete().where(PERMISSION.c.permission_cd.in_(codes)))
    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")
