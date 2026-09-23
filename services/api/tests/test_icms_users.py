"""Officer administration: the guards, the failure modes and the credential rule.

The role matrix and the response shapes are pinned in the contract suites. What
is here is everything those cannot express — what happens when Keycloak is slow,
what the endpoint does with a realm role it was never meant to hand out, and
what a create leaves behind when the third of its three calls fails.

Two levels of double, deliberately:

  * `FakeKeycloak` at the admin-client boundary, for the handlers. The suite has
    no Keycloak server, and a handler test should be about the handler.
  * `httpx.MockTransport` under a REAL `KeycloakAdmin`, for the client itself.
    Token caching and the 401 retry are invisible from above — the assertion is
    how many times the token endpoint was hit, so the client has to be real.
"""

from __future__ import annotations

import httpx
import pytest

from app.clients.keycloak import KeycloakAdmin, get_admin_client
from app.errors import ApiError
from tests.conftest import (
    LEAD,
    NODAL,
    NODAL_ID,
    SUPER_ADMIN,
    SUPER_ADMIN_ID,
    SURVEYOR,
)
from tests.fake_keycloak import FORBIDDEN_ROLE, FailAt

USERS = "/api/icms/admin/users"

# Long enough for the realm's 12-character policy, and distinctive enough that
# `in response.text` is a real search rather than a coincidence.
PROBE_PASSWORD = "Correct-Horse-Battery-2026"

NEW_OFFICER = {
    "username": "new.officer",
    "email": "new.officer@example.invalid",
    "first_name": "New",
    "last_name": "Officer",
}

# Every write, so that one added later without a guard shows up here.
WRITES = (
    ("POST", USERS, NEW_OFFICER),
    ("PATCH", f"{USERS}/{NODAL_ID}", {"enabled": False}),
    ("PUT", f"{USERS}/{NODAL_ID}/roles", {"realm_roles": ["field-surveyor"]}),
    ("POST", f"{USERS}/{NODAL_ID}/reset-password", {"password": PROBE_PASSWORD}),
)

READS = (
    ("GET", USERS, None),
    ("GET", f"{USERS}/{NODAL_ID}", None),
)

ALL_OPERATIONS = READS + WRITES

# The tuple carries a dict, which pytest renders as noise in the test id.
def operation_id(value):
    return value if isinstance(value, str) else ""


# Replaces the realm mid-test, for the cases that need one which misbehaves.
def install(realm):
    from app.main import app

    app.dependency_overrides[get_admin_client] = lambda: realm
    return realm


class TestTheGuards:
    @pytest.mark.parametrize("method,path,body", ALL_OPERATIONS, ids=operation_id)
    @pytest.mark.parametrize("role", [NODAL, SURVEYOR, LEAD])
    def test_only_super_admin_reaches_officer_administration(
        self, icms_client, policy_tables, keycloak, method, path, body, role
    ):
        """`user.read` and `user.manage` are granted to super-admin alone in 0003.
        An officer who can mint officers can give themselves every role there is."""
        response = icms_client.sign_in(role).request(method, path, json=body)

        assert response.status_code == 403, response.text[:200]
        assert response.json()["error"]["allowed"] == [SUPER_ADMIN]
        assert keycloak.calls == [], "a refused caller must not reach Keycloak at all"

    @pytest.mark.parametrize("method,path,body", ALL_OPERATIONS, ids=operation_id)
    def test_no_token_is_401_before_any_role_is_resolved(
        self, anonymous_client, method, path, body
    ):
        response = anonymous_client.request(method, path, json=body)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthenticated"

    def test_there_is_no_delete_route_at_all(self, icms_client, policy_tables):
        """Disable, never delete: five ICMS columns hold a Keycloak subject and none
        is a foreign key, so a delete silently orphans an audit trail."""
        schema = icms_client.sign_in(SUPER_ADMIN).get("/api/openapi.json").json()
        mounted = {p: ops for p, ops in schema["paths"].items() if p.startswith(USERS)}

        assert mounted, "the officer routes are not mounted"
        for path, operations in mounted.items():
            assert "delete" not in operations, f"{path} exposes a delete"


