"""ICMS Batch 2 — raise, read, amend, assign.

The batch where `workflow.check` goes live, so every mutation gets the pair the
testing standard requires: one test that the role which owns the transition can
make it, and one that a role which does not is refused. The second kind is the
point — the legacy routers are mounted with no authentication at all, and a
suite of happy paths would not have noticed.

Rule 1 is checked explicitly rather than assumed: every state change asserts that
exactly one `icms_case_event` row appeared, with the right from/to pair. A case
whose status moved with no event row is a case nobody can account for.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    LEAD,
    LEAD_ID,
    NODAL,
    NODAL_ID,
    SUPER_ADMIN,
    SUPER_ADMIN_ID,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

CASES = "/api/icms/cases"

RAISE = {
    "source": "public",
    "zone_cd": "TAJ",
    "complaint_type_cd": "unauthorised_construction",
    "complainant_name": "Nisha Verma",
    "complainant_phone": "9812345670",
    "property_address": "88 Kamla Nagar",
    "detail": "Fourth floor being added without sanction.",
}


@pytest.fixture
def filing_zones(db, zones):
    """The four zones, with all three enforcement roles holding TAJ.

    A case is filed only into a zone its author can already see, so a raise test
    run against zones nobody is assigned to would fail on the scope rather than
    on whatever it is about.
    """
    from ada_core.models_icms import ZoneAssignment

    db.add_all([
        ZoneAssignment(zone_id=zones["TAJ"].id, user_id=user_id,
                       assigned_by=SUPER_ADMIN_ID)
        for user_id in (NODAL_ID, SURVEYOR_ID, LEAD_ID)
    ])
    db.commit()
    return zones


@pytest.fixture
def surveyor_in_taj(db, zones, cases):
    """The surveyor covers TAJ as well as CANT, where three cases are not theirs.

    Without it the zone scope alone leaves the surveyor with CMP-2026-0003, and
    a test about the assignment narrowing would pass on the zone filter.
    """
    from ada_core.models_icms import ZoneAssignment

    db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                          assigned_by=SUPER_ADMIN_ID))
    db.commit()
    return cases


@pytest.fixture
def directory(keycloak):
    """The officer directory, live, with surveyor B holding `field-surveyor`.

    The realm double seeds the four officers whose count the officer
    administration suite pins; surveyor B is an ICMS fixture, so his role
    mapping is made here rather than there.
    """
    from app.main import app
    from app.routers.icms_cases import officer_directory

    keycloak.role_mappings[SURVEYOR_B_ID] = {"field-surveyor"}
    app.dependency_overrides[officer_directory] = lambda: keycloak
    yield keycloak
    app.dependency_overrides.pop(officer_directory, None)


# ---------------------------------------------------------------- stage 1
class TestRaise:
    def test_a_nodal_officer_raises_a_case(self, icms_client, filing_zones, code_values):
        response = icms_client.sign_in(NODAL).post(CASES, json=RAISE)

        assert response.status_code == 201
        body = response.json()
        assert body["case_ref"] == "CMP-2026-0001"
        assert (body["status"], body["stage_no"]) == ("raised", 1)
        assert body["zone_cd"] == "TAJ"

    def test_the_reference_is_minted_in_order(self, icms_client, filing_zones):
        client = icms_client.sign_in(NODAL)
        first = client.post(CASES, json=RAISE).json()["case_ref"]
        second = client.post(CASES, json=RAISE).json()["case_ref"]

        assert (first, second) == ("CMP-2026-0001", "CMP-2026-0002")

    def test_the_complaint_type_label_is_resolved(self, icms_client, filing_zones, code_values):
        body = icms_client.sign_in(NODAL).post(CASES, json=RAISE).json()

        assert body["complaint_type_label"] == "Unauthorised construction"

    def test_a_surveyor_may_raise_from_the_field(self, icms_client, filing_zones):
        """The transition is open to any authenticated officer: refusing a
        complaint because the reporter is the wrong rank is how a system stops
        being used."""
        response = icms_client.sign_in(SURVEYOR).post(
            CASES, json={**RAISE, "source": "field"})

        assert response.status_code == 201

    def test_a_project_lead_may_raise(self, icms_client, filing_zones):
        assert icms_client.sign_in(LEAD).post(CASES, json=RAISE).status_code == 201

    def test_super_admin_is_refused_by_the_state_machine(self, icms_client, filing_zones):
        """Super Admin holds no transition at all. Administration is a different
        authority from moving a case through enforcement, and the refusal comes
        from the transition table rather than from the router."""
        response = icms_client.sign_in(SUPER_ADMIN).post(CASES, json=RAISE)

        assert response.status_code == 403
        error = error_of(response)
        assert error["code"] == "role_not_permitted"
        assert SUPER_ADMIN not in (error["allowed"] or [])

    def test_a_refused_raise_consumes_no_reference(self, icms_client, filing_zones):
        """The gap arriving by the back door. If the number were allocated before
        the policy ran, a Super Admin's refused attempt would leave 0001 unused
        and the register would start at 0002."""
        icms_client.sign_in(SUPER_ADMIN).post(CASES, json=RAISE)
        after = icms_client.sign_in(NODAL).post(CASES, json=RAISE)

        assert after.json()["case_ref"] == "CMP-2026-0001"

    def test_an_invalid_body_consumes_no_reference(self, icms_client, filing_zones):
        icms_client.sign_in(NODAL).post(CASES, json={**RAISE, "zone_cd": "NOSUCH"})
        after = icms_client.sign_in(NODAL).post(CASES, json=RAISE)

        assert after.json()["case_ref"] == "CMP-2026-0001"

    def test_the_event_row_is_written_in_the_same_transaction(
        self, icms_client, filing_zones, db, events
    ):
        icms_client.sign_in(NODAL).post(CASES, json=RAISE)

        trail = events()
        assert len(trail) == 1
        assert trail[0]["action"] == "raise"
        assert (trail[0]["from_status"], trail[0]["to_status"]) == (None, "raised")
        assert trail[0]["actor_user_id"] == NODAL_ID
        assert trail[0]["actor_role"] == NODAL

    def test_the_event_payload_carries_no_personal_data(self, icms_client, filing_zones, events):
        icms_client.sign_in(NODAL).post(CASES, json=RAISE)

        payload = events()[0]["payload"] or {}
        assert "Nisha Verma" not in str(payload)
        assert "9812345670" not in str(payload)

    def test_neither_zone_nor_location_is_refused(self, icms_client, filing_zones):
        body = {k: v for k, v in RAISE.items() if k != "zone_cd"}
        response = icms_client.sign_in(NODAL).post(CASES, json=body)

        assert response.status_code == 422

    def test_an_unknown_zone_is_a_404(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(CASES, json={**RAISE, "zone_cd": "NOPE"})

        assert response.status_code == 404
        assert error_of(response)["code"] == "zone_not_found"

    def test_an_inactive_zone_cannot_receive_new_cases(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(CASES, json={**RAISE, "zone_cd": "OLD"})

        assert response.status_code == 404

    def test_a_zone_the_caller_cannot_see_is_refused(self, icms_client, filing_zones):
        """CANT is a zone of the authority and the nodal officer covers TAJ. A
        case filed there lands in a register its author cannot read, which is
        also a way to write into a zone nobody gave the officer."""
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "zone_cd": "CANT"})

        assert response.status_code == 404
        assert error_of(response)["code"] == "zone_not_found"

    def test_an_officer_holding_no_zone_files_nothing(self, icms_client, zones):
        response = icms_client.sign_in(NODAL).post(CASES, json=RAISE)

        assert response.status_code == 404

    def test_an_unknown_zone_and_one_outside_the_scope_are_one_refusal(
        self, icms_client, filing_zones
    ):
        """Two different answers here would let an officer walk the zone table
        from an endpoint, which is exactly what scoping `GET /zones` prevents."""
        client = icms_client.sign_in(NODAL)
        unknown = error_of(client.post(CASES, json={**RAISE, "zone_cd": "NOPE"}))
        hidden = error_of(client.post(CASES, json={**RAISE, "zone_cd": "CANT"}))

        assert unknown["code"] == hidden["code"] == "zone_not_found"
        assert unknown["message"] == hidden["message"]
        assert unknown["field"] == hidden["field"] == "zone_cd"

    def test_a_refused_zone_consumes_no_reference(self, icms_client, filing_zones):
        icms_client.sign_in(NODAL).post(CASES, json={**RAISE, "zone_cd": "CANT"})
        after = icms_client.sign_in(NODAL).post(CASES, json=RAISE)

        assert after.json()["case_ref"] == "CMP-2026-0001"

    def test_an_unknown_source_is_refused(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(CASES, json={**RAISE, "source": "carrier"})

        assert response.status_code == 422

    def test_a_detection_case_needs_its_detection(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "source": "detection"})

        assert response.status_code == 422

    def test_the_other_type_escape_hatch_is_required_with_the_other_code(
        self, icms_client, filing_zones
    ):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "complaint_type_cd": "other"})

        assert response.status_code == 422

    def test_an_unknown_body_field_is_refused(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(CASES, json={**RAISE, "status": "closed"})

        assert response.status_code == 422
        assert error_of(response)["field"] == "status"

    def test_a_bad_phone_number_is_refused(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "complainant_phone": "12345"})

        assert response.status_code == 422

    def test_no_token_is_refused(self, anonymous_client, filing_zones):
        assert anonymous_client.post(CASES, json=RAISE).status_code == 401

    def test_a_caller_with_no_icms_role_is_refused(self, icms_client, filing_zones):
        assert icms_client.sign_in().post(CASES, json=RAISE).status_code == 403


# ---------------------------------------------------------------- the detail
class TestDetail:
    def test_a_case_comes_back_with_its_assignment_and_counts(
        self, icms_client, cases, code_values
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{CASES}/CMP-2026-0002").json()

        assert body["case_ref"] == "CMP-2026-0002"
        assert body["assignment"]["assignee_user_id"] == SURVEYOR_B_ID
        assert body["assignment"]["active"] is True
        assert body["rounds"] == []
        assert body["evidence_count"] == 0

    def test_an_unassigned_case_has_no_assignment(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{CASES}/CMP-2026-0001").json()

        assert body["assignment"] is None
        assert body["assignee_user_id"] is None

    def test_the_allowed_actions_come_from_the_policy(self, icms_client, cases):
        """What the portal draws its buttons from. A convenience, never a
        control: `check` runs on every request whether or not a button existed."""
        nodal = icms_client.sign_in(NODAL).get(f"{CASES}/CMP-2026-0001").json()

        assert set(nodal["allowed_actions"]) == {"assign", "reject"}

    def test_the_allowed_actions_differ_by_role(self, icms_client, cases):
        lead = icms_client.sign_in(LEAD).get(f"{CASES}/CMP-2026-0001").json()

        assert lead["allowed_actions"] == []

    def test_a_reference_in_the_wrong_shape_is_refused_before_any_query(
        self, icms_client, cases
    ):
        response = icms_client.sign_in(SUPER_ADMIN).get(f"{CASES}/not-a-reference")

        assert response.status_code == 422

    def test_a_lower_case_reference_is_accepted(self, icms_client, cases):
        """A reference is copied out of an email or a printed notice at least as
        often as it is typed cleanly. The canonical form is upper case; refusing
        the other spelling teaches nobody anything."""
        response = icms_client.sign_in(SUPER_ADMIN).get(f"{CASES}/cmp-2026-0001")

        assert response.status_code == 200

    def test_an_unknown_case_is_a_404(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).get(f"{CASES}/CMP-2026-9999")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"

    def test_a_case_outside_the_scope_is_indistinguishable_from_absent(
        self, icms_client, cases
    ):
        """CMP-2026-0004 is in RURAL, which the nodal officer is not assigned to."""
        out_of_zone = icms_client.sign_in(NODAL).get(f"{CASES}/CMP-2026-0004")
        missing = icms_client.sign_in(NODAL).get(f"{CASES}/CMP-2026-9999")

        assert out_of_zone.status_code == missing.status_code == 404
        assert error_of(out_of_zone)["code"] == error_of(missing)["code"]

    def test_a_surveyor_reading_a_colleagues_case_is_refused(
        self, icms_client, surveyor_in_taj
    ):
        """CMP-2026-0002 is in TAJ, which the surveyor now covers, and is
        assigned to surveyor B. The detail carries the complainant's phone and
        email, the owner's name and phone, the police station and the point."""
        response = icms_client.sign_in(SURVEYOR).get(f"{CASES}/CMP-2026-0002")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"

    def test_a_colleagues_case_is_indistinguishable_from_one_that_does_not_exist(
        self, icms_client, surveyor_in_taj
    ):
        client = icms_client.sign_in(SURVEYOR)
        hidden = error_of(client.get(f"{CASES}/CMP-2026-0002"))
        missing = error_of(client.get(f"{CASES}/CMP-2026-9999"))

        assert hidden["code"] == missing["code"] == "case_not_found"
        assert hidden["field"] == missing["field"] is None

    def test_a_surveyor_still_reads_the_case_they_hold(self, icms_client, surveyor_in_taj):
        body = icms_client.sign_in(SURVEYOR).get(f"{CASES}/CMP-2026-0003").json()

        assert body["case_ref"] == "CMP-2026-0003"
        assert body["assignment"]["assignee_user_id"] == SURVEYOR_ID

    def test_a_nodal_officer_reads_every_case_in_their_zones(
        self, icms_client, surveyor_in_taj
    ):
        """The narrowing is the Field Surveyor's alone: several officers work
        one case at different stages, and the verifier is never its assignee."""
        response = icms_client.sign_in(NODAL).get(f"{CASES}/CMP-2026-0002")

        assert response.status_code == 200
        assert response.json()["complainant_name"] == "Bimal Roy"

    def test_no_token_is_refused(self, anonymous_client, cases):
        assert anonymous_client.get(f"{CASES}/CMP-2026-0001").status_code == 401


