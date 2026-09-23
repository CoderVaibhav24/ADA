"""The re-survey loop: the part the legacy schema could not express.

It stored a second inspection row with nothing distinguishing it from the first,
so "what did we find the first time" had no answer. Here a round is numbered and
`UNIQUE (case_id, round_no)` makes a duplicate impossible rather than merely
discouraged — and the test that matters most in this file is that after round 2
exists, round 1 still reads back exactly as it was.

Two paths through a re-survey request, and they are not symmetrical. Approving
opens round n+1, in the same transaction as the decision, so a request recorded
as approved and a round that never opened cannot both be true. Refusing records
the decision on the request row and moves no case — there is no transition for a
refusal and none is invented.
"""

from __future__ import annotations

from tests.conftest import (
    LEAD,
    NODAL,
    NODAL_ID,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.test_icms_inspections import KEY, check_in_body, open_round
from tests.test_icms_reference import error_of

ICMS = "/api/icms"
CASES = f"{ICMS}/cases"
INSPECTIONS = f"{ICMS}/inspections"
REQUESTS = f"{ICMS}/resurvey-requests"

# Seeded by `inspection_world`: inspection_submitted, round 1 is INS-2026-0002.
SUBMITTED_CASE = "CMP-2026-0007"
# resurvey_requested, with re-survey request 1 still pending.
PENDING_CASE = "CMP-2026-0008"

REASON = "The measured area does not agree with the sanctioned plan."


class TestRequestResurvey:
    def test_a_nodal_officer_asks_for_another_round(self, icms_client, inspection_loop):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{SUBMITTED_CASE}/resurvey-requests", json={"reason": REASON})

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["case_ref"] == SUBMITTED_CASE
        assert body["decision"] == "pending"
        assert body["from_round"] == 1
        assert body["reason"] == REASON
        assert body["requested_by"] == NODAL_ID
        assert body["resulting_round"] is None
        assert body["decided_by"] is None

    def test_the_case_moves_to_the_transition_target(self, icms_client, inspection_loop):
        from app.icms import workflow as wf

        icms_client.sign_in(NODAL).post(
            f"{CASES}/{SUBMITTED_CASE}/resurvey-requests", json={"reason": REASON})
        case = icms_client.sign_in(NODAL).get(f"{CASES}/{SUBMITTED_CASE}").json()
        transition = wf.check(wf.Status.INSPECTION_SUBMITTED, wf.Action.REQUEST_RESURVEY,
                              [NODAL], payload={"reason": REASON})

        assert case["status"] == str(transition.target)
        assert case["stage_no"] == transition.stage_no

    def test_the_request_writes_its_event_with_the_reason(
        self, icms_client, inspection_loop, events, db
    ):
        from ada_core.models_icms import Case
        from sqlalchemy import select

        case_id = db.execute(
            select(Case.id).where(Case.case_ref == SUBMITTED_CASE)).scalar_one()
        icms_client.sign_in(NODAL).post(
            f"{CASES}/{SUBMITTED_CASE}/resurvey-requests", json={"reason": REASON})

        trail = events(case_id)
        assert trail[-1]["action"] == "request_resurvey"
        assert (trail[-1]["from_status"], trail[-1]["to_status"]) == (
            "inspection_submitted", "resurvey_requested")
        assert trail[-1]["note"] == REASON
        assert trail[-1]["round_no"] == 1

    def test_a_reason_is_required(self, icms_client, inspection_loop):
        """A surveyor sent back with no reason has nothing to do differently."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{SUBMITTED_CASE}/resurvey-requests", json={})

        assert response.status_code == 422

    def test_a_second_open_request_is_refused(self, icms_client, inspection_loop):
        """One open request per case, enforced by a partial unique index: a
        second one is a question already asked."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{PENDING_CASE}/resurvey-requests", json={"reason": REASON})

        assert response.status_code in (409, 422), response.text

    def test_a_case_that_has_not_been_submitted_cannot_be_re_surveyed(
        self, icms_client, inspection_loop
    ):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0006/resurvey-requests", json={"reason": REASON})

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_case_outside_the_scope_is_a_404(self, icms_client, inspection_loop):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0004/resurvey-requests", json={"reason": REASON})

        assert response.status_code == 404

    def test_no_token_is_refused(self, anonymous_client, inspection_loop):
        response = anonymous_client.post(
            f"{CASES}/{SUBMITTED_CASE}/resurvey-requests", json={"reason": REASON})

        assert response.status_code == 401


