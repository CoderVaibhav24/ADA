"""Who holds the property, recorded on site (decision 2026-09-24).

The complaint form no longer asks for owner, property type, floors or police
station; the surveyor records them on the round, and the case detail shows the
values each round carries.
"""

from __future__ import annotations

import pytest
from ada_core.models_icms import CodeValue

from tests.conftest import NODAL, SURVEYOR
from tests.test_icms_inspections import CASE, CASES, INSPECTIONS, check_in_body, open_round
from tests.test_icms_reference import error_of

FACTS = {
    "occupant_name": "Ramesh Kumar",
    "occupant_phone": "9876543210",
    "property_type_cd": "commercial",
    "floor_count": 3,
    "police_station": "Tajganj",
}


@pytest.fixture
def property_world(db, inspection_ready):
    db.add_all([
        CodeValue(domain="property_type", code=code, label=code, sort_order=order,
                  active=active)
        for order, (code, active) in enumerate([
            ("residential", True), ("commercial", True), ("retired_kind", False),
        ], start=1)
    ])
    db.commit()
    return inspection_ready


def started(icms_client):
    ref = open_round(icms_client)
    client = icms_client.sign_in(SURVEYOR)
    assert client.post(f"{INSPECTIONS}/{ref}/check-in",
                       json=check_in_body()).status_code == 201
    return ref, client


def save(client, ref, **fields):
    return client.put(f"{INSPECTIONS}/{ref}/findings",
                      json={"findings": ["Shop on the ground floor."], **fields})


class TestRecorded:
    def test_the_facts_are_stored_and_read_back(self, icms_client, property_world):
        ref, client = started(icms_client)
        response = save(client, ref, **FACTS)
        assert response.status_code == 200, response.text
        body = response.json()
        for name, value in FACTS.items():
            assert body[name] == value, name

        detail = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{ref}").json()
        assert detail["property_type_cd"] == "commercial"
        assert detail["floor_count"] == 3

    def test_every_fact_is_optional(self, icms_client, property_world):
        ref, client = started(icms_client)
        body = save(client, ref).json()
        assert all(body[name] is None for name in FACTS)

    def test_the_case_detail_carries_each_rounds_facts(self, icms_client, property_world):
        ref, client = started(icms_client)
        assert save(client, ref, **FACTS).status_code == 200

        case = icms_client.sign_in(NODAL).get(f"{CASES}/{CASE}").json()
        (round_,) = [r for r in case["rounds"] if r["inspection_ref"] == ref]
        for name, value in FACTS.items():
            assert round_[name] == value, name

    def test_an_omitted_fact_is_left_alone(self, icms_client, property_world):
        ref, client = started(icms_client)
        save(client, ref, **FACTS)
        body = save(client, ref, officer_note="Revisited.").json()
        assert body["police_station"] == "Tajganj"
        assert body["floor_count"] == 3


class TestRefused:
    def test_an_unknown_property_type_is_refused(self, icms_client, property_world):
        ref, client = started(icms_client)
        response = save(client, ref, property_type_cd="castle")
        assert response.status_code == 422
        error = error_of(response)
        assert error["field"] == "property_type_cd"
        assert sorted(error["allowed"]) == ["commercial", "residential"]

    def test_a_retired_property_type_is_refused(self, icms_client, property_world):
        ref, client = started(icms_client)
        response = save(client, ref, property_type_cd="retired_kind")
        assert response.status_code == 422
        assert error_of(response)["field"] == "property_type_cd"

    @pytest.mark.parametrize("floors", [-1, 201])
    def test_floors_out_of_range_are_refused(self, icms_client, property_world, floors):
        ref, client = started(icms_client)
        assert save(client, ref, floor_count=floors).status_code == 422

    def test_a_malformed_mobile_is_refused(self, icms_client, property_world):
        ref, client = started(icms_client)
        response = save(client, ref, occupant_name="Ramesh", occupant_phone="12345")
        assert response.status_code == 422

    def test_markup_in_the_police_station_is_refused(self, icms_client, property_world):
        ref, client = started(icms_client)
        assert save(client, ref, police_station="<b>PS</b>").status_code == 422
