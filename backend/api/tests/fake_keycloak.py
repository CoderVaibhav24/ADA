"""A Keycloak realm held in a dict, standing in for the Admin API.

The double sits at the admin-client boundary — the same method surface as
`app.clients.keycloak.KeycloakAdmin` — rather than at the HTTP one. The suite
runs with no Keycloak server, and a double built out of hand-written JSON
responses would mostly be testing the double.

It is not a stub that returns fixtures: usernames and emails really are unique,
role mappings really are a set, and `enabled` really is a flag, so the handlers'
ordering and merging are exercised rather than described. What it cannot prove
is the wire contract — that Keycloak paginates with first/max, that a 409 says
'User exists with same username' — and that is what the end-to-end run against
the real realm is for.
"""

from __future__ import annotations

import itertools
from typing import Any

from app.clients.keycloak import UNAVAILABLE, KeycloakConflict, KeycloakRejected
from app.errors import ApiError
from tests.conftest import LEAD_ID, NODAL_ID, SUPER_ADMIN_ID, SURVEYOR_ID

# The realm's own roles, which are not ICMS's to assign. Present so that a test
# can prove PUT /roles leaves them alone.
REALM_DEFAULTS = ("default-roles-pcsmcpl", "offline_access", "uma_authorization")

ICMS_ROLE_NAMES = (
    "super-admin", "pcs-nodal-officer", "field-surveyor", "ada-project-lead",
)

# A realm-management role. It exists here only so that a test can send it and
# watch the endpoint refuse it rather than pass it through to Keycloak.
FORBIDDEN_ROLE = "realm-admin"

SEEDED = (
    (SUPER_ADMIN_ID, "super.admin", "Super", "Admin", "super-admin"),
    (NODAL_ID, "nodal.officer", "Nodal", "Officer", "pcs-nodal-officer"),
    (SURVEYOR_ID, "field.surveyor", "Field", "Surveyor", "field-surveyor"),
    (LEAD_ID, "project.lead", "Project", "Lead", "ada-project-lead"),
)

CREATED_AT_MS = 1_758_000_000_000


