"""The permission guard, the capabilities endpoint and the policy admin surface.

The claim under test is the one the whole design turns on: a grant changed in
the database changes what the SAME token can do, with no new token and no
restart. Every test here signs in once and never refreshes.
"""

from __future__ import annotations

from ada_core.models_icms import Permission, PolicyRevision, RolePermission
from sqlalchemy import select

from app.icms import policy
from tests.conftest import LEAD, NODAL, SUPER_ADMIN, SURVEYOR, SURVEYOR_B_ID
from tests.test_icms_reference import error_of

CAPABILITIES = "/api/icms/me/capabilities"
ADMIN = "/api/icms/admin/policy"


def transition_id(client, action: str, source: str | None) -> int:
    rows = client.sign_in(SUPER_ADMIN).get(f"{ADMIN}/transitions").json()
    return next(
        row["id"] for row in rows
        if row["action_cd"] == action and row["source_status"] == source
    )


# ------------------------------------------------------ the permission guard
class TestRequirePermission:
    def test_the_admin_surface_is_refused_to_the_roles_that_do_not_hold_it(
        self, icms_client, policy_tables
    ):
        for role in (NODAL, SURVEYOR, LEAD):
            response = icms_client.sign_in(role).get(f"{ADMIN}/roles")

            assert response.status_code == 403, role
            error = error_of(response)
            assert error["code"] == "role_not_permitted"
            assert error["allowed"] == [SUPER_ADMIN]

    def test_the_refusal_names_roles_and_not_permission_codes(
        self, icms_client, policy_tables
    ):
        """An officer cannot grant themselves a permission. The role they need to
        be given is the half of the answer they can act on."""
        error = error_of(icms_client.sign_in(SURVEYOR).get(f"{ADMIN}/roles"))

        assert "policy.read" not in error["message"]
        assert error["allowed"] == [SUPER_ADMIN]

    def test_a_caller_with_no_icms_role_is_refused(self, icms_client, policy_tables):
        assert icms_client.sign_in().get(f"{ADMIN}/roles").status_code == 403
        assert icms_client.sign_in().get(CAPABILITIES).status_code == 403

    def test_no_token_is_refused_before_any_permission_is_resolved(
        self, anonymous_client, policy_tables
    ):
        assert anonymous_client.get(f"{ADMIN}/roles").status_code == 401
        assert anonymous_client.get(CAPABILITIES).status_code == 401

    def test_a_granted_permission_opens_the_endpoint_to_the_same_token(
        self, icms_client, policy_tables
    ):
        nodal = icms_client.sign_in(NODAL)
        assert nodal.get(f"{ADMIN}/roles").status_code == 403

        icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{NODAL}/permissions",
            json={"permission_cds": sorted(policy.DEFAULT_GRANTS[NODAL] | {"policy.read"})},
        )

        assert icms_client.sign_in(NODAL).get(f"{ADMIN}/roles").status_code == 200

    def test_a_revoked_permission_closes_it_again(self, icms_client, policy_tables):
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{SUPER_ADMIN}/permissions",
            json={"permission_cds": ["policy.read", "policy.manage"]},
        )

        assert icms_client.sign_in(SUPER_ADMIN).get("/api/icms/zones").status_code == 403


