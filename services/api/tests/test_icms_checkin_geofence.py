"""Check-in geofence: the officer must stand within the radius of the case point."""

from __future__ import annotations

import json
import uuid

import pytest
from ada_core.datetimes import now_ist
from ada_core.models_icms import Case, CaseEvent, Inspection, RuntimeSetting
from sqlalchemy import select, update

from tests.conftest import NODAL, SUPER_ADMIN, SURVEYOR
from tests.test_icms_reference import error_of

CASE = "CMP-2026-0002"
SITE = (27.0, 78.0)
METRE_LAT = 1 / 111_195.0


@pytest.fixture
def located(db, inspection_ready):
    db.execute(update(Case).where(Case.case_ref == CASE).values(
        location=json.dumps({"type": "Point", "coordinates": [SITE[1], SITE[0]]})))
    db.commit()
    return inspection_ready


def _open_round(icms_client) -> str:
    opened = icms_client.sign_in(NODAL).post(
        f"/api/icms/cases/{CASE}/inspections",
        json={"surveyor_user_id": icms_client.subject_of(SURVEYOR)})
    assert opened.status_code == 201, opened.text[:300]
    return opened.json()["inspection_ref"]


def _check_in(icms_client, ref: str, metres_north: float):
    return icms_client.sign_in(SURVEYOR).post(
        f"/api/icms/inspections/{ref}/check-in",
        json={"latitude": SITE[0] + metres_north * METRE_LAT, "longitude": SITE[1],
              "accuracy_m": 5.0, "device_timestamp": now_ist().isoformat(),
              "capture_source": "gps", "idempotency_key": str(uuid.uuid4())})


def _set(db, key: str, value) -> None:
    db.merge(RuntimeSetting(key=key, value=value))
    db.commit()


class TestEnforced:
    def test_a_fix_outside_the_default_radius_is_refused(self, icms_client, located, db):
        ref = _open_round(icms_client)

        response = _check_in(icms_client, ref, 100)

        assert response.status_code == 422, response.text[:300]
        error = response.json()["error"]
        assert error["code"] == "outside_geofence"
        assert error["details"]["radius_m"] == 30.0
        assert 95 < error["details"]["distance_m"] < 105

    def test_a_fix_inside_the_radius_is_accepted_and_recorded(
        self, icms_client, located, db
    ):
        ref = _open_round(icms_client)

        response = _check_in(icms_client, ref, 10)

        assert response.status_code == 201, response.text[:300]
        inspection = db.execute(
            select(Inspection).where(Inspection.inspection_ref == ref)).scalar_one()
        db.refresh(inspection)
        assert inspection.location is not None
        assert float(inspection.location_accuracy_m) == 5.0
        payload = db.execute(
            select(CaseEvent.payload).where(CaseEvent.action == "check_in")
            .order_by(CaseEvent.id.desc())).scalars().first()
        assert 9 < payload["distance_m"] < 11

    def test_the_radius_is_read_from_the_table(self, icms_client, located, db):
        _set(db, "checkin.geofence_radius_m", 150)
        ref = _open_round(icms_client)

        assert _check_in(icms_client, ref, 100).status_code == 201

    def test_a_case_without_a_location_is_not_blocked(self, icms_client, inspection_ready):
        ref = _open_round(icms_client)

        assert _check_in(icms_client, ref, 5000).status_code == 201


class TestToggleOff:
    def test_a_far_fix_is_accepted_when_not_enforced(self, icms_client, located, db):
        _set(db, "checkin.geofence_enforced", False)
        ref = _open_round(icms_client)

        assert _check_in(icms_client, ref, 1000).status_code == 201

    def test_app_config_publishes_the_switch(self, icms_client, located, db):
        _set(db, "checkin.geofence_enforced", False)
        _set(db, "checkin.geofence_radius_m", 45)

        body = icms_client.sign_in(SURVEYOR).get("/api/icms/app-config").json()

        assert body["geofence_enforced"] is False
        assert body["geofence_radius_m"] == 45.0


class TestAdmin:
    PATH = "/api/icms/admin/runtime-settings"

    def test_put_flips_the_gate_and_records_who(self, icms_client, located, db):
        admin = icms_client.sign_in(SUPER_ADMIN)
        response = admin.put(f"{self.PATH}/checkin.geofence_enforced", json={"value": False})

        assert response.status_code == 200, response.text[:300]
        body = response.json()
        assert body["value"] is False and body["is_default"] is False
        assert body["updated_by"] == icms_client.subject_of(SUPER_ADMIN)
        assert body["updated_at"].endswith("+05:30")

        ref = _open_round(icms_client)
        assert _check_in(icms_client, ref, 1000).status_code == 201

    def test_get_lists_the_known_keys_with_defaults(self, icms_client, located):
        rows = icms_client.sign_in(SUPER_ADMIN).get(self.PATH).json()

        checkin = {r["key"]: r["value"] for r in rows if r["key"].startswith("checkin.")}
        assert checkin == {
            "checkin.geofence_enforced": True, "checkin.geofence_radius_m": 30.0}

    def test_an_unknown_key_is_404(self, icms_client, located):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{self.PATH}/checkin.nonsense", json={"value": True})

        assert response.status_code == 404
        assert error_of(response)["code"] == "not_found"

    @pytest.mark.parametrize("key,value", [
        ("checkin.geofence_enforced", 1),
        ("checkin.geofence_radius_m", True),
        ("checkin.geofence_radius_m", 0),
    ])
    def test_a_wrong_type_is_422(self, icms_client, located, key, value):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{self.PATH}/{key}", json={"value": value})

        assert response.status_code == 422
        assert error_of(response)["code"] == "invalid_value"

    def test_a_surveyor_may_not_flip_it(self, icms_client, located):
        response = icms_client.sign_in(SURVEYOR).put(
            f"{self.PATH}/checkin.geofence_enforced", json={"value": False})

        assert response.status_code == 403
