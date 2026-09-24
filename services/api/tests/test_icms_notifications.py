"""Who is told what after each ICMS workflow step (docs/icms/notifications.md).

The ada-notify SDK client is replaced by a recorder; recipients come from the
real zone assignments and the realm double's role mappings.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    LEAD,
    LEAD_ID,
    NODAL,
    NODAL_ID,
    SUPER_ADMIN_ID,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.test_icms_batch4 import (  # noqa: F401 — fixture
    HANDED_OVER,
    RELIEF_LEAD,
    VERIFIED,
    stages_six_and_seven,
)
from tests.test_icms_cases import RAISE, filing_zones  # noqa: F401 — fixture
from tests.test_icms_inspections import KEY, check_in_body, open_round
from tests.test_icms_notices import issue

ICMS = "/api/icms"
CASES = f"{ICMS}/cases"
INSPECTIONS = f"{ICMS}/inspections"
REQUESTS = f"{ICMS}/resurvey-requests"
PUSH = ["push", "inapp"]
INAPP = ["inapp"]
REASON = "The measured area does not agree with the sanctioned plan."


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def send(self, **kwargs):
        from ada_platform.notify import SendOutcome

        self.calls.append(kwargs)
        return SendOutcome(accepted=True, status_code=202)

    def who(self) -> list[tuple[str, str]]:
        return sorted((c["template_key"], c["recipient"]) for c in self.calls)

    def take(self) -> list[dict]:
        taken, self.calls = self.calls, []
        return taken


@pytest.fixture
def notify(monkeypatch):
    from app.config import settings
    from app.icms import notifier

    fake = _Recorder()
    notifier.reset_role_cache()
    monkeypatch.setattr(settings, "notify_enabled", True)
    monkeypatch.setattr(notifier, "_client", fake)
    yield fake
    notifier.reset_role_cache()


@pytest.fixture
def surveyor_directory(keycloak):
    from app.main import app
    from app.routers.icms_cases import officer_directory

    keycloak.role_mappings[SURVEYOR_B_ID] = {"field-surveyor"}
    app.dependency_overrides[officer_directory] = lambda: keycloak
    yield keycloak
    app.dependency_overrides.pop(officer_directory, None)


def _submitted_round(client, case_ref: str = "CMP-2026-0002") -> str:
    ref = open_round(client, case_ref, SURVEYOR_ID)
    surveyor = client.sign_in(SURVEYOR)
    surveyor.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
    surveyor.put(f"{INSPECTIONS}/{ref}/findings",
                 json={"findings": ["Third floor under construction."],
                       "measured_area_sqm": 120.0})
    submitted = surveyor.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})
    assert submitted.status_code == 200, submitted.text
    return ref


class TestRaise:
    def test_the_zone_nodal_officers_are_told_and_nobody_else(
        self, icms_client, filing_zones, code_values, notify  # noqa: F811
    ):
        response = icms_client.sign_in(LEAD).post(CASES, json=RAISE)

        assert response.status_code == 201, response.text
        ref = response.json()["case_ref"]
        assert notify.calls == [{
            "idempotency_key": f"case_raised-{ref}-{NODAL_ID}",
            "recipient": NODAL_ID,
            "template_key": "case_raised",
            "payload": {"case_ref": ref, "zone_name": "Taj Ganj",
                        "route": f"/complaints/{ref}"},
            "channels": INAPP,
        }]

    def test_the_actor_is_never_told_about_their_own_action(
        self, icms_client, filing_zones, code_values, notify  # noqa: F811
    ):
        assert icms_client.sign_in(NODAL).post(CASES, json=RAISE).status_code == 201
        assert notify.calls == []

    def test_a_directory_outage_drops_the_notice_not_the_case(
        self, icms_client, filing_zones, code_values, notify, keycloak  # noqa: F811
    ):
        from app.errors import ApiError

        keycloak.unavailable = ApiError(503, "down", "keycloak is down")
        assert icms_client.sign_in(LEAD).post(CASES, json=RAISE).status_code == 201
        assert notify.calls == []


class TestAssign:
    def test_reassigning_tells_the_new_assignee_and_the_previous_one(
        self, icms_client, cases, db, zones, surveyor_directory, notify
    ):
        from ada_core.models_icms import ZoneAssignment

        db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                              assigned_by=SUPER_ADMIN_ID))
        db.commit()
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/assign",
            json={"assignee_user_id": SURVEYOR_ID, "reason": "workload"})

        assert response.status_code == 200, response.text
        assert notify.who() == [("case_assigned", SURVEYOR_ID),
                                ("case_unassigned", SURVEYOR_B_ID)]
        assert all(c["channels"] == PUSH for c in notify.calls)
        keys = {c["idempotency_key"] for c in notify.calls}
        assert len(keys) == 2


class TestTheInspectionLoop:
    def test_each_step_reaches_the_right_person(self, icms_client, inspection_ready, notify):
        ref = open_round(icms_client, "CMP-2026-0002", SURVEYOR_ID)
        opened = notify.take()
        assert [(c["template_key"], c["recipient"], c["channels"]) for c in opened] == [
            ("inspection_assigned", SURVEYOR_ID, PUSH)]
        assert opened[0]["payload"] == {
            "case_ref": "CMP-2026-0002", "inspection_ref": ref,
            "route": "/inspection/CMP-2026-0002"}

        surveyor = icms_client.sign_in(SURVEYOR)
        surveyor.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
        surveyor.put(f"{INSPECTIONS}/{ref}/findings",
                     json={"findings": ["Third floor."], "measured_area_sqm": 120.0})
        assert notify.take() == []  # check-in and findings are silent

        surveyor.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})
        submitted = notify.take()
        assert [(c["template_key"], c["recipient"], c["channels"]) for c in submitted] == [
            ("inspection_submitted", NODAL_ID, INAPP)]
        assert submitted[0]["payload"]["inspection_ref"] == ref

        icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify", json={"decision": "accept"})
        accepted = notify.take()
        assert [(c["template_key"], c["recipient"], c["channels"]) for c in accepted] == [
            ("findings_accepted", SURVEYOR_ID, INAPP)]

    def test_a_round_the_surveyor_opens_for_themselves_is_silent(
        self, icms_client, inspection_ready, notify
    ):
        open_round(icms_client, "CMP-2026-0003", SURVEYOR_ID, as_role=SURVEYOR)
        assert notify.calls == []

    def test_a_rejection_pushes_the_reason_to_the_surveyor(
        self, icms_client, inspection_ready, notify
    ):
        ref = _submitted_round(icms_client)
        notify.take()
        response = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify", json={"decision": "reject", "reason": REASON})

        assert response.status_code == 200, response.text
        [call] = notify.calls
        assert (call["template_key"], call["recipient"], call["channels"]) == (
            "resurvey_requested", SURVEYOR_ID, PUSH)
        assert call["payload"]["reason"] == REASON
        assert call["idempotency_key"] == f"resurvey_requested-{ref}"


class TestResurvey:
    def test_a_request_tells_the_assignee_and_approval_tells_the_new_surveyor(
        self, icms_client, inspection_loop, notify
    ):
        nodal = icms_client.sign_in(NODAL)
        request = nodal.post(f"{CASES}/CMP-2026-0007/resurvey-requests",
                             json={"reason": REASON})
        assert request.status_code == 201, request.text
        request_id = request.json()["id"]
        raised = notify.take()
        assert [(c["template_key"], c["recipient"], c["channels"]) for c in raised] == [
            ("resurvey_request_raised", SURVEYOR_ID, PUSH)]
        assert raised[0]["payload"]["reason"] == REASON

        decided = nodal.post(f"{REQUESTS}/{request_id}/decide",
                             json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})
        assert decided.status_code == 200, decided.text
        [call] = notify.take()
        assert (call["template_key"], call["recipient"], call["channels"]) == (
            "resurvey_approved", SURVEYOR_ID, PUSH)
        assert call["idempotency_key"] == f"resurvey_approved-{request_id}"
        assert call["payload"]["inspection_ref"].startswith("INS-")

    def test_a_refusal_tells_whoever_asked(self, icms_client, inspection_loop, notify):
        response = icms_client.sign_in(SURVEYOR).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "Round 1 stands."})

        assert response.status_code == 200, response.text
        assert [(c["template_key"], c["recipient"], c["channels"])
                for c in notify.calls] == [("resurvey_refused", NODAL_ID, INAPP)]


class TestHandoverConfirmNotice:
    @pytest.fixture
    def relief_lead(self, db, zones, keycloak):
        from ada_core.models_icms import ZoneAssignment

        keycloak.users[RELIEF_LEAD] = {"id": RELIEF_LEAD, "username": "relief.lead",
                                       "enabled": True}
        keycloak.role_mappings[RELIEF_LEAD] = {"ada-project-lead"}
        db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=RELIEF_LEAD,
                              assigned_by=SUPER_ADMIN_ID))
        db.commit()

    def test_a_handover_asks_the_zone_project_leads_to_confirm(
        self, icms_client, stages_six_and_seven, relief_lead, notify  # noqa: F811
    ):
        response = icms_client.sign_in(NODAL).post(f"{CASES}/{VERIFIED}/handover")

        assert response.status_code == 200, response.text
        assert notify.who() == [("case_handed_over", LEAD_ID),
                                ("case_handed_over", RELIEF_LEAD)]
        assert all(c["channels"] == INAPP for c in notify.calls)

    def test_a_confirmation_tells_the_other_leads_to_issue_the_notice(
        self, icms_client, stages_six_and_seven, relief_lead, notify  # noqa: F811
    ):
        response = icms_client.sign_in(LEAD).post(f"{CASES}/{HANDED_OVER}/confirm")

        assert response.status_code == 200, response.text
        assert notify.who() == [("case_confirmed", RELIEF_LEAD)]

    def test_an_issued_notice_tells_the_nodal_officers_and_the_author_once(
        self, icms_client, notice_world, notify
    ):
        response = issue(icms_client.sign_in(LEAD))

        assert response.status_code == 201, response.text
        notice_ref = response.json()["notice_ref"]
        [call] = notify.calls
        assert (call["template_key"], call["recipient"], call["channels"]) == (
            "notice_issued", NODAL_ID, INAPP)
        assert call["payload"]["notice_ref"] == notice_ref
        assert call["idempotency_key"] == f"notice_issued-{notice_ref}-{NODAL_ID}"


def test_nothing_is_sent_while_notifications_are_off(
    icms_client, filing_zones, code_values, notify, monkeypatch  # noqa: F811
):
    from app.config import settings

    monkeypatch.setattr(settings, "notify_enabled", False)
    assert icms_client.sign_in(LEAD).post(CASES, json=RAISE).status_code == 201
    assert notify.calls == []
