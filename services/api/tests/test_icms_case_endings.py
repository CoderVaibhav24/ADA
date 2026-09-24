"""Reject and close: the two terminal case actions, their guards and their notices."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from tests.conftest import LEAD, LEAD_ID, NODAL, NODAL_ID, SURVEYOR_B_ID
from tests.test_icms_notifications import INAPP, PUSH, notify  # noqa: F401 — fixture

CASES = "/api/icms/cases"
KEY = "5b0e3c1a-6f2d-4a7b-9c8e-1d2f3a4b5c6d"
DUPLICATE = {"reason_cd": "duplicate", "remarks": "Same site as CMP-2026-0001."}
DEMOLISHED = {"outcome_cd": "demolished_by_owner", "remarks": "Owner removed the floor."}


@pytest.fixture
def world(db, cases, code_values):
    from ada_core.models_icms import Case, CodeValue

    db.add_all([
        CodeValue(domain="case_reject_reason", code="duplicate",
                  label="Duplicate complaint", label_hi="दोहरी शिकायत", sort_order=2),
        CodeValue(domain="case_close_outcome", code="demolished_by_owner",
                  label="Demolished by owner", label_hi="स्वामी द्वारा ध्वस्त", sort_order=1),
    ])
    # Filed by the lead so the nodal officer's rejection has someone to tell.
    db.execute(update(Case).where(Case.case_ref == "CMP-2026-0002")
               .values(created_by=LEAD_ID))
    db.commit()
    return cases


def _notice_issued(db, case_ref: str = "CMP-2026-0002") -> str:
    from ada_core.models_icms import Case

    db.execute(update(Case).where(Case.case_ref == case_ref)
               .values(status="notice_issued", stage_no=7, created_by=NODAL_ID))
    db.commit()
    return case_ref


def _active_assignments(db, case_ref: str) -> int:
    from ada_core.models_icms import Case, CaseAssignment

    return len(db.execute(
        select(CaseAssignment.id).join(Case, Case.id == CaseAssignment.case_id)
        .where(Case.case_ref == case_ref, CaseAssignment.active.is_(True))
    ).all())


class TestReject:
    def test_an_assigned_case_is_rejected_and_leaves_the_surveyors_worklist(
        self, icms_client, world, db, events
    ):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/reject", json=DUPLICATE)

        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["status"], body["outcome_cd"], body["outcome_label"]) == (
            "rejected", "duplicate", "Duplicate complaint")
        assert body["outcome_label_hi"] == "दोहरी शिकायत"
        assert body["outcome_reason"] == DUPLICATE["remarks"]
        assert body["closed_by"] == NODAL_ID and body["closed_at"]
        assert body["allowed_actions"] == []
        assert _active_assignments(db, "CMP-2026-0002") == 0

        [event] = [e for e in events(world["CMP-2026-0002"].id) if e["action"] == "reject"]
        assert (event["from_status"], event["to_status"]) == ("assigned", "rejected")
        assert event["payload"]["released_assignee"] == SURVEYOR_B_ID

        mine = icms_client.sign_in("field-surveyor", subject=SURVEYOR_B_ID).get(
            CASES, params={"mine": "true"}).json()
        assert "CMP-2026-0002" not in [row["case_ref"] for row in mine["items"]]

    def test_a_raised_case_can_be_rejected(self, icms_client, world):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/reject", json=DUPLICATE)
        assert response.status_code == 200, response.text
        assert response.json()["stage_no"] == 1

    def test_a_closed_case_cannot_be_rejected(self, icms_client, world):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0005/reject", json=DUPLICATE)
        assert response.status_code == 409, response.text

    def test_a_project_lead_may_not_reject(self, icms_client, world):
        response = icms_client.sign_in(LEAD).post(
            f"{CASES}/CMP-2026-0002/reject", json=DUPLICATE)
        assert response.status_code == 403, response.text
        assert response.json()["error"]["code"] == "role_not_permitted"

    @pytest.mark.parametrize("remarks", [None, "too short"])
    def test_other_needs_remarks(self, icms_client, world, remarks):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/reject", json={"reason_cd": "other", "remarks": remarks})
        assert response.status_code == 422, response.text

    def test_an_unknown_reason_is_refused(self, icms_client, world):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/reject", json={"reason_cd": "bored"})
        assert response.status_code == 422, response.text

    def test_a_replay_with_the_same_key_is_a_no_op(self, icms_client, world, events, notify):  # noqa: F811
        client = icms_client.sign_in(NODAL)
        first = client.post(f"{CASES}/CMP-2026-0002/reject",
                            json={**DUPLICATE, "idempotency_key": KEY})
        sent = len(notify.calls)
        again = client.post(f"{CASES}/CMP-2026-0002/reject",
                            json={**DUPLICATE, "idempotency_key": KEY})

        assert (first.status_code, again.status_code) == (200, 200)
        assert again.json()["status"] == "rejected"
        assert len([e for e in events(world["CMP-2026-0002"].id)
                    if e["action"] == "reject"]) == 1
        assert len(notify.calls) == sent
        other_key = client.post(f"{CASES}/CMP-2026-0002/reject", json=DUPLICATE)
        assert other_key.status_code == 409

    def test_the_creator_and_the_released_surveyor_are_told(
        self, icms_client, world, notify  # noqa: F811
    ):
        icms_client.sign_in(NODAL).post(f"{CASES}/CMP-2026-0002/reject", json=DUPLICATE)

        calls = {c["recipient"]: c for c in notify.calls}
        assert set(calls) == {LEAD_ID, SURVEYOR_B_ID}
        assert calls[LEAD_ID]["channels"] == INAPP
        assert calls[LEAD_ID]["payload"]["route"] == "/complaints/CMP-2026-0002"
        assert calls[SURVEYOR_B_ID]["channels"] == PUSH
        assert calls[SURVEYOR_B_ID]["payload"]["route"] == "/complaints"
        assert all(c["template_key"] == "case_rejected" for c in notify.calls)
        assert calls[LEAD_ID]["payload"]["outcome_label"] == "Duplicate complaint"


class TestClose:
    def test_a_notice_issued_case_is_closed_by_the_lead(self, icms_client, world, db, events):
        ref = _notice_issued(db)
        response = icms_client.sign_in(LEAD).post(f"{CASES}/{ref}/close", json=DEMOLISHED)

        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["status"], body["outcome_cd"], body["closed_by"]) == (
            "closed", "demolished_by_owner", LEAD_ID)
        assert body["outcome_label"] == "Demolished by owner"
        assert _active_assignments(db, ref) == 0
        assert [e["action"] for e in events(world[ref].id)][-1] == "close"

    def test_only_a_notice_issued_case_can_be_closed(self, icms_client, world):
        response = icms_client.sign_in(LEAD).post(
            f"{CASES}/CMP-2026-0002/close", json=DEMOLISHED)
        assert response.status_code == 409, response.text

    def test_a_nodal_officer_may_not_close(self, icms_client, world, db):
        ref = _notice_issued(db)
        response = icms_client.sign_in(NODAL).post(f"{CASES}/{ref}/close", json=DEMOLISHED)
        assert response.status_code == 403, response.text

    def test_other_needs_remarks(self, icms_client, world, db):
        ref = _notice_issued(db)
        response = icms_client.sign_in(LEAD).post(
            f"{CASES}/{ref}/close", json={"outcome_cd": "other"})
        assert response.status_code == 422, response.text

    def test_the_zone_nodal_officers_are_told(self, icms_client, world, db, notify):  # noqa: F811
        ref = _notice_issued(db)
        icms_client.sign_in(LEAD).post(f"{CASES}/{ref}/close", json=DEMOLISHED)

        [call] = notify.calls
        assert (call["template_key"], call["recipient"], call["channels"]) == (
            "case_closed", NODAL_ID, INAPP)
        assert call["idempotency_key"] == f"case_closed-{ref}-{NODAL_ID}"
        assert call["payload"]["outcome_cd"] == "demolished_by_owner"
