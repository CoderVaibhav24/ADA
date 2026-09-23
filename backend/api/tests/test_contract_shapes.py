"""The success payload of every ICMS endpoint, field by field.

A change to any shape here is a change a browser or the survey app compiles
against, so it fails here before it reaches either.
"""

from __future__ import annotations

import pytest
from ada_core.models_icms import Permission

from tests.conftest import NODAL, NODAL_ID, SUPER_ADMIN, SURVEYOR_B_ID
from tests.contract import (
    CAPABILITIES,
    CAPABILITY_ACTION,
    CASE_ASSIGNMENT,
    CASE_DETAIL,
    COLLECTION_READER,
    COLLECTIONS,
    OPERATIONS,
    PAGE,
    PERMISSION,
    RAISE_BODY,
    ROLE_GRANTS,
    TRANSITION,
    ZONE_ASSIGNMENT,
    ZONE_ASSIGNMENT_REVOKED,
    ZONE_DETAIL,
    assert_shape,
    ist_strings,
)

ICMS = "/api/icms"
ADMIN = f"{ICMS}/admin/policy"


# The collection table carries a dict and a list, which pytest renders as noise.
def collection_id(value):
    return value if isinstance(value, str) else ""


# Not a shape assertion but the clause every shape assertion rests on: a 200 that
# should have been a 201 is a client that never reads the Location it expected.
@pytest.mark.parametrize("op", OPERATIONS, ids=lambda op: op.id)
def test_a_permitted_caller_gets_the_documented_status(icms_client, contract_world, op):
    response = op.send_as_permitted(icms_client)

    assert response.status_code == op.ok, (
        f"{op.id} · success status: expected {op.ok}, got {response.status_code} — "
        f"{response.text[:300]}"
    )


class TestCollectionEnvelope:
    @pytest.mark.parametrize("path,item,sorts", COLLECTIONS, ids=collection_id)
    def test_every_register_answers_in_the_same_envelope(
        self, icms_client, contract_world, path, item, sorts
    ):
        """One envelope for four registers; a grid written against one renders all."""
        body = icms_client.sign_in(COLLECTION_READER[path]).get(path).json()

        assert_shape(f"GET {path}", "the page envelope", body, PAGE)

    @pytest.mark.parametrize("path,item,sorts", COLLECTIONS, ids=collection_id)
    def test_the_first_row_carries_the_whole_row_shape(
        self, icms_client, contract_world, path, item, sorts
    ):
        body = icms_client.sign_in(COLLECTION_READER[path]).get(path).json()

        assert body["items"], f"GET {path}: the fixture produced no rows to pin"
        assert_shape(f"GET {path}", "items[0]", body["items"][0], item)

    @pytest.mark.parametrize("path,item,sorts", COLLECTIONS, ids=collection_id)
    def test_every_row_carries_it_and_not_only_the_first(
        self, icms_client, contract_world, path, item, sorts
    ):
        """A nullable column is only visible on the row that leaves it null."""
        body = icms_client.sign_in(COLLECTION_READER[path]).get(path).json()

        for index, row in enumerate(body["items"]):
            assert_shape(f"GET {path}", f"items[{index}]", row, item)


class TestZoneShapes:
    def test_zone_detail_is_the_list_row_plus_geometry(self, icms_client, contract_world):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ICMS}/zones/TAJ").json()

        assert_shape(f"GET {ICMS}/zones/{{zone_cd}}", "the zone", body, ZONE_DETAIL)
        assert body["geometry"]["type"] == "MultiPolygon"
        assert body["has_geometry"] is True

    def test_a_zone_without_a_boundary_says_so_rather_than_omitting_the_key(
        self, icms_client, contract_world
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ICMS}/zones/RURAL").json()

        assert_shape(f"GET {ICMS}/zones/{{zone_cd}}", "a zone with no boundary", body,
                     ZONE_DETAIL)
        assert body["geometry"] is None
        assert body["has_geometry"] is False

    def test_create_answers_with_the_detail_shape(self, icms_client, contract_world):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            f"{ICMS}/zones", json={"zone_cd": "NEWZ", "name": "New Zone"})

        assert response.status_code == 201
        assert_shape(f"POST {ICMS}/zones", "the created zone", response.json(), ZONE_DETAIL)

    def test_update_answers_with_the_detail_shape(self, icms_client, contract_world):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{ICMS}/zones/TAJ", json={"name": "Renamed"})

        assert response.status_code == 200
        assert_shape(f"PUT {ICMS}/zones/{{zone_cd}}", "the updated zone", response.json(),
                     ZONE_DETAIL)