class TestDecide:
    def test_approving_opens_the_next_round(self, icms_client, inspection_loop):
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID,
                  "note": "Re-measure the rear setback."})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["decision"] == "approved"
        assert body["resulting_round"] == 2
        assert body["decided_by"] == NODAL_ID
        assert body["decided_at"] is not None
        assert body["decision_note"] == "Re-measure the rear setback."

    def test_the_round_and_the_decision_are_one_transaction(
        self, icms_client, inspection_loop, db
    ):
        from ada_core.models_icms import Case, Inspection
        from sqlalchemy import select

        icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        case_id = db.execute(
            select(Case.id).where(Case.case_ref == PENDING_CASE)).scalar_one()
        rounds = db.execute(
            select(Inspection.round_no, Inspection.inspection_ref)
            .where(Inspection.case_id == case_id).order_by(Inspection.round_no)
        ).all()

        assert [row.round_no for row in rounds] == [1, 2]
        assert rounds[1].inspection_ref == "INS-2026-0004"

    def test_the_case_goes_back_under_inspection(self, icms_client, inspection_loop):
        icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        case = icms_client.sign_in(NODAL).get(f"{CASES}/{PENDING_CASE}").json()
        assert (case["status"], case["stage_no"]) == ("under_inspection", 3)
        assert case["current_round"] == 2

    def test_approving_writes_an_open_round_event(self, icms_client, inspection_loop,
                                                  events, db):
        from ada_core.models_icms import Case
        from sqlalchemy import select

        case_id = db.execute(
            select(Case.id).where(Case.case_ref == PENDING_CASE)).scalar_one()
        icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        trail = events(case_id)
        assert trail[-1]["action"] == "open_round"
        assert (trail[-1]["from_status"], trail[-1]["to_status"]) == (
            "resurvey_requested", "under_inspection")
        assert trail[-1]["round_no"] == 2
        assert trail[-1]["payload"]["resurvey_request_id"] == 1

    def test_approving_without_a_surveyor_is_refused(self, icms_client, inspection_loop):
        """Approving opens a round, and a round has to belong to somebody."""
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide", json={"decision": "approve"})

        assert response.status_code == 422

    def test_a_surveyor_who_cannot_see_the_zone_is_refused(
        self, icms_client, inspection_loop
    ):
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": "nobody-at-all"})

        assert response.status_code == 422
        assert error_of(response)["code"] == "assignee_not_in_zone"

    def test_refusing_records_the_decision_and_opens_nothing(
        self, icms_client, inspection_loop, db
    ):
        """There is no transition for a refusal and none is invented, so the case
        does not move. The request row carries who decided, when and why, which
        is the record of the refusal."""
        from ada_core.models_icms import Case, Inspection
        from sqlalchemy import func, select

        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "refuse", "note": "The first round was sufficient."})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["decision"] == "rejected"
        assert body["resulting_round"] is None
        assert body["decision_note"] == "The first round was sufficient."
        assert body["decided_by"] == NODAL_ID

        case_id = db.execute(
            select(Case.id).where(Case.case_ref == PENDING_CASE)).scalar_one()
        assert db.execute(
            select(func.count()).select_from(Inspection)
            .where(Inspection.case_id == case_id)).scalar_one() == 1
        case = icms_client.sign_in(NODAL).get(f"{CASES}/{PENDING_CASE}").json()
        assert case["status"] == "resurvey_requested"

    def test_deciding_twice_is_refused(self, icms_client, inspection_loop):
        client = icms_client.sign_in(NODAL)
        client.post(f"{REQUESTS}/1/decide",
                    json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        again = client.post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        assert again.status_code == 409
        assert error_of(again)["code"] == "resurvey_already_decided"

    def test_an_unknown_request_is_a_404(self, icms_client, inspection_loop):
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/9999/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 404
        assert error_of(response)["code"] == "resurvey_request_not_found"

    def test_a_project_lead_may_not_decide(self, icms_client, inspection_loop):
        """Deciding is the authority to open the round being asked for, and the
        lead holds no part of it."""
        response = icms_client.sign_in(LEAD).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "No."})

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"

    def test_no_token_is_refused(self, anonymous_client, inspection_loop):
        response = anonymous_client.post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 401