class FakeKeycloak:
    """An in-memory realm with the four seeded officers."""

    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.role_mappings: dict[str, set[str]] = {}
        self.credentials: dict[str, bool] = {}
        self.calls: list[str] = []
        # Set to an ApiError to make every call fail, as a Keycloak outage does.
        self.unavailable: ApiError | None = None
        self._ids = (f"11111111-0000-4000-8000-{n:012d}" for n in itertools.count(1))

        self.roles = [
            {"id": f"role-{index}", "name": name}
            for index, name in enumerate(
                (*ICMS_ROLE_NAMES, *REALM_DEFAULTS, FORBIDDEN_ROLE)
            )
        ]

        for user_id, username, first, last, role in SEEDED:
            self.users[user_id] = {
                "id": user_id,
                "username": username,
                "firstName": first,
                "lastName": last,
                "email": f"{username}@example.invalid",
                "enabled": True,
                "emailVerified": True,
                "createdTimestamp": CREATED_AT_MS,
                "requiredActions": ["CONFIGURE_TOTP"],
            }
            self.role_mappings[user_id] = {role, "default-roles-pcsmcpl"}

    # Every entry point passes through here, so one flag turns the whole realm off.
    def _record(self, what: str) -> None:
        self.calls.append(what)
        if self.unavailable is not None:
            raise self.unavailable

    # ------------------------------------------------------------------ users
    def count_users(self, *, search: str | None = None) -> int:
        self._record("count_users")
        return len(self._matching(search))

    def list_users(
        self, *, first: int, max_results: int, search: str | None = None
    ) -> list[dict]:
        self._record("list_users")
        rows = self._matching(search)
        return [dict(row) for row in rows[first:first + max_results]]

    def _matching(self, search: str | None) -> list[dict]:
        rows = sorted(self.users.values(), key=lambda row: row["username"])
        if not search:
            return rows
        needle = search.lower()
        return [
            row for row in rows
            if any(
                needle in str(row.get(key) or "").lower()
                for key in ("username", "firstName", "lastName", "email")
            )
        ]

    def get_user(self, user_id: str) -> dict | None:
        self._record(f"get_user {user_id}")
        found = self.users.get(user_id)
        return dict(found) if found else None

    def find_by_username(self, username: str) -> dict | None:
        self._record("find_by_username")
        return next(
            (dict(row) for row in self.users.values() if row["username"] == username),
            None,
        )

    def create_user(self, payload: dict) -> str:
        self._record("create_user")
        for row in self.users.values():
            if row["username"] == payload["username"]:
                raise KeycloakConflict("User exists with same username")
            if payload.get("email") and row.get("email") == payload["email"]:
                raise KeycloakConflict("User exists with same email")

        user_id = next(self._ids)
        self.users[user_id] = {
            **payload,
            "id": user_id,
            "createdTimestamp": CREATED_AT_MS,
            # What the realm's default required actions do on a real create.
            "requiredActions": ["CONFIGURE_TOTP"],
        }
        self.role_mappings[user_id] = {"default-roles-pcsmcpl"}
        return user_id

    def update_user(self, user_id: str, payload: dict) -> None:
        self._record(f"update_user {user_id}")
        for other_id, row in self.users.items():
            if (other_id != user_id and payload.get("email")
                    and row.get("email") == payload["email"]):
                raise KeycloakConflict("User exists with same email")
        self.users[user_id] = {**self.users[user_id], **payload, "id": user_id}

    def reset_password(self, user_id: str, value: str, *, temporary: bool) -> None:
        self._record(f"reset_password {user_id}")
        if len(value) < 12:
            raise KeycloakRejected("Invalid password: minimum length 12.")
        # The value is deliberately not kept: a double that could hand it back is
        # one refactor away from a test asserting on a credential.
        self.credentials[user_id] = temporary
        if temporary:
            actions = set(self.users[user_id].get("requiredActions") or ())
            self.users[user_id]["requiredActions"] = sorted(actions | {"UPDATE_PASSWORD"})

    # ------------------------------------------------------------------ roles
    def realm_roles(self) -> list[dict]:
        self._record("realm_roles")
        return [dict(role) for role in self.roles]

    def user_realm_roles(self, user_id: str) -> list[dict]:
        self._record(f"user_realm_roles {user_id}")
        held = self.role_mappings.get(user_id, set())
        return [dict(role) for role in self.roles if role["name"] in held]

    def role_members(self, role_name: str, *, limit: int = 200) -> list[dict]:
        self._record(f"role_members {role_name}")
        return [
            dict(self.users[user_id])
            for user_id, held in sorted(self.role_mappings.items())
            if role_name in held and user_id in self.users
        ][:limit]

    def add_realm_roles(self, user_id: str, roles: list[dict]) -> None:
        if not roles:
            return
        self._record(f"add_realm_roles {user_id}")
        self.role_mappings.setdefault(user_id, set()).update(
            role["name"] for role in roles
        )

    def remove_realm_roles(self, user_id: str, roles: list[dict]) -> None:
        if not roles:
            return
        self._record(f"remove_realm_roles {user_id}")
        self.role_mappings.setdefault(user_id, set()).difference_update(
            role["name"] for role in roles
        )

    # ------------------------------------------------------------- test knobs
    def go_down(self) -> None:
        """Every subsequent call fails exactly as an unreachable Keycloak does."""
        self.unavailable = ApiError(503, "identity_unavailable", UNAVAILABLE)

    def roles_of(self, user_id: str) -> set[str]:
        return set(self.role_mappings.get(user_id, set()))

    def called(self, prefix: str) -> list[str]:
        return [call for call in self.calls if call.startswith(prefix)]


# Fails only at the named call, so "roles were assigned and then Keycloak stopped
# answering" is expressible without timing anything.
class FailAt(FakeKeycloak):
    def __init__(self, failing_call: str) -> None:
        super().__init__()
        self._failing_call = failing_call

    def _record(self, what: str) -> None:
        self.calls.append(what)
        if what.startswith(self._failing_call):
            raise ApiError(503, "identity_unavailable", UNAVAILABLE)
        if self.unavailable is not None:
            raise self.unavailable


def any_representation(**overrides: Any) -> dict:
    """A Keycloak user representation, for a test that needs one directly."""
    return {
        "id": "99999999-0000-4000-8000-000000000099",
        "username": "sample.officer",
        "firstName": "Sample",
        "lastName": "Officer",
        "email": "sample.officer@example.invalid",
        "enabled": True,
        "emailVerified": False,
        "createdTimestamp": CREATED_AT_MS,
        "requiredActions": ["CONFIGURE_TOTP"],
        **overrides,
    }
