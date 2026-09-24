"""The ICMS workflow policy.

Every transition gets two tests: one that it works for the role that owns it,
and one that it is refused for a role that does not. The second kind is the
point. `docs/Agents/build-plan.md` lists "the authorisation-denial test per
transition" among the six things not to cut, because the legacy system has no
authorisation at all — `server.js` lines 499-542 mount every ICMS router with no
middleware — and a suite of happy paths would not have noticed.
"""

from __future__ import annotations

import pytest
from ada_core.models_icms import CASE_STATUSES

from app.icms import policy
from app.icms import workflow as wf

SURVEYOR = [wf.Role.FIELD_SURVEYOR]
NODAL = [wf.Role.PCS_NODAL_OFFICER]
LEAD = [wf.Role.ADA_PROJECT_LEAD]
ADMIN = [wf.Role.SUPER_ADMIN]

ASSIGN_PAYLOAD = {"assignee_user_id": "user-b"}
ROUND_PAYLOAD = {"surveyor_user_id": "user-b"}
CHECK_IN_PAYLOAD = {
    "latitude": 27.1,
    "longitude": 78.0,
    "accuracy_m": 6.5,
    "device_timestamp": "2026-09-18T10:15:00+05:30",
    "idempotency_key": "3f1d6dd9-8443-b909-5a86-0f65c42bb001",
}


# --- the table itself ------------------------------------------------------

def test_status_values_match_the_database_check_constraint():
    """The enum and the CHECK constraint are two statements of one fact.

    If they drift, a transition this module considers legal is refused by
    PostgreSQL at commit — after the event row has been written.
    """
    # Against the mapped class, which is where the CHECK constraint is now
    # declared. The policy and the database state the same list twice; this is
    # what stops the two drifting.
    assert set(CASE_STATUSES) == {s.value for s in wf.Status}


def test_every_role_except_public_exists_in_the_realm():
    """The role strings are only meaningful if Keycloak issues them.

    `public` is deliberately absent: it means no token at all — a complainant
    reporting from the public form — not a realm role somebody can be granted.
    Every other role must exist, or `check` refuses everyone and the symptom is
    a 403 on a request that should have worked.
    """
    import json
    from pathlib import Path

    realm = json.loads(
        (Path(__file__).resolve().parents[3] / "infra/keycloak/realm-ada.json")
        .read_text()
    )
    declared = {role["name"] for role in realm["roles"]["realm"]}
    required = {r.value for r in wf.Role} - {wf.Role.PUBLIC.value}
    assert required <= declared, required - declared


def test_every_status_has_a_stage():
    for status in wf.Status:
        assert 1 <= wf.stage_of(status) <= 7


def test_terminal_states_have_no_way_out():
    for status in wf.TERMINAL:
        assert wf.transitions_for(status) == ()


def test_every_status_except_the_terminal_ones_is_reachable():
    """A state nothing can reach is a state the code will never produce, and a
    branch in the portal that can never render."""
    reachable = {t.target for t in wf.TRANSITIONS}
    assert set(wf.Status) - reachable == set()


# --- the happy path, end to end -------------------------------------------

def test_the_full_seven_stage_path():
    steps = [
        (None, wf.Action.RAISE, NODAL, {"zone_id": 1, "source": "field"}, wf.Status.RAISED),
        (wf.Status.RAISED, wf.Action.ASSIGN, NODAL, ASSIGN_PAYLOAD, wf.Status.ASSIGNED),
        (wf.Status.ASSIGNED, wf.Action.OPEN_ROUND, NODAL, ROUND_PAYLOAD,
         wf.Status.UNDER_INSPECTION),
        (wf.Status.UNDER_INSPECTION, wf.Action.SUBMIT, SURVEYOR,
         {"idempotency_key": "k"}, wf.Status.INSPECTION_SUBMITTED),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_ACCEPT, NODAL, None,
         wf.Status.VERIFIED),
        (wf.Status.VERIFIED, wf.Action.HAND_OVER, NODAL, None, wf.Status.HANDED_OVER),
        (wf.Status.HANDED_OVER, wf.Action.CONFIRM, LEAD, None, wf.Status.CONFIRMED),
        (wf.Status.CONFIRMED, wf.Action.ISSUE_NOTICE, LEAD,
         {"act_cd": "up_urban_planning_act", "section_cds": ["27"]},
         wf.Status.NOTICE_ISSUED),
        (wf.Status.NOTICE_ISSUED, wf.Action.CLOSE, LEAD, None, wf.Status.CLOSED),
    ]
    for source, action, roles, payload, expected in steps:
        transition = wf.check(source, action, roles, is_assignee=True, payload=payload)
        assert transition.target == expected