class TestWhoseRequestItIsToDecide:
    """Refusing is the same authority as approving, and is bound the same way.

    The two branches do not look alike — approving opens a round and refusing
    writes one column — so it is tempting to guard only the first. That is the
    wrong way round. `open_round` is the ONLY transition out of
    `resurvey_requested`; a refusal by someone with no authority over the case
    strands it where the nodal officer cannot raise a second request either,
    because `request_resurvey` fires only from `inspection_submitted`. The
    damage a refusal does is permanent and the damage an approval does is a
    round somebody can decline.

    `inspection_world` assigns CMP-2026-0008 — the case request 1 sits on — to
    SURVEYOR_ID, and gives surveyor B sight of the same zone.
    """

    def test_a_surveyor_may_not_refuse_a_request_on_a_colleagues_case(
        self, icms_client, inspection_loop
    ):
        response = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "refuse", "note": "Not needed."})

        assert response.status_code == 403, response.text[:300]
        assert error_of(response)["code"] == "not_the_assignee"

    def test_a_refusal_it_had_no_authority_for_leaves_the_request_pending(
        self, icms_client, inspection_loop
    ):
        """The point of the refusal above. A request decided by the wrong officer
        cannot be decided again — `resurvey_already_decided` — and the case has
        no transition left."""
        icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "Not needed."})

        rows = icms_client.sign_in(NODAL).get(
            f"{CASES}/{PENDING_CASE}/resurvey-requests").json()

        assert [row["decision"] for row in rows] == ["pending"]
        assert rows[0]["decided_by"] is None

    def test_the_surveyor_whose_case_it_is_may_refuse(
        self, icms_client, inspection_loop
    ):
        """The other half. A rule that refused every surveyor would pass the two
        tests above and take a real authority away."""
        response = icms_client.sign_in(SURVEYOR).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "Round 1 stands."})

        assert response.status_code == 200, response.text[:300]
        assert response.json()["decision"] == "rejected"

    def test_a_nodal_officer_refuses_anything_in_their_zones(
        self, icms_client, inspection_loop
    ):
        """Unchanged, and the branch most at risk of being broken by the fix."""
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "No."})

        assert response.status_code == 200, response.text[:300]
        assert response.json()["decided_by"] == NODAL_ID

    def test_a_project_lead_is_still_refused_by_role_before_anything_else(
        self, icms_client, inspection_loop
    ):
        """Ordering: the transition is checked first, so a role that holds no part
        of `open_round` is told that rather than told whose case it is."""
        response = icms_client.sign_in(LEAD).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "No."})

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"


