"""icms_permission.screen_cd — which screen a permission belongs to

The Roles tab groups permissions by screen: a screen's `*.access` code first,
then every action taken on that screen. The grouping lives here, in the row,
so a new permission is placed by data and not by a table in the portal.
`screen_cd` is the resource of the screen's `*.access` code. NULL means the
permission is shared by several screens (reference data, zone geometry).

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCREENS = {
    "dashboard": ["dashboard.access", "dashboard.read"],
    "change_detection": [
        "change_detection.access", "imagery.read", "imagery.write", "imagery.run",
        "imagery.export",
    ],
    "complaint_create": ["complaint_create.access", "case.raise"],
    "complaints": [
        "complaints.access", "case.read", "case.export", "case.assign", "case.reassign",
        "case.reject", "case.amend", "case.hand_over", "case.confirm", "case.close",
        "evidence.read",
    ],
    "inspections": [
        "inspections.access", "inspection.read", "inspection.export",
        "inspection.open_round", "inspection.check_in", "inspection.record_findings",
        "inspection.submit", "inspection.verify", "inspection.request_resurvey",
        "evidence.write",
    ],
    "notices": [
        "notices.access", "notice.read", "notice.export", "notice.issue", "notice.download",
    ],
    "reports": ["reports.access", "report.read", "report.export"],
    "administration": ["administration.access", "policy.read", "policy.manage"],
    "officers": [
        "officers.access", "user.read", "user.create", "user.update", "user.roles",
        "user.password", "user.disable", "user.manage", "zone.manage",
        "zone_assignment.read", "zone_assignment.manage",
    ],
}

PERMISSION = sa.table(
    "icms_permission",
    sa.column("permission_cd", sa.String),
    sa.column("screen_cd", sa.String),
)


def upgrade() -> None:
    op.add_column("icms_permission", sa.Column("screen_cd", sa.String(40), nullable=True))
    for screen_cd, codes in SCREENS.items():
        op.execute(
            PERMISSION.update()
            .where(PERMISSION.c.permission_cd.in_(codes))
            .values(screen_cd=screen_cd)
        )
    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")


def downgrade() -> None:
    op.drop_column("icms_permission", "screen_cd")
    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")
