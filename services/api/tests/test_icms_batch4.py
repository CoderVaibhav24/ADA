"""ICMS Batch 4 — handover and confirmation, stages 6 and 7.

Two transitions the table already held, and nothing else: no schema change, no
new status, no outbound call. The Parivartan seam is after `issue_notice` and
belongs to Batch 6, so a test here that reached outside this service would be
testing the wrong batch — `TestTheParivartanBoundary` says so in assertions
rather than in a comment.

Every move gets the pair the testing standard requires: the role that owns the
transition makes it, and every role that does not is refused at the API. The
denial is the half that matters — the legacy routes carry no authentication at
all, and a suite of happy paths would not have noticed.
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
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

CASES = "/api/icms/cases"

VERIFIED = "CMP-2026-0011"
HANDED_OVER = "CMP-2026-0012"
OUT_OF_ZONE = "CMP-2026-0013"
RAISED = "CMP-2026-0001"

# Officers with no history on any case, for the ownership clauses below.
RELIEF_NODAL = "bbbbbbbb-0000-4000-8000-00000000000b"
RELIEF_LEAD = "dddddddd-0000-4000-8000-00000000000d"


@pytest.fixture
def stages_six_and_seven(db, zones, cases):
    """The two statuses Batch 4 moves from, with every role able to see them.

    All four principals hold TAJ, so a refusal is about the ROLE and not about
    zone scope — the interesting denial is the one a caller who CAN see the case
    still gets. `CMP-2026-0013` carries the same `verified` status in RURAL,
    which nobody holds, so the only thing separating it from `CMP-2026-0011` is
    the zone.
    """
    from ada_core.models_icms import Case, ZoneAssignment

    db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                          assigned_by=SUPER_ADMIN_ID))

    rows = [
        Case(case_ref=VERIFIED, zone_id=zones["TAJ"].id, source="field",
             status="verified", stage_no=5, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Imran Sheikh",
             property_address="14 Nai Ki Mandi", created_by=NODAL_ID),
        Case(case_ref=HANDED_OVER, zone_id=zones["TAJ"].id, source="office",
             status="handed_over", stage_no=6, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Jyoti Saxena",
             property_address="2 Shahganj", created_by=NODAL_ID),
        Case(case_ref=OUT_OF_ZONE, zone_id=zones["RURAL"].id, source="field",
             status="verified", stage_no=5, current_round=1,
             complaint_type_cd="illegal_colony", complainant_name="Kamal Yadav",
             property_address="Village Bichpuri", created_by=NODAL_ID),
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return {**cases, **{row.case_ref: row for row in rows}}


def status_of(db, case_ref: str) -> tuple[str, int]:
    """The persisted status and stage, read past the session's identity map."""
    from ada_core.models_icms import Case
    from sqlalchemy import select

    db.expire_all()
    row = db.execute(
        select(Case.status, Case.stage_no).where(Case.case_ref == case_ref)
    ).one()
    return row.status, row.stage_no


