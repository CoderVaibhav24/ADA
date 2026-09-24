"""The surveyor's structured answers and rules R1-R6 (gap audit §1a).

The three closed answers (encroachment confirmed, external support,
recommendation) and the six area types from the web form. A findings save refuses
answers that contradict each other; submit also refuses a round missing an
answer the others make required.
"""

from __future__ import annotations

import pytest
from ada_core.models_icms import CodeValue, Inspection

from app.icms import inspection_rules as rules
from tests.conftest import NODAL, SURVEYOR
from tests.test_icms_inspections import INSPECTIONS, check_in_body, open_round
from tests.test_icms_reference import error_of

SUBMIT_KEY = "6f1d6dd9-8443-4b90-9a86-0f65c42b3999"

CONFIRMED = {
    "findings": ["RCC room built on the drain."],
    "encroachment_confirmed_cd": "yes",
    "measured_area_sqm": 185.81,
    "area_type_cd": "rcc",
    "external_support_cd": "none",
    "recommendation_cd": "issue_notice",
    "notice_act_cd": "up_upda_1973",
    "sections": [{"act_cd": "up_upda_1973", "section_cd": "sec_27"}],
}


@pytest.fixture
def answers_world(db, inspection_ready, act_sections, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "icms_require_inspection_answers", True)
    db.add_all([
        CodeValue(domain="area_type", code=code, label=code, sort_order=order,
                  active=active)
        for order, (code, active) in enumerate([
            ("built_up", False), ("under_construction", False), ("vacant", False),
            ("rcc", True), ("semi_permanent", True), ("shed_hutment", True),
            ("agricultural", True), ("land_levelling", True), ("fencing", True),
        ])
    ])
    db.commit()
    return inspection_ready


def started(icms_client, *, check_in: bool = True):
    ref = open_round(icms_client)
    client = icms_client.sign_in(SURVEYOR)
    if check_in:
        assert client.post(f"{INSPECTIONS}/{ref}/check-in",
                           json=check_in_body()).status_code == 201
    return ref, client


def submit(client, ref):
    return client.post(f"{INSPECTIONS}/{ref}/submit", json={"idempotency_key": SUBMIT_KEY})


class TestValidSubmit:
    def test_a_confirmed_encroachment_is_stored_and_submitted(
        self, icms_client, answers_world
    ):
        ref, client = started(icms_client)
        saved = client.put(f"{INSPECTIONS}/{ref}/findings", json=CONFIRMED)
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert body["encroachment_confirmed_cd"] == "yes"
        assert body["external_support_cd"] == "none"
        assert body["recommendation_cd"] == "issue_notice"
        assert body["area_type_cd"] == "rcc"
        assert body["measured_area_sqm"] == 185.81
        assert body["notice_required"] is True, "derived from issue_notice"

        response = submit(client, ref)
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "submitted"

    def test_a_false_positive_needs_only_the_answer(self, icms_client, answers_world):
        ref, client = started(icms_client)
        body = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            "findings": ["Nothing new on site."],
            "encroachment_confirmed_cd": "no_false_positive",
        }).json()
        assert body["recommendation_cd"] == "no_action_required"
        assert body["notice_required"] is False

        assert submit(client, ref).status_code == 200

    def test_a_false_positive_overrides_an_earlier_recommendation(
        self, icms_client, answers_world
    ):
        ref, client = started(icms_client)
        client.put(f"{INSPECTIONS}/{ref}/findings", json=CONFIRMED)
        body = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            "findings": ["Second look: nothing new."],
            "encroachment_confirmed_cd": "no_false_positive",
        }).json()
        assert (body["recommendation_cd"], body["notice_required"]) == (
            "no_action_required", False)

    def test_partial_with_further_investigation_is_accepted(
        self, icms_client, answers_world
    ):
        ref, client = started(icms_client)
        body = {**CONFIRMED, "encroachment_confirmed_cd": "partial",
                "recommendation_cd": "further_investigation", "area_type_cd": "fencing",
                "notice_required": True}
        assert client.put(f"{INSPECTIONS}/{ref}/findings", json=body).status_code == 200
        assert submit(client, ref).status_code == 200