# ---------------------------------------------------------- the capabilities
class TestCapabilities:
    def test_it_returns_the_callers_own_roles_and_permissions(
        self, icms_client, policy_tables
    ):
        body = icms_client.sign_in(SURVEYOR).get(CAPABILITIES).json()

        assert body["roles"] == [SURVEYOR]
        assert body["permissions"] == sorted(policy.DEFAULT_GRANTS[SURVEYOR])

    def test_it_never_leaks_another_roles_permissions(self, icms_client, policy_tables):
        """A surveyor holds five of the fifteen. The endpoint answers about the
        caller, and there is no parameter that would make it answer about anyone
        else."""
        surveyor = icms_client.sign_in(SURVEYOR).get(CAPABILITIES).json()

        for code in policy.DEFAULT_GRANTS[SUPER_ADMIN] - policy.DEFAULT_GRANTS[SURVEYOR]:
            assert code not in surveyor["permissions"]
        assert SUPER_ADMIN not in surveyor["roles"]

    def test_unknown_realm_roles_are_left_out(self, icms_client, policy_tables):
        body = icms_client.sign_in(NODAL).get(CAPABILITIES).json()

        assert body["roles"] == [NODAL]

    def test_it_reports_the_zones_the_caller_may_see(
        self, icms_client, zones, assignments, policy_tables
    ):
        body = icms_client.sign_in(NODAL).get(CAPABILITIES).json()

        assert body["zone_ids"] == [zones["TAJ"].id]
        assert body["unrestricted"] is False

    def test_super_admin_is_unrestricted_and_holds_no_action(
        self, icms_client, zones, policy_tables
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(CAPABILITIES).json()

        assert body["unrestricted"] is True
        assert body["actions"] == []

    def test_the_actions_are_the_transitions_the_caller_may_make(
        self, icms_client, policy_tables
    ):
        body = icms_client.sign_in(SURVEYOR).get(CAPABILITIES).json()
        actions = {row["action"] for row in body["actions"]}

        assert {"check_in", "add_evidence", "record_findings", "submit"} <= actions
        assert "verify_accept" not in actions

    def test_it_says_it_is_advisory(self, icms_client, policy_tables):
        """The browser renders buttons from this. It is not a control, and the
        response says so rather than leaving the reader to assume."""
        body = icms_client.sign_in(LEAD).get(CAPABILITIES).json()

        assert body["advisory"] is True
        assert body["policy_source"] == "database"

    def test_it_follows_a_grant_change_without_a_new_token(
        self, icms_client, policy_tables
    ):
        assert "case.export" in icms_client.sign_in(LEAD).get(CAPABILITIES).json()["permissions"]

        icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{LEAD}/permissions",
            json={"permission_cds": sorted(policy.DEFAULT_GRANTS[LEAD] - {"case.export"})},
        )
        body = icms_client.sign_in(LEAD).get(CAPABILITIES).json()

        assert "case.export" not in body["permissions"]
        assert body["policy_revision"] == 2


# ------------------------------------------------------------- the admin CRUD
class TestRoleGrants:
    def test_the_grants_come_back_per_role(self, icms_client, policy_tables):
        rows = icms_client.sign_in(SUPER_ADMIN).get(f"{ADMIN}/roles").json()
        grants = {row["role_cd"]: set(row["permission_cds"]) for row in rows}

        assert grants == {role: set(codes) for role, codes in policy.DEFAULT_GRANTS.items()}

    def test_a_write_bumps_the_revision_and_reloads_this_worker(
        self, icms_client, db, policy_tables
    ):
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{SURVEYOR}/permissions", json={"permission_cds": ["case.read"]}
        )

        assert db.execute(select(PolicyRevision.revision)).scalar_one() == 2
        assert policy.snapshot().permitted([SURVEYOR]) == frozenset({"case.read"})

    def test_an_unknown_permission_is_refused_with_the_legal_ones(
        self, icms_client, policy_tables
    ):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{SURVEYOR}/permissions",
            json={"permission_cds": ["case.teleport"]},
        )

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "unknown_permission"
        assert error["field"] == "permission_cds"
        assert "case.read" in error["allowed"]

    def test_an_unknown_role_is_404(self, icms_client, policy_tables):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/no-such-role/permissions", json={"permission_cds": []}
        )

        assert response.status_code == 404

    def test_the_last_role_holding_policy_manage_cannot_drop_it(
        self, icms_client, policy_tables
    ):
        """Locking every officer out of the screen that could unlock them is the
        one edit worth refusing outright."""
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{SUPER_ADMIN}/permissions", json={"permission_cds": ["case.read"]}
        )

        assert response.status_code == 409
        assert error_of(response)["code"] == "policy_lockout"

    def test_a_refused_write_changes_nothing(self, icms_client, db, policy_tables):
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{SUPER_ADMIN}/permissions", json={"permission_cds": ["case.read"]}
        )

        assert db.execute(select(PolicyRevision.revision)).scalar_one() == 1
        assert policy.snapshot().permitted([SUPER_ADMIN]) == policy.DEFAULT_GRANTS[SUPER_ADMIN]


