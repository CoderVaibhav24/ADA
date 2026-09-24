"""inspection answers — encroachment confirmed, external support, recommendation

The web inspection form (Figma 48:5195 / 60:641) asks the surveyor three closed
questions that no column held: whether the encroachment is confirmed (63:1054),
what outside help the case needs (63:1087, single select) and what the office
should do next (63:983). They land on `icms_inspection` as three nullable code
columns, each held to its vocabulary by a CHECK. Nullable because every round
written before this revision has none of them; the rules that make them
required are enforced at submit, in app/icms/inspection_rules.py.

`area_type` gets the six Construction / Occupation Type options of 63:1026. The
three provisional codes from 0001 are marked inactive rather than deleted, so a
round that already carries one still resolves to a label.

Every code value the field app shows now has a `label_hi`. As with 0007, each
Hindi label is a GUESS awaiting the same reviewer as apps/web/src/i18n/hi.ts.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-24

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from ada_core.migrate import CodeValueSeed

revision: str = "0011"
down_revision: str | None = "0010"
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
    sa.column("active", sa.Boolean),
)


def _values(domain: str, rows: list[tuple[str, str, str]]) -> list[CodeValueSeed]:
    return [
        CodeValueSeed(domain, code, label, order, label_hi)
        for order, (code, label, label_hi) in enumerate(rows, start=1)
    ]


# Restated as literals so this revision keeps meaning the same thing after the
# tuples in ada_core.models_icms move on. Order is the Figma list's order.
ENCROACHMENT = _values("encroachment_confirmed", [
    ("yes", "Yes – Confirmed", "हाँ - पक्का कब्ज़ा"),
    ("partial", "Partial – Further Review Needed", "थोड़ा - और जाँच चाहिए"),
    ("no_false_positive", "No – False Positive", "नहीं - गलत सूचना"),
])
EXTERNAL_SUPPORT = _values("external_support", [
    ("none", "None", "कोई नहीं"),
    ("police", "Police Assistance", "पुलिस की मदद"),
    ("survey_dept", "Survey Department", "सर्वे विभाग"),
    ("legal", "Legal Team", "कानूनी टीम"),
])
RECOMMENDATION = _values("recommendation", [
    ("issue_notice", "Issue Notice to Vacate", "जगह खाली करने का नोटिस दें"),
    ("file_legal_case", "File Legal Case", "कानूनी केस करें"),
    ("demolition_order", "Demolition Order", "तोड़ने का आदेश"),
    ("further_investigation", "Further Investigation", "और जाँच करें"),
    ("no_action_required", "No Action Required (False Positive)",
     "कोई कार्रवाई नहीं (गलत सूचना)"),
    ("impose_fine", "Impose Fine / Penalty", "जुर्माना लगाएँ"),
])
# Sorted after the three legacy rows (1-3) so an unfiltered list keeps them apart.
AREA_TYPE = [
    CodeValueSeed("area_type", code, label, order, label_hi)
    for order, (code, label, label_hi) in enumerate([
        ("rcc", "Permanent Structure (RCC)", "पक्का ढाँचा (RCC)"),
        ("semi_permanent", "Semi-Permanent Structure", "आधा-पक्का ढाँचा"),
        ("shed_hutment", "Temporary Shed / Hutment", "कच्चा शेड / झोपड़ी"),
        ("agricultural", "Agricultural Occupation", "खेती के लिए कब्ज़ा"),
        ("land_levelling", "Land Levelling / Grading", "ज़मीन समतल करना"),
        ("fencing", "Fencing / Boundary Extension", "बाड़ / चारदीवारी बढ़ाना"),
    ], start=11)
]
SEED = [*ENCROACHMENT, *EXTERNAL_SUPPORT, *RECOMMENDATION, *AREA_TYPE]

LEGACY_AREA_TYPES = ("built_up", "under_construction", "vacant")

# Hindi for the 0001 rows the field app shows. Only filled where still empty, so
# a label an administrator already corrected is left alone.
HINDI = [
    ("area_type", "built_up", "निर्मित"),
    ("area_type", "under_construction", "निर्माणाधीन"),
    ("area_type", "vacant", "रिक्त"),
    ("complaint_type", "unauthorised_construction", "अनधिकृत निर्माण"),
    ("complaint_type", "deviation_from_plan", "स्वीकृत नक्शे से विचलन"),
    ("complaint_type", "encroachment", "सार्वजनिक भूमि पर अतिक्रमण"),
    ("complaint_type", "illegal_colony", "अवैध कॉलोनी विकास"),
    ("complaint_type", "other", "अन्य"),
    ("property_type", "residential", "आवासीय"),
    ("property_type", "commercial", "वाणिज्यिक"),
    ("property_type", "industrial", "औद्योगिक"),
    ("property_type", "institutional", "संस्थागत"),
    ("property_type", "vacant_land", "रिक्त भूमि"),
    ("delivery_mode", "hand", "दस्ती"),
    ("delivery_mode", "registered_post", "पंजीकृत डाक"),
    ("delivery_mode", "affixation", "स्थल पर चस्पा"),
    ("delivery_mode", "email", "ईमेल"),
]

COLUMNS = [
    ("encroachment_confirmed_cd", "icms_inspection_encroachment_ck",
     ("yes", "partial", "no_false_positive")),
    ("external_support_cd", "icms_inspection_external_support_ck",
     ("none", "police", "survey_dept", "legal")),
    ("recommendation_cd", "icms_inspection_recommendation_ck",
     ("issue_notice", "file_legal_case", "demolition_order",
      "further_investigation", "no_action_required", "impose_fine")),
]


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _row(domain: str, code: str):
    return sa.and_(TABLE.c.domain == domain, TABLE.c.code == code)


def upgrade() -> None:
    for column, check, values in COLUMNS:
        op.add_column("icms_inspection", sa.Column(column, sa.String(40), nullable=True))
        op.create_check_constraint(check, "icms_inspection", _in(column, values))

    # One statement per row: offline mode cannot render an executemany list.
    for row in SEED:
        op.execute(
            postgresql.insert(TABLE)
            .values(**row._asdict())
            .on_conflict_do_nothing(index_elements=["domain", "code"])
        )
    for code in LEGACY_AREA_TYPES:
        op.execute(TABLE.update().where(_row("area_type", code)).values(active=False))
    for domain, code, label_hi in HINDI:
        op.execute(
            TABLE.update()
            .where(sa.and_(_row(domain, code), TABLE.c.label_hi.is_(None)))
            .values(label_hi=label_hi)
        )


def downgrade() -> None:
    # The Hindi backfill is left in place: it is data 0001 had room for.
    for code in LEGACY_AREA_TYPES:
        op.execute(TABLE.update().where(_row("area_type", code)).values(active=True))
    for row in SEED:
        op.execute(TABLE.delete().where(_row(row.domain, row.code)))
    for column, check, _ in reversed(COLUMNS):
        op.drop_constraint(check, "icms_inspection", type_="check")
        op.drop_column("icms_inspection", column)