class TestSaveRefusals:
    @pytest.mark.parametrize("field, value", [
        ("encroachment_confirmed_cd", "maybe"),
        ("external_support_cd", "army"),
        ("recommendation_cd", "shrug"),
        ("measured_area_sqm", 0),
        ("measured_area_sqm", -5),
        ("measured_area_sqm", 10_000_001),
    ])
    def test_an_out_of_range_value_is_refused_on_its_field(
        self, icms_client, answers_world, field, value
    ):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings",
                              json={**CONFIRMED, field: value})
        assert response.status_code == 422
        error = error_of(response)
        assert (error["code"], error["field"]) == ("validation_failed", field)

    def test_r1_a_false_positive_cannot_carry_an_enforcement_recommendation(
        self, icms_client, answers_world
    ):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            "findings": ["x"], "encroachment_confirmed_cd": "no_false_positive",
            "recommendation_cd": "demolition_order"})
        error = error_of(response)
        assert response.status_code == 422
        assert error["field"] == "recommendation_cd"
        assert error["allowed"] == ["no_action_required"]

    def test_r1_a_false_positive_cannot_require_a_notice(self, icms_client, answers_world):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            "findings": ["x"], "encroachment_confirmed_cd": "no_false_positive",
            "notice_required": True})
        assert response.status_code == 422
        assert error_of(response)["field"] == "notice_required"

    @pytest.mark.parametrize("confirmed", ["yes", "partial"])
    def test_r2_a_confirmed_encroachment_cannot_be_no_action(
        self, icms_client, answers_world, confirmed
    ):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            **CONFIRMED, "encroachment_confirmed_cd": confirmed,
            "recommendation_cd": "no_action_required"})
        assert response.status_code == 422
        error = error_of(response)
        assert error["field"] == "recommendation_cd"
        assert "no_action_required" not in error["allowed"]

    def test_r2_is_checked_against_what_the_round_already_holds(
        self, icms_client, answers_world
    ):
        ref, client = started(icms_client)
        client.put(f"{INSPECTIONS}/{ref}/findings", json={
            "findings": ["x"], "encroachment_confirmed_cd": "no_false_positive"})
        response = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            "findings": ["x"], "encroachment_confirmed_cd": "yes"})
        assert response.status_code == 422
        assert error_of(response)["field"] == "recommendation_cd"

    def test_a_notice_recommendation_cannot_say_no_notice(self, icms_client, answers_world):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings",
                              json={**CONFIRMED, "notice_required": False})
        assert response.status_code == 422
        assert error_of(response)["field"] == "notice_required"

    def test_an_unknown_area_type_is_refused(self, icms_client, answers_world):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings",
                              json={**CONFIRMED, "area_type_cd": "castle"})
        assert response.status_code == 422
        error = error_of(response)
        assert error["field"] == "area_type_cd"
        assert "rcc" in error["allowed"] and "built_up" not in error["allowed"]

    def test_a_retired_area_type_is_refused_on_a_new_write(
        self, icms_client, answers_world
    ):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings",
                              json={**CONFIRMED, "area_type_cd": "built_up"})
        assert response.status_code == 422
        assert error_of(response)["field"] == "area_type_cd"

    def test_a_refused_save_writes_nothing(self, icms_client, answers_world, db):
        ref, client = started(icms_client)
        client.put(f"{INSPECTIONS}/{ref}/findings", json={
            **CONFIRMED, "recommendation_cd": "no_action_required"})
        row = db.query(Inspection).filter_by(inspection_ref=ref).one()
        db.refresh(row)
        assert row.encroachment_confirmed_cd is None
        assert row.findings == []