class TestTheRegister:
    def test_the_envelope_carries_keycloaks_own_count_and_not_the_page_length(
        self, icms_client, policy_tables, keycloak
    ):
        """A total guessed from the page makes the last page unreachable."""
        body = icms_client.sign_in(SUPER_ADMIN).get(USERS, params={"size": 2}).json()

        assert body["total"] == 4 and len(body["items"]) == 2
        assert body["pages"] == 2 and body["next_cursor"] == "2"
        assert body["sort"] == "username"
        assert keycloak.called("count_users"), "the total must come from /users/count"

    def test_the_search_term_reaches_keycloak_rather_than_filtering_the_page(
        self, icms_client, policy_tables
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(USERS, params={"q": "nodal"}).json()

        assert body["total"] == 1
        assert [row["username"] for row in body["items"]] == ["nodal.officer"]

    def test_a_page_past_the_end_is_empty_and_not_an_error(self, icms_client,
                                                           policy_tables):
        response = icms_client.sign_in(SUPER_ADMIN).get(USERS, params={"page": 99})

        assert response.status_code == 200
        assert response.json()["items"] == []
        assert response.json()["next_cursor"] is None

    def test_a_sort_key_keycloak_cannot_honour_is_refused_rather_than_ignored(
        self, icms_client, policy_tables
    ):
        """Keycloak orders users by username and takes no sort parameter. Accepting
        `-created_at` and answering in username order is a grid that lies."""
        response = icms_client.sign_in(SUPER_ADMIN).get(
            USERS, params={"sort": "-created_at"})

        assert response.status_code == 422
        assert response.json()["error"]["field"] == "sort"


class TestCreatingAnOfficer:
    def test_the_created_officer_carries_its_keycloak_subject(self, icms_client,
                                                              policy_tables, keycloak):
        """The id is the value ICMS rows store, so the caller needs it back."""
        response = icms_client.sign_in(SUPER_ADMIN).post(
            USERS, json={**NEW_OFFICER, "realm_roles": ["field-surveyor"]})

        assert response.status_code == 201
        body = response.json()
        assert body["id"] in keycloak.users
        assert body["realm_roles"] == ["field-surveyor"]
        assert body["enabled"] is True

    def test_the_realm_default_required_action_survives_the_create(
        self, icms_client, policy_tables
    ):
        """CONFIGURE_TOTP is a realm default already on the account. Sending
        requiredActions as a bare list would remove it, and nobody would notice
        until an officer signed in without being asked to enrol."""
        body = icms_client.sign_in(SUPER_ADMIN).post(USERS, json=NEW_OFFICER).json()

        assert body["required_actions"] == ["CONFIGURE_TOTP", "UPDATE_PASSWORD"]

    def test_a_temporary_password_leaves_keycloak_to_add_update_password(
        self, icms_client, policy_tables, keycloak
    ):
        body = icms_client.sign_in(SUPER_ADMIN).post(
            USERS, json={**NEW_OFFICER, "credential": "temporary_password",
                         "password": PROBE_PASSWORD}).json()

        assert keycloak.credentials[body["id"]] is True
        assert body["required_actions"] == ["CONFIGURE_TOTP", "UPDATE_PASSWORD"]

    def test_a_username_already_in_the_realm_names_the_username_field(
        self, icms_client, policy_tables
    ):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            USERS, json={"username": "nodal.officer",
                         "email": "somebody.else@example.invalid"})

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "user_exists" and error["field"] == "username"

    def test_an_email_already_in_the_realm_names_the_email_field(self, icms_client,
                                                                 policy_tables):
        """Both collisions arrive as a Keycloak 409 and only the prose distinguishes
        them, so the form would highlight the wrong input without this."""
        response = icms_client.sign_in(SUPER_ADMIN).post(
            USERS, json={"username": "somebody.else",
                         "email": "nodal.officer@example.invalid"})

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "user_exists" and error["field"] == "email"

    def test_a_realm_role_outside_icms_is_refused_before_anything_is_created(
        self, icms_client, policy_tables, keycloak
    ):
        """realm-admin exists in the realm. Passing it through would let anybody
        holding user.manage promote an officer to a realm administrator."""
        response = icms_client.sign_in(SUPER_ADMIN).post(
            USERS, json={**NEW_OFFICER, "realm_roles": [FORBIDDEN_ROLE]})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "unknown_role"
        assert keycloak.called("create_user") == [], "nothing may be created first"