# ----------------------------------------------------------------- amend
class TestAmend:
    def test_a_nodal_officer_corrects_a_field(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"owner_name": "Ramesh Chandra Gupta"})

        assert response.status_code == 200
        assert response.json()["owner_name"] == "Ramesh Chandra Gupta"

    def test_omitted_fields_are_left_alone(self, icms_client, cases):
        """A PATCH that blanked every column the form did not carry would be a
        data loss with a 200 on it."""
        client = icms_client.sign_in(NODAL)
        client.patch(f"{CASES}/CMP-2026-0001", json={"owner_name": "Ramesh C Gupta"})
        body = client.get(f"{CASES}/CMP-2026-0001").json()

        assert body["complainant_name"] == "Asha Devi"
        assert body["property_address"] == "12 Fatehabad Road"

    def test_the_status_does_not_move(self, icms_client, cases):
        body = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"landmark": "Opposite Shilpgram"}).json()

        assert (body["status"], body["stage_no"]) == ("raised", 1)

    def test_the_status_cannot_be_smuggled_in(self, icms_client, cases):
        """The legacy route this replaces takes a client-supplied status and
        writes it to the column, on an unauthenticated route."""
        response = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"status": "confirmed"})

        assert response.status_code == 422
        assert error_of(response)["field"] == "status"

    def test_the_zone_cannot_be_smuggled_in(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"zone_cd": "RURAL"})

        assert response.status_code == 422

    def test_an_empty_amendment_is_refused(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).patch(f"{CASES}/CMP-2026-0001", json={})

        assert response.status_code == 422

    def test_an_amendment_writes_exactly_one_event(self, icms_client, cases, events):
        case_id = cases["CMP-2026-0001"].id
        icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"landmark": "Opposite Shilpgram"})

        trail = events(case_id)
        assert len(trail) == 1
        assert trail[0]["action"] == "amend"
        assert (trail[0]["from_status"], trail[0]["to_status"]) == ("raised", "raised")

    def test_the_event_names_the_fields_and_not_their_values(
        self, icms_client, cases, events
    ):
        icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"owner_name": "Ramesh Chandra Gupta"})

        payload = events(cases["CMP-2026-0001"].id)[0]["payload"]
        assert payload == {"fields": ["owner_name"]}

    def test_a_surveyor_is_refused(self, icms_client, cases):
        """A surveyor who finds the owner's name wrong records it as a finding.
        The complaint is what was reported; the finding is what was observed."""
        response = icms_client.sign_in(SURVEYOR).patch(
            f"{CASES}/CMP-2026-0003", json={"owner_name": "Someone Else"})

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"

    def test_a_project_lead_is_refused(self, icms_client, cases):
        response = icms_client.sign_in(LEAD).patch(
            f"{CASES}/CMP-2026-0001", json={"owner_name": "Someone Else"})

        assert response.status_code == 403

    def test_super_admin_is_refused(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{CASES}/CMP-2026-0001", json={"owner_name": "Someone Else"})

        assert response.status_code == 403

    def test_a_closed_case_cannot_be_amended(self, icms_client, cases):
        """Once a case is closed its record is the record. 409, not 403: the
        caller is entitled to make the request, the case is what is wrong."""
        response = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0005", json={"owner_name": "Too Late"})

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_refused_amendment_writes_nothing(self, icms_client, cases, events):
        icms_client.sign_in(SURVEYOR).patch(
            f"{CASES}/CMP-2026-0003", json={"owner_name": "Someone Else"})

        assert events(cases["CMP-2026-0003"].id) == []

    def test_a_case_outside_the_scope_is_a_404(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0004", json={"owner_name": "Not Mine"})

        assert response.status_code == 404

    def test_no_token_is_refused(self, anonymous_client, cases):
        response = anonymous_client.patch(f"{CASES}/CMP-2026-0001", json={"landmark": "X"})

        assert response.status_code == 401


# ---------------------------------------------------------------- stage 2
class TestAssign:
    @pytest.fixture(autouse=True)
    def _directory(self, directory):
        """Every assignment in this class is made with the realm reachable."""
        return directory

    def test_a_nodal_officer_assigns_a_raised_case(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 200
        body = response.json()
        assert (body["status"], body["stage_no"]) == ("assigned", 2)
        assert body["assignment"]["assignee_user_id"] == SURVEYOR_B_ID

    def test_the_status_comes_from_the_transition_table(self, icms_client, cases):
        """The router reads `target` and `stage_no` off the Transition rather
        than restating them, which is what stops it disagreeing with the table."""
        from app.icms import workflow as wf

        body = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID}
        ).json()
        transition = wf.check(wf.Status.RAISED, wf.Action.ASSIGN, [NODAL],
                              payload={"assignee_user_id": SURVEYOR_B_ID})

        assert body["status"] == str(transition.target)
        assert body["stage_no"] == transition.stage_no

    def test_assignment_writes_exactly_one_event(self, icms_client, cases, events):
        case_id = cases["CMP-2026-0001"].id
        icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        trail = events(case_id)
        assert len(trail) == 1
        assert trail[0]["action"] == "assign"
        assert (trail[0]["from_status"], trail[0]["to_status"]) == ("raised", "assigned")

    def test_reassignment_closes_the_old_row_and_opens_a_new_one(
        self, icms_client, cases, db
    ):
        """History stays readable, which is why this is not an UPDATE of the
        assignee. The legacy schema overwrote it and lost who held the case."""
        from ada_core.models_icms import CaseAssignment
        from sqlalchemy import select

        icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/assign",
            json={"assignee_user_id": SURVEYOR_B_ID, "reason": "workload"})

        rows = db.execute(
            select(CaseAssignment.assignee_user_id, CaseAssignment.active)
            .where(CaseAssignment.case_id == cases["CMP-2026-0002"].id)
            .order_by(CaseAssignment.id)
        ).all()

        assert len(rows) == 2
        assert rows[0].active is False
        assert rows[1].active is True

    def test_reassignment_is_recorded_as_reassign_not_assign(
        self, icms_client, cases, events
    ):
        icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/assign",
            json={"assignee_user_id": SURVEYOR_B_ID, "reason": "on leave"})

        trail = events(cases["CMP-2026-0002"].id)
        assert trail[0]["action"] == "reassign"
        assert trail[0]["note"] == "on leave"

    def test_reassignment_without_a_reason_is_refused_by_the_policy(
        self, icms_client, cases
    ):
        """The `reassign` transition requires it and `assign` does not. One
        authority for that, not two."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "missing_payload"
        assert error["field"] == "reason"

    def test_an_assignee_who_cannot_see_the_zone_is_refused(self, icms_client, cases):
        """A case assigned to an officer with no sight of the zone is work
        allocated into a hole: it appears in nobody's register."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_ID})

        assert response.status_code == 422
        assert error_of(response)["code"] == "assignee_not_in_zone"

    def test_an_assignee_who_is_not_a_field_surveyor_is_refused(
        self, icms_client, cases
    ):
        """The nodal officer covers TAJ, so the zone check passes and the case
        would go to an officer the transition table admits to none of its
        assignee-only moves: work allocated to somebody who cannot do it."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": NODAL_ID})

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "assignee_not_a_surveyor"
        assert error["field"] == "assignee_user_id"

    def test_a_field_surveyor_the_realm_knows_is_assignable(
        self, icms_client, cases, zones, db
    ):
        from ada_core.models_icms import ZoneAssignment

        db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                              assigned_by=SUPER_ADMIN_ID))
        db.commit()

        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_ID})

        assert response.status_code == 200
        assert response.json()["assignment"]["assignee_user_id"] == SURVEYOR_ID

    def test_a_refused_assignee_writes_nothing(self, icms_client, cases, events):
        icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": NODAL_ID})

        assert events(cases["CMP-2026-0001"].id) == []

    def test_an_unreachable_realm_does_not_stop_the_assignment(
        self, icms_client, cases, directory
    ):
        """Deliberate. The guard is a data-quality one — `workflow.check` refuses
        the assignee-only moves to a non-surveyor whatever this says — and an
        enforcement workflow must not stop because the directory is down."""
        from app.errors import ApiError

        directory.unavailable = ApiError(503, "identity_unavailable", "down")

        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 200

    def test_a_surveyor_cannot_assign(self, icms_client, cases):
        response = icms_client.sign_in(SURVEYOR).post(
            f"{CASES}/CMP-2026-0003/assign", json={"assignee_user_id": SURVEYOR_ID})

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"

    def test_a_project_lead_cannot_assign(self, icms_client, cases):
        response = icms_client.sign_in(LEAD).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 403

    def test_super_admin_cannot_assign(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 403

    def test_a_closed_case_cannot_be_assigned(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0005/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_refused_assignment_changes_nothing(self, icms_client, cases, events, db):
        from ada_core.models_icms import CaseAssignment
        from sqlalchemy import func, select

        icms_client.sign_in(SURVEYOR).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert events(cases["CMP-2026-0001"].id) == []
        assert db.execute(
            select(func.count()).select_from(CaseAssignment)
            .where(CaseAssignment.case_id == cases["CMP-2026-0001"].id)
        ).scalar_one() == 0

    def test_a_case_outside_the_scope_is_a_404(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0004/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 404

    def test_no_token_is_refused(self, anonymous_client, cases):
        response = anonymous_client.post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 401


# ------------------------------------------- retry-safe raise (revision 0002)
class TestIdempotentRaise:
    """A field app on a bad connection cannot tell a request that never arrived
    from a response that never came back, so it retries. Without a key the retry
    files the same complaint twice, under two references, into a register
    somebody then reconciles by hand.
    """

    KEY = "6f1d6dd9-8443-4b90-9a86-0f65c42bb001"

    def test_a_replay_returns_the_first_case_rather_than_a_second(
        self, icms_client, filing_zones
    ):
        client = icms_client.sign_in(NODAL)
        payload = {**RAISE, "idempotency_key": self.KEY}

        first = client.post(CASES, json=payload)
        second = client.post(CASES, json=payload)

        assert (first.status_code, second.status_code) == (201, 200)
        assert first.json()["case_ref"] == second.json()["case_ref"] == "CMP-2026-0001"

    def test_a_replay_consumes_no_reference(self, icms_client, filing_zones):
        """The hole arriving by the back door. Minting a number and discarding
        it because the row already exists is exactly the gap the counter design
        exists to avoid."""
        client = icms_client.sign_in(NODAL)
        payload = {**RAISE, "idempotency_key": self.KEY}

        client.post(CASES, json=payload)
        client.post(CASES, json=payload)
        next_case = client.post(CASES, json=RAISE)

        assert next_case.json()["case_ref"] == "CMP-2026-0002"

    def test_a_replay_writes_no_second_event(self, icms_client, filing_zones, events):
        """One raise, one audit row. A replay that logged a second `raise` would
        make the trail claim the complaint was filed twice."""
        client = icms_client.sign_in(NODAL)
        payload = {**RAISE, "idempotency_key": self.KEY}

        client.post(CASES, json=payload)
        client.post(CASES, json=payload)

        assert [row["action"] for row in events()] == ["raise"]

    def test_a_replay_creates_no_second_row(self, icms_client, filing_zones, db):
        from ada_core.models_icms import Case
        from sqlalchemy import func, select

        client = icms_client.sign_in(NODAL)
        payload = {**RAISE, "idempotency_key": self.KEY}
        client.post(CASES, json=payload)
        client.post(CASES, json=payload)

        assert db.execute(select(func.count()).select_from(Case)).scalar_one() == 1

    def test_different_keys_file_different_cases(self, icms_client, filing_zones):
        client = icms_client.sign_in(NODAL)
        first = client.post(CASES, json={**RAISE, "idempotency_key": self.KEY})
        second = client.post(
            CASES,
            json={**RAISE, "idempotency_key": "7a2e7ee0-9554-4ca1-8b97-1f76d53cc002"},
        )

        assert first.json()["case_ref"] != second.json()["case_ref"]
        assert second.status_code == 201

    def test_a_raise_without_a_key_is_still_allowed(self, icms_client, filing_zones):
        """The portal has a human in front of it who can see the result. The key
        is for the offline queue, not a requirement on everybody."""
        client = icms_client.sign_in(NODAL)

        assert client.post(CASES, json=RAISE).status_code == 201
        assert client.post(CASES, json=RAISE).status_code == 201

    def test_the_key_must_be_a_uuid(self, icms_client, filing_zones):
        """A UUID rather than a free string on purpose: the uniqueness of the
        retry guard should not depend on a client's idea of what makes a key."""
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "idempotency_key": "retry-1"})

        assert response.status_code == 422

    def test_the_key_is_not_amendable(self, icms_client, filing_zones):
        """Rewriting it would let a caller detach a case from the retry that
        created it."""
        client = icms_client.sign_in(NODAL)
        client.post(CASES, json={**RAISE, "idempotency_key": self.KEY})

        response = client.patch(
            f"{CASES}/CMP-2026-0001", json={"idempotency_key": self.KEY})

        assert response.status_code == 422