class TestSubmitRefusals:
    def missing(self, response) -> list[str]:
        assert response.status_code == 422, response.text
        error = error_of(response)
        assert error["code"] == "missing_payload"
        return error["allowed"]

    def test_r1_the_encroachment_answer_is_required(self, icms_client, answers_world):
        ref, client = started(icms_client)
        client.put(f"{INSPECTIONS}/{ref}/findings", json={"findings": ["x"]})
        response = submit(client, ref)
        assert error_of(response)["field"] == "encroachment_confirmed_cd"
        assert "encroachment_confirmed_cd" in self.missing(response)

    @pytest.mark.parametrize("dropped", [
        "measured_area_sqm", "area_type_cd", "external_support_cd", "recommendation_cd"])
    def test_r2_yes_makes_the_rest_required(self, icms_client, answers_world, dropped):
        ref, client = started(icms_client)
        body = {k: v for k, v in CONFIRMED.items() if k != dropped}
        assert client.put(f"{INSPECTIONS}/{ref}/findings", json=body).status_code == 200
        assert self.missing(submit(client, ref)) == [dropped]

    def test_r4_a_phone_needs_a_name(self, icms_client, answers_world):
        ref, client = started(icms_client)
        client.put(f"{INSPECTIONS}/{ref}/findings",
                   json={**CONFIRMED, "occupant_phone": "9876543210"})
        assert self.missing(submit(client, ref)) == ["occupant_name"]

    def test_r5_police_help_needs_a_remark(self, icms_client, answers_world):
        ref, client = started(icms_client)
        client.put(f"{INSPECTIONS}/{ref}/findings",
                   json={**CONFIRMED, "external_support_cd": "police"})
        assert self.missing(submit(client, ref)) == ["officer_note"]

        client.put(f"{INSPECTIONS}/{ref}/findings",
                   json={**CONFIRMED, "external_support_cd": "police",
                         "officer_note": "Occupant threatened the team."})
        assert submit(client, ref).status_code == 200

    def test_r6_a_round_with_no_check_in_is_refused(self, icms_client, answers_world):
        ref, client = started(icms_client, check_in=False)
        client.put(f"{INSPECTIONS}/{ref}/findings", json=CONFIRMED)
        assert self.missing(submit(client, ref)) == ["check_in"]

    def test_r6_a_round_with_nothing_recorded_lists_everything(
        self, icms_client, answers_world
    ):
        ref, client = started(icms_client)
        assert set(self.missing(submit(client, ref))) == {
            "encroachment_confirmed_cd", "findings"}

    def test_a_refused_submit_leaves_the_round_open(self, icms_client, answers_world):
        ref, client = started(icms_client)
        submit(client, ref)
        body = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{ref}").json()
        assert body["status"] != "submitted"
        assert body["case_status"] == "under_inspection"


class TestNoticeAndOwner:
    """R7 (notice, act, sections) and R8 (owner), from legacy inspection."""

    def missing(self, response) -> list[str]:
        assert response.status_code == 422, response.text
        return error_of(response)["allowed"]

    def test_a_notice_without_act_or_section_cannot_submit(self, icms_client, answers_world):
        ref, client = started(icms_client)
        body = {k: v for k, v in CONFIRMED.items() if k not in ("notice_act_cd", "sections")}
        assert client.put(f"{INSPECTIONS}/{ref}/findings", json=body).status_code == 200
        assert self.missing(submit(client, ref)) == ["notice_act_cd", "sections"]

    def test_a_section_under_another_act_does_not_count(self, icms_client, answers_world, db):
        db.add_all([
            CodeValue(domain="act", code="other_act", label="Other", sort_order=2),
            CodeValue(domain="section", code="oth_1", parent_code="other_act",
                      label="Other 1", sort_order=1),
        ])
        db.commit()
        ref, client = started(icms_client)
        body = {**CONFIRMED, "sections": [{"act_cd": "other_act", "section_cd": "oth_1"}]}
        assert client.put(f"{INSPECTIONS}/{ref}/findings", json=body).status_code == 200
        assert self.missing(submit(client, ref)) == ["sections"]

    def test_file_legal_case_needs_the_notice_answer(self, icms_client, answers_world):
        ref, client = started(icms_client)
        body = {**CONFIRMED, "recommendation_cd": "file_legal_case"}
        del body["notice_act_cd"]
        del body["sections"]
        client.put(f"{INSPECTIONS}/{ref}/findings", json=body)
        assert self.missing(submit(client, ref)) == ["notice_required"]

        client.put(f"{INSPECTIONS}/{ref}/findings", json={**body, "notice_required": False})
        assert submit(client, ref).status_code == 200

    @pytest.mark.parametrize("field, value", [
        ("notice_act_cd", "indian_penal_code"),
        ("sections", [{"act_cd": "up_upda_1973", "section_cd": "sec_99"}]),
        ("sections", [{"act_cd": "up_upda_1973", "section_cd": "sec_28a"}]),
        ("sections", [{"act_cd": "no_such_act", "section_cd": "sec_27"}]),
    ])
    def test_an_unknown_act_or_section_is_refused(
        self, icms_client, answers_world, field, value
    ):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings",
                              json={**CONFIRMED, field: value})
        assert response.status_code == 422
        assert error_of(response)["field"] == field

    def test_no_notice_with_an_act_is_refused(self, icms_client, answers_world):
        ref, client = started(icms_client)
        response = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            **CONFIRMED, "recommendation_cd": "further_investigation",
            "notice_required": False})
        assert response.status_code == 422
        assert error_of(response)["field"] == "notice_act_cd"

    def test_the_owner_is_stored_apart_from_the_occupant(self, icms_client, answers_world):
        ref, client = started(icms_client)
        body = client.put(f"{INSPECTIONS}/{ref}/findings", json={
            **CONFIRMED, "owner_name": "Suresh Gupta", "owner_phone": "+91 98765 43210",
            "occupant_name": "Ramesh Lal"}).json()
        assert (body["owner_name"], body["owner_phone"]) == ("Suresh Gupta", "9876543210")
        assert body["occupant_name"] == "Ramesh Lal"

    def test_an_owner_phone_needs_an_owner_name(self, icms_client, answers_world):
        ref, client = started(icms_client)
        client.put(f"{INSPECTIONS}/{ref}/findings",
                   json={**CONFIRMED, "owner_phone": "9876543210"})
        assert self.missing(submit(client, ref)) == ["owner_name"]