class TestHandover:
    def test_a_nodal_officer_hands_over_a_verified_case(self, icms_client,
                                                        stages_six_and_seven):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{VERIFIED}/handover", json={"note": "Passing to the authority."})

        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["status"], body["stage_no"]) == ("handed_over", 6)

    def test_the_status_and_stage_come_from_the_transition_table(
        self, icms_client, stages_six_and_seven
    ):
        """The repository reads `target` and `stage_no` off the Transition; no
        router decides a status, which is what stops it disagreeing with the table."""
        from app.icms import workflow as wf

        body = icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover").json()
        transition = wf.check(wf.Status.VERIFIED, wf.Action.HAND_OVER, [NODAL])

        assert body["status"] == str(transition.target)
        assert body["stage_no"] == transition.stage_no

    def test_handover_writes_exactly_one_event(self, icms_client, stages_six_and_seven,
                                               events):
        case_id = stages_six_and_seven[VERIFIED].id
        icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")

        trail = events(case_id)
        assert len(trail) == 1
        assert trail[0]["action"] == "hand_over"
        assert (trail[0]["from_status"], trail[0]["to_status"]) == (
            "verified", "handed_over")

    def test_the_event_names_the_officer_who_made_the_move(
        self, icms_client, stages_six_and_seven, events
    ):
        icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")

        event = events(stages_six_and_seven[VERIFIED].id)[0]
        assert event["actor_user_id"] == NODAL_ID
        assert event["actor_role"] == NODAL

    def test_the_note_is_recorded_on_the_event(self, icms_client, stages_six_and_seven,
                                               events):
        icms_client.sign_in(NODAL).post(
            f"{CASES}/{VERIFIED}/handover", json={"note": "Measured area agreed."})

        assert events(stages_six_and_seven[VERIFIED].id)[0]["note"] == (
            "Measured area agreed.")

    def test_the_body_may_be_omitted_entirely(self, icms_client, stages_six_and_seven):
        """The transition carries no `requires`, so a bare POST is the normal case."""
        response = icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")

        assert response.status_code == 200
        assert response.json()["status"] == "handed_over"

    def test_an_unknown_body_field_is_refused_by_name(self, icms_client,
                                                      stages_six_and_seven):
        """A client-supplied status does not survive `extra="forbid"`, which is
        what the legacy `updateComplainStatus` route accepted from anyone."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{VERIFIED}/handover", json={"status": "confirmed"})

        assert response.status_code == 422
        assert error_of(response)["field"] == "status"

    def test_the_status_and_the_event_share_one_transaction(
        self, icms_client, stages_six_and_seven, db, events, monkeypatch
    ):
        """Rule 1, proved rather than assumed: break the event write and the status
        must not have moved. A case whose status moved with no event row is a case
        nobody can account for."""
        from app.icms import cases as repo

        def explode(*_args, **_kwargs):
            raise RuntimeError("the event row could not be written")

        monkeypatch.setattr(repo, "_event", explode)

        with pytest.raises(RuntimeError):
            icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")

        assert status_of(db, VERIFIED) == ("verified", 5)
        assert events(stages_six_and_seven[VERIFIED].id) == []


class TestHandoverIsRefused:
    @pytest.mark.parametrize("role", [SURVEYOR, LEAD, SUPER_ADMIN])
    def test_every_role_the_table_does_not_admit_is_refused(
        self, icms_client, stages_six_and_seven, role
    ):
        """All three can see TAJ, so this is the transition table refusing a role
        rather than zone scope hiding a row."""
        response = icms_client.sign_in(role).post(f"{CASES}/{VERIFIED}/handover")

        assert response.status_code == 403, response.text
        error = error_of(response)
        assert error["code"] == "role_not_permitted"
        assert NODAL in error["message"]

    @pytest.mark.parametrize("role", [SURVEYOR, LEAD, SUPER_ADMIN])
    def test_a_refused_handover_changes_nothing(
        self, icms_client, stages_six_and_seven, db, events, role
    ):
        icms_client.sign_in(role).post(f"{CASES}/{VERIFIED}/handover")

        assert status_of(db, VERIFIED) == ("verified", 5)
        assert events(stages_six_and_seven[VERIFIED].id) == []

    def test_a_case_that_is_not_verified_is_a_409(self, icms_client,
                                                  stages_six_and_seven):
        response = icms_client.sign_in(NODAL).post(f"{CASES}/{RAISED}/handover")

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_second_handover_is_a_409_rather_than_a_silent_replay(
        self, icms_client, stages_six_and_seven
    ):
        """`hand_over` is legal from `verified` and from nothing else, so the
        already-handed-over case has no move left on this route."""
        response = icms_client.sign_in(NODAL).post(f"{CASES}/{HANDED_OVER}/handover")

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_case_outside_the_zone_is_indistinguishable_from_absent(
        self, icms_client, stages_six_and_seven
    ):
        client = icms_client.sign_in(NODAL)
        hidden = client.post(f"{CASES}/{OUT_OF_ZONE}/handover")
        missing = client.post(f"{CASES}/CMP-2026-9999/handover")

        assert hidden.status_code == missing.status_code == 404
        assert error_of(hidden)["code"] == error_of(missing)["code"] == "case_not_found"
        assert error_of(hidden)["field"] == error_of(missing)["field"] is None

    def test_a_case_moved_between_the_read_and_the_write_is_a_409(
        self, icms_client, stages_six_and_seven, events, monkeypatch
    ):
        """The compare-and-set. Two officers pressing handover at once give one
        move and one 409, not two moves and two event rows — the UPDATE carries
        `status = :status` and the lost update is a refusal rather than silence."""
        from app.icms import cases as repo

        case_id = stages_six_and_seven[HANDED_OVER].id
        monkeypatch.setattr(
            repo, "_case_for_update", lambda *_a, **_k: (case_id, "verified"))

        response = icms_client.sign_in(NODAL).post(f"{CASES}/{HANDED_OVER}/handover")

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"
        assert events(case_id) == [], "a refused move writes no event row"

    def test_an_out_of_zone_case_is_never_a_403(self, icms_client,
                                                stages_six_and_seven):
        """404 and not 403: a 403 on a case the caller cannot see would confirm
        that the reference exists, which is the leak the scope is there to stop."""
        response = icms_client.sign_in(LEAD).post(f"{CASES}/{OUT_OF_ZONE}/handover")

        assert response.status_code == 404

    def test_no_token_is_refused_before_any_role_is_resolved(self, anonymous_client,
                                                             stages_six_and_seven):
        response = anonymous_client.post(f"{CASES}/{VERIFIED}/handover")

        assert response.status_code == 401


class TestConfirm:
    def test_a_project_lead_confirms_a_handed_over_case(self, icms_client,
                                                        stages_six_and_seven):
        response = icms_client.sign_in(LEAD).post(
            f"{CASES}/{HANDED_OVER}/confirm", json={"note": "Confirmed for notice."})

        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["status"], body["stage_no"]) == ("confirmed", 7)

    def test_the_status_and_stage_come_from_the_transition_table(
        self, icms_client, stages_six_and_seven
    ):
        from app.icms import workflow as wf

        body = icms_client.sign_in(LEAD).post(f"{CASES}/{HANDED_OVER}/confirm").json()
        transition = wf.check(wf.Status.HANDED_OVER, wf.Action.CONFIRM, [LEAD])

        assert body["status"] == str(transition.target)
        assert body["stage_no"] == transition.stage_no

    def test_confirmation_writes_exactly_one_event(self, icms_client,
                                                   stages_six_and_seven, events):
        case_id = stages_six_and_seven[HANDED_OVER].id
        icms_client.sign_in(LEAD).post(f"{CASES}/{HANDED_OVER}/confirm")

        trail = events(case_id)
        assert len(trail) == 1
        assert trail[0]["action"] == "confirm"
        assert (trail[0]["from_status"], trail[0]["to_status"]) == (
            "handed_over", "confirmed")
        assert trail[0]["actor_user_id"] == LEAD_ID
        assert trail[0]["actor_role"] == LEAD

    def test_the_note_is_recorded_on_the_event(self, icms_client, stages_six_and_seven,
                                               events):
        icms_client.sign_in(LEAD).post(
            f"{CASES}/{HANDED_OVER}/confirm", json={"note": "Sanction plan checked."})

        assert events(stages_six_and_seven[HANDED_OVER].id)[0]["note"] == (
            "Sanction plan checked.")

    def test_confirmation_is_what_unlocks_the_notice(self, icms_client,
                                                     stages_six_and_seven):
        """Batch 6 is gated on this one move, so the lead's next available action
        is the proof that stage 7 has actually been reached."""
        body = icms_client.sign_in(LEAD).post(f"{CASES}/{HANDED_OVER}/confirm").json()

        assert "issue_notice" in body["allowed_actions"]

    def test_the_status_and_the_event_share_one_transaction(
        self, icms_client, stages_six_and_seven, db, events, monkeypatch
    ):
        from app.icms import cases as repo

        def explode(*_args, **_kwargs):
            raise RuntimeError("the event row could not be written")

        monkeypatch.setattr(repo, "_event", explode)

        with pytest.raises(RuntimeError):
            icms_client.sign_in(LEAD).post(f"{CASES}/{HANDED_OVER}/confirm")

        assert status_of(db, HANDED_OVER) == ("handed_over", 6)
        assert events(stages_six_and_seven[HANDED_OVER].id) == []


class TestConfirmIsRefused:
    @pytest.mark.parametrize("role", [NODAL, SURVEYOR, SUPER_ADMIN])
    def test_every_role_the_table_does_not_admit_is_refused(
        self, icms_client, stages_six_and_seven, role
    ):
        response = icms_client.sign_in(role).post(f"{CASES}/{HANDED_OVER}/confirm")

        assert response.status_code == 403, response.text
        error = error_of(response)
        assert error["code"] == "role_not_permitted"
        assert LEAD in error["message"]

    @pytest.mark.parametrize("role", [NODAL, SURVEYOR, SUPER_ADMIN])
    def test_a_refused_confirmation_changes_nothing(
        self, icms_client, stages_six_and_seven, db, events, role
    ):
        icms_client.sign_in(role).post(f"{CASES}/{HANDED_OVER}/confirm")

        assert status_of(db, HANDED_OVER) == ("handed_over", 6)
        assert events(stages_six_and_seven[HANDED_OVER].id) == []

    def test_a_confirmation_before_a_handover_is_a_409(self, icms_client,
                                                       stages_six_and_seven):
        """The verified case has not been handed over yet, so there is nothing to
        confirm. The order of the two is the whole of stages 6 and 7."""
        response = icms_client.sign_in(LEAD).post(f"{CASES}/{VERIFIED}/confirm")

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_confirmed_case_cannot_be_confirmed_again(self, icms_client,
                                                        stages_six_and_seven):
        client = icms_client.sign_in(LEAD)
        assert client.post(f"{CASES}/{HANDED_OVER}/confirm").status_code == 200

        response = client.post(f"{CASES}/{HANDED_OVER}/confirm")

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_case_outside_the_zone_is_indistinguishable_from_absent(
        self, icms_client, stages_six_and_seven
    ):
        client = icms_client.sign_in(LEAD)
        hidden = client.post(f"{CASES}/{OUT_OF_ZONE}/confirm")
        missing = client.post(f"{CASES}/CMP-2026-9999/confirm")

        assert hidden.status_code == missing.status_code == 404
        assert error_of(hidden)["code"] == error_of(missing)["code"] == "case_not_found"

    def test_no_token_is_refused_before_any_role_is_resolved(self, anonymous_client,
                                                             stages_six_and_seven):
        response = anonymous_client.post(f"{CASES}/{HANDED_OVER}/confirm")

        assert response.status_code == 401


class TestTheLadder:
    def test_verified_to_handed_over_to_confirmed(self, icms_client,
                                                  stages_six_and_seven):
        """The two compose, and only in this order."""
        handed = icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")
        assert handed.status_code == 200, handed.text
        assert handed.json()["status"] == "handed_over"

        confirmed = icms_client.sign_in(LEAD).post(f"{CASES}/{VERIFIED}/confirm")
        assert confirmed.status_code == 200, confirmed.text
        body = confirmed.json()
        assert (body["status"], body["stage_no"]) == ("confirmed", 7)

    def test_the_ladder_leaves_two_events_in_order(self, icms_client,
                                                   stages_six_and_seven, events):
        icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")
        icms_client.sign_in(LEAD).post(f"{CASES}/{VERIFIED}/confirm")

        trail = events(stages_six_and_seven[VERIFIED].id)
        assert [(e["action"], e["from_status"], e["to_status"]) for e in trail] == [
            ("hand_over", "verified", "handed_over"),
            ("confirm", "handed_over", "confirmed"),
        ]
        assert [e["actor_user_id"] for e in trail] == [NODAL_ID, LEAD_ID]

    def test_the_lead_cannot_skip_the_handover(self, icms_client,
                                               stages_six_and_seven, db):
        confirmed = icms_client.sign_in(LEAD).post(f"{CASES}/{VERIFIED}/confirm")

        assert confirmed.status_code == 409
        assert status_of(db, VERIFIED) == ("verified", 5)

    def test_the_nodal_officer_cannot_carry_on_past_the_handover(
        self, icms_client, stages_six_and_seven
    ):
        """The point of splitting stage 6 from stage 7: the officer who hands the
        case over is not the officer who confirms it."""
        icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")

        response = icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/confirm")

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"


class TestTheParivartanBoundary:
    """Section 3a: stages 1 to 7 are ours, the notice included. The seam is after
    `issue_notice`, its transport is not yet known, and Batch 4 builds none of it."""

    def test_a_handover_mints_no_reference_number(self, icms_client,
                                                  stages_six_and_seven, db):
        """`hand_over` is not a numbering event. A counter row appearing here would
        mean a notice was being minted two transitions early."""
        from ada_core.models_icms import NoticeSequence
        from sqlalchemy import func, select

        before = db.execute(select(func.count()).select_from(NoticeSequence)).scalar_one()
        icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")
        db.expire_all()

        assert db.execute(
            select(func.count()).select_from(NoticeSequence)).scalar_one() == before

    def test_neither_move_writes_a_notice_or_a_delivery(self, icms_client,
                                                        stages_six_and_seven, db):
        """`icms_notice_delivery` gains no endpoint and no writer in this batch: a
        delivery recorded in Parivartan is not ours to invent a row for."""
        from ada_core.models_icms import Notice, NoticeDelivery
        from sqlalchemy import func, select

        icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")
        icms_client.sign_in(LEAD).post(f"{CASES}/{VERIFIED}/confirm")
        db.expire_all()

        for table in (Notice, NoticeDelivery):
            assert db.execute(
                select(func.count()).select_from(table)
            ).scalar_one() == 0, f"{table.__tablename__} was written by a stage 6-7 move"

    def test_the_two_moves_touch_the_case_and_its_events_and_nothing_else(
        self, icms_client, stages_six_and_seven, db
    ):
        """One row changes and one row is added, per move. Anything else here would
        be a side effect nobody asked stage 6 or stage 7 for."""
        from ada_core.models_icms import (
            CaseAssignment,
            Evidence,
            Inspection,
            ResurveyRequest,
        )
        from sqlalchemy import func, select

        watched = (CaseAssignment, Evidence, Inspection, ResurveyRequest)
        before = {
            table: db.execute(select(func.count()).select_from(table)).scalar_one()
            for table in watched
        }

        icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")
        icms_client.sign_in(LEAD).post(f"{CASES}/{VERIFIED}/confirm")
        db.expire_all()

        for table in watched:
            assert db.execute(
                select(func.count()).select_from(table)
            ).scalar_one() == before[table], f"{table.__tablename__} changed"


class TestOwnershipIsNotAConstraintHere:
    """Asked and answered, rather than left unexamined.

    The audit of 2026-09-23 found zone scope treated as sufficient six times, so
    the ownership question is put to every handler now. For these two the answer
    is that there is no actor-to-record relationship to require:
    `icms_case_assignment` binds a SURVEYOR to a case, and nothing in the schema
    binds a nodal officer or a project lead to one. Zone scope plus the
    transition table is the whole of it, exactly as for `assign`.
    """

    @pytest.fixture
    def relief_officers(self, db, zones, stages_six_and_seven):
        """Two officers with no history on any case, holding only the zone."""
        from ada_core.models_icms import ZoneAssignment

        db.add_all([
            ZoneAssignment(zone_id=zones["TAJ"].id, user_id=user_id,
                           assigned_by=SUPER_ADMIN_ID)
            for user_id in (RELIEF_NODAL, RELIEF_LEAD)
        ])
        db.commit()
        return stages_six_and_seven

    def test_any_nodal_officer_holding_the_zone_may_hand_over(self, icms_client,
                                                              relief_officers):
        """Requiring the officer who verified it would strand every case whose
        officer is on leave, transferred, or moved to another zone."""
        response = icms_client.sign_in(NODAL, subject=RELIEF_NODAL).post(
            f"{CASES}/{VERIFIED}/handover")

        assert response.status_code == 200, response.text

    def test_any_project_lead_holding_the_zone_may_confirm(self, icms_client,
                                                           relief_officers):
        response = icms_client.sign_in(LEAD, subject=RELIEF_LEAD).post(
            f"{CASES}/{HANDED_OVER}/confirm")

        assert response.status_code == 200, response.text

    def test_an_officer_without_the_zone_is_a_404_and_not_a_403(self, icms_client,
                                                                stages_six_and_seven):
        """The relief officer without the grant. Zone scope is the constraint that
        DOES apply, and it answers 404 before the role is ever considered."""
        response = icms_client.sign_in(NODAL, subject=RELIEF_NODAL).post(
            f"{CASES}/{VERIFIED}/handover")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"

    def test_the_surveyor_who_did_the_work_still_cannot_hand_over(
        self, icms_client, stages_six_and_seven
    ):
        """Ownership would have widened the role, not narrowed it. It does not:
        the surveyor holds the case and still holds no stage 6 transition."""
        response = icms_client.sign_in(SURVEYOR).post(f"{CASES}/{VERIFIED}/handover")

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"
