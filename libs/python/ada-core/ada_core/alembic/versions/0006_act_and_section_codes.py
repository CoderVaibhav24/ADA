"""act and section code values — UP Urban Planning and Development Act, 1973

`icms_code_value` has had an `act` domain and a `section` domain since the
baseline and neither has ever had a row. The consequence is not abstract: the
findings screen's legal citation control is inert, and `notice_required` can be
set on an inspection with no act to name. Six rows close it — one act, five
sections, each section hung off the act by `parent_code`.

Not an edit to 0001. That revision is applied to databases already, and a seed
that changes underneath an applied revision is one nobody can reason about. The
inserts here are `ON CONFLICT (domain, code) DO NOTHING`, so this applies
cleanly to a database that already holds the baseline's seventeen rows and to
one where an operator has added an act by hand.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-23

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from ada_core.migrate import CodeValueSeed

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACT = "up_upda_1973"

TABLE = sa.table(
    "icms_code_value",
    sa.column("domain", sa.String),
    sa.column("code", sa.String),
    sa.column("label", sa.Text),
    sa.column("label_hi", sa.Text),
    sa.column("parent_code", sa.String),
    sa.column("sort_order", sa.SmallInteger),
)


# One section of the Act, hung off it by parent_code.
def _section(code: str, order: int, label: str, label_hi: str) -> CodeValueSeed:
    return CodeValueSeed("section", code, label, order, label_hi, ACT)


# Provisional, in the same sense as 0001's SEED and for a heavier reason.
#
# ADA is the Agra Development Authority and its enforcement runs under the Uttar
# Pradesh Urban Planning and Development Act, 1973. The five sections below were
# checked on 2026-09-23 against indiacode.nic.in and Indian Kanoon rather than
# recalled, and this is what the Act provides:
#
#   14    permission for development — the sanction everything downstream turns
#         on, and its absence is the offence
#   26    notice and a reasonable opportunity to show cause before demolition
#   27    order for removal of unauthorised development by demolition, filling
#         or otherwise, with a compliance period of not less than 15 and not
#         more than 40 days from delivery of the order
#   28    order requiring development to be discontinued, effective from the
#         date of service
#   28-A  power to seal unauthorised development, before or after an order
#         under 27 or 28
#
# What is NOT settled is which of them ADA actually issues under, in which
# combination, and under what local wording — tracker blocker B3. A notice
# citing the wrong section is a defective legal instrument rather than a
# cosmetic error, so these rows exist to make the citation control work and are
# to be confirmed, corrected or replaced by ADA before a real notice is
# generated.
#
# The Hindi follows the convention set by 0003's role labels and
# apps/web/src/i18n/hi.ts — plain translation, transliterating what is a name
# rather than translating it. None of it has a counterpart in ADA's own wording,
# so every `label_hi` below is a GUESS in the sense hi.ts uses the word and
# wants the same reviewer as the section list itself.
SEED = [
    CodeValueSeed(
        "act", ACT,
        "Uttar Pradesh Urban Planning and Development Act, 1973", 1,
        "उत्तर प्रदेश नगर योजना एवं विकास अधिनियम, 1973",
    ),
    _section("sec_14", 1,
             "Section 14 — permission for development",
             "धारा 14 — विकास की अनुमति"),
    _section("sec_26", 2,
             "Section 26 — notice to show cause before demolition",
             "धारा 26 — ध्वस्तीकरण से पूर्व कारण बताओ सूचना"),
    _section("sec_27", 3,
             "Section 27 — order for removal of unauthorised development",
             "धारा 27 — अनधिकृत विकास हटाने का आदेश"),
    _section("sec_28", 4,
             "Section 28 — order to discontinue development",
             "धारा 28 — विकास रोकने का आदेश"),
    _section("sec_28a", 5,
             "Section 28-A — power to seal unauthorised development",
             "धारा 28-क — अनधिकृत विकास को सील करने की शक्ति"),
]


def upgrade() -> None:
    # One statement per row rather than one bulk insert: these go into a table
    # that already holds rows, and ON CONFLICT is what makes a re-run against a
    # database somebody has hand-seeded a no-op instead of a failure.
    for row in SEED:
        op.execute(
            postgresql.insert(TABLE)
            .values(**row._asdict())
            .on_conflict_do_nothing(index_elements=["domain", "code"])
        )


def downgrade() -> None:
    # The six codes this revision states, matched one at a time: a delete over
    # the whole `act` and `section` domains would take rows ADA added beside
    # them.
    for row in SEED:
        op.execute(
            TABLE.delete().where(
                sa.and_(TABLE.c.domain == row.domain, TABLE.c.code == row.code)
            )
        )