class TestCreationIsNotAtomic:
    def test_a_failure_after_the_account_exists_leaves_it_disabled(
        self, icms_client, policy_tables
    ):
        """Created disabled and enabled last, so every half-state is one nobody can
        sign in to. The alternative compensation — delete the account — is the one
        act this router refuses to have."""
        realm = install(FailAt("add_realm_roles"))

        response = icms_client.sign_in(SUPER_ADMIN).post(
            USERS, json={**NEW_OFFICER, "realm_roles": ["field-surveyor"]})

        assert response.status_code == 503
        created = [row for row in realm.users.values()
                   if row["username"] == "new.officer"]
        assert len(created) == 1, "the account was created and must not be deleted"
        assert created[0]["enabled"] is False

    def test_the_refusal_names_the_username_the_id_and_what_survived(
        self, icms_client, policy_tables
    ):
        """Retrying will now collide on the username, so 'try again' is wrong advice
        and the message has to say what to do instead."""
        realm = install(FailAt("reset_password"))

        response = icms_client.sign_in(SUPER_ADMIN).post(
            USERS, json={**NEW_OFFICER, "realm_roles": ["field-surveyor"],
                         "credential": "temporary_password",
                         "password": PROBE_PASSWORD})
        error = response.json()["error"]

        assert response.status_code == 503
        assert error["code"] == "user_partially_created"
        assert "new.officer" in error["message"]
        assert "roles assigned (field-surveyor)" in error["message"]
        assert "DISABLED" in error["message"]
        assert PROBE_PASSWORD not in response.text
        assert len(realm.users) == 5, "the half-made account is still there to finish"