def test_the_resurvey_loop_returns_to_inspection_and_opens_a_round():
    back = wf.check(wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_REJECT, NODAL,
                    payload={"reason": "measurements missing"})
    assert back.target == wf.Status.RESURVEY_REQUESTED

    again = wf.check(wf.Status.RESURVEY_REQUESTED, wf.Action.OPEN_ROUND, NODAL,
                     payload=ROUND_PAYLOAD)
    assert again.target == wf.Status.UNDER_INSPECTION
    assert again.opens_round is True


def test_only_the_two_round_openers_increment_the_round():
    openers = {(t.source, t.action) for t in wf.TRANSITIONS if t.opens_round}
    assert openers == {
        (wf.Status.ASSIGNED, wf.Action.OPEN_ROUND),
        (wf.Status.RESURVEY_REQUESTED, wf.Action.OPEN_ROUND),
    }


# --- authorisation denial, one per transition ------------------------------

@pytest.mark.parametrize(
    ("source", "action", "wrong_roles", "payload"),
    [
        (wf.Status.RAISED, wf.Action.ASSIGN, SURVEYOR, ASSIGN_PAYLOAD),
        (wf.Status.RAISED, wf.Action.REJECT, SURVEYOR, {"reason": "duplicate"}),
        (wf.Status.ASSIGNED, wf.Action.REASSIGN, SURVEYOR,
         {"assignee_user_id": "user-c", "reason": "on leave"}),
        (wf.Status.ASSIGNED, wf.Action.REJECT, LEAD, {"reason": "duplicate"}),
        (wf.Status.ASSIGNED, wf.Action.OPEN_ROUND, LEAD, ROUND_PAYLOAD),
        (wf.Status.UNDER_INSPECTION, wf.Action.CHECK_IN, NODAL, CHECK_IN_PAYLOAD),
        (wf.Status.UNDER_INSPECTION, wf.Action.ADD_EVIDENCE, NODAL,
         {"kind": "photo", "idempotency_key": "k"}),
        (wf.Status.UNDER_INSPECTION, wf.Action.RECORD_FINDINGS, LEAD,
         {"findings": ["one"]}),
        (wf.Status.UNDER_INSPECTION, wf.Action.SUBMIT, NODAL, {"idempotency_key": "k"}),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_ACCEPT, SURVEYOR, None),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_REJECT, SURVEYOR,
         {"reason": "redo"}),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.REQUEST_RESURVEY, SURVEYOR,
         {"reason": "redo"}),
        (wf.Status.RESURVEY_REQUESTED, wf.Action.OPEN_ROUND, LEAD, ROUND_PAYLOAD),
        (wf.Status.VERIFIED, wf.Action.HAND_OVER, SURVEYOR, None),
        (wf.Status.HANDED_OVER, wf.Action.CONFIRM, NODAL, None),
        (wf.Status.CONFIRMED, wf.Action.ISSUE_NOTICE, NODAL,
         {"act_cd": "a", "section_cds": ["27"]}),
        (wf.Status.NOTICE_ISSUED, wf.Action.CLOSE, NODAL, None),
    ],
)
def test_the_wrong_role_is_refused(source, action, wrong_roles, payload):
    with pytest.raises(wf.RoleNotPermitted) as exc:
        wf.check(source, action, wrong_roles, is_assignee=True, payload=payload)
    assert exc.value.status_code == 403
    assert exc.value.permission == policy.snapshot().transition(source, action).permission
    assert exc.value.allowed, "the refusal names the roles that could have acted"
    assert not set(exc.value.allowed) & {str(r) for r in wrong_roles}


