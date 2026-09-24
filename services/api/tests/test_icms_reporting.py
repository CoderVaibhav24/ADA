"""The reporting structure: the ladder order, who holds each rung, and their zones.

The guards and the Keycloak-outage 503 are in `test_icms_users.py`, where the
endpoint sits in READS beside the officer register it shares `user.read` with.
"""

from __future__ import annotations

from tests.conftest import LEAD_ID, NODAL_ID, SUPER_ADMIN, SURVEYOR_ID

REPORTING = "/api/icms/admin/reporting"


def _by_role(body: list[dict]) -> dict[str, dict]:
    return {rung["role_cd"]: rung for rung in body}


class TestTheLadder:
    def test_the_roles_come_most_senior_first_and_each_reports_one_rung_up(
        self, icms_client, policy_tables, keycloak
    ):
        """Not `icms_role.sort_order`, which puts the lead below the surveyor."""
        body = icms_client.sign_in(SUPER_ADMIN).get(REPORTING).json()

        assert [(r["role_cd"], r["level"], r["reports_to"]) for r in body] == [
            ("super-admin", 0, None),
            ("ada-project-lead", 1, "super-admin"),
            ("pcs-nodal-officer", 2, "ada-project-lead"),
            ("field-surveyor", 3, "pcs-nodal-officer"),
        ]
        assert body[1]["label"] == "ADA Project Lead"
        assert body[1]["label_hi"], "the Hindi label comes from icms_role"

    def test_a_role_created_from_administration_has_no_rung_until_placed(
        self, icms_client, policy_tables, keycloak
    ):
        created = icms_client.sign_in(SUPER_ADMIN).post(
            "/api/icms/admin/policy/roles",
            json={"role_cd": "zone-inspector", "label": "Zone Inspector",
                  "permission_cds": ["dashboard.access"]},
        )
        assert created.status_code == 201, created.text[:200]
        keycloak.role_mappings[LEAD_ID].add("zone-inspector")

        body = icms_client.sign_in(SUPER_ADMIN).get(REPORTING).json()

        last = body[-1]
        assert last["role_cd"] == "zone-inspector"
        assert last["reports_to"] is None and last["level"] == 4
        assert [m["id"] for m in last["members"]] == [LEAD_ID]


class TestTheMembers:
    def test_each_rung_lists_its_holders_with_their_active_zones_only(
        self, icms_client, policy_tables, keycloak, assignments
    ):
        """The surveyor's revoked RURAL assignment is history, not a zone they work."""
        rungs = _by_role(icms_client.sign_in(SUPER_ADMIN).get(REPORTING).json())

        nodal = rungs["pcs-nodal-officer"]["members"]
        assert [m["id"] for m in nodal] == [NODAL_ID]
        assert nodal[0]["username"] == "nodal.officer"
        assert (nodal[0]["first_name"], nodal[0]["last_name"]) == ("Nodal", "Officer")
        assert [z["zone_cd"] for z in nodal[0]["zones"]] == ["TAJ"]
        assert nodal[0]["zones"][0]["name_hi"] == "ताजगंज"

        surveyor = rungs["field-surveyor"]["members"][0]
        assert surveyor["id"] == SURVEYOR_ID
        assert [z["zone_cd"] for z in surveyor["zones"]] == ["CANT"]

        assert rungs["super-admin"]["members"][0]["zones"] == []

    def test_a_disabled_holder_is_still_shown_and_listed_after_the_enabled_ones(
        self, icms_client, policy_tables, keycloak
    ):
        keycloak.users[SURVEYOR_ID]["enabled"] = False
        second = "cccccccc-0000-4000-8000-00000000000b"
        keycloak.users[second] = {
            "id": second, "username": "zz.surveyor", "enabled": True,
        }
        keycloak.role_mappings[second] = {"field-surveyor"}

        members = _by_role(
            icms_client.sign_in(SUPER_ADMIN).get(REPORTING).json()
        )["field-surveyor"]["members"]

        assert [(m["username"], m["enabled"]) for m in members] == [
            ("zz.surveyor", True), ("field.surveyor", False),
        ]
        assert members[0]["first_name"] is None, "a blank name is null, not ''"

    def test_keycloak_is_asked_once_per_role_and_never_once_per_officer(
        self, icms_client, policy_tables, keycloak, assignments
    ):
        icms_client.sign_in(SUPER_ADMIN).get(REPORTING)

        assert sorted(keycloak.called("role_members")) == sorted(
            f"role_members {code}" for code in (
                "super-admin", "pcs-nodal-officer", "field-surveyor", "ada-project-lead",
            )
        )
        assert not keycloak.called("get_user")
        assert not keycloak.called("user_realm_roles")

    def test_the_public_role_is_not_a_rung(self, icms_client, policy_tables, keycloak):
        """`public` has an icms_role row for the transition FK and no Keycloak role."""
        body = icms_client.sign_in(SUPER_ADMIN).get(REPORTING).json()

        assert "public" not in _by_role(body)
