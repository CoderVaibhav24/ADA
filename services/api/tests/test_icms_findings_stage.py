"""Construction stage, length × width, and the web-origin relaxation (0023).

docs/icms/inspection-findings-fields.md. All three new fields are optional; the
area is derived from length × width when none is given, and flagged, not
refused, when the two disagree by more than 10%. A round whose findings were
saved from the web portal is not held to the notice act, sections or owner.
"""

from __future__ import annotations

import pytest
from ada_core.models_icms import CodeValue

from app.icms import inspection_rules as rules
from tests.conftest import SURVEYOR
from tests.test_icms_inspection_answers import CONFIRMED, answers_world, submit  # noqa: F401
from tests.test_icms_inspections import INSPECTIONS, check_in_body, open_round
from tests.test_icms_reference import error_of

STAGES = ("foundation_plinth", "under_construction", "structure_complete",
          "finishing", "completed_occupied", "completed_vacant")


@pytest.fixture
def stage_world(db, answers_world):  # noqa: F811
    db.add_all([
        CodeValue(domain="construction_stage", code=code, label=code, sort_order=order)
        for order, code in enumerate(STAGES, start=1)
    ])
    db.commit()
    return answers_world


def started(icms_client, *, azp: str | None = None):
    ref = open_round(icms_client)
    client = icms_client.sign_in(SURVEYOR, azp=azp)
    assert client.post(f"{INSPECTIONS}/{ref}/check-in", json=check_in_body()).status_code == 201
    return ref, client


def put(client, ref, body):
    return client.put(f"{INSPECTIONS}/{ref}/findings", json=body)


class TestNewFields:
    def test_stage_and_sides_are_stored_and_read_back(self, icms_client, stage_world):
        ref, client = started(icms_client)
        response = put(client, ref, {**CONFIRMED, "construction_stage_cd": "finishing",
                                     "length_m": 12.5, "width_m": 8})
        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["construction_stage_cd"], body["length_m"], body["width_m"]) == (
            "finishing", 12.5, 8.0)
        assert body["findings_source"] == "field"
        assert submit(client, ref).status_code == 200

    def test_all_three_are_optional(self, icms_client, stage_world):
        ref, client = started(icms_client)
        body = put(client, ref, CONFIRMED).json()
        assert (body["construction_stage_cd"], body["length_m"], body["width_m"]) == (
            None, None, None)
        assert body["area_mismatch"] is False
        assert submit(client, ref).status_code == 200

    def test_an_unknown_stage_is_refused(self, icms_client, stage_world):
        ref, client = started(icms_client)
        response = put(client, ref, {**CONFIRMED, "construction_stage_cd": "demolished"})
        assert response.status_code == 422
        error = error_of(response)
        assert error["field"] == "construction_stage_cd"
        assert set(error["allowed"]) == set(STAGES)

    @pytest.mark.parametrize("field, value", [
        ("length_m", 0), ("length_m", -1), ("width_m", 10_000.5),
    ])
    def test_a_side_out_of_range_is_refused(self, icms_client, stage_world, field, value):
        ref, client = started(icms_client)
        response = put(client, ref, {**CONFIRMED, field: value})
        assert response.status_code == 422
        assert error_of(response)["field"] == field


class TestArea:
    def test_the_area_is_derived_from_the_sides(self, icms_client, stage_world):
        ref, client = started(icms_client)
        body = {k: v for k, v in CONFIRMED.items() if k != "measured_area_sqm"}
        saved = put(client, ref, {**body, "length_m": 10, "width_m": 4.5}).json()
        assert saved["measured_area_sqm"] == 45.0
        assert saved["area_mismatch"] is False
        assert submit(client, ref).status_code == 200, "the derived area satisfies R2"

    def test_a_derived_area_follows_new_sides(self, icms_client, stage_world):
        ref, client = started(icms_client)
        body = {k: v for k, v in CONFIRMED.items() if k != "measured_area_sqm"}
        put(client, ref, {**body, "length_m": 10, "width_m": 4})
        again = put(client, ref, {**body, "length_m": 10, "width_m": 5}).json()
        assert again["measured_area_sqm"] == 50.0

    def test_a_typed_area_is_kept_and_a_mismatch_flagged(self, icms_client, stage_world):
        ref, client = started(icms_client)
        saved = put(client, ref, {**CONFIRMED, "measured_area_sqm": 60,
                                  "length_m": 10, "width_m": 5})
        assert saved.status_code == 200, "a disagreement is accepted, not refused"
        assert saved.json()["measured_area_sqm"] == 60.0
        assert saved.json()["area_mismatch"] is True

        kept = put(client, ref, {**CONFIRMED, "measured_area_sqm": 54,
                                 "length_m": 10, "width_m": 5}).json()
        assert kept["area_mismatch"] is False, "within 10% of 50"

    def test_a_typed_area_is_not_overwritten_by_later_sides(self, icms_client, stage_world):
        ref, client = started(icms_client)
        put(client, ref, {**CONFIRMED, "measured_area_sqm": 100})
        body = {k: v for k, v in CONFIRMED.items() if k != "measured_area_sqm"}
        saved = put(client, ref, {**body, "length_m": 2, "width_m": 2}).json()
        assert saved["measured_area_sqm"] == 100.0
        assert saved["area_mismatch"] is True


