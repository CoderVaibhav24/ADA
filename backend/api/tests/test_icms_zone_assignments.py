"""ICMS Batch 1 — zone assignment, the table the whole visibility model rests on.

The legacy equivalent is `data_assignment` (docs/icms/schema/legacy-inventory.md
§2.10), which is "the whole of the legacy authorisation model for data
visibility" and is reached through routes mounted with no authentication at all.
Here it is Super Admin only, it is never deleted from, and — the tests at the
bottom of this file — granting it immediately changes what the grantee can read,
which is the property that makes it an authorisation model rather than a table.
"""

from __future__ import annotations

from tests.conftest import (
    LEAD,
    NODAL,
    NODAL_ID,
    SUPER_ADMIN,
    SUPER_ADMIN_ID,
    SURVEYOR,
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

ASSIGNMENTS = "/api/icms/zone-assignments"
ZONES = "/api/icms/zones"


# ----------------------------------------------------------------- the list
class TestListAssignments:
    def test_a_super_admin_sees_the_open_assignments(
        self, icms_client, zones, assignments
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(ASSIGNMENTS).json()

        assert {item["zone_cd"] for item in body["items"]} == {"TAJ", "CANT"}
        assert body["total"] == 2

    def test_a_row_names_the_zone_rather_than_only_its_id(
        self, icms_client, zones, assignments
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            ASSIGNMENTS, params={"zone_cd": "TAJ"}).json()

        assert body["items"][0]["zone_name"] == "Taj Ganj"
        assert body["items"][0]["assigned_by"] == SUPER_ADMIN_ID

    def test_revoked_assignments_are_still_there_to_be_read(
        self, icms_client, zones, assignments
    ):
        """A revoke is an UPDATE, never a DELETE. Who could see which zone, and
        until when, is part of the record an enforcement system has to show."""
        body = icms_client.sign_in(SUPER_ADMIN).get(
            ASSIGNMENTS, params={"active": "false"}).json()

        assert [item["zone_cd"] for item in body["items"]] == ["RURAL"]
        assert body["items"][0]["active"] is False

    def test_filtering_by_officer(self, icms_client, zones, assignments):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            ASSIGNMENTS, params={"user_id": SURVEYOR_ID}).json()

        assert [item["zone_cd"] for item in body["items"]] == ["CANT"]
        assert body["total"] == 1

    def test_the_default_sort_is_newest_first(self, icms_client, zones, assignments):
        body = icms_client.sign_in(SUPER_ADMIN).get(ASSIGNMENTS).json()

        assert body["sort"] == "-created_at"
        assert [item["id"] for item in body["items"]] == sorted(
            [item["id"] for item in body["items"]], reverse=True)

    def test_a_page_past_the_end_still_knows_the_total(
        self, icms_client, zones, assignments
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            ASSIGNMENTS, params={"size": 1, "page": 40}).json()

        assert body["items"] == []
        assert body["total"] == 2

    def test_the_sort_whitelist_is_published_in_the_refusal(
        self, icms_client, zones, assignments
    ):
        response = icms_client.sign_in(SUPER_ADMIN).get(
            ASSIGNMENTS, params={"sort": "assigned_by"})

        assert response.status_code == 400
        assert error_of(response)["allowed"] == ["created_at", "user_id", "zone_cd"]

    def test_an_unknown_filter_is_refused(self, icms_client, zones, assignments):
        response = icms_client.sign_in(SUPER_ADMIN).get(ASSIGNMENTS, params={"officer": "x"})

        assert response.status_code == 422
        assert error_of(response)["field"] == "officer"

    def test_every_role_but_super_admin_is_refused(self, icms_client, zones, assignments):
        for role in (NODAL, SURVEYOR, LEAD):
            response = icms_client.sign_in(role).get(ASSIGNMENTS)

            assert response.status_code == 403, role
            assert error_of(response)["allowed"] == [SUPER_ADMIN]

    def test_no_token_is_refused(self, anonymous_client, zones):
        assert anonymous_client.get(ASSIGNMENTS).status_code == 401


# ---------------------------------------------------------------- the grant
class TestGrant:
    def test_a_super_admin_grants_a_zone(self, icms_client, zones, assignments):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            ASSIGNMENTS, json={"zone_cd": "RURAL", "user_id": NODAL_ID})

        assert response.status_code == 201
        body = response.json()
        assert (body["zone_cd"], body["user_id"], body["active"]) == (
            "RURAL", NODAL_ID, True)
        assert body["assigned_by"] == SUPER_ADMIN_ID

    def test_a_replay_returns_the_same_assignment_rather_than_a_second(
        self, icms_client, zones, assignments
    ):
        """The portal will be clicked twice and a mobile client will retry. A
        duplicate would violate uq_icms_zone_assignment_active anyway; answering
        200 with the open row is the useful shape of that."""
        client = icms_client.sign_in(SUPER_ADMIN)
        payload = {"zone_cd": "RURAL", "user_id": NODAL_ID}

        first = client.post(ASSIGNMENTS, json=payload)
        second = client.post(ASSIGNMENTS, json=payload)

        assert (first.status_code, second.status_code) == (201, 200)
        assert first.json()["id"] == second.json()["id"]

    def test_an_unknown_zone_is_a_404(self, icms_client, zones, assignments):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            ASSIGNMENTS, json={"zone_cd": "NOSUCH", "user_id": NODAL_ID})

        assert response.status_code == 404
        assert error_of(response)["code"] == "zone_not_found"

    def test_an_unknown_body_field_is_refused(self, icms_client, zones, assignments):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            ASSIGNMENTS,
            json={"zone_cd": "RURAL", "user_id": NODAL_ID, "role": "super-admin"},
        )

        assert response.status_code == 422
        assert error_of(response)["field"] == "role"

    def test_every_role_but_super_admin_is_refused(self, icms_client, zones, assignments):
        for role in (NODAL, SURVEYOR, LEAD):
            response = icms_client.sign_in(role).post(
                ASSIGNMENTS, json={"zone_cd": "RURAL", "user_id": NODAL_ID})

            assert response.status_code == 403, role

    def test_an_officer_cannot_grant_themselves_a_zone(
        self, icms_client, zones, assignments
    ):
        """The interesting denial. Self-service visibility is the failure mode
        an unauthenticated admin route actually produces."""
        client = icms_client.sign_in(NODAL)
        client.post(ASSIGNMENTS, json={"zone_cd": "RURAL", "user_id": NODAL_ID})

        assert "RURAL" not in [item["zone_cd"] for item in client.get(ZONES).json()["items"]]

    def test_no_token_is_refused(self, anonymous_client, zones):
        response = anonymous_client.post(
            ASSIGNMENTS, json={"zone_cd": "TAJ", "user_id": NODAL_ID})

        assert response.status_code == 401


