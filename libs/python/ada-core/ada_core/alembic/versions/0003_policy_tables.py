"""workflow transitions and RBAC, moved out of Python and into the database

Six tables: icms_role, icms_permission, icms_role_permission,
icms_workflow_transition, icms_workflow_transition_role, icms_policy_revision.
The seeds below are restated as literals rather than imported, because a
migration must keep meaning what it meant when it was written. Permissions are
`is_system`: a code is named by an endpoint in source, so one invented through
the admin UI would guard nothing. Additive — rollback is a drop of the six.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-22

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Mirrors ada_core.models_icms.CASE_STATUSES and CASE_ACTIONS. Stated as
# literals for the reason given above: this revision must not change meaning
# when those tuples do.
CASE_STATUSES = (
    "raised", "assigned", "under_inspection", "inspection_submitted",
    "resurvey_requested", "verified", "handed_over", "confirmed",
    "notice_issued", "closed", "rejected",
)
CASE_ACTIONS = (
    "raise", "assign", "reassign", "reject", "open_round", "check_in",
    "add_evidence", "record_findings", "submit", "verify_accept",
    "verify_reject", "request_resurvey", "hand_over", "confirm",
    "issue_notice", "close",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


# `requires: []` renders offline as a bare ARRAY[], which PostgreSQL refuses for
# having no type — SQL that only fails when somebody runs it. A TypeDecorator and
# not an ARRAY subclass, because the psycopg dialect adapts a plain subclass away.
class _TextArray(sa.types.TypeDecorator):
    impl = postgresql.ARRAY(sa.Text())
    cache_ok = True

    def literal_processor(self, dialect):  # type: ignore[no-untyped-def]
        render = self.impl_instance.literal_processor(dialect)
        return lambda value: f"{render(value)}::text[]"


# --- seed: roles -----------------------------------------------------------
#
# `public` is here and is not a Keycloak realm role. It is the role the workflow
# gives an unauthenticated complainant on `raise`, and it needs a row because
# icms_workflow_transition_role carries a foreign key. It grants nothing: it
# holds no permission, and no endpoint admits a caller without a token.
ROLES = [
    ("super-admin",       "Super Admin",        "सुपर एडमिन",            10),
    ("pcs-nodal-officer", "PCS Nodal Officer",  "पीसीएस नोडल अधिकारी",   20),
    ("field-surveyor",    "Field Surveyor",     "क्षेत्र सर्वेक्षक",       30),
    ("ada-project-lead",  "ADA Project Lead",   "एडीए परियोजना प्रमुख",  40),
    ("public",            "Public complainant", "सार्वजनिक शिकायतकर्ता",  90),
]

# --- seed: permissions -----------------------------------------------------
#
# These govern the surface that is NOT a case transition: reads, exports and
# administration. Moving a case is governed by icms_workflow_transition_role and
# by nothing else — two mechanisms guarding the same act is how they come to
# disagree, and the workflow table is the one that knows the case's state.
PERMISSIONS = [
    ("reference.read",        "reference",       "read",   "Read code values and lookups"),
    ("zone.read",             "zone",            "read",   "Read zones and their geometry"),
    ("zone.manage",           "zone",            "manage", "Create and amend zones"),
    ("zone_assignment.read",  "zone_assignment", "read",   "See which officers cover which zones"),
    ("zone_assignment.manage","zone_assignment", "manage", "Assign and revoke zone coverage"),
    ("case.read",             "case",            "read",   "Read the complaints register and case detail"),
    ("case.export",           "case",            "export", "Export register rows to CSV"),
    ("inspection.read",       "inspection",      "read",   "Read inspections and findings"),
    ("evidence.read",         "evidence",        "read",   "Read captured evidence"),
    ("notice.read",           "notice",          "read",   "Read the notices register and notice detail"),
    ("dashboard.read",        "dashboard",       "read",   "Read dashboard aggregates"),
    ("policy.read",           "policy",          "read",   "Read the workflow table and role grants"),
    ("policy.manage",         "policy",          "manage", "Change the workflow table and role grants"),
    ("user.read",             "user",            "read",   "List officers"),
    ("user.manage",           "user",            "manage", "Create and disable officers"),
]

# --- seed: grants ----------------------------------------------------------
#
# Super Admin holds administration and every read, and holds no transition at
# all — that split is stated in workflow.py and is the reason this table cannot
# simply give one role everything.
GRANTS = {
    "super-admin": [
        "reference.read", "zone.read", "zone.manage", "zone_assignment.read",
        "zone_assignment.manage", "case.read", "case.export", "inspection.read",
        "evidence.read", "notice.read", "dashboard.read", "policy.read",
        "policy.manage", "user.read", "user.manage",
    ],
    "pcs-nodal-officer": [
        "reference.read", "zone.read", "zone_assignment.read", "case.read",
        "case.export", "inspection.read", "evidence.read", "notice.read",
        "dashboard.read",
    ],
    "field-surveyor": [
        "reference.read", "zone.read", "case.read", "inspection.read", "evidence.read",
    ],
    "ada-project-lead": [
        "reference.read", "zone.read", "case.read", "case.export", "inspection.read",
        "evidence.read", "notice.read", "dashboard.read",
    ],
    "public": [],
}

# --- seed: the workflow table ---------------------------------------------
#
# Verbatim from workflow.TRANSITIONS as of 2026-09-22, notes included. A test
# asserts the two still agree, so a transition added in code and not here is a
# failing build rather than a rule that exists in one environment.
TRANSITIONS = [
    {
        "action_cd": 'raise',
        "source_status": None,
        "target_status": 'raised',
        "stage_no": 1,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['zone_id', 'source'],
        "roles": ['ada-project-lead', 'field-surveyor', 'pcs-nodal-officer', 'public'],
        "sort_order": 10,
        "note": (
            'From a detection, a public complaint, a field report or the office. Public intake '
            'is included deliberately: refusing a complaint because the complainant has no '
            'account is how a system stops being used.'
        ),
    },
    {
        "action_cd": 'reject',
        "source_status": 'raised',
        "target_status": 'rejected',
        "stage_no": 1,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['reason'],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 20,
        "note": (
            'A duplicate or a non-case. Reachable only before survey work begins; after that '
            'the case is closed with a record, not erased.'
        ),
    },
    {
        "action_cd": 'assign',
        "source_status": 'raised',
        "target_status": 'assigned',
        "stage_no": 2,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['assignee_user_id'],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 30,
        "note": None,
    },
    {
        "action_cd": 'reassign',
        "source_status": 'assigned',
        "target_status": 'assigned',
        "stage_no": 2,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['assignee_user_id', 'reason'],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 40,
        "note": (
            'Closes the open assignment row and opens a new one. The history stays readable, '
            'which is why reassignment is not an UPDATE.'
        ),
    },
    {
        "action_cd": 'reject',
        "source_status": 'assigned',
        "target_status": 'rejected',
        "stage_no": 2,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['reason'],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 50,
        "note": None,
    },
    {
        "action_cd": 'open_round',
        "source_status": 'assigned',
        "target_status": 'under_inspection',
        "stage_no": 3,
        "assignee_only": False,
        "opens_round": True,
        "requires": ['surveyor_user_id'],
        "roles": ['field-surveyor', 'pcs-nodal-officer'],
        "sort_order": 60,
        "note": (
            'Allocates INS-YYYY-NNNN and round_no = current_round + 1, in the same transaction '
            'as the event row.'
        ),
    },
    {
        "action_cd": 'check_in',
        "source_status": 'under_inspection',
        "target_status": 'under_inspection',
        "stage_no": 3,
        "assignee_only": True,
        "opens_round": False,
        "requires": ['latitude', 'longitude', 'accuracy_m', 'device_timestamp', 'idempotency_key'],
        "roles": ['field-surveyor'],
        "sort_order": 70,
        "note": (
            'The accuracy gate is applied by the endpoint against server config, not here: the '
            'threshold is an operational value ADA sets, not a rule.'
        ),
    },
    {
        "action_cd": 'add_evidence',
        "source_status": 'under_inspection',
        "target_status": 'under_inspection',
        "stage_no": 3,
        "assignee_only": True,
        "opens_round": False,
        "requires": ['kind', 'idempotency_key'],
        "roles": ['field-surveyor'],
        "sort_order": 80,
        "note": (
            "The five capture fields are enforced by icms_evidence's CHECK constraint and by "
            'the request model, in that order.'
        ),
    },
    {
        "action_cd": 'record_findings',
        "source_status": 'under_inspection',
        "target_status": 'under_inspection',
        "stage_no": 4,
        "assignee_only": True,
        "opens_round": False,
        "requires": ['findings'],
        "roles": ['field-surveyor'],
        "sort_order": 90,
        "note": None,
    },
    {
        "action_cd": 'submit',
        "source_status": 'under_inspection',
        "target_status": 'inspection_submitted',
        "stage_no": 4,
        "assignee_only": True,
        "opens_round": False,
        "requires": ['idempotency_key'],
        "roles": ['field-surveyor'],
        "sort_order": 100,
        "note": (
            'Idempotent. A replay returns the same inspection rather than creating a second '
            'one; that is the guarantee the offline queue is built on.'
        ),
    },
    {
        "action_cd": 'request_resurvey',
        "source_status": 'inspection_submitted',
        "target_status": 'resurvey_requested',
        "stage_no": 4,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['reason'],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 110,
        "note": None,
    },
    {
        "action_cd": 'open_round',
        "source_status": 'resurvey_requested',
        "target_status": 'under_inspection',
        "stage_no": 3,
        "assignee_only": False,
        "opens_round": True,
        "requires": ['surveyor_user_id'],
        "roles": ['field-surveyor', 'pcs-nodal-officer'],
        "sort_order": 120,
        "note": (
            'The loop. Round n+1 is a new row set; round n stays readable, which is the defect '
            'in the legacy schema that made re-survey unreconstructable.'
        ),
    },
    {
        "action_cd": 'verify_accept',
        "source_status": 'inspection_submitted',
        "target_status": 'verified',
        "stage_no": 5,
        "assignee_only": False,
        "opens_round": False,
        "requires": [],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 130,
        "note": None,
    },
    {
        "action_cd": 'verify_reject',
        "source_status": 'inspection_submitted',
        "target_status": 'resurvey_requested',
        "stage_no": 5,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['reason'],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 140,
        "note": (
            'Rejecting an inspection and requesting a re-survey land in the same state on '
            'purpose. They differ in who initiated it, and that is what the event row records.'
        ),
    },
    {
        "action_cd": 'hand_over',
        "source_status": 'verified',
        "target_status": 'handed_over',
        "stage_no": 6,
        "assignee_only": False,
        "opens_round": False,
        "requires": [],
        "roles": ['pcs-nodal-officer'],
        "sort_order": 150,
        "note": None,
    },
    {
        "action_cd": 'confirm',
        "source_status": 'handed_over',
        "target_status": 'confirmed',
        "stage_no": 7,
        "assignee_only": False,
        "opens_round": False,
        "requires": [],
        "roles": ['ada-project-lead'],
        "sort_order": 160,
        "note": None,
    },
    {
        "action_cd": 'issue_notice',
        "source_status": 'confirmed',
        "target_status": 'notice_issued',
        "stage_no": 7,
        "assignee_only": False,
        "opens_round": False,
        "requires": ['act_cd', 'section_cds'],
        "roles": ['ada-project-lead'],
        "sort_order": 170,
        "note": (
            'The unlock condition is the feature: a notice cannot be issued before stage 7 '
            'confirmation exists. NTC-YYYY-XXXX is allocated gaplessly, inside the persisting '
            'transaction.'
        ),
    },
    {
        "action_cd": 'close',
        "source_status": 'notice_issued',
        "target_status": 'closed',
        "stage_no": 7,
        "assignee_only": False,
        "opens_round": False,
        "requires": [],
        "roles": ['ada-project-lead'],
        "sort_order": 180,
        "note": None,
    },
]


def upgrade() -> None:
    op.create_table(
        "icms_role",
        sa.Column("role_cd", sa.String(40), primary_key=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("label_hi", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
    )

    op.create_table(
        "icms_permission",
        sa.Column("permission_cd", sa.String(64), primary_key=True),
        sa.Column("resource", sa.String(40), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("label_hi", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("resource", "action", name="icms_permission_uq"),
    )
    op.create_index("ix_icms_permission_resource", "icms_permission", ["resource"])

    op.create_table(
        "icms_role_permission",
        sa.Column("role_cd", sa.String(40), primary_key=True),
        sa.Column("permission_cd", sa.String(64), primary_key=True),
        sa.Column("granted_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["role_cd"], ["icms_role.role_cd"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_cd"], ["icms_permission.permission_cd"],
                                ondelete="CASCADE"),
    )

    op.create_table(
        "icms_workflow_transition",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("action_cd", sa.String(40), nullable=False),
        sa.Column("source_status", sa.String(30), nullable=True),
        sa.Column("target_status", sa.String(30), nullable=False),
        sa.Column("stage_no", sa.SmallInteger(), nullable=False),
        sa.Column("assignee_only", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("opens_round", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("requires", postgresql.ARRAY(sa.Text()), nullable=False,
                  server_default=sa.text("'{}'")),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_by", sa.String(64), nullable=True),
        sa.CheckConstraint(_in("action_cd", CASE_ACTIONS), name="icms_wf_transition_action_ck"),
        sa.CheckConstraint(_in("target_status", CASE_STATUSES),
                           name="icms_wf_transition_target_ck"),
        sa.CheckConstraint(f"source_status IS NULL OR {_in('source_status', CASE_STATUSES)}",
                           name="icms_wf_transition_source_ck"),
        sa.CheckConstraint("stage_no BETWEEN 1 AND 7", name="icms_wf_transition_stage_ck"),
    )
    # Two indexes, not one. PostgreSQL treats NULLs as distinct, so a single
    # unique (action_cd, source_status) would admit two `raise` rows.
    op.create_index(
        "uq_icms_wf_transition_src", "icms_workflow_transition",
        ["action_cd", "source_status"], unique=True,
        postgresql_where=sa.text("active AND source_status IS NOT NULL"),
    )
    op.create_index(
        "uq_icms_wf_transition_initial", "icms_workflow_transition",
        ["action_cd"], unique=True,
        postgresql_where=sa.text("active AND source_status IS NULL"),
    )

    op.create_table(
        "icms_workflow_transition_role",
        sa.Column("transition_id", sa.BigInteger(), primary_key=True),
        sa.Column("role_cd", sa.String(40), primary_key=True),
        sa.ForeignKeyConstraint(["transition_id"], ["icms_workflow_transition.id"],
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_cd"], ["icms_role.role_cd"], ondelete="CASCADE"),
    )

    op.create_table(
        "icms_policy_revision",
        sa.Column("id", sa.SmallInteger(), primary_key=True, autoincrement=False),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column("updated_by", sa.String(64), nullable=True),
        sa.CheckConstraint("id = 1", name="icms_policy_revision_single_ck"),
    )

    _seed()


def _seed() -> None:
    """Fill the six tables. bulk_insert throughout, never op.get_bind(): offline
    mode has no bind, and it renders a parameter list as one all-NULL statement."""
    op.bulk_insert(
        sa.table(
            "icms_role",
            sa.column("role_cd", sa.String),
            sa.column("label", sa.Text),
            sa.column("label_hi", sa.Text),
            sa.column("is_system", sa.Boolean),
            sa.column("active", sa.Boolean),
            sa.column("sort_order", sa.SmallInteger),
        ),
        [
            {"role_cd": cd, "label": label, "label_hi": label_hi,
             "is_system": True, "active": True, "sort_order": order}
            for cd, label, label_hi, order in ROLES
        ],
    )

    op.bulk_insert(
        sa.table(
            "icms_permission",
            sa.column("permission_cd", sa.String),
            sa.column("resource", sa.String),
            sa.column("action", sa.String),
            sa.column("label", sa.Text),
            sa.column("is_system", sa.Boolean),
        ),
        [
            {"permission_cd": cd, "resource": resource, "action": action,
             "label": label, "is_system": True}
            for cd, resource, action, label in PERMISSIONS
        ],
    )

    grants = [
        {"role_cd": role_cd, "permission_cd": permission_cd}
        for role_cd, permission_cds in GRANTS.items()
        for permission_cd in permission_cds
    ]
    if grants:
        op.bulk_insert(
            sa.table(
                "icms_role_permission",
                sa.column("role_cd", sa.String),
                sa.column("permission_cd", sa.String),
            ),
            grants,
        )

    # Ids are stated here, not read back from RETURNING. The role rows need the
    # id, and offline mode has no result set to read one out of; list position is
    # a stable key because this list is frozen at the revision that wrote it.
    op.bulk_insert(
        sa.table(
            "icms_workflow_transition",
            sa.column("id", sa.BigInteger),
            sa.column("action_cd", sa.String),
            sa.column("source_status", sa.String),
            sa.column("target_status", sa.String),
            sa.column("stage_no", sa.SmallInteger),
            sa.column("assignee_only", sa.Boolean),
            sa.column("opens_round", sa.Boolean),
            sa.column("requires", _TextArray()),
            sa.column("note", sa.Text),
            sa.column("active", sa.Boolean),
            sa.column("sort_order", sa.SmallInteger),
        ),
        [
            {
                "id": transition_id,
                "action_cd": row["action_cd"],
                "source_status": row["source_status"],
                "target_status": row["target_status"],
                "stage_no": row["stage_no"],
                "assignee_only": row["assignee_only"],
                "opens_round": row["opens_round"],
                "requires": list(row["requires"]),
                "note": row["note"],
                "active": True,
                "sort_order": row["sort_order"],
            }
            for transition_id, row in enumerate(TRANSITIONS, start=1)
        ],
    )

    op.bulk_insert(
        sa.table(
            "icms_workflow_transition_role",
            sa.column("transition_id", sa.BigInteger),
            sa.column("role_cd", sa.String),
        ),
        [
            {"transition_id": transition_id, "role_cd": role_cd}
            for transition_id, row in enumerate(TRANSITIONS, start=1)
            for role_cd in row["roles"]
        ],
    )

    # BIGSERIAL did not issue those ids, so its sequence still points at 1 and the
    # next insert collides. COALESCE keeps this valid on an empty table.
    op.execute(
        "SELECT setval("
        "pg_get_serial_sequence('icms_workflow_transition', 'id'), "
        "COALESCE((SELECT max(id) FROM icms_workflow_transition), 0) + 1, false)"
    )

    op.execute("INSERT INTO icms_policy_revision (id, revision) VALUES (1, 1)")


def downgrade() -> None:
    op.drop_table("icms_policy_revision")
    op.drop_table("icms_workflow_transition_role")
    op.drop_index("uq_icms_wf_transition_initial", table_name="icms_workflow_transition")
    op.drop_index("uq_icms_wf_transition_src", table_name="icms_workflow_transition")
    op.drop_table("icms_workflow_transition")
    op.drop_table("icms_role_permission")
    op.drop_index("ix_icms_permission_resource", table_name="icms_permission")
    op.drop_table("icms_permission")
    op.drop_table("icms_role")