class TestRoles:
    def test_the_full_set_replaces_what_was_held(self, icms_client, policy_tables,
                                                 keycloak):
        body = icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{NODAL_ID}/roles",
            json={"realm_roles": ["field-surveyor", "ada-project-lead"]}).json()

        assert body["realm_roles"] == ["ada-project-lead", "field-surveyor"]
        assert "pcs-nodal-officer" not in keycloak.roles_of(NODAL_ID)

    def test_the_realms_own_default_role_is_left_alone(self, icms_client,
                                                       policy_tables, keycloak):
        """`default-roles-pcsmcpl` carries the account's standard client scopes.
        Stripping it while 'replacing the role list' breaks the login itself."""
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{NODAL_ID}/roles", json={"realm_roles": []})

        assert keycloak.roles_of(NODAL_ID) == {"default-roles-pcsmcpl"}

    def test_a_role_outside_icms_is_refused_and_nothing_is_changed(
        self, icms_client, policy_tables, keycloak
    ):
        before = keycloak.roles_of(NODAL_ID)

        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{NODAL_ID}/roles", json={"realm_roles": [FORBIDDEN_ROLE]})

        assert response.status_code == 422
        assert response.json()["error"]["allowed"] == [
            "ada-project-lead", "field-surveyor", "pcs-nodal-officer", "super-admin",
        ]
        assert keycloak.roles_of(NODAL_ID) == before

    def test_the_detail_reports_only_assignable_roles_so_get_matches_put(
        self, icms_client, policy_tables
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{USERS}/{NODAL_ID}").json()

        assert body["realm_roles"] == ["pcs-nodal-officer"]


class TestDisablingRatherThanDeleting:
    def test_disabling_keeps_the_account_and_its_subject(self, icms_client,
                                                         policy_tables, keycloak):
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{USERS}/{NODAL_ID}", json={"enabled": False})

        assert response.status_code == 200
        assert response.json()["enabled"] is False
        assert NODAL_ID in keycloak.users, "the subject every audit row names is still there"

    def test_an_amendment_does_not_clear_the_fields_it_did_not_mention(
        self, icms_client, policy_tables, keycloak
    ):
        """A PUT to Keycloak replaces the representation. Merging onto what it holds
        is what stops a rename from also blanking the email and the required actions."""
        icms_client.sign_in(SUPER_ADMIN).patch(
            f"{USERS}/{NODAL_ID}", json={"first_name": "Renamed"})
        stored = keycloak.users[NODAL_ID]

        assert stored["firstName"] == "Renamed"
        assert stored["email"] == "nodal.officer@example.invalid"
        assert stored["requiredActions"] == ["CONFIGURE_TOTP"]


class TestTheLastSuperAdminCannotBeShutOut:
    """Two edits here can lock every administrator out of ICMS entirely.

    `super-admin` is in `ASSIGNABLE_ROLES`, so `PUT .../roles` with a list that
    omits it strips the role; and `PATCH` with `enabled: false` disables the
    account holding it. Either one, applied to the last enabled holder, leaves
    nobody able to reach this screen or the policy screen, and no route back
    except the Keycloak console.

    It cannot be a browser warning. `list_users` fetches no role mappings per
    row — Keycloak returns none with a user list — so `UserRow` carries no roles
    and the client cannot count who else holds it. The count exists only here.

    The double seeds one super-admin: SUPER_ADMIN_ID.
    """

    def test_stripping_the_role_from_the_last_holder_is_refused(
        self, icms_client, policy_tables, keycloak
    ):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{SUPER_ADMIN_ID}/roles",
            json={"realm_roles": ["pcs-nodal-officer"]})

        assert response.status_code == 409, response.text[:300]
        error = response.json()["error"]
        assert error["code"] == "user_lockout"
        assert error["field"] == "realm_roles"
        assert error["allowed"] == ["super-admin"]
        assert "super-admin" in keycloak.roles_of(SUPER_ADMIN_ID), "nothing was changed"

    def test_an_empty_role_list_is_the_same_lockout_by_another_name(
        self, icms_client, policy_tables, keycloak
    ):
        """The shortest path to it, and the one a "clear all" button sends."""
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{SUPER_ADMIN_ID}/roles", json={"realm_roles": []})

        assert response.status_code == 409
        assert "super-admin" in keycloak.roles_of(SUPER_ADMIN_ID)

    def test_stripping_it_is_allowed_once_a_second_enabled_holder_exists(
        self, icms_client, policy_tables, keycloak
    ):
        """The other half. A guard that refused every edit would pass the two
        above and make the role impossible to move."""
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{NODAL_ID}/roles", json={"realm_roles": ["super-admin"]})

        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{SUPER_ADMIN_ID}/roles",
            json={"realm_roles": ["pcs-nodal-officer"]})

        assert response.status_code == 200, response.text[:300]
        assert keycloak.roles_of(SUPER_ADMIN_ID) == {
            "pcs-nodal-officer", "default-roles-pcsmcpl"}

    def test_disabling_the_last_holder_is_refused(
        self, icms_client, policy_tables, keycloak
    ):
        """`enabled: false` is how an officer leaves, and the last administrator
        cannot leave by it."""
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{USERS}/{SUPER_ADMIN_ID}", json={"enabled": False})

        assert response.status_code == 409, response.text[:300]
        error = response.json()["error"]
        assert error["code"] == "user_lockout"
        assert error["field"] == "enabled"
        assert keycloak.users[SUPER_ADMIN_ID]["enabled"] is True

    def test_disabling_one_of_two_holders_is_allowed(
        self, icms_client, policy_tables, keycloak
    ):
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{NODAL_ID}/roles", json={"realm_roles": ["super-admin"]})

        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{USERS}/{SUPER_ADMIN_ID}", json={"enabled": False})

        assert response.status_code == 200, response.text[:300]
        assert keycloak.users[SUPER_ADMIN_ID]["enabled"] is False

    def test_a_disabled_second_holder_is_not_a_way_back_in(
        self, icms_client, policy_tables, keycloak
    ):
        """The clause the whole guard turns on. An account that cannot sign in
        cannot administer anything, so it does not count as cover — counting
        holders rather than ENABLED holders would pass this and lock the door."""
        client = icms_client.sign_in(SUPER_ADMIN)
        client.put(f"{USERS}/{NODAL_ID}/roles", json={"realm_roles": ["super-admin"]})
        client.patch(f"{USERS}/{NODAL_ID}", json={"enabled": False})

        response = client.put(
            f"{USERS}/{SUPER_ADMIN_ID}/roles",
            json={"realm_roles": ["pcs-nodal-officer"]})

        assert response.status_code == 409, response.text[:300]
        assert response.json()["error"]["code"] == "user_lockout"
        assert "super-admin" in keycloak.roles_of(SUPER_ADMIN_ID)

    def test_an_officer_who_does_not_hold_the_role_is_edited_freely(
        self, icms_client, policy_tables, keycloak
    ):
        """The guard must not spread. Disabling a surveyor is ordinary
        administration and cannot lock anybody out of anything."""
        response = icms_client.sign_in(SUPER_ADMIN).patch(
            f"{USERS}/{NODAL_ID}", json={"enabled": False})

        assert response.status_code == 200, response.text[:300]
        assert keycloak.users[NODAL_ID]["enabled"] is False

    def test_the_count_is_not_asked_for_on_an_edit_that_cannot_cause_it(
        self, icms_client, policy_tables, keycloak
    ):
        """One extra round trip to Keycloak, and only on the two dangerous edits.
        A rename must not pay for it."""
        icms_client.sign_in(SUPER_ADMIN).patch(
            f"{USERS}/{NODAL_ID}", json={"first_name": "Renamed"})

        assert keycloak.called("role_members") == []

    def test_granting_the_role_never_asks_either(
        self, icms_client, policy_tables, keycloak
    ):
        """A role list that KEEPS super-admin cannot remove the last one."""
        icms_client.sign_in(SUPER_ADMIN).put(
            f"{USERS}/{SUPER_ADMIN_ID}/roles",
            json={"realm_roles": ["super-admin", "pcs-nodal-officer"]})

        assert keycloak.called("role_members") == []