class TestPermissions:
    def test_the_catalogue_is_readable(self, icms_client, policy_tables):
        rows = icms_client.sign_in(SUPER_ADMIN).get(f"{ADMIN}/permissions").json()

        assert {row["permission_cd"] for row in rows} == set(policy.PERMISSIONS)

    def test_a_system_permission_cannot_be_deleted(self, icms_client, policy_tables):
        """It is named by an endpoint in source. Deleting the row would not remove
        the guard, it would make the guard unsatisfiable."""
        response = icms_client.sign_in(SUPER_ADMIN).delete(f"{ADMIN}/permissions/case.read")

        assert response.status_code == 409
        assert error_of(response)["code"] == "permission_is_system"

    def test_a_permission_that_guards_nothing_can_be_deleted(
        self, icms_client, db, policy_tables
    ):
        db.add(Permission(permission_cd="case.teleport", resource="case", action="teleport",
                          label="Left over", is_system=False))
        db.add(RolePermission(role_cd=SUPER_ADMIN, permission_cd="case.teleport"))
        db.commit()
        policy.reload(db)

        response = icms_client.sign_in(SUPER_ADMIN).delete(f"{ADMIN}/permissions/case.teleport")

        assert response.status_code == 204
        assert db.get(Permission, "case.teleport") is None
        assert "case.teleport" not in policy.snapshot().permitted([SUPER_ADMIN])

    def test_an_unknown_permission_is_404(self, icms_client, policy_tables):
        assert icms_client.sign_in(SUPER_ADMIN).delete(
            f"{ADMIN}/permissions/case.nothing").status_code == 404


class TestTransitions:
    def test_the_table_comes_back_in_order(self, icms_client, policy_tables):
        rows = icms_client.sign_in(SUPER_ADMIN).get(f"{ADMIN}/transitions").json()

        assert len(rows) == 18
        assert rows[0]["action_cd"] == "raise"
        assert rows[2]["permission_cd"] == "case.assign"
        assert sorted(rows[2]["roles"]) == [NODAL]
        assert SUPER_ADMIN not in {role for row in rows for role in row["roles"]}

    def test_the_roles_are_derived_from_the_grants(self, icms_client, policy_tables):
        client = icms_client.sign_in(SUPER_ADMIN)
        client.put(f"{ADMIN}/roles/{LEAD}/permissions", json={"permission_cds": [
            *policy.snapshot().permitted([LEAD]), "case.assign"]})

        rows = client.get(f"{ADMIN}/transitions").json()
        assign = next(r for r in rows if r["action_cd"] == "assign")
        assert sorted(assign["roles"]) == sorted([NODAL, LEAD])

    def test_editing_the_permission_changes_who_may_move_a_case(
        self, icms_client, cases, policy_tables
    ):
        body = {"assignee_user_id": SURVEYOR_B_ID}
        assert icms_client.sign_in(LEAD).post(
            "/api/icms/cases/CMP-2026-0001/assign", json=body).status_code == 403

        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ADMIN}/transitions/{transition_id(icms_client, 'assign', 'raised')}",
            json={"permission_cd": "case.confirm"},
        )
        assert response.status_code == 200
        assert response.json()["permission_cd"] == "case.confirm"
        assert response.json()["roles"] == [LEAD]

        assert icms_client.sign_in(NODAL).post(
            "/api/icms/cases/CMP-2026-0001/assign", json=body).status_code == 403
        assert icms_client.sign_in(LEAD).post(
            "/api/icms/cases/CMP-2026-0001/assign", json=body).status_code == 200

    def test_roles_can_no_longer_be_written_on_a_transition(self, icms_client, policy_tables):
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ADMIN}/transitions/{transition_id(icms_client, 'assign', 'raised')}",
            json={"roles": [NODAL, LEAD]},
        )

        assert response.status_code == 422
        assert error_of(response)["code"] == "validation_failed"

    def test_deactivating_a_row_removes_the_action_from_capabilities(
        self, icms_client, policy_tables
    ):
        icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ADMIN}/transitions/{transition_id(icms_client, 'assign', 'raised')}",
            json={"active": False},
        )
        body = icms_client.sign_in(NODAL).get(CAPABILITIES).json()

        assert "assign" not in {row["action"] for row in body["actions"]}

    def test_an_unknown_permission_is_refused_with_the_legal_ones(
        self, icms_client, policy_tables
    ):
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ADMIN}/transitions/{transition_id(icms_client, 'assign', 'raised')}",
            json={"permission_cd": "case.teleport"},
        )

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "unknown_permission"
        assert error["field"] == "permission_cd"
        assert "case.assign" in error["allowed"]

    def test_the_action_and_the_statuses_are_not_editable(self, icms_client, policy_tables):
        """Which roles may act is operational. Which state an action leads to is
        what the product means by a stage, and it is not an admin setting."""
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ADMIN}/transitions/{transition_id(icms_client, 'assign', 'raised')}",
            json={"target_status": "closed"},
        )

        assert response.status_code == 422

    def test_an_unknown_transition_is_404(self, icms_client, policy_tables):
        assert icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ADMIN}/transitions/9999", json={"active": False}).status_code == 404


