"""The Create Complaint pin's location suggestion: mapping, LGD lookup, throttle, cache, route.

Nothing here reaches the network: Nominatim is an httpx MockTransport.
"""

from __future__ import annotations

import httpx
import pytest

from app.icms.lgd_districts import UP_DISTRICTS, canonical_district, district_lgd_code
from app.icms.locator import (
    Located,
    NominatimLocator,
    NullLocator,
    get_locator,
    located_from_nominatim,
)
from tests.conftest import LEAD, NODAL, SUPER_ADMIN, SURVEYOR

LOCATE = "/api/icms/geo/locate"

AGRA_PAYLOAD = {
    "place_id": 1,
    "display_name": "Taj Ganj, Agra, Uttar Pradesh, 282001, India",
    "address": {
        "suburb": "Taj Ganj",
        "city": "Agra",
        "state_district": "Agra District",
        "state": "Uttar Pradesh",
        "ISO3166-2-lvl4": "IN-UP",
        "postcode": "282001",
        "country": "India",
        "country_code": "in",
    },
}


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def nominatim(handler, clock: FakeClock | None = None) -> NominatimLocator:
    clock = clock or FakeClock()
    return NominatimLocator(
        "https://nominatim.test", "ADA-ICMS/test (ops@example.test)", 5.0,
        transport=httpx.MockTransport(handler), clock=clock, sleep=clock.sleep,
    )


class TestTheAddressMapping:
    def test_a_full_agra_address(self):
        assert located_from_nominatim(AGRA_PAYLOAD) == Located(
            state="Uttar Pradesh", district="Agra", district_lgd="118",
            pincode="282001", source="nominatim")

    def test_county_is_the_fallback_for_district(self):
        payload = {"address": {"county": "Mathura", "state": "Uttar Pradesh"}}
        found = located_from_nominatim(payload)
        assert (found.district, found.district_lgd) == ("Mathura", "167")

    def test_a_renamed_district_comes_back_in_lgd_spelling(self):
        payload = {"address": {"state_district": "Allahabad District", "state": "Uttar Pradesh"}}
        found = located_from_nominatim(payload)
        assert (found.district, found.district_lgd) == ("Prayagraj", "120")

    @pytest.mark.parametrize("postcode", ["28200", "2820011", "082001", "abc123", ""])
    def test_a_postcode_that_is_not_a_pin_code_is_dropped(self, postcode):
        payload = {"address": {**AGRA_PAYLOAD["address"], "postcode": postcode}}
        assert located_from_nominatim(payload).pincode is None

    def test_no_lgd_code_outside_uttar_pradesh(self):
        payload = {"address": {"state_district": "Bijnor", "state": "Rajasthan"}}
        found = located_from_nominatim(payload)
        assert (found.district, found.district_lgd) == ("Bijnor", None)

    @pytest.mark.parametrize("payload", [{}, {"error": "Unable to geocode"}, [], None])
    def test_no_address_is_all_null(self, payload):
        assert located_from_nominatim(payload) == Located(source="nominatim")


class TestTheLgdTable:
    def test_all_seventy_five_districts_with_distinct_codes(self):
        assert len(UP_DISTRICTS) == 75
        assert len(set(UP_DISTRICTS.values())) == 75

    @pytest.mark.parametrize(("name", "code"), [
        ("Agra", "118"), ("AGRA DISTRICT", "118"), ("Firozabad", "143"),
        ("Mathura", "167"), ("Lucknow", "162"), ("Varanasi", "187"),
        ("Siddharthnagar", "182"), ("Sant Kabir Nagar", "178"), ("Faizabad", "140"),
        ("Lakhimpur Kheri", "159"), ("Kanpur", "157"), ("Kanpur Dehat", "156"),
        ("Gautam Budh Nagar", "144"), ("Hapur", "661"),
    ])
    def test_matching_is_tolerant(self, name, code):
        assert district_lgd_code(name) == code

    @pytest.mark.parametrize("name", ["Delhi", "", None, "Agra Fort"])
    def test_an_unknown_name_is_none(self, name):
        assert district_lgd_code(name) is None
        assert canonical_district(name) is None


