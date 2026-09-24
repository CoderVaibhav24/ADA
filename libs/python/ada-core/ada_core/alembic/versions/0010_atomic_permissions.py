"""atomic permissions, phase 1 — seed only, nothing enforces them yet

One code per screen, per export and per workflow step, granted to exactly the
roles that can do that thing today (derived from 0003, 0008 and
workflow.TRANSITIONS). No endpoint, workflow check or nav entry reads any of
them in this revision; later phases move the checks over one at a time.

  super-admin          21  (no transition code and no case.amend: it moves nothing)
  pcs-nodal-officer    23      field-surveyor   11
  ada-project-lead     18      public            1  (case.raise)

`case.amend` is the exception to "nothing reads it": policy.py resolves the
amendable roles from it the moment the row exists, so it goes to exactly
workflow.AMENDABLE_ROLES (pcs-nodal-officer).

Also adds icms_workflow_transition.permission_cd, backfilled per action, for
phase 2. icms_workflow_transition_role still decides who may move a case.

Not an edit to 0003 or 0008. Every insert is `ON CONFLICT DO NOTHING`, and the
policy revision is bumped so running workers reload their snapshot.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-23

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERMISSIONS = [
    # screen access
    ("dashboard.access",        "dashboard",        "access", "Open the Dashboard screen"),
    ("change_detection.access", "change_detection", "access", "Open the Change Detection screen"),
    ("complaint_create.access", "complaint_create", "access", "Open the Create Complaint screen"),
    ("complaints.access",       "complaints",       "access", "Open the Complaints register"),
    ("inspections.access",      "inspections",      "access", "Open the Inspections register"),
    ("notices.access",          "notices",          "access", "Open the Notices register"),
    ("reports.access",          "reports",          "access", "Open the Reports screen"),
    ("administration.access",   "administration",   "access", "Open the Administration screen"),
    ("officers.access",         "officers",         "access", "Open the Officers screen"),
    # imagery
    ("imagery.export",          "imagery",          "export", "Export change-detection results"),
    ("imagery.run",             "imagery",          "run",    "Start a change-detection run"),
    # cases
    ("case.raise",              "case",             "raise",     "Raise a new case"),
    ("case.assign",             "case",             "assign",    "Assign a case to a surveyor"),
    ("case.reassign",           "case",             "reassign",  "Reassign a case to another surveyor"),
    ("case.reject",             "case",             "reject",    "Reject a case as a duplicate or non-case"),
    ("case.amend",              "case",             "amend",     "Correct a case's descriptive fields"),
    ("case.hand_over",          "case",             "hand_over", "Hand a verified case over to ADA"),
    ("case.confirm",            "case",             "confirm",   "Confirm a handed-over case"),
    ("case.close",              "case",             "close",     "Close a case after its notice"),
    # evidence
    ("evidence.write",          "evidence",         "write",  "Capture photographs and other evidence"),
    # inspections
    ("inspection.export",          "inspection", "export",           "Export inspection rows to CSV"),
    ("inspection.open_round",      "inspection", "open_round",       "Open an inspection round"),
    ("inspection.check_in",        "inspection", "check_in",         "Check in at the site"),
    ("inspection.record_findings", "inspection", "record_findings",  "Record inspection findings"),
    ("inspection.submit",          "inspection", "submit",           "Submit an inspection"),
    ("inspection.verify",          "inspection", "verify",           "Accept or reject a submitted inspection"),
    ("inspection.request_resurvey","inspection", "request_resurvey", "Request a re-survey"),
    # notices
    ("notice.export",           "notice",           "export",   "Export notice rows to CSV"),
    ("notice.issue",            "notice",           "issue",    "Issue a notice on a confirmed case"),
    ("notice.download",         "notice",           "download", "Download a notice PDF"),
    # reports
    ("report.read",             "report",           "read",   "Read reports"),
    ("report.export",           "report",           "export", "Export reports"),
    # officers
    ("user.create",             "user",             "create",   "Create officers"),
    ("user.update",             "user",             "update",   "Edit an officer's details"),
    ("user.roles",              "user",             "roles",    "Change an officer's roles"),
    ("user.password",           "user",             "password", "Reset an officer's password"),
    ("user.disable",            "user",             "disable",  "Disable and re-enable officers"),
]

LABEL_HI = {
    "dashboard.access":            "डैशबोर्ड स्क्रीन खोलें",
    "change_detection.access":     "परिवर्तन पहचान स्क्रीन खोलें",
    "complaint_create.access":     "शिकायत दर्ज करें स्क्रीन खोलें",
    "complaints.access":           "शिकायत रजिस्टर खोलें",
    "inspections.access":          "निरीक्षण रजिस्टर खोलें",
    "notices.access":              "नोटिस रजिस्टर खोलें",
    "reports.access":              "रिपोर्ट स्क्रीन खोलें",
    "administration.access":       "प्रशासन स्क्रीन खोलें",
    "officers.access":             "अधिकारी स्क्रीन खोलें",
    "imagery.export":              "परिवर्तन पहचान परिणाम निर्यात करें",
    "imagery.run":                 "परिवर्तन पहचान रन शुरू करें",
    "case.raise":                  "नया मामला दर्ज करें",
    "case.assign":                 "मामला सर्वेक्षक को सौंपें",
    "case.reassign":               "मामला दूसरे सर्वेक्षक को सौंपें",
    "case.reject":                 "दोहराव या गैर-मामले को अस्वीकार करें",
    "case.amend":                  "मामले का विवरण सुधारें",
    "case.hand_over":              "सत्यापित मामला एडीए को सौंपें",
    "case.confirm":                "सौंपे गए मामले की पुष्टि करें",
    "case.close":                  "नोटिस के बाद मामला बंद करें",
    "evidence.write":              "फ़ोटो और अन्य साक्ष्य दर्ज करें",
    "inspection.export":           "निरीक्षण पंक्तियाँ CSV में निर्यात करें",
    "inspection.open_round":       "निरीक्षण चरण खोलें",
    "inspection.check_in":         "स्थल पर चेक-इन करें",
    "inspection.record_findings":  "निरीक्षण निष्कर्ष दर्ज करें",
    "inspection.submit":           "निरीक्षण जमा करें",
    "inspection.verify":           "जमा निरीक्षण स्वीकार या अस्वीकार करें",
    "inspection.request_resurvey": "पुनः सर्वेक्षण का अनुरोध करें",
    "notice.export":               "नोटिस पंक्तियाँ CSV में निर्यात करें",
    "notice.issue":                "पुष्टि किए गए मामले पर नोटिस जारी करें",
    "notice.download":             "नोटिस PDF डाउनलोड करें",
    "report.read":                 "रिपोर्ट देखें",
    "report.export":               "रिपोर्ट निर्यात करें",
    "user.create":                 "अधिकारी बनाएँ",
    "user.update":                 "अधिकारी का विवरण संपादित करें",
    "user.roles":                  "अधिकारी की भूमिकाएँ बदलें",
    "user.password":               "अधिकारी का पासवर्ड रीसेट करें",
    "user.disable":                "अधिकारी को निष्क्रिय या पुनः सक्रिय करें",
}

# Action -> the code that will guard it, stated as literals like 0003's seed.
TRANSITION_CODES = {
    "raise": "case.raise",
    "reject": "case.reject",
    "assign": "case.assign",
    "reassign": "case.reassign",
    "open_round": "inspection.open_round",
    "check_in": "inspection.check_in",
    "add_evidence": "evidence.write",
    "record_findings": "inspection.record_findings",
    "submit": "inspection.submit",
    "request_resurvey": "inspection.request_resurvey",
    "verify_accept": "inspection.verify",
    "verify_reject": "inspection.verify",
    "hand_over": "case.hand_over",
    "confirm": "case.confirm",
    "issue_notice": "notice.issue",
    "close": "case.close",
}

GRANTS = {
    "super-admin": [
        cd for cd, *_ in PERMISSIONS
        if cd not in TRANSITION_CODES.values() and cd != "case.amend"
    ],
    "pcs-nodal-officer": [
        "dashboard.access", "change_detection.access", "complaint_create.access",
        "complaints.access", "inspections.access", "notices.access", "reports.access",
        "imagery.export", "imagery.run",
        "case.raise", "case.assign", "case.reassign", "case.reject", "case.amend",
        "case.hand_over",
        "inspection.export", "inspection.open_round", "inspection.verify",
        "inspection.request_resurvey",
        "notice.export", "notice.download",
        "report.read", "report.export",
    ],
    "field-surveyor": [
        "change_detection.access", "complaint_create.access", "complaints.access",
        "inspections.access",
        "imagery.export",
        "case.raise",
        "evidence.write",
        "inspection.open_round", "inspection.check_in", "inspection.record_findings",
        "inspection.submit",
    ],
    "ada-project-lead": [
        "dashboard.access", "change_detection.access", "complaint_create.access",
        "complaints.access", "inspections.access", "notices.access", "reports.access",
        "imagery.export", "imagery.run",
        "case.raise", "case.confirm", "case.close",
        "inspection.export",
        "notice.export", "notice.issue", "notice.download",
        "report.read", "report.export",
    ],
    "public": ["case.raise"],
}

PERMISSION = sa.table(
    "icms_permission",
    sa.column("permission_cd", sa.String),
    sa.column("resource", sa.String),
    sa.column("action", sa.String),
    sa.column("label", sa.Text),
    sa.column("label_hi", sa.Text),
    sa.column("is_system", sa.Boolean),
)

ROLE_PERMISSION = sa.table(
    "icms_role_permission",
    sa.column("role_cd", sa.String),
    sa.column("permission_cd", sa.String),
)

TRANSITION = sa.table(
    "icms_workflow_transition",
    sa.column("action_cd", sa.String),
    sa.column("permission_cd", sa.String),
)

TRANSITION_FK = "icms_wf_transition_permission_fk"


def upgrade() -> None:
    # One statement per row: offline mode renders an executemany list as NULLs.
    for cd, resource, action, label in PERMISSIONS:
        op.execute(
            postgresql.insert(PERMISSION)
            .values(permission_cd=cd, resource=resource, action=action,
                    label=label, label_hi=LABEL_HI[cd], is_system=True)
            .on_conflict_do_nothing()
        )
    for role_cd, codes in GRANTS.items():
        for code in codes:
            op.execute(
                postgresql.insert(ROLE_PERMISSION)
                .values(role_cd=role_cd, permission_cd=code)
                .on_conflict_do_nothing()
            )

    op.add_column("icms_workflow_transition",
                  sa.Column("permission_cd", sa.String(64), nullable=True))
    op.create_foreign_key(TRANSITION_FK, "icms_workflow_transition", "icms_permission",
                          ["permission_cd"], ["permission_cd"], ondelete="RESTRICT")
    for action_cd, code in TRANSITION_CODES.items():
        op.execute(
            TRANSITION.update()
            .where(TRANSITION.c.action_cd == action_cd)
            .values(permission_cd=code)
        )

    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")


def downgrade() -> None:
    op.drop_constraint(TRANSITION_FK, "icms_workflow_transition", type_="foreignkey")
    op.drop_column("icms_workflow_transition", "permission_cd")
    codes = [cd for cd, *_ in PERMISSIONS]
    op.execute(ROLE_PERMISSION.delete().where(ROLE_PERMISSION.c.permission_cd.in_(codes)))
    op.execute(PERMISSION.delete().where(PERMISSION.c.permission_cd.in_(codes)))
    op.execute("UPDATE icms_policy_revision SET revision = revision + 1 WHERE id = 1")
