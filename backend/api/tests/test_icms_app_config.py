"""`GET /api/icms/app-config` — the rules a field client must not duplicate.

The endpoint exists because a copy went stale: the app carried its own accuracy
threshold, and the server's single threshold then became a gate and a flag. So
the tests that matter here are not "does it answer 200" but "does the answer
MOVE when the server's rule moves". A test that pinned 50.0 would pass against a
second hard-coded literal, which is the bug rather than the fix.
"""

from __future__ import annotations

import pytest
from ada_core.validation import MAX_CLOCK_SKEW

from app.config import settings
from tests.conftest import LEAD, NODAL, SUPER_ADMIN, SURVEYOR
from tests.test_icms_reference import error_of

PATH = "/api/icms/app-config"
ROLES = (SUPER_ADMIN, NODAL, SURVEYOR, LEAD)

FIELDS = {
    "gps_accuracy_gate_m",
    "gps_accuracy_flag_m",
    "device_timestamp_max_age_hours",
    "minimum_photo_count",
    "maximum_photo_count",
}


class TestTheShape:
    def test_it_carries_exactly_the_documented_fields(self, icms_client):
        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert set(body) == FIELDS

    def test_every_value_is_a_number_and_not_a_string(self, icms_client):
        """A client that has to parse "50.0" before comparing it is a client that
        will compare the strings instead."""
        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        for name, value in body.items():
            assert isinstance(value, (int, float)) and not isinstance(value, bool), (
                f"{name} arrived as {type(value).__name__}: {value!r}"
            )

    def test_it_publishes_both_photo_counts(self, icms_client):
        """Added 2026-09-23, and only because the server now enforces them.

        The rule was published in the order it had to be: `submit` refuses a
        round below the minimum and `add_evidence` refuses a photograph past the
        maximum, and only then do the two numbers appear here. A count nobody is
        held to would be worse than no field at all — it is the thing this
        endpoint exists to end.
        """
        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert body["minimum_photo_count"] == settings.icms_min_photos_per_round
        assert body["maximum_photo_count"] == settings.icms_max_photos_per_round


class TestTheValuesAreTheServersOwn:
    def test_the_gate_is_the_setting_the_check_in_refuses_on(
        self, icms_client, monkeypatch
    ):
        """The whole point of the endpoint. Move the setting, and the answer moves
        — which a duplicated literal here could not do."""
        monkeypatch.setattr(settings, "icms_accuracy_gate_m", 25.0)

        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert body["gps_accuracy_gate_m"] == 25.0

    def test_the_flag_is_the_setting_the_evidence_path_marks_on(
        self, icms_client, monkeypatch
    ):
        monkeypatch.setattr(settings, "icms_accuracy_flag_m", 9.0)

        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert body["gps_accuracy_flag_m"] == 9.0

    def test_the_two_thresholds_are_read_independently(self, icms_client, monkeypatch):
        """They were one number once. A handler that read the gate for both would
        pass each test above on its own."""
        monkeypatch.setattr(settings, "icms_accuracy_gate_m", 40.0)
        monkeypatch.setattr(settings, "icms_accuracy_flag_m", 5.0)

        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert (body["gps_accuracy_gate_m"], body["gps_accuracy_flag_m"]) == (40.0, 5.0)

    def test_the_minimum_is_the_setting_the_submit_refuses_below(
        self, icms_client, monkeypatch
    ):
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 2)

        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert body["minimum_photo_count"] == 2

    def test_the_maximum_is_the_setting_the_upload_refuses_past(
        self, icms_client, monkeypatch
    ):
        monkeypatch.setattr(settings, "icms_max_photos_per_round", 8)

        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert body["maximum_photo_count"] == 8

    def test_the_two_counts_are_read_independently(self, icms_client, monkeypatch):
        """One handler reading one setting for both bounds would pass each test
        above on its own, and would publish a floor that is also the ceiling."""
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 1)
        monkeypatch.setattr(settings, "icms_max_photos_per_round", 9)

        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert (body["minimum_photo_count"], body["maximum_photo_count"]) == (1, 9)

    def test_the_clock_skew_is_the_constant_the_validator_enforces(self, icms_client):
        """`MAX_CLOCK_SKEW` in ada_core.validation is what refuses a device
        timestamp, so it is what is served — in hours, converted rather than
        restated."""
        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert body["device_timestamp_max_age_hours"] == (
            MAX_CLOCK_SKEW.total_seconds() / 3600
        )

    def test_the_gate_the_check_in_actually_refuses_on_is_the_one_published(
        self, icms_client, inspection_ready, monkeypatch
    ):
        """End to end, because agreeing with the setting is not the claim — the
        claim is agreeing with the behaviour. A fix just outside the published
        gate must be the fix the check-in refuses."""
        from ada_core.datetimes import now_ist

        monkeypatch.setattr(settings, "icms_accuracy_gate_m", 20.0)
        gate = icms_client.sign_in(NODAL).get(PATH).json()["gps_accuracy_gate_m"]

        opened = icms_client.sign_in(NODAL).post(
            "/api/icms/cases/CMP-2026-0002/inspections",
            json={"surveyor_user_id": icms_client.subject_of(SURVEYOR)})
        ref = opened.json()["inspection_ref"]

        def check_in(accuracy_m: float, key: str):
            return icms_client.sign_in(SURVEYOR).post(
                f"/api/icms/inspections/{ref}/check-in",
                json={"latitude": 27.005, "longitude": 78.005,
                      "accuracy_m": accuracy_m,
                      "device_timestamp": now_ist().isoformat(),
                      "capture_source": "gps", "idempotency_key": key})

        inside = check_in(gate, "6f1d6dd9-8443-4b90-9a86-0f65c42b5001")
        outside = check_in(gate + 1, "6f1d6dd9-8443-4b90-9a86-0f65c42b5002")

        assert inside.status_code == 201, inside.text[:300]
        assert outside.status_code == 422, outside.text[:300]
        assert error_of(outside)["code"] == "poor_accuracy"


class TestWhoMayReadIt:
    @pytest.mark.parametrize("role", ROLES)
    def test_every_icms_role_reads_it(self, icms_client, role):
        """No permission check beyond being an officer: a field app that cannot
        read its own rules is a field app that guesses them."""
        assert icms_client.sign_in(role).get(PATH).status_code == 200

    def test_a_verified_token_with_no_icms_role_is_refused(self, icms_client):
        response = icms_client.sign_in().get(PATH)

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"

    def test_no_token_is_401(self, anonymous_client):
        """401 and not 403: this is the first call a cold client makes, and it
        must tell the app to authenticate rather than to give up."""
        response = anonymous_client.get(PATH)

        assert response.status_code == 401
        assert error_of(response)["code"] == "unauthenticated"

    def test_it_needs_no_database(self, icms_client):
        """Nothing here is seeded, and the answer is still complete: the config is
        code and settings, so a client can read it before any data exists."""
        body = icms_client.sign_in(SURVEYOR).get(PATH).json()

        assert set(body) == FIELDS
