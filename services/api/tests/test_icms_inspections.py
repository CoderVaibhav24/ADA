"""ICMS Batch 3 — the loop, one happy path per transition.

Eight transitions, walked in the order a real case goes through them: open a
round, check in at the property, upload what was seen, record the findings,
submit, and have the nodal officer accept it.

Rule 1 is checked rather than assumed: every state change asserts the
`icms_case_event` row that went with it, with the right from/to pair. A case
whose status moved with no event row is a case nobody can account for, and in an
enforcement system the account is the product.

The authorisation denials live next door in test_icms_inspection_auth.py, one
per transition. The re-survey round loop is in test_icms_resurvey.py and the
evidence rules are in test_icms_evidence.py.
"""

from __future__ import annotations

from ada_core.datetimes import now_ist

from tests.conftest import (
    JPEG_BYTES,
    NODAL,
    NODAL_ID,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

CASES = "/api/icms/cases"
INSPECTIONS = "/api/icms/inspections"

# CMP-2026-0002 is in TAJ and is `assigned`, which is where a round opens from.
CASE = "CMP-2026-0002"
KEY = "6f1d6dd9-8443-4b90-9a86-0f65c42b3001"


def device_now() -> str:
    """A device clock inside the twelve hours ada_core.validation allows."""
    return now_ist().isoformat()


def check_in_body(key: str = KEY, accuracy_m: float = 8.0) -> dict:
    return {
        "latitude": 27.005, "longitude": 78.005, "accuracy_m": accuracy_m,
        "device_timestamp": device_now(), "capture_source": "gps",
        "idempotency_key": key,
    }


def photo(key: str, **overrides) -> tuple[dict, dict]:
    """The multipart halves of one evidence upload: the fields and the file."""
    fields = {
        "kind": "photo", "latitude": "27.005", "longitude": "78.005",
        "accuracy_m": "6.5", "device_timestamp": device_now(),
        "capture_source": "camera", "idempotency_key": key,
    }
    fields.update(overrides)
    return fields, {"file": ("front.jpg", JPEG_BYTES, "image/jpeg")}


def open_round(client, case_ref: str = CASE, surveyor: str = SURVEYOR_ID,
               as_role: str = NODAL) -> str:
    response = client.sign_in(as_role).post(
        f"{CASES}/{case_ref}/inspections", json={"surveyor_user_id": surveyor})
    assert response.status_code == 201, response.text
    return response.json()["inspection_ref"]


# ---------------------------------------------------------------- stage 3
class TestOpenRound:
    def test_a_nodal_officer_opens_the_first_round(self, icms_client, inspection_ready):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{CASE}/inspections", json={"surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["inspection_ref"] == "INS-2026-0001"
        assert (body["round_no"], body["status"]) == (1, "scheduled")
        assert body["case_ref"] == CASE
        assert body["surveyor_user_id"] == SURVEYOR_ID

    def test_the_reference_comes_from_the_inspection_series(
        self, icms_client, inspection_ready, db
    ):
        """`CMP` and `INS` do not share a counter, and `allocate` is already
        per-series. Two rounds run the INS counter; the CMP one is untouched."""
        from ada_core.models_icms import NoticeSequence
        from sqlalchemy import select

        client = icms_client.sign_in(NODAL)
        first = open_round(icms_client)
        assigned = client.post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_ID})
        assert assigned.status_code == 200, assigned.text
        again = open_round(icms_client, "CMP-2026-0001")

        assert (first, again) == ("INS-2026-0001", "INS-2026-0002")
        counters = dict(db.execute(
            select(NoticeSequence.series, NoticeSequence.last_seq)).all())
        assert counters == {"INS": 2}

    def test_the_case_moves_to_the_transition_target(self, icms_client, inspection_ready):
        from app.icms import workflow as wf

        open_round(icms_client)
        case = icms_client.sign_in(NODAL).get(f"{CASES}/{CASE}").json()
        transition = wf.check(wf.Status.ASSIGNED, wf.Action.OPEN_ROUND, [NODAL],
                              payload={"surveyor_user_id": SURVEYOR_ID})

        assert case["status"] == str(transition.target)
        assert case["stage_no"] == transition.stage_no
        assert case["current_round"] == 1

    def test_a_surveyor_may_open_their_own_round(self, icms_client, inspection_ready):
        """The table admits both roles; a surveyor already at the property should
        not have to telephone the office to start the visit.

        CMP-2026-0002 is assigned to surveyor B, so B is who signs in: a surveyor
        opens a round on their OWN case and names themselves, which is the whole
        of what the role holds. test_icms_inspection_auth.py owns the denials.
        """
        response = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).post(
            f"{CASES}/{CASE}/inspections", json={"surveyor_user_id": SURVEYOR_B_ID})

        assert response.status_code == 201, response.text

    def test_a_scheduled_visit_keeps_its_date(self, icms_client, inspection_ready):
        """Round-tripped rather than compared to the string sent: SQLite drops the
        offset a timestamptz column keeps, so the value read back is the property
        under test, not the storage backend's timezone handling."""
        when = now_ist().replace(microsecond=0).isoformat()
        created = icms_client.sign_in(NODAL).post(
            f"{CASES}/{CASE}/inspections",
            json={"surveyor_user_id": SURVEYOR_ID, "scheduled_for": when}).json()
        read_back = icms_client.sign_in(NODAL).get(
            f"{INSPECTIONS}/{created['inspection_ref']}").json()

        assert created["scheduled_for"] is not None
        assert read_back["scheduled_for"] == created["scheduled_for"]

    def test_a_surveyor_who_cannot_see_the_zone_is_refused(
        self, icms_client, inspection_ready
    ):
        """A round opened for an officer with no sight of the zone is work
        allocated into a hole: it appears in nobody's register."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{CASE}/inspections", json={"surveyor_user_id": "nobody-at-all"})

        assert response.status_code == 422
        assert error_of(response)["code"] == "assignee_not_in_zone"

    def test_a_raised_case_has_no_round_to_open(self, icms_client, inspection_ready):
        """CMP-2026-0001 is `raised`; a case nobody is assigned to is not a case
        anybody is inspecting."""
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/inspections", json={"surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_opening_writes_exactly_one_event(self, icms_client, inspection_ready, events):
        open_round(icms_client)

        trail = events(inspection_ready[CASE].id)
        assert len(trail) == 1
        assert trail[0]["action"] == "open_round"
        assert (trail[0]["from_status"], trail[0]["to_status"]) == (
            "assigned", "under_inspection")
        assert trail[0]["actor_user_id"] == NODAL_ID

    def test_a_refused_open_consumes_no_inspection_reference(
        self, icms_client, inspection_ready
    ):
        """The gap arriving by the back door. If the number were minted before
        the policy ran, a refused attempt would leave INS-2026-0001 unused."""
        icms_client.sign_in(NODAL).post(
            f"{CASES}/{CASE}/inspections", json={"surveyor_user_id": "nobody-at-all"})

        assert open_round(icms_client) == "INS-2026-0001"

    def test_a_case_outside_the_scope_is_a_404(self, icms_client, inspection_ready):
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0004/inspections", json={"surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 404

    def test_no_token_is_refused(self, anonymous_client, inspection_ready):
        response = anonymous_client.post(
            f"{CASES}/{CASE}/inspections", json={"surveyor_user_id": SURVEYOR_ID})

        assert response.status_code == 401


class TestCheckIn:
    def test_the_assignee_checks_in(self, icms_client, inspection_ready):
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["inspection_ref"] == ref
        assert (body["lat"], body["lon"]) == (27.005, 78.005)
        assert body["user_id"] == SURVEYOR_ID
        assert body["capture_source"] == "gps"

    def test_a_poor_fix_is_refused(self, icms_client, inspection_ready):
        """The point of a check-in is "this officer stood here". A 900 m fix does
        not support that claim, and storing it anyway is what makes the record
        unusable later."""
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body(accuracy_m=900.0))

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "poor_accuracy"
        assert error["field"] == "accuracy_m"

    def test_the_gate_is_configurable(self, icms_client, inspection_ready,
                                      monkeypatch):
        """ADA has not fixed the number yet, so the gate reads
        `icms_accuracy_gate_m` rather than a literal — and this proves it
        actually reads it."""
        from app.config import settings

        monkeypatch.setattr(settings, "icms_accuracy_gate_m", 1000.0)
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body(accuracy_m=900.0))

        assert response.status_code == 201

    def test_a_fix_the_flag_distrusts_is_still_admitted(self, icms_client,
                                                        inspection_ready):
        """The gate is not the flag. 30 m is an urban-canyon fix beside the wall
        being inspected: refusing it sends the surveyor into the road, which is
        the one place the geo-tag must not be taken from. It is accepted here and
        the evidence captured there is flagged instead —
        `test_icms_evidence.py::test_a_fix_the_gate_admits_and_the_flag_distrusts`.
        """
        from app.config import settings

        assert settings.icms_accuracy_flag_m < 30 < settings.icms_accuracy_gate_m
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body(accuracy_m=30.0))

        assert response.status_code == 201, response.text

    def test_a_refused_check_in_writes_nothing(self, icms_client, inspection_ready, db):
        from ada_core.models_icms import CheckIn
        from sqlalchemy import func, select

        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body(accuracy_m=900.0))

        assert db.execute(select(func.count()).select_from(CheckIn)).scalar_one() == 0

    def test_checking_in_starts_the_round(self, icms_client, inspection_ready):
        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())

        body = icms_client.sign_in(SURVEYOR).get(f"{INSPECTIONS}/{ref}").json()
        assert body["status"] == "in_progress"
        assert body["started_at"] is not None
        assert body["has_check_in"] is True

    def test_the_case_status_does_not_move(self, icms_client, inspection_ready):
        """`check_in` targets the status it came from. Arriving is not progress
        through the workflow; it is progress through the day."""
        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())

        case = icms_client.sign_in(NODAL).get(f"{CASES}/{CASE}").json()
        assert (case["status"], case["stage_no"]) == ("under_inspection", 3)

    def test_a_replay_returns_the_first_check_in(self, icms_client, inspection_ready):
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)

        first = client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
        second = client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())

        assert (first.status_code, second.status_code) == (201, 200)
        assert first.json()["id"] == second.json()["id"]

    def test_a_replay_creates_no_second_row_and_no_second_event(
        self, icms_client, inspection_ready, db, events
    ):
        from ada_core.models_icms import CheckIn
        from sqlalchemy import func, select

        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
        client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())

        assert db.execute(select(func.count()).select_from(CheckIn)).scalar_one() == 1
        actions = [row["action"] for row in events(inspection_ready[CASE].id)]
        assert actions == ["open_round", "check_in"]

    def test_a_second_visit_with_a_new_key_is_a_second_check_in(
        self, icms_client, inspection_ready
    ):
        """A surveyor who comes back in the afternoon checks in again. The
        check-ins are a list, not a flag."""
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
        client.post(f"{INSPECTIONS}/{ref}/check-in",
                    json=check_in_body(key="6f1d6dd9-8443-4b90-9a86-0f65c42b3002"))

        body = client.get(f"{INSPECTIONS}/{ref}").json()
        assert len(body["check_ins"]) == 2

    def test_a_device_clock_from_last_year_is_refused(self, icms_client, inspection_ready):
        ref = open_round(icms_client)
        body = check_in_body() | {"device_timestamp": "2025-01-01T09:00:00+05:30"}

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=body)

        assert response.status_code == 422

    def test_an_unknown_capture_source_is_refused(self, icms_client, inspection_ready):
        ref = open_round(icms_client)
        body = check_in_body() | {"capture_source": "guesswork"}

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=body)

        assert response.status_code == 422

    def test_a_key_that_is_not_a_uuid_is_refused(self, icms_client, inspection_ready):
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/check-in", json=check_in_body(key="retry-1"))

        assert response.status_code == 422

    def test_an_unknown_inspection_is_a_404(self, icms_client, inspection_ready):
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/INS-2026-9999/check-in", json=check_in_body())

        assert response.status_code == 404
        assert error_of(response)["code"] == "inspection_not_found"

    def test_no_token_is_refused(self, anonymous_client, inspection_ready):
        response = anonymous_client.post(
            f"{INSPECTIONS}/INS-2026-0001/check-in", json=check_in_body())

        assert response.status_code == 401


# ---------------------------------------------------------------- stage 4
class TestFindings:
    def test_the_assignee_records_what_was_found(self, icms_client, inspection_ready):
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ref}/findings",
            json={"findings": ["Fourth floor added without sanction.",
                               "Setback on the north side is 1.2 m."],
                  "measured_area_sqm": 184.5, "notice_required": True,
                  "occupant_name": "Ramesh Gupta"})

        assert response.status_code == 200, response.text
        body = response.json()
        assert [f["finding"] for f in body["findings"]] == [
            "Fourth floor added without sanction.",
            "Setback on the north side is 1.2 m.",
        ]
        assert [f["seq"] for f in body["findings"]] == [1, 2]
        assert body["measured_area_sqm"] == 184.5
        assert body["notice_required"] is True
        assert body["occupant_name"] == "Ramesh Gupta"

    def test_saving_again_replaces_rather_than_appends(self, icms_client, inspection_ready):
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.put(f"{INSPECTIONS}/{ref}/findings", json={"findings": ["One", "Two"]})
        body = client.put(
            f"{INSPECTIONS}/{ref}/findings", json={"findings": ["Only this"]}).json()

        assert [f["finding"] for f in body["findings"]] == ["Only this"]
        assert body["finding_count"] == 1

    def test_an_empty_findings_list_is_refused(self, icms_client, inspection_ready):
        """A round with no finding is a round that was not carried out."""
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ref}/findings", json={"findings": []})

        assert response.status_code == 422

    def test_sections_are_stored_and_deduplicated(
        self, icms_client, inspection_ready, act_sections,
    ):
        ref = open_round(icms_client)

        body = icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ref}/findings",
            json={"findings": ["Deviation from the sanctioned plan."],
                  "sections": [{"act_cd": "up_upda_1973", "section_cd": "sec_27"},
                               {"act_cd": "up_upda_1973", "section_cd": "sec_27"},
                               {"act_cd": "up_upda_1973",
                                "section_cd": "sec_28"}]}).json()

        assert body["sections"] == [
            {"act_cd": "up_upda_1973", "section_cd": "sec_27"},
            {"act_cd": "up_upda_1973", "section_cd": "sec_28"},
        ]

    def test_omitting_sections_leaves_them_alone(self, icms_client, inspection_ready, act_sections):
        """A save from a screen without the sections field must not silently drop
        citations entered on another one."""
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.put(f"{INSPECTIONS}/{ref}/findings",
                   json={"findings": ["One"],
                         "sections": [{"act_cd": "up_upda_1973",
                                       "section_cd": "sec_27"}]})
        body = client.put(
            f"{INSPECTIONS}/{ref}/findings", json={"findings": ["Two"]}).json()

        assert body["sections"] == [
            {"act_cd": "up_upda_1973", "section_cd": "sec_27"}]

    def test_sending_an_empty_section_list_clears_them(
        self, icms_client, inspection_ready, act_sections,
    ):
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.put(f"{INSPECTIONS}/{ref}/findings",
                   json={"findings": ["One"],
                         "sections": [{"act_cd": "up_upda_1973",
                                       "section_cd": "sec_27"}]})
        body = client.put(f"{INSPECTIONS}/{ref}/findings",
                          json={"findings": ["One"], "sections": []}).json()

        assert body["sections"] == []

    def test_the_stage_moves_to_four(self, icms_client, inspection_ready):
        """Read off the transition, not restated here: `record_findings` carries
        stage 4 while keeping the status at under_inspection."""
        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ref}/findings", json={"findings": ["One"]})

        case = icms_client.sign_in(NODAL).get(f"{CASES}/{CASE}").json()
        assert (case["status"], case["stage_no"]) == ("under_inspection", 4)

    def test_recording_writes_one_event_naming_no_values(
        self, icms_client, inspection_ready, events
    ):
        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ref}/findings",
            json={"findings": ["The occupant is Ramesh Gupta."],
                  "occupant_name": "Ramesh Gupta"})

        trail = events(inspection_ready[CASE].id)
        assert [row["action"] for row in trail] == ["open_round", "record_findings"]
        payload = trail[-1]["payload"]
        assert payload == {"findings": 1, "fields": ["occupant_name"], "source": "field"}

    def test_a_finding_longer_than_the_column_is_refused(
        self, icms_client, inspection_ready
    ):
        """Refused by the request model rather than truncated by the database,
        which is how half a finding ends up in an enforcement record."""
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ref}/findings", json={"findings": ["x" * 5001]})

        assert response.status_code == 422

    def test_no_token_is_refused(self, anonymous_client, inspection_ready):
        response = anonymous_client.put(
            f"{INSPECTIONS}/INS-2026-0001/findings", json={"findings": ["One"]})

        assert response.status_code == 401


class TestSubmit:
    def test_the_assignee_submits_the_round(self, icms_client, inspection_ready):
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.put(f"{INSPECTIONS}/{ref}/findings", json={"findings": ["One"]})

        response = client.post(f"{INSPECTIONS}/{ref}/submit",
                               json={"idempotency_key": KEY})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "submitted"
        assert body["submitted_at"] is not None
        assert body["case_status"] == "inspection_submitted"

    def test_the_case_reaches_stage_four(self, icms_client, inspection_ready):
        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})

        case = icms_client.sign_in(NODAL).get(f"{CASES}/{CASE}").json()
        assert (case["status"], case["stage_no"]) == ("inspection_submitted", 4)

    def test_a_replay_returns_the_submitted_round(self, icms_client, inspection_ready):
        """The handset cannot tell a request that never arrived from a response
        that never came back, so it retries. The answer is the round it already
        submitted, not a 409 it can do nothing with."""
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        first = client.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})
        second = client.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})

        assert (first.status_code, second.status_code) == (200, 200)
        assert first.json()["submitted_at"] == second.json()["submitted_at"]

    def test_a_replay_writes_no_second_event(self, icms_client, inspection_ready, events):
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})
        client.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})

        actions = [row["action"] for row in events(inspection_ready[CASE].id)]
        assert actions == ["open_round", "submit"]

    def test_submitting_writes_the_event_with_the_right_pair(
        self, icms_client, inspection_ready, events
    ):
        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})

        event = events(inspection_ready[CASE].id)[-1]
        assert event["action"] == "submit"
        assert (event["from_status"], event["to_status"]) == (
            "under_inspection", "inspection_submitted")
        assert event["actor_user_id"] == SURVEYOR_ID

    def test_a_missing_key_is_refused(self, icms_client, inspection_ready):
        ref = open_round(icms_client)

        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/submit", json={})

        assert response.status_code == 422

    def test_no_token_is_refused(self, anonymous_client, inspection_ready):
        response = anonymous_client.post(
            f"{INSPECTIONS}/INS-2026-0001/submit", json={"idempotency_key": KEY})

        assert response.status_code == 401


# ---------------------------------------------------------------- stage 5
class TestVerify:
    def submitted(self, icms_client) -> str:
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.put(f"{INSPECTIONS}/{ref}/findings", json={"findings": ["One"]})
        client.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})
        return ref

    def test_a_nodal_officer_accepts_the_round(self, icms_client, inspection_ready):
        ref = self.submitted(icms_client)

        response = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify", json={"decision": "accept"})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "accepted"
        assert body["case_status"] == "verified"

    def test_acceptance_reaches_stage_five(self, icms_client, inspection_ready):
        ref = self.submitted(icms_client)
        icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify", json={"decision": "accept"})

        case = icms_client.sign_in(NODAL).get(f"{CASES}/{CASE}").json()
        assert (case["status"], case["stage_no"]) == ("verified", 5)

    def test_a_rejection_sends_the_case_back_for_a_re_survey(
        self, icms_client, inspection_ready
    ):
        ref = self.submitted(icms_client)

        body = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify",
            json={"decision": "reject",
                  "reason": "No photograph of the rear elevation."}).json()

        assert body["status"] == "rejected"
        assert body["case_status"] == "resurvey_requested"

    def test_a_rejection_without_a_reason_is_refused(self, icms_client, inspection_ready):
        """The surveyor has to act on it, and "rejected" on its own is not an
        instruction anybody can follow."""
        ref = self.submitted(icms_client)

        response = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify", json={"decision": "reject"})

        assert response.status_code == 422

    def test_the_reason_is_recorded_on_the_event(self, icms_client, inspection_ready,
                                                 events):
        ref = self.submitted(icms_client)
        icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify",
            json={"decision": "reject", "reason": "No rear elevation."})

        event = events(inspection_ready[CASE].id)[-1]
        assert event["action"] == "verify_reject"
        assert event["note"] == "No rear elevation."
        assert (event["from_status"], event["to_status"]) == (
            "inspection_submitted", "resurvey_requested")

    def test_an_unsubmitted_round_cannot_be_verified(self, icms_client, inspection_ready):
        ref = open_round(icms_client)

        response = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify", json={"decision": "accept"})

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"

    def test_an_unknown_decision_is_refused(self, icms_client, inspection_ready):
        ref = self.submitted(icms_client)

        response = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ref}/verify", json={"decision": "maybe"})

        assert response.status_code == 422

    def test_no_token_is_refused(self, anonymous_client, inspection_ready):
        response = anonymous_client.post(
            f"{INSPECTIONS}/INS-2026-0001/verify", json={"decision": "accept"})

        assert response.status_code == 401


# ----------------------------------------------------------------- the reads
class TestRegister:
    def test_the_register_carries_the_counts_the_grid_draws(
        self, icms_client, inspection_ready
    ):
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
        client.put(f"{INSPECTIONS}/{ref}/findings", json={"findings": ["One", "Two"]})
        fields, files = photo("6f1d6dd9-8443-4b90-9a86-0f65c42b3010")
        client.post(f"{INSPECTIONS}/{ref}/evidence", data=fields, files=files)

        row = client.get(INSPECTIONS).json()["items"][0]
        assert row["inspection_ref"] == ref
        assert (row["finding_count"], row["evidence_count"]) == (2, 1)
        assert row["has_check_in"] is True
        assert row["case_title"] == "4 Taj Road"
        assert row["zone_cd"] == "TAJ"

    def test_a_field_surveyor_sees_only_their_own_rounds(
        self, icms_client, inspection_ready
    ):
        """The narrowing that makes GET /inspections the field app's work list."""
        open_round(icms_client, CASE, SURVEYOR_B_ID)
        open_round(icms_client, "CMP-2026-0003", SURVEYOR_ID, as_role=SURVEYOR)

        mine = icms_client.sign_in(SURVEYOR).get(INSPECTIONS).json()
        assert {row["surveyor_user_id"] for row in mine["items"]} == {SURVEYOR_ID}
        assert mine["total"] == 1
        # The other round is in TAJ, which this surveyor can see; it is filtered
        # out because it is somebody else's, not because of the zone.
        assert icms_client.sign_in(NODAL).get(INSPECTIONS).json()["total"] == 1

    def test_a_nodal_officer_sees_every_round_in_their_zones(
        self, icms_client, inspection_ready
    ):
        open_round(icms_client, CASE, SURVEYOR_ID)

        body = icms_client.sign_in(NODAL).get(INSPECTIONS).json()
        assert body["total"] == 1
        assert body["items"][0]["case_ref"] == CASE

    def test_a_round_outside_the_scope_is_not_counted(self, icms_client, inspection_ready):
        """CMP-2026-0003 is in CANT, which the nodal officer is not assigned to."""
        open_round(icms_client, CASE, SURVEYOR_ID)
        icms_client.sign_in(SURVEYOR).post(
            f"{CASES}/CMP-2026-0003/inspections", json={"surveyor_user_id": SURVEYOR_ID})

        body = icms_client.sign_in(NODAL).get(INSPECTIONS).json()
        assert body["total"] == len(body["items"]) == 1

    def test_the_filters_narrow_the_register(self, icms_client, inspection_ready):
        open_round(icms_client, CASE, SURVEYOR_ID)
        client = icms_client.sign_in(NODAL)

        assert client.get(INSPECTIONS, params={"case_ref": CASE}).json()["total"] == 1
        assert client.get(
            INSPECTIONS, params={"case_ref": "CMP-2026-0001"}).json()["total"] == 0
        assert client.get(INSPECTIONS, params={"status": "scheduled"}).json()["total"] == 1
        assert client.get(INSPECTIONS, params={"status": "submitted"}).json()["total"] == 0
        assert client.get(INSPECTIONS, params={"round_no": 1}).json()["total"] == 1
        assert client.get(INSPECTIONS, params={"zone_cd": "TAJ"}).json()["total"] == 1
        assert client.get(INSPECTIONS, params={"zone_cd": "CANT"}).json()["total"] == 0

    def test_the_case_priority_travels_with_the_round(self, icms_client,
                                                      inspection_ready):
        """The register's PRIORITY column. It is the CASE's priority, joined so the
        grid does not need a second call per row."""
        open_round(icms_client, CASE, SURVEYOR_ID)

        row = icms_client.sign_in(NODAL).get(INSPECTIONS).json()["items"][0]
        assert row["priority"] == "low"

    def test_the_priority_filter_is_a_closed_vocabulary(self, icms_client,
                                                        inspection_ready):
        open_round(icms_client, CASE, SURVEYOR_ID)
        client = icms_client.sign_in(NODAL)

        assert client.get(INSPECTIONS, params={"priority": "low"}).json()["total"] == 1
        assert client.get(INSPECTIONS, params={"priority": "high"}).json()["total"] == 0
        assert client.get(
            INSPECTIONS, params={"priority": "urgent"}).status_code == 422

    def test_the_free_text_search_covers_the_two_references(self, icms_client,
                                                            inspection_ready):
        """`q` is the reference box, not a general search: a surveyor reads a
        number off a printed sheet and types it in."""
        ref = open_round(icms_client, CASE, SURVEYOR_ID)
        client = icms_client.sign_in(NODAL)

        assert client.get(INSPECTIONS, params={"q": ref}).json()["total"] == 1
        assert client.get(INSPECTIONS, params={"q": CASE}).json()["total"] == 1
        assert client.get(INSPECTIONS, params={"q": "Taj Road"}).json()["total"] == 0

    def test_the_sort_whitelist_is_the_whole_defence(self, icms_client,
                                                     inspection_ready):
        """The column name reaches ORDER BY, so anything outside the whitelist is
        refused by name rather than interpolated."""
        open_round(icms_client, CASE, SURVEYOR_ID)
        client = icms_client.sign_in(NODAL)

        assert client.get(INSPECTIONS).json()["sort"] == "-inspection_ref"
        assert client.get(INSPECTIONS, params={"sort": "round_no"}).status_code == 200
        refused = client.get(INSPECTIONS, params={"sort": "evidence_count"})
        assert refused.status_code == 400
        assert error_of(refused)["code"] == "unknown_sort_field"

    def test_an_unknown_status_filter_is_refused(self, icms_client, inspection_ready):
        response = icms_client.sign_in(NODAL).get(
            INSPECTIONS, params={"status": "in-progress"})

        assert response.status_code == 422

    def test_the_submitted_date_range_is_anchored_in_indian_time(
        self, icms_client, inspection_ready
    ):
        ref = open_round(icms_client)
        icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": KEY})
        today = now_ist().date().isoformat()

        client = icms_client.sign_in(NODAL)
        assert client.get(
            INSPECTIONS, params={"submitted_from": today}).json()["total"] == 1
        assert client.get(
            INSPECTIONS, params={"submitted_to": "2026-01-01"}).json()["total"] == 0

    def test_no_token_is_refused(self, anonymous_client, inspection_ready):
        assert anonymous_client.get(INSPECTIONS).status_code == 401


