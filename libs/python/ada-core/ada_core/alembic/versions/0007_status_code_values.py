"""status code values — case_status, inspection_status, resurvey_decision

Three domains `icms_code_value` has carried since the baseline with no rows in
them. The consequence is the same on both clients: a register renders
`under_inspection` and a field app renders `in_progress`, because the only thing
either has to show is the code the API sent. `0005_app_screen.py` already asks
for `{{item.status|label:case_status}}`, which resolves to nothing today.

Unlike 0006's act and section rows, none of this is law. These are OUR OWN
vocabularies and each already has exactly one source of truth in code:

  case_status        `Status` in services/api/app/icms/workflow.py — eleven
                     members. `icms_case.status` is written from a transition's
                     `target`, and `icms_case_status_ck` admits the same eleven.
  inspection_status  the five values the inspection repository writes
                     (`SCHEDULED, IN_PROGRESS, SUBMITTED, ACCEPTED, REJECTED` in
                     app/icms/inspections.py), which are also what
                     `icms_inspection_status_ck` admits.
  resurvey_decision  `icms_resurvey_decision_ck` on `icms_resurvey_request` —
                     pending, approved, rejected.

So the codes below are transcribed, not chosen. A code here that no enum or
CHECK constraint holds would be a label for a state the system cannot reach.

The LABELS are transcribed too, from `apps/web/src/i18n/en.ts` and `hi.ts`,
which already carry all three vocabularies in both languages (`caseStatus`,
`inspectionStatus`, `resurveyDecision`). Taking them from there rather than
composing new ones is the point: the portal renders its own bundle, the field
app renders what this table serves, and the two must say the same thing about
the same case. Two wordings for `inspection_submitted` is a defect an officer
reports as "the two screens disagree".

Two labels read oddly beside their code and are deliberate rather than typos:
`assigned` is "Pending Inspection" — what an officer is waiting for, not what an
administrator did — and `inspection_status.rejected` is "Sent Back", because a
rejected round is returned for another round rather than thrown away.

Every `label_hi` is a GUESS in the sense `hi.ts` uses the word: it follows the
convention set by 0003's role labels, none of it has an ADA counterpart, and it
wants the same reviewer as the rest of that bundle.

Not an edit to 0001, for the reason 0006 gives: that revision is applied to
databases already. The inserts are `ON CONFLICT (domain, code) DO NOTHING`.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-23

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from ada_core.migrate import CodeValueSeed

revision: str = "0007"
down_revision: str | None = "0006"
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


# `sort_order` is the workflow's own order, so a status facet lists the stages in
# the sequence a case passes through rather than alphabetically.
def _values(domain: str, rows: list[tuple[str, str, str]]) -> list[CodeValueSeed]:
    return [
        CodeValueSeed(domain, code, label, order, label_hi)
        for order, (code, label, label_hi) in enumerate(rows, start=1)
    ]


# The eleven members of `Status`, in workflow order. `rejected` is last because
# it is terminal and reachable from stages 1 and 2 rather than a stage of its own.
CASE_STATUS = _values("case_status", [
    ("raised", "Complaint Filed", "शिकायत दर्ज"),
    ("assigned", "Pending Inspection", "निरीक्षण लंबित"),
    ("under_inspection", "Under Inspection", "निरीक्षण जारी"),
    ("inspection_submitted", "Inspection Submitted", "निरीक्षण प्रस्तुत"),
    ("resurvey_requested", "Resurvey Requested", "पुनः सर्वेक्षण अपेक्षित"),
    ("verified", "Verified", "सत्यापित"),
    ("handed_over", "Handed Over", "हस्तांतरित"),
    ("confirmed", "Confirmed", "पुष्ट"),
    ("notice_issued", "Notice Issued", "नोटिस जारी"),
    ("closed", "Closed", "बंद"),
    ("rejected", "Rejected", "अस्वीकृत"),
])

# The life of one round: scheduled when opened, in_progress at the first field
# activity, submitted by the surveyor, then accepted or sent back at verification.
INSPECTION_STATUS = _values("inspection_status", [
    ("scheduled", "Scheduled", "निर्धारित"),
    ("in_progress", "In Progress", "प्रगति पर"),
    ("submitted", "Submitted", "प्रस्तुत"),
    ("accepted", "Accepted", "स्वीकृत"),
    ("rejected", "Sent Back", "वापस भेजा गया"),
])

# `pending` is the row's resting state, and `uq_icms_resurvey_pending` allows
# exactly one of them per case.
RESURVEY_DECISION = _values("resurvey_decision", [
    ("pending", "Awaiting decision", "निर्णय प्रतीक्षित"),
    ("approved", "Approved", "स्वीकृत"),
    ("rejected", "Refused", "अस्वीकृत"),
])

SEED = [*CASE_STATUS, *INSPECTION_STATUS, *RESURVEY_DECISION]


def upgrade() -> None:
    # One statement per row rather than one bulk insert: offline mode has no bind
    # and renders an executemany parameter list as a single all-NULL VALUES,
    # which is runnable SQL that inserts nothing real.
    for row in SEED:
        op.execute(
            postgresql.insert(TABLE)
            .values(**row._asdict())
            .on_conflict_do_nothing(index_elements=["domain", "code"])
        )


def downgrade() -> None:
    # Matched one at a time: a delete over the three domains would take rows ADA
    # added beside them.
    for row in SEED:
        op.execute(
            TABLE.delete().where(
                sa.and_(TABLE.c.domain == row.domain, TABLE.c.code == row.code)
            )
        )