# --------------------------------------------------------------- the revoke
class TestRevoke:
    def test_a_super_admin_revokes(self, icms_client, zones, assignments):
        response = icms_client.sign_in(SUPER_ADMIN).request(
            "DELETE", ASSIGNMENTS, params={"zone_cd": "TAJ", "user_id": NODAL_ID})

        assert response.status_code == 200
        body = response.json()
        assert body["revoked"] is True
        assert body["revoked_at"] is not None

    def test_a_replay_is_a_no_op_rather_than_an_error(
        self, icms_client, zones, assignments
    ):
        """A retried request should not read as a failure the second time."""
        client = icms_client.sign_in(SUPER_ADMIN)
        params = {"zone_cd": "TAJ", "user_id": NODAL_ID}

        first = client.request("DELETE", ASSIGNMENTS, params=params)
        second = client.request("DELETE", ASSIGNMENTS, params=params)

        assert (first.status_code, second.status_code) == (200, 200)
        assert (first.json()["revoked"], second.json()["revoked"]) == (True, False)

    def test_the_row_survives_the_revoke(self, icms_client, zones, assignments):
        client = icms_client.sign_in(SUPER_ADMIN)
        client.request("DELETE", ASSIGNMENTS,
                       params={"zone_cd": "TAJ", "user_id": NODAL_ID})

        closed = client.get(ASSIGNMENTS, params={"active": "false", "zone_cd": "TAJ"}).json()
        assert closed["total"] == 1
        assert closed["items"][0]["revoked_at"] is not None

    def test_an_unknown_zone_is_a_404(self, icms_client, zones, assignments):
        response = icms_client.sign_in(SUPER_ADMIN).request(
            "DELETE", ASSIGNMENTS, params={"zone_cd": "NOSUCH", "user_id": NODAL_ID})

        assert response.status_code == 404

    def test_the_target_is_required(self, icms_client, zones, assignments):
        response = icms_client.sign_in(SUPER_ADMIN).request(
            "DELETE", ASSIGNMENTS, params={"zone_cd": "TAJ"})

        assert response.status_code == 422
        assert error_of(response)["field"] == "user_id"

    def test_every_role_but_super_admin_is_refused(self, icms_client, zones, assignments):
        for role in (NODAL, SURVEYOR, LEAD):
            response = icms_client.sign_in(role).request(
                "DELETE", ASSIGNMENTS, params={"zone_cd": "TAJ", "user_id": NODAL_ID})

            assert response.status_code == 403, role

    def test_no_token_is_refused(self, anonymous_client, zones):
        response = anonymous_client.request(
            "DELETE", ASSIGNMENTS, params={"zone_cd": "TAJ", "user_id": NODAL_ID})

        assert response.status_code == 401


# ------------------------------------------- the point of the whole exercise
class TestAssignmentDecidesVisibility:
    def test_a_grant_changes_what_the_grantee_can_read(
        self, icms_client, zones, assignments
    ):
        before = icms_client.sign_in(NODAL).get(ZONES).json()
        icms_client.sign_in(SUPER_ADMIN).post(
            ASSIGNMENTS, json={"zone_cd": "RURAL", "user_id": NODAL_ID})
        after = icms_client.sign_in(NODAL).get(ZONES).json()

        assert "RURAL" not in [item["zone_cd"] for item in before["items"]]
        assert "RURAL" in [item["zone_cd"] for item in after["items"]]
        assert after["total"] == before["total"] + 1

    def test_a_revoke_takes_it_away_again(self, icms_client, zones, assignments):
        icms_client.sign_in(SUPER_ADMIN).request(
            "DELETE", ASSIGNMENTS, params={"zone_cd": "TAJ", "user_id": NODAL_ID})

        body = icms_client.sign_in(NODAL).get(ZONES).json()
        detail = icms_client.get(f"{ZONES}/TAJ")

        assert body["items"] == []
        assert detail.status_code == 404

    def test_re_granting_opens_a_new_row_rather_than_reviving_the_old_one(
        self, icms_client, zones, assignments
    ):
        """Granted, revoked, granted again has to stay readable afterwards. The
        partial unique index permits exactly this and nothing else."""
        client = icms_client.sign_in(SUPER_ADMIN)
        params = {"zone_cd": "TAJ", "user_id": NODAL_ID}
        original = client.get(ASSIGNMENTS, params={"zone_cd": "TAJ"}).json()["items"][0]["id"]

        client.request("DELETE", ASSIGNMENTS, params=params)
        regranted = client.post(ASSIGNMENTS, json=params)

        assert regranted.status_code == 201
        assert regranted.json()["id"] != original
        assert client.get(
            ASSIGNMENTS, params={"zone_cd": "TAJ", "active": "false"}).json()["total"] == 1