def test_every_transition_has_a_denial_test():
    """Guards the list above: a transition added without a denial case fails here
    rather than shipping unprotected."""
    covered = {
        (wf.Status.RAISED, wf.Action.ASSIGN),
        (wf.Status.RAISED, wf.Action.REJECT),
        (wf.Status.ASSIGNED, wf.Action.REASSIGN),
        (wf.Status.ASSIGNED, wf.Action.REJECT),
        (wf.Status.ASSIGNED, wf.Action.OPEN_ROUND),
        (wf.Status.UNDER_INSPECTION, wf.Action.CHECK_IN),
        (wf.Status.UNDER_INSPECTION, wf.Action.ADD_EVIDENCE),
        (wf.Status.UNDER_INSPECTION, wf.Action.RECORD_FINDINGS),
        (wf.Status.UNDER_INSPECTION, wf.Action.SUBMIT),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_ACCEPT),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_REJECT),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.REQUEST_RESURVEY),
        (wf.Status.RESURVEY_REQUESTED, wf.Action.OPEN_ROUND),
        (wf.Status.VERIFIED, wf.Action.HAND_OVER),
        (wf.Status.HANDED_OVER, wf.Action.CONFIRM),
        (wf.Status.CONFIRMED, wf.Action.ISSUE_NOTICE),
        (wf.Status.NOTICE_ISSUED, wf.Action.CLOSE),
    }
    every = {(t.source, t.action) for t in wf.TRANSITIONS if t.source is not None}
    assert every - covered == set()


def test_super_admin_can_move_nothing():
    """Administration is a different authority from enforcement. A role that can
    do everything is the role every incident is later traced to."""
    held = policy.snapshot().permitted(ADMIN)
    for transition in wf.TRANSITIONS:
        assert transition.permission not in held
    assert wf.AMEND_PERMISSION not in held
    for status in wf.Status:
        assert wf.allowed_actions(status, ADMIN, is_assignee=True) == ()
    assert wf.allowed_actions(None, ADMIN) == ()


# --- assignment ------------------------------------------------------------

@pytest.mark.parametrize(
    ("action", "payload"),
    [
        (wf.Action.CHECK_IN, CHECK_IN_PAYLOAD),
        (wf.Action.ADD_EVIDENCE, {"kind": "photo", "idempotency_key": "k"}),
        (wf.Action.RECORD_FINDINGS, {"findings": ["one"]}),
        (wf.Action.SUBMIT, {"idempotency_key": "k"}),
    ],
)
def test_a_surveyor_cannot_act_on_another_surveyors_case(action, payload):
    # The right role, the wrong officer. This is what decides whether a
    # photograph is attributable to the person who took it.
    with pytest.raises(wf.NotTheAssignee) as exc:
        wf.check(wf.Status.UNDER_INSPECTION, action, SURVEYOR,
                 is_assignee=False, payload=payload)
    assert exc.value.status_code == 403


def test_assignee_only_is_set_on_exactly_the_capture_actions():
    assignee_only = {t.action for t in wf.TRANSITIONS if t.assignee_only}
    assert assignee_only == {
        wf.Action.CHECK_IN, wf.Action.ADD_EVIDENCE,
        wf.Action.RECORD_FINDINGS, wf.Action.SUBMIT,
    }


# --- state ----------------------------------------------------------------

def test_an_action_that_does_not_exist_from_this_state_is_409():
    with pytest.raises(wf.UnknownTransition) as exc:
        wf.check(wf.Status.RAISED, wf.Action.SUBMIT, SURVEYOR, is_assignee=True,
                 payload={"idempotency_key": "k"})
    assert exc.value.status_code == 409


def test_a_notice_cannot_be_issued_before_confirmation():
    # The unlock condition is the feature.
    for status in (wf.Status.VERIFIED, wf.Status.HANDED_OVER,
                   wf.Status.INSPECTION_SUBMITTED):
        with pytest.raises(wf.UnknownTransition):
            wf.check(status, wf.Action.ISSUE_NOTICE, LEAD,
                     payload={"act_cd": "a", "section_cds": ["27"]})


def test_a_case_cannot_be_rejected_once_survey_work_has_begun():
    for status in (wf.Status.UNDER_INSPECTION, wf.Status.INSPECTION_SUBMITTED,
                   wf.Status.VERIFIED):
        with pytest.raises(wf.UnknownTransition):
            wf.check(status, wf.Action.REJECT, NODAL, payload={"reason": "duplicate"})


# --- payload ---------------------------------------------------------------

def test_a_missing_required_field_is_422_and_names_the_field():
    with pytest.raises(wf.MissingPayload) as exc:
        wf.check(wf.Status.RAISED, wf.Action.ASSIGN, NODAL, payload={})
    assert exc.value.status_code == 422
    assert exc.value.missing == ("assignee_user_id",)