class TestZoneAssignmentShapes:
    def test_grant_answers_201_with_the_assignment(self, icms_client, contract_world):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            f"{ICMS}/zone-assignments", json={"zone_cd": "RURAL", "user_id": "contract-officer"})

        assert response.status_code == 201
        assert_shape(f"POST {ICMS}/zone-assignments", "the grant", response.json(),
                     ZONE_ASSIGNMENT)

    def test_a_repeated_grant_is_200_and_the_same_row(self, icms_client, contract_world):
        """A retried request must not read as a failure, and must not open a second row."""
        client = icms_client.sign_in(SUPER_ADMIN)
        payload = {"zone_cd": "RURAL", "user_id": "contract-officer"}
        first = client.post(f"{ICMS}/zone-assignments", json=payload).json()
        repeat = client.post(f"{ICMS}/zone-assignments", json=payload)

        assert repeat.status_code == 200
        assert_shape(f"POST {ICMS}/zone-assignments", "the repeated grant", repeat.json(),
                     ZONE_ASSIGNMENT)
        assert repeat.json()["id"] == first["id"]

    def test_revoke_answers_with_the_revoked_shape(self, icms_client, contract_world):
        response = icms_client.sign_in(SUPER_ADMIN).delete(
            f"{ICMS}/zone-assignments?zone_cd=TAJ&user_id={NODAL_ID}")

        assert response.status_code == 200
        body = response.json()
        assert_shape(f"DELETE {ICMS}/zone-assignments", "the revocation", body,
                     ZONE_ASSIGNMENT_REVOKED)
        assert body["revoked"] is True

    def test_revoking_twice_is_200_with_revoked_false_and_no_timestamp(
        self, icms_client, contract_world
    ):
        client = icms_client.sign_in(SUPER_ADMIN)
        path = f"{ICMS}/zone-assignments?zone_cd=TAJ&user_id={NODAL_ID}"
        client.delete(path)
        repeat = client.delete(path)

        assert repeat.status_code == 200
        body = repeat.json()
        assert_shape(f"DELETE {ICMS}/zone-assignments", "a replayed revocation", body,
                     ZONE_ASSIGNMENT_REVOKED)
        assert (body["revoked"], body["revoked_at"]) == (False, None)