class TestListResurveyRequests:
    """The read that makes the loop decidable.

    `POST /decide` takes an id, and until this route existed nothing produced one
    that survived a page load: the request came back only from the two writes, so
    the officer who raised it lost sight of it on navigation and the officer who
    had to decide it — a different person, a different visit — never saw it.
    """

    def test_a_raised_request_is_still_readable_afterwards(
        self, icms_client, inspection_loop
    ):
        nodal = icms_client.sign_in(NODAL)
        raised = nodal.post(f"{CASES}/{SUBMITTED_CASE}/resurvey-requests",
                            json={"reason": REASON}).json()

        response = nodal.get(f"{CASES}/{SUBMITTED_CASE}/resurvey-requests")

        assert response.status_code == 200, response.text
        body = response.json()
        assert [row["id"] for row in body] == [raised["id"]]
        assert body[0]["case_ref"] == SUBMITTED_CASE
        assert body[0]["from_round"] == 1
        assert body[0]["reason"] == REASON
        assert body[0]["requested_by"] == NODAL_ID
        assert body[0]["decision"] == "pending"
        assert body[0]["decided_by"] is None
        assert body[0]["decided_at"] is None
        assert body[0]["decision_note"] is None

    def test_the_decision_is_visible_on_the_row_it_was_recorded_on(
        self, icms_client, inspection_loop
    ):
        nodal = icms_client.sign_in(NODAL)
        nodal.post(f"{REQUESTS}/1/decide",
                   json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID,
                         "note": "Re-measure the rear setback."})

        body = nodal.get(f"{CASES}/{PENDING_CASE}/resurvey-requests").json()

        assert [row["id"] for row in body] == [1]
        assert body[0]["decision"] == "approved"
        assert body[0]["decided_by"] == NODAL_ID
        assert body[0]["decided_at"] is not None
        assert body[0]["decision_note"] == "Re-measure the rear setback."
        assert body[0]["resulting_round"] == 2

    def test_a_decided_request_stays_beside_the_pending_one_newest_first(
        self, icms_client, inspection_loop
    ):
        """Round 1's decision is why round 2 happened. A panel that showed only
        the open request would lose that the moment somebody answered it."""
        nodal = icms_client.sign_in(NODAL)
        first = nodal.post(f"{CASES}/{SUBMITTED_CASE}/resurvey-requests",
                           json={"reason": REASON}).json()["id"]
        nodal.post(f"{REQUESTS}/{first}/decide",
                   json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})
        rounds = nodal.get(f"{CASES}/{SUBMITTED_CASE}").json()["rounds"]
        second_round = [r for r in rounds if r["round_no"] == 2][0]["inspection_ref"]
        icms_client.sign_in(SURVEYOR).post(f"{INSPECTIONS}/{second_round}/submit",
                                           json={"idempotency_key": KEY})
        nodal = icms_client.sign_in(NODAL)
        second = nodal.post(
            f"{CASES}/{SUBMITTED_CASE}/resurvey-requests",
            json={"reason": "The rear setback is still unmeasured."}).json()["id"]

        body = nodal.get(f"{CASES}/{SUBMITTED_CASE}/resurvey-requests").json()

        assert [row["id"] for row in body] == [second, first]
        assert [row["decision"] for row in body] == ["pending", "approved"]
        assert [row["from_round"] for row in body] == [2, 1]
        assert body[1]["resulting_round"] == 2

    def test_a_case_with_no_requests_is_an_empty_list(self, icms_client, inspection_loop):
        """Not a 404. The portal reads 404 as "empty" today, and that crutch is
        what this route exists to take away."""
        response = icms_client.sign_in(NODAL).get(
            f"{CASES}/{SUBMITTED_CASE}/resurvey-requests")

        assert response.status_code == 200, response.text
        assert response.json() == []

    def test_a_case_outside_the_caller_s_zones_is_a_404(self, icms_client,
                                                        inspection_world):
        """`inspection_world` without the TAJ grant: the surveyor sees CANT alone.
        The case exists and carries a pending request, and the answer is the same
        one an absent case gets — existence does not cross a zone boundary."""
        response = icms_client.sign_in(SURVEYOR).get(
            f"{CASES}/{PENDING_CASE}/resurvey-requests")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"

    def test_a_case_nobody_is_assigned_to_is_a_404(self, icms_client, inspection_loop):
        response = icms_client.sign_in(NODAL).get(
            f"{CASES}/CMP-2026-0004/resurvey-requests")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"

    def test_every_officer_may_read_them(self, icms_client, inspection_loop):
        """`inspection.read` is granted to all four roles: the decider is not
        always the officer who asked, and a lead reads the loop without acting."""
        for role in (LEAD, SURVEYOR, NODAL):
            response = icms_client.sign_in(role).get(
                f"{CASES}/{PENDING_CASE}/resurvey-requests")

            assert response.status_code == 200, f"{role}: {response.text}"
            assert [row["id"] for row in response.json()] == [1]

    def test_no_token_is_refused(self, anonymous_client, inspection_loop):
        response = anonymous_client.get(f"{CASES}/{PENDING_CASE}/resurvey-requests")

        assert response.status_code == 401


