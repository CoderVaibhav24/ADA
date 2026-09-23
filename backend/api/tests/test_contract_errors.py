"""Every refusal an ICMS endpoint can produce, as a status and a full envelope.

The envelope is the whole of what a client can act on. A refusal that arrives as
a bare string, or with the wrong code, is a screen that can only say "error".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from tests.conftest import (
    LEAD,
    NODAL,
    NODAL_ID,
    SUPER_ADMIN,
    SUPER_ADMIN_ID,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.contract import UNSPECIFIED, assert_error

ICMS = "/api/icms"
ADMIN = f"{ICMS}/admin/policy"
USERS = f"{ICMS}/admin/users"
ICMS_ROLES = ["ada-project-lead", "field-surveyor", "pcs-nodal-officer", "super-admin"]

# Well-formed and absent from the realm the double seeds, so a 404 here is the
# endpoint's answer rather than the path validator's.
UNKNOWN_USER = "00000000-0000-4000-8000-0000000000ff"
NEW_OFFICER = {"username": "new.officer", "email": "new.officer@example.invalid"}


@dataclass(frozen=True)
class Case:
    clause: str
    method: str
    path: str
    role: str | None
    status: int
    code: str
    body: dict | None = None
    field: Any = UNSPECIFIED
    allowed: Any = UNSPECIFIED

    @property
    def where(self) -> str:
        return f"{self.method} {self.path.split('?')[0]}"


CASES: tuple[Case, ...] = (
    # ------------------------------------------------------------------ 403
    Case("a caller with no ICMS role is refused by name", "GET", f"{ICMS}/code-values",
         None, 403, "role_not_permitted", allowed=ICMS_ROLES),
    Case("the admin register names the one role that holds it", "GET",
         f"{ICMS}/zone-assignments", NODAL, 403, "role_not_permitted",
         allowed=[SUPER_ADMIN]),
    Case("zone administration is Super Admin's alone", "POST", f"{ICMS}/zones",
         NODAL, 403, "role_not_permitted", body={"zone_cd": "X1", "name": "X"},
         allowed=[SUPER_ADMIN]),
    Case("the policy screen is refused to an officer who cannot edit it", "GET",
         f"{ADMIN}/roles", LEAD, 403, "role_not_permitted", allowed=[SUPER_ADMIN]),
    # CMP-2026-0002 is assigned to surveyor B; the caller here is surveyor A.
    Case("a surveyor opening a round on a colleague's case", "POST",
         f"{ICMS}/cases/CMP-2026-0002/inspections", SURVEYOR, 403, "not_the_assignee",
         body={"surveyor_user_id": SURVEYOR_ID}, field=None),
    # CMP-2026-0008 is surveyor A's own case, so only the naming is wrong.
    Case("a surveyor naming another surveyor on their own case", "POST",
         f"{ICMS}/cases/CMP-2026-0008/inspections", SURVEYOR, 403, "not_the_assignee",
         body={"surveyor_user_id": SURVEYOR_B_ID}, field="surveyor_user_id"),

    # ------------------------------------------------------------------ 404
    Case("an unknown zone", "GET", f"{ICMS}/zones/NOPE", NODAL, 404, "zone_not_found",
         field=None),
    Case("a zone outside the caller's scope is not found either", "GET",
         f"{ICMS}/zones/RURAL", SURVEYOR, 404, "zone_not_found", field=None),
    Case("updating an unknown zone", "PUT", f"{ICMS}/zones/NOPE", SUPER_ADMIN, 404,
         "zone_not_found", body={"name": "X"}, field=None),
    Case("granting sight of an unknown zone names the field", "POST",
         f"{ICMS}/zone-assignments", SUPER_ADMIN, 404, "zone_not_found",
         body={"zone_cd": "NOPE", "user_id": "u1"}, field="zone_cd"),
    Case("revoking sight of an unknown zone names the field", "DELETE",
         f"{ICMS}/zone-assignments?zone_cd=NOPE&user_id=u1", SUPER_ADMIN, 404,
         "zone_not_found", field="zone_cd"),
    Case("an unknown case", "GET", f"{ICMS}/cases/CMP-2026-9999", NODAL, 404,
         "case_not_found", field=None),
    Case("a case outside the caller's zones is not found either", "GET",
         f"{ICMS}/cases/CMP-2026-0004", NODAL, 404, "case_not_found", field=None),
    Case("amending a case outside the caller's zones", "PATCH",
         f"{ICMS}/cases/CMP-2026-0004", NODAL, 404, "case_not_found",
         body={"priority": "low"}),
    Case("assigning a case outside the caller's zones", "POST",
         f"{ICMS}/cases/CMP-2026-0004/assign", NODAL, 404, "case_not_found",
         body={"assignee_user_id": SURVEYOR_B_ID}),
    Case("an unknown role", "PUT", f"{ADMIN}/roles/nosuch/permissions", SUPER_ADMIN, 404,
         "role_not_found", body={"permission_cds": []}),
    Case("an unknown permission", "DELETE", f"{ADMIN}/permissions/nope.read", SUPER_ADMIN,
         404, "permission_not_found"),
    Case("an unknown transition", "PATCH", f"{ADMIN}/transitions/9999", SUPER_ADMIN, 404,
         "transition_not_found", body={"active": False}),

    # ------------------------------------------------------------------ 409
    Case("a zone code already in use", "POST", f"{ICMS}/zones", SUPER_ADMIN, 409,
         "zone_exists", body={"zone_cd": "TAJ", "name": "Duplicate"}, field="zone_cd"),
    Case("a closed case is the record and cannot be amended", "PATCH",
         f"{ICMS}/cases/CMP-2026-0005", NODAL, 409, "invalid_transition",
         body={"priority": "low"}),
    Case("a permission an endpoint names cannot be deleted", "DELETE",
         f"{ADMIN}/permissions/case.read", SUPER_ADMIN, 409, "permission_is_system",
         field="permission_cd"),
    Case("the last policy.manage grant cannot be given away", "PUT",
         f"{ADMIN}/roles/super-admin/permissions", SUPER_ADMIN, 409, "policy_lockout",
         body={"permission_cds": ["case.read"]}, field="permission_cds",
         allowed=["policy.manage"]),
    Case("the last enabled super-admin cannot be stripped of the role", "PUT",
         f"{USERS}/{SUPER_ADMIN_ID}/roles", SUPER_ADMIN, 409, "user_lockout",
         body={"realm_roles": ["pcs-nodal-officer"]}, field="realm_roles",
         allowed=["super-admin"]),
    Case("the last enabled super-admin cannot be disabled either", "PATCH",
         f"{USERS}/{SUPER_ADMIN_ID}", SUPER_ADMIN, 409, "user_lockout",
         body={"enabled": False}, field="enabled", allowed=["super-admin"]),

    # ------------------------------------------------------------------ 422
    Case("an unknown body field is refused by name", "POST", f"{ICMS}/zones", SUPER_ADMIN,
         422, "validation_failed", body={"zone_cd": "X1", "name": "X", "bogus": 1},
         field="bogus"),
    Case("an unknown body field on update", "PUT", f"{ICMS}/zones/TAJ", SUPER_ADMIN, 422,
         "validation_failed", body={"name": "X", "bogus": 1}, field="bogus"),
    Case("an unknown body field on a grant", "POST", f"{ICMS}/zone-assignments",
         SUPER_ADMIN, 422, "validation_failed",
         body={"zone_cd": "TAJ", "user_id": "u1", "bogus": 1}, field="bogus"),
    Case("an unknown body field when raising", "POST", f"{ICMS}/cases", NODAL, 422,
         "validation_failed", body={"source": "public", "zone_cd": "TAJ", "bogus": 1},
         field="bogus"),
    Case("a client-supplied status is refused by name, not silently applied", "PATCH",
         f"{ICMS}/cases/CMP-2026-0001", NODAL, 422, "validation_failed",
         body={"status": "closed"}, field="status"),
    Case("a client-supplied case_ref is refused by name", "PATCH",
         f"{ICMS}/cases/CMP-2026-0001", NODAL, 422, "validation_failed",
         body={"case_ref": "CMP-2026-0002"}, field="case_ref"),
    Case("an unknown body field on assign", "POST", f"{ICMS}/cases/CMP-2026-0001/assign",
         NODAL, 422, "validation_failed",
         body={"assignee_user_id": SURVEYOR_B_ID, "bogus": 1}, field="bogus"),
    Case("an unknown body field on a transition edit", "PATCH", f"{ADMIN}/transitions/1",
         SUPER_ADMIN, 422, "validation_failed", body={"bogus": 1}, field="bogus"),
    Case("an unknown query parameter is refused by name", "GET",
         f"{ICMS}/code-values?bogus=1", SUPER_ADMIN, 422, "validation_failed",
         field="bogus"),
    Case("a malformed case reference in the path", "GET", f"{ICMS}/cases/NOPE", NODAL, 422,
         "validation_failed", field="case_ref"),
    Case("a malformed zone code in the path", "GET", f"{ICMS}/zones/!!!", NODAL, 422,
         "validation_failed", field="zone_cd"),
    Case("a malformed permission code in the path", "DELETE", f"{ADMIN}/permissions/NOPE!",
         SUPER_ADMIN, 422, "validation_failed", field="permission_cd"),
    Case("a transition id that is not a number", "PATCH", f"{ADMIN}/transitions/abc",
         SUPER_ADMIN, 422, "validation_failed", body={"active": False},
         field="transition_id"),
    Case("a missing required body field", "POST", f"{ICMS}/cases/CMP-2026-0001/assign",
         NODAL, 422, "validation_failed", body={}, field="assignee_user_id"),
    Case("a missing required query parameter", "DELETE",
         f"{ICMS}/zone-assignments?zone_cd=TAJ", SUPER_ADMIN, 422, "validation_failed",
         field="user_id"),
    Case("an amendment with nothing in it", "PATCH", f"{ICMS}/cases/CMP-2026-0001", NODAL,
         422, "validation_failed", body={}),
    Case("a status the workflow does not have", "GET", f"{ICMS}/cases?status=bogus", NODAL,
         422, "validation_failed"),
    Case("a source the vocabulary does not have", "GET", f"{ICMS}/cases?source=bogus",
         NODAL, 422, "validation_failed"),
    Case("a filed range that runs backwards", "GET",
         f"{ICMS}/cases?filed_from=2026-09-20&filed_to=2026-09-10", NODAL, 422,
         "validation_failed"),
    Case("a geometry that is not a polygon", "POST", f"{ICMS}/zones", SUPER_ADMIN, 422,
         "validation_failed",
         body={"zone_cd": "G1", "name": "G",
               "geometry": {"type": "Point", "coordinates": [78.0, 27.0]}},
         field="geometry.type"),
    Case("an assignee who cannot see the case's zone", "POST",
         f"{ICMS}/cases/CMP-2026-0001/assign", NODAL, 422, "assignee_not_in_zone",
         body={"assignee_user_id": "nobody-in-taj"}, field="assignee_user_id"),

    # ------------------------------------------- officer administration (Keycloak)
    Case("the officer register is Super Admin's alone", "GET", USERS, NODAL, 403,
         "role_not_permitted", allowed=[SUPER_ADMIN]),
    Case("creating an officer is Super Admin's alone", "POST", USERS, NODAL, 403,
         "role_not_permitted", body=NEW_OFFICER, allowed=[SUPER_ADMIN]),
    Case("an officer the realm does not hold", "GET", f"{USERS}/{UNKNOWN_USER}",
         SUPER_ADMIN, 404, "user_not_found", field=None),
    Case("amending an officer the realm does not hold", "PATCH",
         f"{USERS}/{UNKNOWN_USER}", SUPER_ADMIN, 404, "user_not_found",
         body={"enabled": False}),
    Case("setting roles on an officer the realm does not hold", "PUT",
         f"{USERS}/{UNKNOWN_USER}/roles", SUPER_ADMIN, 404, "user_not_found",
         body={"realm_roles": []}),
    Case("a username Keycloak already holds names the field", "POST", USERS,
         SUPER_ADMIN, 409, "user_exists", field="username",
         body={"username": "nodal.officer", "email": "someone.else@example.invalid"}),
    Case("an email Keycloak already holds names the other field", "POST", USERS,
         SUPER_ADMIN, 409, "user_exists", field="email",
         body={"username": "someone.else", "email": "nodal.officer@example.invalid"}),
    # The refusal that matters most here: realm-management roles exist in the
    # realm and this endpoint could otherwise hand one to an officer.
    Case("a realm role outside ICMS is refused rather than passed through", "PUT",
         f"{USERS}/{NODAL_ID}/roles", SUPER_ADMIN, 422, "unknown_role",
         body={"realm_roles": ["realm-admin"]}, field="realm_roles",
         allowed=ICMS_ROLES),
    Case("a role outside ICMS on creation is refused too", "POST", USERS, SUPER_ADMIN,
         422, "unknown_role", field="realm_roles", allowed=ICMS_ROLES,
         body={**NEW_OFFICER, "realm_roles": ["realm-admin"]}),
    Case("an unknown body field when creating an officer", "POST", USERS, SUPER_ADMIN,
         422, "validation_failed", body={**NEW_OFFICER, "bogus": 1}, field="bogus"),
    Case("a malformed officer id in the path", "GET", f"{USERS}/not-a-uuid",
         SUPER_ADMIN, 422, "validation_failed", field="user_id"),
    Case("a credential choice with no password to go with it", "POST", USERS,
         SUPER_ADMIN, 422, "validation_failed", field="password",
         body={**NEW_OFFICER, "credential": "temporary_password"}),
    Case("a password below the realm's policy is refused before Keycloak sees it",
         "POST", f"{USERS}/{NODAL_ID}/reset-password", SUPER_ADMIN, 422,
         "validation_failed", body={"password": "short"}, field="password"),
    Case("an amendment with nothing in it", "PATCH", f"{USERS}/{NODAL_ID}",
         SUPER_ADMIN, 422, "validation_failed", body={}),
)


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c.where} — {c.clause}")
def test_the_refusal_is_the_documented_status_and_envelope(icms_client, contract_world, case):
    client = icms_client.sign_in(case.role) if case.role else icms_client.sign_in()
    response = client.request(case.method, case.path, json=case.body)

    assert_error(case.where, case.clause, response, status=case.status, code=case.code,
                 field=case.field, allowed=case.allowed)


class TestNotFoundHidesExistence:
    """A 404 that differs from a 403 tells an officer which cases exist elsewhere."""

    def test_an_out_of_zone_case_is_indistinguishable_from_one_that_does_not_exist(
        self, icms_client, contract_world
    ):
        client = icms_client.sign_in(NODAL)
        missing = client.get(f"{ICMS}/cases/CMP-2026-9998").json()["error"]
        hidden = client.get(f"{ICMS}/cases/CMP-2026-0004").json()["error"]

        assert missing["code"] == hidden["code"] == "case_not_found"
        assert missing["field"] == hidden["field"] is None
        assert missing["allowed"] == hidden["allowed"] is None

    def test_an_out_of_zone_zone_is_indistinguishable_from_one_that_does_not_exist(
        self, icms_client, contract_world
    ):
        client = icms_client.sign_in(SURVEYOR)
        missing = client.get(f"{ICMS}/zones/NOSUCH").json()["error"]
        hidden = client.get(f"{ICMS}/zones/RURAL").json()["error"]

        assert missing["code"] == hidden["code"] == "zone_not_found"
        assert missing["field"] == hidden["field"] is None

    def test_an_out_of_zone_case_does_not_leak_through_the_register_total(
        self, icms_client, contract_world
    ):
        """`total` is counted over the scoped selectable, so it cannot count a hidden row."""
        body = icms_client.sign_in(NODAL).get(f"{ICMS}/cases").json()

        assert body["total"] == len(body["items"]) == 9
        assert "CMP-2026-0004" not in [row["case_ref"] for row in body["items"]]


class TestTheAllowedListIsActionable:
    def test_an_unknown_permission_lists_the_ones_that_exist(self, icms_client, contract_world):
        client = icms_client.sign_in(SUPER_ADMIN)
        known = sorted(row["permission_cd"] for row in client.get(f"{ADMIN}/permissions").json())

        response = client.put(f"{ADMIN}/roles/field-surveyor/permissions",
                              json={"permission_cds": ["bogus"]})

        assert_error(f"PUT {ADMIN}/roles/{{role_cd}}/permissions",
                     "an unknown permission lists the whitelist", response,
                     status=422, code="unknown_permission", field="permission_cds",
                     allowed=known)

    def test_an_unknown_role_lists_the_ones_that_exist(self, icms_client, contract_world):
        client = icms_client.sign_in(SUPER_ADMIN)
        known = sorted(row["role_cd"] for row in client.get(f"{ADMIN}/roles").json())

        response = client.patch(f"{ADMIN}/transitions/1", json={"roles": ["bogus"]})

        assert_error(f"PATCH {ADMIN}/transitions/{{id}}", "an unknown role lists the whitelist",
                     response, status=422, code="unknown_role", field="roles", allowed=known)


class TestWorkflowRefusals:
    def test_a_role_that_holds_no_transition_is_refused_at_the_transition(
        self, icms_client, contract_world
    ):
        """Super Admin reaches the handler and is refused by the table, not by the route."""
        response = icms_client.sign_in(SUPER_ADMIN).post(
            f"{ICMS}/cases", json={"source": "public", "zone_cd": "TAJ"})

        error = assert_error(f"POST {ICMS}/cases", "Super Admin holds no transition",
                             response, status=403, code="role_not_permitted")
        assert "pcs-nodal-officer" in error["message"]

    def test_a_lead_may_read_a_case_but_not_move_it(self, icms_client, contract_world):
        response = icms_client.sign_in(LEAD).post(
            f"{ICMS}/cases/CMP-2026-0002/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        error = assert_error(f"POST {ICMS}/cases/{{case_ref}}/assign",
                             "a project lead holds no assignment transition",
                             response, status=403, code="role_not_permitted")
        assert "pcs-nodal-officer" in error["message"]

    # BUG: RoleNotPermitted builds its message from the `required` generator and
    # then stores frozenset(required) from the exhausted generator, so `allowed`
    # is always []. Only the prose carries the roles, which no client can parse.
    @pytest.mark.xfail(
        strict=True,
        reason="workflow.RoleNotPermitted consumes `required` building its message, "
               "so the machine-readable `allowed` is always []",
    )
    def test_a_workflow_refusal_names_the_roles_in_allowed_and_not_only_in_the_message(
        self, icms_client, contract_world
    ):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            f"{ICMS}/cases", json={"source": "public", "zone_cd": "TAJ"})

        assert response.json()["error"]["allowed"] == [
            "ada-project-lead", "field-surveyor", "pcs-nodal-officer", "public",
        ]

    @pytest.mark.xfail(
        strict=True,
        reason="same generator-exhaustion bug, reached through workflow.check_amendable",
    )
    def test_an_amendment_refusal_names_the_roles_in_allowed(self, icms_client, contract_world):
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{ICMS}/cases/CMP-2026-0001", json={"priority": "low"})

        assert response.json()["error"]["allowed"] == ["pcs-nodal-officer"]

    def test_a_route_level_refusal_does_carry_its_allowed_list(self, icms_client, contract_world):
        """The half that works: require_permission builds the list eagerly."""
        response = icms_client.sign_in(NODAL).get(f"{ADMIN}/roles")

        assert response.json()["error"]["allowed"] == [SUPER_ADMIN]


class TestTheReferenceAllocator:
    def test_the_counter_and_the_register_agree_in_the_normal_case(self, icms_client,
                                                                   contract_world):
        response = icms_client.sign_in(NODAL).post(
            f"{ICMS}/cases", json={"source": "public", "zone_cd": "TAJ"})

        assert response.status_code == 201
        # 0012 and not 0011 since 2026-09-23: `contract_world` seeds an eleventh
        # case, CMP-2026-0011 in `confirmed`, for Batch 6's issue_notice.
        assert response.json()["case_ref"] == "CMP-2026-0012"

    # BUG: allocate() mints the next reference from icms_notice_sequence with no
    # check that it is free and no retry. A register imported from the legacy
    # system without seeding the counter makes every raise collide on
    # icms_case.case_ref, and the IntegrityError is unhandled — a 500 rather than
    # a handled refusal. `cases` here is the un-seeded fixture, which is exactly
    # that state.
    @pytest.mark.xfail(
        strict=True,
        reason="icms.numbering.allocate has no collision recovery, so a counter behind "
               "the register raises IntegrityError out of the handler",
    )
    def test_a_counter_behind_the_register_is_a_handled_refusal_and_not_a_500(
        self, icms_client, zones, assignments, cases, policy_tables
    ):
        response = icms_client.sign_in(NODAL).post(
            f"{ICMS}/cases", json={"source": "public", "zone_cd": "TAJ"})

        assert response.status_code != 500, (
            f"POST {ICMS}/cases · reference collision: the allocator re-minted "
            f"{cases and 'CMP-2026-0001'} and nothing caught it"
        )