def test_an_empty_string_counts_as_missing():
    # "" is what an untouched form field sends, and it is not a reason.
    with pytest.raises(wf.MissingPayload):
        wf.check(wf.Status.RAISED, wf.Action.REJECT, NODAL, payload={"reason": ""})


def test_role_is_checked_before_payload():
    """A caller who may not act at all is not told which fields would have been
    needed. That is an enumeration aid, and it is free to withhold."""
    with pytest.raises(wf.RoleNotPermitted):
        wf.check(wf.Status.RAISED, wf.Action.ASSIGN, SURVEYOR, payload={})


# --- what the portal renders ----------------------------------------------

def test_allowed_actions_reflects_role_and_assignment():
    assert wf.allowed_actions(wf.Status.RAISED, NODAL) == (
        wf.Action.REJECT, wf.Action.ASSIGN,
    )
    assert wf.allowed_actions(wf.Status.UNDER_INSPECTION, SURVEYOR, is_assignee=False) == ()
    assert set(wf.allowed_actions(wf.Status.UNDER_INSPECTION, SURVEYOR, is_assignee=True)) == {
        wf.Action.CHECK_IN, wf.Action.ADD_EVIDENCE,
        wf.Action.RECORD_FINDINGS, wf.Action.SUBMIT,
    }


def test_unknown_realm_roles_are_ignored_not_refused():
    # A token carries offline_access and default-roles-pcsmcpl too. A realm
    # gaining a role unrelated to ICMS must not stop ICMS working.
    roles = ["offline_access", "default-roles-pcsmcpl", wf.Role.PCS_NODAL_OFFICER]
    assert wf.check(wf.Status.RAISED, wf.Action.ASSIGN, roles,
                    payload=ASSIGN_PAYLOAD).target == wf.Status.ASSIGNED


def test_a_caller_with_no_recognised_role_is_refused():
    with pytest.raises(wf.RoleNotPermitted):
        wf.check(wf.Status.RAISED, wf.Action.ASSIGN, ["offline_access"],
                 payload=ASSIGN_PAYLOAD)


# --- amendment: policy, but deliberately not a transition ------------------

def test_amend_is_not_a_transition():
    """It changes no status and occupies no stage, so it has no row in the
    table. Adding one would put a seventeenth move in a state machine the spec
    document describes as having sixteen."""
    assert wf.Action.AMEND not in {t.action for t in wf.TRANSITIONS}


def test_treating_amend_as_a_move_is_a_409():
    """`check` is honest about it: amending is not a way to move a case."""
    with pytest.raises(wf.UnknownTransition) as exc:
        wf.check(wf.Status.RAISED, wf.Action.AMEND, NODAL)
    assert exc.value.status_code == 409


def test_a_nodal_officer_may_amend_an_open_case():
    for status in (wf.Status.RAISED, wf.Status.ASSIGNED, wf.Status.UNDER_INSPECTION,
                   wf.Status.VERIFIED, wf.Status.NOTICE_ISSUED):
        wf.check_amendable(status, NODAL)


@pytest.mark.parametrize("wrong_roles", [SURVEYOR, LEAD, ADMIN])
def test_amendment_is_refused_to_every_other_role(wrong_roles):
    """The denial test, as every rule in this module gets one. A surveyor who
    finds the owner's name wrong records a finding; the complaint stays what was
    reported."""
    with pytest.raises(wf.RoleNotPermitted) as exc:
        wf.check_amendable(wf.Status.RAISED, wrong_roles)
    assert exc.value.status_code == 403
    assert exc.value.permission == wf.AMEND_PERMISSION
    assert exc.value.allowed == ("pcs-nodal-officer",)
    assert "pcs-nodal-officer" in str(exc.value)


@pytest.mark.parametrize("status", [wf.Status.CLOSED, wf.Status.REJECTED])
def test_a_terminal_case_cannot_be_amended_by_anybody(status):
    """409 rather than 403: the caller is entitled to ask, the case is what is
    wrong. Once a case is closed its record is the record."""
    with pytest.raises(wf.UnknownTransition) as exc:
        wf.check_amendable(status, NODAL)
    assert exc.value.status_code == 409


def test_the_state_is_checked_before_the_role():
    """Same order as `check`. A caller who may not act at all is not told which
    states would have worked."""
    with pytest.raises(wf.UnknownTransition):
        wf.check_amendable(wf.Status.CLOSED, SURVEYOR)