class TestTheWholeLoop:
    """One case, twice round the loop, from `assigned` to `verified`."""

    CASE = "CMP-2026-0002"

    def first_round(self, icms_client) -> str:
        ref = open_round(icms_client, self.CASE, SURVEYOR_ID)
        surveyor = icms_client.sign_in(SURVEYOR)
        surveyor.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
        surveyor.put(f"{INSPECTIONS}/{ref}/findings",
                     json={"findings": ["Third floor under construction."],
                           "measured_area_sqm": 120.0})
        submitted = surveyor.post(f"{INSPECTIONS}/{ref}/submit",
                                  json={"idempotency_key": KEY})
        assert submitted.status_code == 200, submitted.text
        return ref

    def second_round(self, icms_client) -> str:
        nodal = icms_client.sign_in(NODAL)
        request_id = nodal.post(f"{CASES}/{self.CASE}/resurvey-requests",
                                json={"reason": REASON}).json()["id"]
        decided = nodal.post(f"{REQUESTS}/{request_id}/decide",
                             json={"decision": "approve",
                                   "surveyor_user_id": SURVEYOR_ID})
        assert decided.status_code == 200, decided.text
        assert decided.json()["resulting_round"] == 2
        case = nodal.get(f"{CASES}/{self.CASE}").json()
        return [r for r in case["rounds"] if r["round_no"] == 2][0]["inspection_ref"]

    def test_the_loop_runs_twice_and_ends_verified(self, icms_client, inspection_ready):
        first = self.first_round(icms_client)
        second = self.second_round(icms_client)

        surveyor = icms_client.sign_in(SURVEYOR)
        surveyor.put(f"{INSPECTIONS}/{second}/findings",
                     json={"findings": ["Third floor complete; area re-measured."],
                           "measured_area_sqm": 148.0})
        surveyor.post(f"{INSPECTIONS}/{second}/submit",
                      json={"idempotency_key": "6f1d6dd9-8443-4b90-9a86-0f65c42b6002"})
        accepted = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{second}/verify", json={"decision": "accept"})

        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["case_status"] == "verified"
        assert first != second

    def test_round_one_stays_readable_after_round_two_exists(
        self, icms_client, inspection_ready
    ):
        """The whole point of numbering a round. The legacy system lost this."""
        first = self.first_round(icms_client)
        before = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{first}").json()
        self.second_round(icms_client)

        after = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{first}").json()

        assert after["round_no"] == 1
        assert after["status"] == "submitted"
        assert after["submitted_at"] == before["submitted_at"]
        assert [f["finding"] for f in after["findings"]] == [
            "Third floor under construction."]
        assert after["measured_area_sqm"] == 120.0
        assert len(after["check_ins"]) == 1

    def test_the_two_rounds_carry_different_measurements(
        self, icms_client, inspection_ready
    ):
        """A re-survey adds a round; it never replaces one. Both answers stay on
        the record, which is what makes the second one worth anything."""
        first = self.first_round(icms_client)
        second = self.second_round(icms_client)
        icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{second}/findings",
            json={"findings": ["Re-measured."], "measured_area_sqm": 148.0})

        nodal = icms_client.sign_in(NODAL)
        rounds = nodal.get(f"{CASES}/{self.CASE}").json()["rounds"]

        assert [r["round_no"] for r in rounds] == [1, 2]
        assert [r["measured_area_sqm"] for r in rounds] == [120.0, 148.0]
        assert nodal.get(f"{INSPECTIONS}/{first}").json()["measured_area_sqm"] == 120.0

    def test_both_rounds_appear_in_the_register(self, icms_client, inspection_ready):
        self.first_round(icms_client)
        self.second_round(icms_client)

        body = icms_client.sign_in(NODAL).get(
            INSPECTIONS, params={"case_ref": self.CASE}).json()

        assert body["total"] == 2
        assert sorted(row["round_no"] for row in body["items"]) == [1, 2]

    def test_the_audit_trail_reads_as_the_loop_it_was(
        self, icms_client, inspection_ready, events
    ):
        """Every state change left its row, in order, in the same transaction as
        the change. A case whose status moved with no event row is a case nobody
        can account for."""
        self.first_round(icms_client)
        self.second_round(icms_client)

        trail = events(inspection_ready[self.CASE].id)
        assert [row["action"] for row in trail] == [
            "open_round", "check_in", "record_findings", "submit",
            "request_resurvey", "open_round",
        ]
        assert [row["round_no"] for row in trail] == [1, 1, 1, 1, 1, 2]