class TestLegacyRounds:
    def test_a_round_recorded_before_the_answers_reads_as_nulls(
        self, icms_client, answers_world, db
    ):
        ref, client = started(icms_client)
        row = db.query(Inspection).filter_by(inspection_ref=ref).one()
        row.area_type_cd, row.measured_area_sqm = "built_up", 0
        db.commit()

        body = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{ref}").json()
        assert body["area_type_cd"] == "built_up"
        assert body["encroachment_confirmed_cd"] is None
        assert body["external_support_cd"] is None
        assert body["recommendation_cd"] is None

    def test_a_round_keeping_its_legacy_area_type_can_still_submit(
        self, icms_client, answers_world, db
    ):
        ref, client = started(icms_client)
        row = db.query(Inspection).filter_by(inspection_ref=ref).one()
        row.area_type_cd = "under_construction"
        db.commit()

        body = {k: v for k, v in CONFIRMED.items() if k != "area_type_cd"}
        assert client.put(f"{INSPECTIONS}/{ref}/findings", json=body).status_code == 200
        resent = client.put(f"{INSPECTIONS}/{ref}/findings",
                            json={**body, "area_type_cd": "under_construction"})
        assert resent.status_code == 200, "re-sending the round's own code is not a new write"
        assert submit(client, ref).status_code == 200


class TestRulesArePure:
    def test_derive_leaves_an_untouched_body_alone(self):
        assert rules.derive({"officer_note": "x"}) == {"officer_note": "x"}

    def test_derive_does_not_override_what_the_body_said(self):
        derived = rules.derive({"recommendation_cd": "issue_notice",
                                "notice_required": False})
        assert derived["notice_required"] is False
        assert [p.field for p in rules.inconsistencies(derived)] == ["notice_required"]

    def test_file_legal_case_leaves_the_notice_to_the_officer(self):
        derived = rules.derive({"recommendation_cd": "file_legal_case"})
        assert "notice_required" not in derived
        assert rules.inconsistencies({**derived, "notice_required": True}) == []

    def test_a_complete_confirmed_round_owes_nothing(self):
        values = rules.derive({**CONFIRMED, "occupant_phone": None})
        assert rules.missing_for_submit(
            values, findings=1, check_ins=1,
            sections=[("up_upda_1973", "sec_27")]) == []

    def test_a_decided_recommendation_owes_the_notice_answer(self):
        values = {"encroachment_confirmed_cd": "yes", "measured_area_sqm": 10,
                  "area_type_cd": "rcc", "external_support_cd": "none",
                  "recommendation_cd": "file_legal_case"}
        assert rules.missing_for_submit(values, findings=1, check_ins=1) == [
            "notice_required"]

    def test_a_notice_owes_an_act_and_a_section_under_it(self):
        values = {"encroachment_confirmed_cd": "no_false_positive",
                  "recommendation_cd": "no_action_required", "notice_required": True}
        assert rules.missing_for_submit(values, findings=1, check_ins=1) == [
            "notice_act_cd", "sections"]
        values["notice_act_cd"] = "up_upda_1973"
        assert rules.missing_for_submit(
            values, findings=1, check_ins=1, sections=[("other_act", "s1")]) == ["sections"]

    def test_no_notice_clears_the_act_it_would_have_cited(self):
        derived = rules.derive({"notice_required": False})
        assert derived["notice_act_cd"] is None
        problems = rules.inconsistencies({"notice_required": False,
                                          "notice_act_cd": "up_upda_1973"})
        assert [p.field for p in problems] == ["notice_act_cd"]

    def test_an_owner_phone_needs_an_owner_name(self):
        values = {"owner_phone": "9876543210"}
        assert "owner_name" in rules.missing_for_submit(values, findings=1, check_ins=1)
