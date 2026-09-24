"""0010 seeds atomic permission codes that mirror today's grants exactly.

Expectations are derived here from the 0003 + 0008 seeds (0003's transition
role lists included), never copied from 0010, so a wrong literal there fails.
"""

from __future__ import annotations

import pytest

from app.icms import policy
from app.icms import workflow as wf
from tests.conftest import _load_revision

ROLES = ("super-admin", "pcs-nodal-officer", "field-surveyor", "ada-project-lead", "public")

NEW_CODES = {
    "dashboard.access", "change_detection.access", "complaint_create.access",
    "complaints.access", "inspections.access", "notices.access", "reports.access",
    "administration.access", "officers.access",
    "imagery.export", "imagery.run",
    "case.raise", "case.assign", "case.reassign", "case.reject", "case.amend",
    "case.hand_over", "case.confirm", "case.close",
    "evidence.write",
    "inspection.export", "inspection.open_round", "inspection.check_in",
    "inspection.record_findings", "inspection.submit", "inspection.verify",
    "inspection.request_resurvey",
    "notice.export", "notice.issue", "notice.download",
    "report.read", "report.export",
    "user.create", "user.update", "user.roles", "user.password", "user.disable",
}

# Workflow action -> the atomic code that will guard it.
ACTION_CODES = {
    wf.Action.RAISE: "case.raise",
    wf.Action.ASSIGN: "case.assign",
    wf.Action.REASSIGN: "case.reassign",
    wf.Action.REJECT: "case.reject",
    wf.Action.HAND_OVER: "case.hand_over",
    wf.Action.CONFIRM: "case.confirm",
    wf.Action.CLOSE: "case.close",
    wf.Action.ISSUE_NOTICE: "notice.issue",
    wf.Action.OPEN_ROUND: "inspection.open_round",
    wf.Action.CHECK_IN: "inspection.check_in",
    wf.Action.ADD_EVIDENCE: "evidence.write",
    wf.Action.RECORD_FINDINGS: "inspection.record_findings",
    wf.Action.SUBMIT: "inspection.submit",
    wf.Action.VERIFY_ACCEPT: "inspection.verify",
    wf.Action.VERIFY_REJECT: "inspection.verify",
    wf.Action.REQUEST_RESURVEY: "inspection.request_resurvey",
}

# New code -> the pre-0010 permissions a role must hold (all of them) to get it.
DERIVED_FROM = {
    "dashboard.access": {"dashboard.read"},
    "complaints.access": {"case.read"},
    "complaint_create.access": {"case.read"},
    "inspections.access": {"inspection.read"},
    "notices.access": {"notice.read"},
    "change_detection.access": {"imagery.read"},
    "reports.access": {"dashboard.read", "case.export"},
    "administration.access": {"policy.read"},
    "officers.access": {"user.read"},
    "imagery.export": {"imagery.read"},
    "imagery.run": {"imagery.write"},
    "inspection.export": {"case.export"},
    "notice.export": {"case.export", "notice.read"},
    "notice.download": {"notice.read"},
    "report.read": {"dashboard.read"},
    "report.export": {"case.export"},
    "user.create": {"user.manage"},
    "user.update": {"user.manage"},
    "user.roles": {"user.manage"},
    "user.password": {"user.manage"},
    "user.disable": {"user.manage"},
}

EXPECTED_COUNTS = {
    "super-admin": 21,
    "pcs-nodal-officer": 23,
    "field-surveyor": 11,
    "ada-project-lead": 18,
    "public": 1,
}

# What survives 0012, which takes change detection away from everyone but the nodal officer.
LOADED_COUNTS = {**EXPECTED_COUNTS, "super-admin": 18, "field-surveyor": 9, "ada-project-lead": 15}


@pytest.fixture(scope="module")
def atomic():
    return _load_revision("0010_atomic_permissions")