class TestParcelOnRaise:
    def test_a_case_can_be_raised_with_its_parcel(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(CASES, json={
            **RAISE, "ulpin": "ab12cd34ef56gh", "khasra_no": " 127 / 1 ",
            "village_lgd_code": "071234", "priority": "high",
        })

        assert response.status_code == 201
        body = response.json()
        # Upper-cased on the way in, because it is transcribed off a document.
        assert body["ulpin"] == "AB12CD34EF56GH"
        # Separators normalised: `127 / 1` and `127/1` are the same plot.
        assert body["khasra_no"] == "127/1"
        assert body["parcel_id"] == "AB12CD34EF56GH"
        assert body["priority"] == "high"

    def test_a_short_ulpin_is_refused(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "ulpin": "TOOSHORT"})

        assert response.status_code == 422

    def test_a_khasra_that_is_not_a_plot_number_is_refused(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "khasra_no": "behind the temple"})

        assert response.status_code == 422

    def test_a_devanagari_khasra_suffix_survives(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "khasra_no": "1234-अ"})

        assert response.status_code == 201
        assert response.json()["khasra_no"] == "1234-अ"

    def test_an_unknown_priority_is_refused(self, icms_client, filing_zones):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "priority": "urgent"})

        assert response.status_code == 422

    def test_the_parcel_can_be_corrected_later(self, icms_client, cases):
        response = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"khasra_no": "50/2", "priority": "low"})

        assert response.status_code == 200
        assert response.json()["khasra_no"] == "50/2"
        assert response.json()["priority"] == "low"