class TestTheNominatimClient:
    def test_it_sends_the_documented_query_and_user_agent(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json=AGRA_PAYLOAD)

        found = nominatim(handler).locate(27.175144, 78.042142)

        assert found.district_lgd == "118"
        (request,) = seen
        assert request.url.path == "/reverse"
        assert dict(request.url.params) == {
            "format": "jsonv2", "lat": "27.1751", "lon": "78.0421", "zoom": "16",
            "addressdetails": "1"}
        assert request.headers["User-Agent"] == "ADA-ICMS/test (ops@example.test)"

    def test_a_nearby_pin_is_served_from_the_cache(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(200, json=AGRA_PAYLOAD)

        locator = nominatim(handler)
        first = locator.locate(27.17512, 78.04211)
        second = locator.locate(27.17514, 78.04209)

        assert first == second
        assert len(calls) == 1

    def test_the_cache_is_bounded(self):
        locator = nominatim(lambda request: httpx.Response(200, json=AGRA_PAYLOAD))
        locator.CACHE_SIZE = 3
        for step in range(5):
            locator.locate(27.0 + step / 100, 78.0)
        assert len(locator._cache) == 3

    def test_back_to_back_calls_wait_out_the_second(self):
        clock = FakeClock()
        locator = nominatim(lambda request: httpx.Response(200, json=AGRA_PAYLOAD), clock)

        locator.locate(27.1, 78.0)
        clock.now += 0.25
        locator.locate(27.2, 78.0)
        clock.now += 5
        locator.locate(27.3, 78.0)

        assert clock.slept == [pytest.approx(0.75)]

    @pytest.mark.parametrize("response", [
        httpx.Response(503, text="busy"),
        httpx.Response(200, text="<html>not json</html>"),
    ])
    def test_an_upstream_failure_is_unavailable_and_not_cached(self, response, caplog):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return response

        locator = nominatim(handler)
        assert locator.locate(27.1, 78.0) == Located(source="unavailable")
        locator.locate(27.1, 78.0)

        assert len(calls) == 2
        assert "reverse geocode failed" in caplog.text

    def test_a_timeout_is_unavailable(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow", request=request)

        assert nominatim(handler).locate(27.1, 78.0).source == "unavailable"


def test_the_null_locator_answers_nothing():
    assert NullLocator().locate(27.1, 78.0) == Located(source="none")


class TestTheRoute:
    @pytest.fixture
    def with_locator(self):
        from app.main import app

        def install(locator):
            app.dependency_overrides[get_locator] = lambda: locator

        return install

    def test_the_suite_runs_the_null_locator(self, icms_client, policy_tables):
        body = icms_client.sign_in(NODAL).get(LOCATE, params={"lat": 27.17, "lon": 78.04}).json()
        assert body == {"state": None, "district": None, "district_lgd": None,
                        "pincode": None, "source": "none"}

    def test_a_suggestion_comes_back(self, icms_client, policy_tables, with_locator):
        with_locator(nominatim(lambda request: httpx.Response(200, json=AGRA_PAYLOAD)))
        response = icms_client.sign_in(SURVEYOR).get(LOCATE, params={"lat": 27.17, "lon": 78.04})
        assert response.status_code == 200
        assert response.json() == {"state": "Uttar Pradesh", "district": "Agra",
                                   "district_lgd": "118", "pincode": "282001",
                                   "source": "nominatim"}

    def test_an_upstream_outage_is_still_200(self, icms_client, policy_tables, with_locator):
        with_locator(nominatim(lambda request: httpx.Response(502)))
        response = icms_client.sign_in(LEAD).get(LOCATE, params={"lat": 27.17, "lon": 78.04})
        assert response.status_code == 200
        assert response.json()["source"] == "unavailable"

    def test_super_admin_files_no_complaint_so_gets_no_suggestion(self, icms_client,
                                                                   policy_tables):
        response = icms_client.sign_in(SUPER_ADMIN).get(LOCATE, params={"lat": 27.1, "lon": 78.0})
        assert response.status_code == 403

    @pytest.mark.parametrize("params", [{"lat": 91, "lon": 78}, {"lat": 27, "lon": 181},
                                        {"lat": 27}])
    def test_a_bad_point_is_422(self, icms_client, policy_tables, params):
        response = icms_client.sign_in(NODAL).get(LOCATE, params=params)
        assert response.status_code == 422