def _before() -> dict[str, set[str]]:
    base = _load_revision("0003_policy_tables")
    imagery = _load_revision("0008_imagery_permissions")
    grants = {role: set(base.GRANTS.get(role, ())) for role in ROLES}
    for role, codes in imagery.GRANTS.items():
        grants[role] |= set(codes)
    return grants


def _expected() -> dict[str, set[str]]:
    before = _before()
    expected = {role: set() for role in ROLES}
    for role in ROLES:
        for code, needs in DERIVED_FROM.items():
            if needs <= before[role]:
                expected[role].add(code)
    for row in _load_revision("0003_policy_tables").TRANSITIONS:
        for role in row["roles"]:
            expected[role].add(ACTION_CODES[wf.Action(row["action_cd"])])
    # Amendment was the nodal officer's alone before 0010 (workflow.AMENDABLE_ROLES).
    expected["pcs-nodal-officer"].add(policy.AMEND_PERMISSION)
    expected["super-admin"] = (
        NEW_CODES - set(ACTION_CODES.values()) - {policy.AMEND_PERMISSION}
    )
    return expected


def test_the_revision_follows_0009(atomic):
    assert atomic.revision == "0010"
    assert atomic.down_revision == "0009"


def test_every_new_code_is_seeded_once_with_both_labels(atomic):
    codes = [cd for cd, *_ in atomic.PERMISSIONS]
    assert len(codes) == len(set(codes)) == 37
    assert set(codes) == NEW_CODES
    assert set(atomic.LABEL_HI) == NEW_CODES
    assert all(label and atomic.LABEL_HI[cd] for cd, _, _, label in atomic.PERMISSIONS)


def test_no_existing_code_is_touched(atomic):
    before = {cd for cd, *_ in _load_revision("0003_policy_tables").PERMISSIONS}
    before |= {cd for cd, *_ in _load_revision("0008_imagery_permissions").PERMISSIONS}
    assert not before & {cd for cd, *_ in atomic.PERMISSIONS}
    assert "user.manage" in policy.PERMISSIONS


def test_resource_and_action_pairs_are_unique_across_the_whole_seed(atomic):
    """icms_permission_uq is UNIQUE (resource, action)."""
    rows = [*_load_revision("0003_policy_tables").PERMISSIONS,
            *_load_revision("0008_imagery_permissions").PERMISSIONS,
            *atomic.PERMISSIONS]
    pairs = [(resource, action) for _, resource, action, _ in rows]
    assert len(pairs) == len(set(pairs))


def test_every_action_code_names_a_seeded_permission(atomic):
    assert set(ACTION_CODES.values()) <= NEW_CODES
    assert set(ACTION_CODES) == {t.action for t in wf.TRANSITIONS}
    assert atomic.TRANSITION_CODES == {str(a): cd for a, cd in ACTION_CODES.items()}


def test_super_admin_holds_no_transition_code(atomic):
    held = set(atomic.GRANTS["super-admin"])
    assert not held & set(ACTION_CODES.values())
    assert policy.AMEND_PERMISSION not in held


@pytest.mark.parametrize("role", ROLES)
def test_the_grants_mirror_todays_behaviour(atomic, role):
    assert set(atomic.GRANTS.get(role, ())) == _expected()[role]


@pytest.mark.parametrize("role", ROLES)
def test_the_grant_count_per_role(atomic, role):
    assert len(set(atomic.GRANTS.get(role, ()))) == EXPECTED_COUNTS[role]
    assert len(atomic.GRANTS.get(role, ())) == EXPECTED_COUNTS[role]


def test_amendment_is_unchanged_once_the_seed_is_loaded(db, policy_tables):
    """The one new code something already reads: seeding it must not widen who may amend."""
    assert policy.snapshot().roles_holding({policy.AMEND_PERMISSION}) == {"pcs-nodal-officer"}


def test_the_loaded_seed_carries_every_new_grant(db, policy_tables):
    snapshot = policy.snapshot()
    assert NEW_CODES <= snapshot.permissions
    for role, count in LOADED_COUNTS.items():
        assert len(snapshot.permitted([role]) & NEW_CODES) == count
