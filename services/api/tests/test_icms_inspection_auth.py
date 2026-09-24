"""One authorisation denial per transition, at the API rather than at the policy.

`test_icms_workflow.py` proves the transition table refuses the wrong role. This
proves the ROUTES do, which is a different claim and the one the legacy system
fails: its ICMS routers are mounted with no authentication middleware at all
(`server.js`, lines 499-542), so every check it has is one a caller can walk
straight past.

The table below is the whole file. Each row is one move in Batch 3, the roles
the transition admits, and a request that would make it. From that:

  * the roles the transition names reach it,
  * every other role is refused 403 `role_not_permitted`,
  * a Field Surveyor who is not the round's surveyor is refused 403
    `not_the_assignee` on the four assignee-only moves,
  * a Field Surveyor may open a round only on a case assigned to them and only
    in their own name — `TestOwnRound`, which is not a table row because the
    rule is role-dependent and the nodal branch of the same transition is
    unconstrained,
  * no token at all is 401 before any of that is resolved,

and a meta-test fails if a Batch 3 transition is ever added without a row here,
so the coverage cannot quietly erode.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from ada_core.datetimes import now_ist

from tests.conftest import (
    JPEG_BYTES,
    LEAD,
    NODAL,
    SUPER_ADMIN,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

ICMS = "/api/icms"
ROLES = (SUPER_ADMIN, NODAL, SURVEYOR, LEAD)

KEY = "6f1d6dd9-8443-4b90-9a86-0f65c42b4001"

# `inspection_world` seeds these: CMP-2026-0006 is under_inspection with round
# INS-2026-0001; CMP-2026-0007 is inspection_submitted with INS-2026-0002; and
# CMP-2026-0008 is resurvey_requested with re-survey request 1 still pending.
# All three are assigned to SURVEYOR_ID.
UNDER_INSPECTION = "INS-2026-0001"
SUBMITTED = "INS-2026-0002"
SUBMITTED_CASE = "CMP-2026-0007"
RESURVEY_CASE = "CMP-2026-0008"
# Assigned to SURVEYOR_B, which is what makes it a colleague's case below.
OTHERS_CASE = "CMP-2026-0002"


def device_now() -> str:
    return now_ist().isoformat()


@dataclass(frozen=True)
class Move:
    """One move, as a request plus the roles the transition table admits to it."""

    action: str
    source: str | None
    method: str
    path: str
    allowed: frozenset
    ok: int = 200
    assignee_only: bool = False
    body: dict | None = None
    form: dict | None = None

    @property
    def id(self) -> str:
        return self.action

    def send(self, client, role: str | None = None, *, subject: str | None = None):
        signed = client.sign_in(role, subject=subject) if role else client.sign_in()
        return request(signed, self, subject=subject)


def request(client, move: Move, *, subject: str | None = None):
    if move.form is not None:
        return client.request(
            move.method, f"{ICMS}{move.path}", data=move.form,
            files={"file": ("front.jpg", JPEG_BYTES, "image/jpeg")})
    return client.request(move.method, f"{ICMS}{move.path}", json=move.body)


NODAL_ONLY = frozenset({NODAL})
SURVEYOR_ONLY = frozenset({SURVEYOR})
OPENERS = frozenset({NODAL, SURVEYOR})

MOVES: tuple[Move, ...] = (
    # On the re-survey case rather than on CMP-2026-0002, because a Field
    # Surveyor reaches `open_round` only on a case assigned to them (TestOwnRound
    # below) and CMP-2026-0002 belongs to surveyor B. Both `open_round`
    # transitions carry the same roles.
    Move("open_round", "resurvey_requested", "POST",
         f"/cases/{RESURVEY_CASE}/inspections",
         OPENERS, ok=201, body={"surveyor_user_id": SURVEYOR_ID}),
    Move("check_in", "under_inspection", "POST",
         f"/inspections/{UNDER_INSPECTION}/check-in", SURVEYOR_ONLY, ok=201,
         assignee_only=True,
         body={"latitude": 27.005, "longitude": 78.005, "accuracy_m": 7.0,
               "device_timestamp": device_now(), "capture_source": "gps",
               "idempotency_key": KEY}),
    Move("add_evidence", "under_inspection", "POST",
         f"/inspections/{UNDER_INSPECTION}/evidence", SURVEYOR_ONLY, ok=201,
         assignee_only=True,
         form={"kind": "photo", "latitude": "27.005", "longitude": "78.005",
               "accuracy_m": "6.0", "device_timestamp": device_now(),
               "capture_source": "camera", "idempotency_key": KEY}),
    Move("record_findings", "under_inspection", "PUT",
         f"/inspections/{UNDER_INSPECTION}/findings", SURVEYOR_ONLY,
         assignee_only=True, body={"findings": ["Unauthorised third floor."]}),
    Move("submit", "under_inspection", "POST",
         f"/inspections/{UNDER_INSPECTION}/submit", SURVEYOR_ONLY,
         assignee_only=True, body={"idempotency_key": KEY}),
    Move("verify_accept", "inspection_submitted", "POST",
         f"/inspections/{SUBMITTED}/verify", NODAL_ONLY, body={"decision": "accept"}),
    Move("verify_reject", "inspection_submitted", "POST",
         f"/inspections/{SUBMITTED}/verify", NODAL_ONLY,
         body={"decision": "reject", "reason": "No rear elevation photographed."}),
    Move("request_resurvey", "inspection_submitted", "POST",
         f"/cases/{SUBMITTED_CASE}/resurvey-requests", NODAL_ONLY, ok=201,
         body={"reason": "The measurements do not agree with the plan."}),
    # Not a transition of its own: deciding is the authority to open the round
    # the request asks for, so it admits exactly the roles `open_round` does.
    Move("decide_resurvey", None, "POST", "/resurvey-requests/1/decide", OPENERS,
         body={"decision": "approve", "surveyor_user_id": SURVEYOR_ID}),
)

ASSIGNEE_ONLY = tuple(move for move in MOVES if move.assignee_only)


def refusals() -> list[tuple[Move, str]]:
    return [(move, role) for move in MOVES for role in ROLES if role not in move.allowed]


def _id(value) -> str:
    return value if isinstance(value, str) else value.id


@pytest.mark.parametrize("move,role", refusals(), ids=_id)
def test_every_role_the_transition_does_not_name_is_refused(
    icms_client, inspection_loop, move, role
):
    """403 and not 404: the caller can see the case — they are refused the move.

    Super Admin appears in every one of these rows on purpose. Administration is
    a different authority from moving a case through enforcement, and a role that
    can do everything is the role every incident is eventually traced to.
    """
    response = move.send(icms_client, role)

    assert response.status_code == 403, (
        f"{move.action} as {role}: expected 403, got {response.status_code} — "
        f"{response.text[:300]}"
    )
    error = error_of(response)
    assert error["code"] == "role_not_permitted"
    assert role not in (error["allowed"] or [])


def permissions() -> list[tuple[Move, str]]:
    return [(move, role) for move in MOVES for role in sorted(move.allowed)]


@pytest.mark.parametrize("move,role", permissions(), ids=_id)
def test_the_roles_the_transition_names_can_make_the_move(
    icms_client, inspection_loop, move, role
):
    """The other half of the pair. A denial suite that refused everybody would
    pass while the endpoint was broken."""
    response = move.send(icms_client, role)

    assert response.status_code == move.ok, (
        f"{move.action} as {role}: expected {move.ok}, got {response.status_code} — "
        f"{response.text[:300]}"
    )


@pytest.mark.parametrize("move", ASSIGNEE_ONLY, ids=_id)
def test_a_surveyor_who_is_not_the_assignee_is_refused(
    icms_client, inspection_loop, move
):
    """The right role is not enough. A Field Surveyor may submit an inspection
    and may not submit somebody else's — that distinction is what decides whether
    a photograph is attributable to the person who took it, and the legacy system
    never drew it."""
    response = move.send(icms_client, SURVEYOR, subject=SURVEYOR_B_ID)

    assert response.status_code == 403, response.text[:300]
    assert error_of(response)["code"] == "not_the_assignee"


@pytest.mark.parametrize("move", MOVES, ids=_id)
def test_a_refused_move_writes_no_event(icms_client, inspection_loop, move, db):
    """A 403 that had already written half the change is worse than a 500."""
    from ada_core.models_icms import CaseEvent
    from sqlalchemy import func, select

    before = db.execute(select(func.count()).select_from(CaseEvent)).scalar_one()
    refused = next(role for role in ROLES if role not in move.allowed)
    move.send(icms_client, refused)

    assert db.execute(
        select(func.count()).select_from(CaseEvent)).scalar_one() == before


@pytest.mark.parametrize("move", MOVES, ids=_id)
def test_no_token_is_401_before_any_role_is_resolved(
    anonymous_client, inspection_loop, move
):
    """401 tells the client to refresh; 403 tells it not to bother. Confusing the
    two makes a client with an expired token retry for ever or give up wrongly."""
    response = request(anonymous_client, move)

    assert response.status_code == 401
    assert error_of(response)["code"] == "unauthenticated"


@pytest.mark.parametrize("move", MOVES, ids=_id)
def test_a_caller_with_no_icms_role_is_refused(icms_client, inspection_loop, move):
    """A verified token from the realm is not an officer of the authority."""
    assert move.send(icms_client).status_code == 403


class TestOwnRound:
    """`open_round` admits two roles with two different authorities.

    A PCS Nodal Officer allocates work: any case in their zones, named to any
    surveyor who can see the zone. A Field Surveyor starts their own visit: their
    own case, in their own name. The transition table cannot say this — it holds
    one `roles` set per transition and `assignee_only` would take the nodal
    branch away with it — so the rule is in the repository next to the zone
    check, and these are the tests of it.
    """

    def test_a_surveyor_may_not_open_a_round_on_a_colleagues_case(
        self, icms_client, inspection_loop
    ):
        """The bug this class was written for. CMP-2026-0002 is surveyor B's, and
        a round opened on it by surveyor A attributes B's work to A."""
        response = icms_client.sign_in(SURVEYOR).post(
            f"{ICMS}/cases/{OTHERS_CASE}/inspections",
            json={"surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 403, response.text[:300]
        assert error_of(response)["code"] == "not_the_assignee"

    def test_a_surveyor_may_open_a_round_on_their_own_case(
        self, icms_client, inspection_loop
    ):
        """The other half. Refusing everybody would pass the test above."""
        response = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).post(
            f"{ICMS}/cases/{OTHERS_CASE}/inspections",
            json={"surveyor_user_id": SURVEYOR_B_ID})

        assert response.status_code == 201, response.text[:300]

    def test_a_surveyor_may_not_name_another_surveyor_on_their_own_case(
        self, icms_client, inspection_loop
    ):
        """Naming somebody else is allocating work, which is the nodal officer's.
        `field` names the input the screen should highlight."""
        response = icms_client.sign_in(SURVEYOR).post(
            f"{ICMS}/cases/{RESURVEY_CASE}/inspections",
            json={"surveyor_user_id": SURVEYOR_B_ID})

        assert response.status_code == 403, response.text[:300]
        error = error_of(response)
        assert error["code"] == "not_the_assignee"
        assert error["field"] == "surveyor_user_id"

    def test_a_nodal_officer_opens_a_round_on_any_case_in_zone(
        self, icms_client, inspection_loop
    ):
        """Assignment authority, unchanged: CMP-2026-0002 is assigned to surveyor
        B and the officer names surveyor A on it."""
        response = icms_client.sign_in(NODAL).post(
            f"{ICMS}/cases/{OTHERS_CASE}/inspections",
            json={"surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 201, response.text[:300]

    def test_a_refused_open_writes_neither_round_nor_event(
        self, icms_client, inspection_loop, db
    ):
        """A 403 that had already minted INS-YYYY-NNNN is worse than a 500."""
        from ada_core.models_icms import CaseEvent, Inspection
        from sqlalchemy import func, select

        def counts() -> tuple[int, int]:
            return (
                db.execute(select(func.count()).select_from(Inspection)).scalar_one(),
                db.execute(select(func.count()).select_from(CaseEvent)).scalar_one(),
            )

        before = counts()

        icms_client.sign_in(SURVEYOR).post(
            f"{ICMS}/cases/{OTHERS_CASE}/inspections",
            json={"surveyor_user_id": SURVEYOR_ID})

        assert counts() == before

    # The re-survey branch reaches the same round through `_open_round_rows`, so
    # it is checked against the same rule rather than trusted to inherit it.
    def test_an_approved_resurvey_obeys_the_same_rule(
        self, icms_client, inspection_loop
    ):
        """Request 1 is on CMP-2026-0008, which is surveyor A's."""
        response = icms_client.sign_in(SURVEYOR).post(
            f"{ICMS}/resurvey-requests/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_B_ID})

        assert response.status_code == 403, response.text[:300]
        assert error_of(response)["code"] == "not_the_assignee"

    def test_a_surveyor_may_not_approve_a_resurvey_on_a_colleagues_case(
        self, icms_client, inspection_loop
    ):
        response = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).post(
            f"{ICMS}/resurvey-requests/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_B_ID})

        assert response.status_code == 403, response.text[:300]
        assert error_of(response)["code"] == "not_the_assignee"

    def test_a_surveyor_may_approve_a_resurvey_on_their_own_case(
        self, icms_client, inspection_loop
    ):
        response = icms_client.sign_in(SURVEYOR).post(
            f"{ICMS}/resurvey-requests/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 200, response.text[:300]

    def test_a_nodal_officer_still_opens_the_round_an_approval_asks_for(
        self, icms_client, inspection_loop
    ):
        """The path the fix most risked breaking: the officer who approves a
        re-survey is not the surveyor who will carry it out."""
        response = icms_client.sign_in(NODAL).post(
            f"{ICMS}/resurvey-requests/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 200, response.text[:300]
        body = response.json()
        assert (body["decision"], body["resulting_round"]) == ("approved", 2)


class TestTheShapeOfTheTable:
    def test_every_batch_three_transition_has_a_denial_row(self):
        """The meta-test. A transition added without a row here is a move whose
        route-level refusal nothing checks."""
        from app.icms import workflow as wf

        batch_three = {
            wf.Action.OPEN_ROUND, wf.Action.CHECK_IN, wf.Action.ADD_EVIDENCE,
            wf.Action.RECORD_FINDINGS, wf.Action.SUBMIT, wf.Action.VERIFY_ACCEPT,
            wf.Action.VERIFY_REJECT, wf.Action.REQUEST_RESURVEY,
        }
        covered = {move.action for move in MOVES}

        assert {str(action) for action in batch_three} <= covered

    def test_the_allowed_roles_are_the_ones_the_policy_holds(self):
        """The table above restates the policy, so it is checked against it: a
        row admitting a role the transition does not would make this whole file
        agree with the wrong answer."""
        from app.icms import policy
        from app.icms import workflow as wf

        for move in MOVES:
            if move.source is None:
                continue
            transition = next(
                t for t in wf.transitions_for(wf.Status(move.source))
                if str(t.action) == move.action
            )
            holders = policy.snapshot().roles_holding({transition.permission})
            assert holders == set(move.allowed), (
                f"{move.action}: the policy admits {sorted(holders)}"
            )

    def test_the_assignee_only_moves_are_the_ones_the_policy_marks(self):
        from app.icms import workflow as wf

        marked = {str(t.action) for t in wf.TRANSITIONS if t.assignee_only}

        assert {move.action for move in ASSIGNEE_ONLY} == marked

    def test_super_admin_holds_no_move_in_this_batch(self):
        """Stated here rather than left to be inferred from nine rows."""
        for move in MOVES:
            assert SUPER_ADMIN not in move.allowed, move.action