class TestWhenKeycloakIsDown:
    @pytest.mark.parametrize("method,path,body", ALL_OPERATIONS, ids=operation_id)
    def test_every_endpoint_answers_503_in_the_project_envelope(
        self, icms_client, policy_tables, keycloak, method, path, body
    ):
        """Keycloak is a different failure domain from the database. A 500 here says
        ada-api is broken, which sends an operator to the wrong logs."""
        keycloak.go_down()

        response = icms_client.sign_in(SUPER_ADMIN).request(method, path, json=body)

        assert response.status_code == 503, response.text[:200]
        error = response.json()["error"]
        assert error["code"] == "identity_unavailable"
        assert error["request_id"], "a 503 nobody can find in the logs is half an answer"

    def test_an_unreachable_host_is_a_503_and_not_a_hang(self):
        """The real client, so the httpx error mapping is exercised rather than described."""
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        with pytest.raises(ApiError) as caught:
            _admin(httpx.MockTransport(refuse)).count_users()

        assert caught.value.status_code == 503
        assert caught.value.code == "identity_unavailable"

    def test_a_slow_realm_times_out_into_the_same_503(self):
        def stall(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("too slow", request=request)

        with pytest.raises(ApiError) as caught:
            _admin(httpx.MockTransport(stall)).realm_roles()

        assert caught.value.status_code == 503

    def test_no_client_secret_configured_says_so_rather_than_401ing_per_request(
        self, monkeypatch
    ):
        from app.clients import keycloak as module

        monkeypatch.setattr(module.settings, "oidc_admin_client_secret", "")
        module.reset_admin_client()
        try:
            with pytest.raises(ApiError) as caught:
                module.get_admin_client()
        finally:
            module.reset_admin_client()

        assert caught.value.code == "identity_admin_not_configured"


class TestTheServiceAccountToken:
    def test_one_mint_covers_several_calls(self):
        """Minting per request is a round trip to Keycloak before the one you wanted."""
        recorder = _Recorder()
        admin = _admin(recorder.transport)

        admin.count_users()
        admin.realm_roles()
        admin.get_user("11111111-0000-4000-8000-000000000001")

        assert recorder.mints == 1, f"minted {recorder.mints} times for three calls"

    def test_a_401_re_mints_once_and_the_request_still_succeeds(self):
        """A token that expired between the check and the call is ordinary. Failing
        the officer's request over it would be a retry every caller has to write."""
        recorder = _Recorder(reject_first=True)
        admin = _admin(recorder.transport)

        assert admin.count_users() == 7
        assert recorder.mints == 2, "the 401 must re-mint exactly once"

    def test_a_second_401_is_not_retried_for_ever(self):
        """A 401 with a freshly minted token is a role the service account does not
        hold, and retrying that is a busy loop against the identity service."""
        recorder = _Recorder(reject_all=True)
        admin = _admin(recorder.transport)

        with pytest.raises(ApiError) as caught:
            admin.count_users()

        assert caught.value.status_code == 503
        assert recorder.mints == 2


class TestNoCredentialEverLeaves:
    @pytest.mark.parametrize("method,path,body", ALL_OPERATIONS, ids=operation_id)
    def test_no_response_body_contains_the_password_that_was_sent(
        self, icms_client, policy_tables, method, path, body
    ):
        payload = dict(body) if body else None
        if payload is not None and method == "POST" and path == USERS:
            payload |= {"credential": "temporary_password", "password": PROBE_PASSWORD}

        response = icms_client.sign_in(SUPER_ADMIN).request(method, path, json=payload)

        assert response.status_code < 400, response.text[:200]
        assert PROBE_PASSWORD not in response.text

    def test_no_response_body_has_a_field_that_could_hold_one(self, icms_client,
                                                              policy_tables):
        """Names as well as values: a `password` key that happens to be null today
        is a key somebody fills in tomorrow."""
        client = icms_client.sign_in(SUPER_ADMIN)
        bodies = [
            client.get(USERS).json(),
            client.get(f"{USERS}/{NODAL_ID}").json(),
            client.post(f"{USERS}/{NODAL_ID}/reset-password",
                        json={"password": PROBE_PASSWORD}).json(),
            client.post(USERS, json={**NEW_OFFICER, "credential": "temporary_password",
                                     "password": PROBE_PASSWORD}).json(),
        ]

        banned = {"password", "secret", "token", "credential", "credentials",
                  "client_secret", "access_token"}
        for body in bodies:
            leaked = _keys(body) & banned
            assert not leaked, f"{sorted(leaked)} in {body}"

    def test_the_client_secret_is_not_in_the_openapi_document(self, icms_client,
                                                              policy_tables):
        """The schema is served to the browser and generated into the typed client."""
        schema = icms_client.sign_in(SUPER_ADMIN).get("/api/openapi.json").text

        assert "client_secret" not in schema


def _keys(payload, found=None) -> set[str]:
    found = set() if found is None else found
    if isinstance(payload, dict):
        found |= set(payload)
        for value in payload.values():
            _keys(value, found)
    elif isinstance(payload, list):
        for value in payload:
            _keys(value, found)
    return found


def _admin(transport: httpx.MockTransport) -> KeycloakAdmin:
    return KeycloakAdmin(
        "http://keycloak.test/idp", "pcsmcpl", "ada-api", "not-a-real-secret",
        timeout=1.0, client=httpx.Client(transport=transport),
    )


# The token endpoint and a couple of admin ones, with a counter on the first.
# The caching this proves is invisible to a test that goes through a handler.
class _Recorder:
    def __init__(self, *, reject_first: bool = False, reject_all: bool = False) -> None:
        self.mints = 0
        self.admin_calls = 0
        self._reject_first = reject_first
        self._reject_all = reject_all
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/protocol/openid-connect/token"):
            self.mints += 1
            return httpx.Response(
                200, json={"access_token": "fake-access-token", "expires_in": 300}
            )

        self.admin_calls += 1
        if self._reject_all or (self._reject_first and self.admin_calls == 1):
            return httpx.Response(401, json={"error": "invalid_token"})
        if request.url.path.endswith("/users/count"):
            return httpx.Response(200, json=7)
        if request.url.path.endswith("/roles"):
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"id": "x", "username": "x"})