class TestWebOrigin:
    NO_CITATION = {k: v for k, v in CONFIRMED.items() if k not in ("notice_act_cd", "sections")}

    def test_a_web_round_submits_without_act_sections_or_owner(
        self, icms_client, stage_world
    ):
        ref, client = started(icms_client, azp="ada-web")
        saved = put(client, ref, {**self.NO_CITATION, "owner_phone": "9876543210"})
        assert saved.json()["findings_source"] == "web"
        response = submit(client, ref)
        assert response.status_code == 200, response.text

    def test_the_otp_client_counts_as_web(self, icms_client, stage_world):
        ref, client = started(icms_client, azp="ada-auth")
        assert put(client, ref, self.NO_CITATION).json()["findings_source"] == "web"
        assert submit(client, ref).status_code == 200

    def test_a_field_round_still_owes_them(self, icms_client, stage_world):
        ref, client = started(icms_client, azp="ada-field")
        put(client, ref, {**self.NO_CITATION, "owner_phone": "9876543210"})
        response = submit(client, ref)
        assert response.status_code == 422
        assert set(error_of(response)["allowed"]) == {"notice_act_cd", "sections", "owner_name"}

    def test_the_last_save_decides(self, icms_client, stage_world):
        ref, web = started(icms_client, azp="ada-web")
        put(web, ref, self.NO_CITATION)
        field = icms_client.sign_in(SURVEYOR, azp="ada-field")
        put(field, ref, self.NO_CITATION)
        assert submit(field, ref).status_code == 422

    def test_a_web_round_is_still_held_to_the_other_rules(self, icms_client, stage_world):
        ref, client = started(icms_client, azp="ada-web")
        body = {k: v for k, v in self.NO_CITATION.items() if k != "area_type_cd"}
        put(client, ref, body)
        assert error_of(submit(client, ref))["allowed"] == ["area_type_cd"]

    def test_a_web_save_still_checks_the_codes_it_is_given(self, icms_client, stage_world):
        ref, client = started(icms_client, azp="ada-web")
        response = put(client, ref, {**CONFIRMED, "notice_act_cd": "indian_penal_code"})
        assert error_of(response)["field"] == "notice_act_cd"


class TestPureRules:
    def test_side_area_needs_both_sides(self):
        assert rules.side_area({"length_m": 3}) is None
        assert rules.side_area({"length_m": 3, "width_m": 2.5}) == 7.5

    @pytest.mark.parametrize("area, flagged", [(50, False), (55, False), (55.01, True),
                                               (44.99, True), (None, False)])
    def test_the_mismatch_is_ten_percent_of_length_times_width(self, area, flagged):
        values = {"length_m": 10, "width_m": 5, "measured_area_sqm": area}
        assert rules.area_mismatch(values) is flagged

    def test_web_origin_drops_only_the_act_sections_and_owner(self):
        values = {"encroachment_confirmed_cd": "no_false_positive",
                  "recommendation_cd": "no_action_required", "notice_required": True,
                  "owner_phone": "9876543210"}
        assert rules.missing_for_submit(values, findings=1, check_ins=1) == [
            "notice_act_cd", "sections", "owner_name"]
        assert rules.missing_for_submit(values, findings=0, check_ins=1,
                                        origin=rules.WEB) == ["findings"]