class TestCaseShapes:
    def test_raise_answers_201_with_the_full_detail(self, icms_client, contract_world):
        response = icms_client.sign_in(NODAL).post(f"{ICMS}/cases", json=RAISE_BODY)

        assert response.status_code == 201
        assert_shape(f"POST {ICMS}/cases", "the raised case", response.json(), CASE_DETAIL)

    def test_a_replayed_raise_is_200_and_the_same_reference(self, icms_client, contract_world):
        """The idempotency key is what stops a retried form filing twice."""
        client = icms_client.sign_in(NODAL)
        payload = {**RAISE_BODY, "idempotency_key": "11111111-1111-4111-8111-111111111111"}
        first = client.post(f"{ICMS}/cases", json=payload).json()
        repeat = client.post(f"{ICMS}/cases", json=payload)

        assert repeat.status_code == 200
        assert_shape(f"POST {ICMS}/cases", "the replayed case", repeat.json(), CASE_DETAIL)
        assert repeat.json()["case_ref"] == first["case_ref"]

    def test_case_detail_is_the_register_row_plus_the_case_file(
        self, icms_client, contract_world
    ):
        body = icms_client.sign_in(NODAL).get(f"{ICMS}/cases/CMP-2026-0001").json()

        assert_shape(f"GET {ICMS}/cases/{{case_ref}}", "the case", body, CASE_DETAIL)
        assert body["allowed_actions"] == ["reject", "assign"]

    def test_amend_answers_with_the_detail(self, icms_client, contract_world):
        response = icms_client.sign_in(NODAL).patch(
            f"{ICMS}/cases/CMP-2026-0001", json={"priority": "low"})

        assert response.status_code == 200
        assert_shape(f"PATCH {ICMS}/cases/{{case_ref}}", "the amended case", response.json(),
                     CASE_DETAIL)

    def test_assign_answers_with_the_detail_and_a_typed_assignment_block(
        self, icms_client, contract_world
    ):
        response = icms_client.sign_in(NODAL).post(
            f"{ICMS}/cases/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert response.status_code == 200
        body = response.json()
        where = f"POST {ICMS}/cases/{{case_ref}}/assign"
        assert_shape(where, "the assigned case", body, CASE_DETAIL)
        assert_shape(where, "assignment", body["assignment"], CASE_ASSIGNMENT)
        assert body["assignee_user_id"] == SURVEYOR_B_ID

    def test_an_unassigned_case_nulls_the_block_rather_than_dropping_it(
        self, icms_client, contract_world
    ):
        body = icms_client.sign_in(NODAL).get(f"{ICMS}/cases/CMP-2026-0001").json()

        assert body["assignment"] is None
        assert body["rounds"] == []
        assert body["evidence_count"] == 0

    def test_parcel_id_is_derived_and_present_on_every_row(self, icms_client, contract_world):
        """The map joins on it, so a row without the key is a row it cannot place."""
        items = icms_client.sign_in(NODAL).get(f"{ICMS}/cases").json()["items"]

        assert all("parcel_id" in row for row in items)
        by_ref = {row["case_ref"]: row for row in items}
        assert by_ref["CMP-2026-0001"]["parcel_id"] == "AB12CD34EF56GH"
        assert by_ref["CMP-2026-0002"]["parcel_id"] == "071234/127/1/2"


class TestPolicyShapes:
    def test_capabilities_is_the_advisory_envelope(self, icms_client, contract_world):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ICMS}/me/capabilities").json()

        assert_shape(f"GET {ICMS}/me/capabilities", "the capabilities", body, CAPABILITIES)
        assert body["advisory"] is True, "the flag that says this is not a control"

    def test_each_action_carries_what_a_button_needs(self, icms_client, contract_world):
        body = icms_client.sign_in(NODAL).get(f"{ICMS}/me/capabilities").json()

        assert body["actions"], "a nodal officer holds transitions and must see them"
        for index, action in enumerate(body["actions"]):
            assert_shape(f"GET {ICMS}/me/capabilities", f"actions[{index}]", action,
                         CAPABILITY_ACTION)

    def test_a_super_admin_sees_permissions_and_no_actions(self, icms_client, contract_world):
        """The split the whole policy design turns on, stated as a payload."""
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ICMS}/me/capabilities").json()

        assert body["actions"] == []
        assert body["unrestricted"] is True
        assert "policy.manage" in body["permissions"]

    def test_permissions_is_a_bare_list_of_the_permission_shape(
        self, icms_client, contract_world
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ADMIN}/permissions").json()

        assert isinstance(body, list) and body
        for index, row in enumerate(body):
            assert_shape(f"GET {ADMIN}/permissions", f"[{index}]", row, PERMISSION)

    def test_role_grants_is_a_bare_list_of_the_grant_shape(self, icms_client, contract_world):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ADMIN}/roles").json()

        assert isinstance(body, list) and body
        for index, row in enumerate(body):
            assert_shape(f"GET {ADMIN}/roles", f"[{index}]", row, ROLE_GRANTS)

    def test_transitions_is_a_bare_list_of_the_transition_shape(
        self, icms_client, contract_world
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ADMIN}/transitions").json()

        assert isinstance(body, list) and body
        for index, row in enumerate(body):
            assert_shape(f"GET {ADMIN}/transitions", f"[{index}]", row, TRANSITION)

    def test_setting_grants_answers_with_the_new_grant_set(self, icms_client, contract_world):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/field-surveyor/permissions", json={"permission_cds": ["case.read"]})

        assert response.status_code == 200
        body = response.json()
        assert_shape(f"PUT {ADMIN}/roles/{{role_cd}}/permissions", "the grants", body,
                     ROLE_GRANTS)
        assert body["permission_cds"] == ["case.read"]

    def test_editing_a_transition_answers_with_the_row_as_it_now_stands(
        self, icms_client, contract_world
    ):
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ADMIN}/transitions/1", json={"note": "contract"})

        assert response.status_code == 200
        body = response.json()
        assert_shape(f"PATCH {ADMIN}/transitions/{{id}}", "the transition", body, TRANSITION)
        assert body["note"] == "contract"

    def test_deleting_a_non_system_permission_is_204_with_no_body(
        self, icms_client, db, contract_world
    ):
        db.add(Permission(permission_cd="contract.read", resource="contract", action="read",
                          label="A permission no endpoint names", is_system=False))
        db.commit()

        response = icms_client.sign_in(SUPER_ADMIN).delete(
            f"{ADMIN}/permissions/contract.read")

        assert response.status_code == 204
        assert response.content == b"", "204 must carry no body"


class TestIstTimestamps:
    @pytest.mark.parametrize("op", OPERATIONS, ids=lambda op: op.id)
    def test_every_timestamp_in_the_response_carries_the_ist_offset(
        self, icms_client, contract_world, op
    ):
        """One clock for the whole stack. A 'Z' here renders as 05:30 in the morning."""
        response = op.send_as_permitted(icms_client)
        # A binary download carries no timestamps and is not JSON to look in.
        if op.binary or not response.content:
            return

        wrong = [
            f"{path}={value}"
            for path, value in ist_strings(response.json())
            if not value.endswith("+05:30")
        ]
        assert not wrong, f"{op.id} · IST serialisation: " + "; ".join(wrong)

    def test_the_registers_actually_carry_timestamps_to_check(
        self, icms_client, contract_world
    ):
        """Guards the walk above: a payload with no timestamps would pass it vacuously."""
        for path in ("/api/icms/zones", "/api/icms/cases", "/api/icms/zone-assignments"):
            body = icms_client.sign_in(COLLECTION_READER[path]).get(path).json()
            assert ist_strings(body), f"GET {path} carries no timestamp to pin"