# ------------------------------------------------------ role, state, zone, you
class TestDecisionOrder:
    """Role alone decides none of these. The answer is (permission, zone, case
    state, whether you are the assignee), and the order the four are asked in is
    what decides whether a refusal leaks the existence of a case."""

    def test_the_permission_is_asked_before_the_zone(
        self, icms_client, cases, policy_tables
    ):
        """403 and not 404: a caller who may not read cases at all is not told
        whether this one exists."""
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{ADMIN}/roles/{SURVEYOR}/permissions", json={"permission_cds": ["zone.read"]}
        )
        response = icms_client.sign_in(SURVEYOR).get("/api/icms/cases/CMP-2026-0004")

        assert response.status_code == 403

    def test_the_zone_is_asked_before_the_transition(
        self, icms_client, cases, policy_tables
    ):
        """404 and not 403. CMP-2026-0004 is in RURAL, which nobody covers; a
        role-shaped refusal would confirm the case exists."""
        response = icms_client.sign_in(LEAD).post(
            "/api/icms/cases/CMP-2026-0004/assign", json={"assignee_user_id": SURVEYOR_B_ID}
        )

        assert response.status_code == 404

    def test_the_transition_is_asked_once_the_zone_allows_it(
        self, icms_client, cases, policy_tables
    ):
        """Same caller, same role, a case they CAN see: now the refusal is about
        the move rather than about the case."""
        response = icms_client.sign_in(LEAD).post(
            "/api/icms/cases/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID}
        )

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"

    def test_the_assignee_is_the_last_attribute(
        self, icms_client, db, cases, zones, policy_tables
    ):
        """Two officers, one role, one zone, one case — and different answers,
        because one of them is the officer the case is assigned to.

        For a Field Surveyor the answer is now the whole case rather than the
        action list on it: a case outside their own assignments does not exist."""
        from ada_core.models_icms import Case, ZoneAssignment
        from sqlalchemy import update

        db.execute(
            update(Case).where(Case.case_ref == "CMP-2026-0002")
            .values(status="under_inspection", stage_no=3)
        )
        db.add(ZoneAssignment(zone_id=zones["TAJ"].id,
                              user_id=icms_client.subject_of(SURVEYOR),
                              assigned_by=icms_client.subject_of(SUPER_ADMIN)))
        db.commit()

        case = "/api/icms/cases/CMP-2026-0002"
        holder = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).get(case)
        other = icms_client.sign_in(SURVEYOR).get(case)

        assert set(holder.json()["allowed_actions"]) == {
            "check_in", "add_evidence", "record_findings", "submit"}
        assert other.status_code == 404


class TestCreateRole:
    def test_a_created_role_is_a_realm_role_with_its_grants(
        self, icms_client, policy_tables, keycloak
    ):
        response = icms_client.sign_in(SUPER_ADMIN).post(f"{ADMIN}/roles", json={
            "role_cd": "zone-inspector", "label": "Zone Inspector",
            "permission_cds": ["dashboard.access", "dashboard.read"],
        })
        assert response.status_code == 201
        assert response.json()["permission_cds"] == ["dashboard.access", "dashboard.read"]
        assert any(r["name"] == "zone-inspector" for r in keycloak.roles)
        assert policy.snapshot().permitted(["zone-inspector"]) == {
            "dashboard.access", "dashboard.read",
        }

    def test_the_new_role_is_assignable_and_admitted(self, icms_client, policy_tables):
        from app.icms.security import icms_roles

        icms_client.sign_in(SUPER_ADMIN).post(f"{ADMIN}/roles", json={
            "role_cd": "zone-inspector", "label": "Zone Inspector",
        })
        assert "zone-inspector" in icms_roles()

    def test_an_existing_role_is_refused(self, icms_client, policy_tables):
        response = icms_client.sign_in(SUPER_ADMIN).post(f"{ADMIN}/roles", json={
            "role_cd": "field-surveyor", "label": "Duplicate",
        })
        assert error_of(response)["code"] == "role_exists"

    def test_a_reserved_name_is_refused(self, icms_client, policy_tables):
        response = icms_client.sign_in(SUPER_ADMIN).post(f"{ADMIN}/roles", json={
            "role_cd": "public", "label": "Public",
        })
        assert error_of(response)["code"] == "role_code_reserved"

    def test_only_policy_managers_create_roles(self, icms_client, policy_tables):
        response = icms_client.sign_in(NODAL).post(f"{ADMIN}/roles", json={
            "role_cd": "zone-inspector", "label": "Zone Inspector",
        })
        assert response.status_code == 403