class TestDetail:
    def test_the_detail_carries_every_part_of_the_round(
        self, icms_client, inspection_ready, act_sections
    ):
        ref = open_round(icms_client)
        client = icms_client.sign_in(SURVEYOR)
        client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body())
        client.put(f"{INSPECTIONS}/{ref}/findings",
                   json={"findings": ["One"],
                         "sections": [{"act_cd": "up_upda_1973",
                                       "section_cd": "sec_27"}]})
        fields, files = photo("6f1d6dd9-8443-4b90-9a86-0f65c42b3011")
        client.post(f"{INSPECTIONS}/{ref}/evidence", data=fields, files=files)

        body = client.get(f"{INSPECTIONS}/{ref}").json()
        assert len(body["check_ins"]) == 1
        assert len(body["findings"]) == 1
        assert len(body["sections"]) == 1
        assert len(body["evidence"]) == 1
        assert body["case_status"] == "under_inspection"

    def test_the_available_actions_come_from_the_policy(
        self, icms_client, inspection_ready
    ):
        """What the portal draws its buttons from. A convenience, never a
        control: `check` runs on every request whether or not a button existed."""
        ref = open_round(icms_client)

        surveyor = icms_client.sign_in(SURVEYOR).get(f"{INSPECTIONS}/{ref}").json()
        nodal = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{ref}").json()

        assert set(surveyor["available_actions"]) == {
            "check_in", "add_evidence", "record_findings", "submit"}
        assert nodal["available_actions"] == []

    def test_a_surveyor_cannot_read_a_colleagues_round_at_all(
        self, icms_client, inspection_ready
    ):
        """Not "no buttons" — no round.

        The work list already hides a colleague's round, and this detail carries
        the occupant's name and telephone number. A narrowing that the register
        applies and the by-reference read does not is a filter rather than a
        boundary. 404 and not 403, like every other record outside the caller's
        authority in this module.
        """
        ref = open_round(icms_client, CASE, SURVEYOR_B_ID)

        response = icms_client.sign_in(SURVEYOR).get(f"{INSPECTIONS}/{ref}")

        assert response.status_code == 404
        assert error_of(response)["code"] == "inspection_not_found"

    def test_the_surveyor_whose_round_it_is_still_reads_it(
        self, icms_client, inspection_ready
    ):
        """The other half: the narrowing must not hide a surveyor's own work."""
        ref = open_round(icms_client, CASE, SURVEYOR_B_ID)

        response = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).get(
            f"{INSPECTIONS}/{ref}")

        assert response.status_code == 200, response.text[:300]
        assert response.json()["inspection_ref"] == ref

    def test_a_lower_case_reference_is_accepted(self, icms_client, inspection_ready):
        ref = open_round(icms_client)

        response = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{ref.lower()}")
        assert response.status_code == 200

    def test_a_reference_in_the_wrong_shape_is_refused_before_any_query(
        self, icms_client, inspection_ready
    ):
        response = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/CMP-2026-0001")

        assert response.status_code == 422

    def test_a_round_outside_the_scope_is_indistinguishable_from_absent(
        self, icms_client, inspection_ready
    ):
        ref = open_round(icms_client, "CMP-2026-0003", SURVEYOR_ID, as_role=SURVEYOR)

        hidden = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{ref}")
        missing = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/INS-2026-9999")

        assert hidden.status_code == missing.status_code == 404
        assert error_of(hidden)["code"] == error_of(missing)["code"]

    def test_no_token_is_refused(self, anonymous_client, inspection_ready):
        assert anonymous_client.get(f"{INSPECTIONS}/INS-2026-0001").status_code == 401
