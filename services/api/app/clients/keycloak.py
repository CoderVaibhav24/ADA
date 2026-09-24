"""Keycloak's Admin API, as ada-api's user store.

There is no local users table and no mirror of one. An officer is a row in
Keycloak and nowhere else, so every read here is a network call into a system
that can be down while PostgreSQL is fine — which is the whole reason this
module exists rather than a repository.

Three consequences shape it:

  * The service-account token is cached. Minting one per request is a round
    trip to Keycloak before the round trip you wanted. A 401 from Keycloak
    re-mints once and retries, because a token that expired between the check
    and the call is ordinary rather than an error.
  * Every failure to reach Keycloak is a 503 in the project envelope. Not a 500,
    which says ada-api is broken, and never a hang: there is an explicit timeout.
  * Nothing here logs a password, a client secret or a token. Those values pass
    through as request bodies and are never formatted into a message.

It authenticates as ada-api's own confidential client, whose service account
holds view-users, query-users, manage-users and view-realm. Not the bootstrap
admin: that account can administer every realm on the server.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any
from urllib.parse import quote

import httpx
from ada_platform.requestid import outbound_headers

from ..config import settings
from ..errors import ApiError

log = logging.getLogger("ada.api.keycloak")

__all__ = [
    "KeycloakAdmin",
    "KeycloakConflict",
    "KeycloakRejected",
    "get_admin_client",
    "reset_admin_client",
]

UNAVAILABLE = (
    "The identity service is not reachable, so officers cannot be read or "
    "changed right now."
)

# Refresh this far before the token actually expires. A token that is valid when
# checked and expired when it arrives is the failure this margin buys off.
_EXPIRY_SKEW_SECONDS = 30.0


class KeycloakConflict(Exception):
    """Keycloak answered 409 — a username or email already belongs to somebody."""


class KeycloakRejected(Exception):
    """Keycloak answered 400 — usually the realm's password policy."""


# A shared, mutable token behind a lock: FastAPI runs these `def` endpoints in a
# threadpool, so two requests really can mint at the same moment.
class _ServiceToken:
    def __init__(self) -> None:
        self._value = ""
        self._expires_at = 0.0
        self._lock = threading.Lock()

    def current(self) -> str | None:
        with self._lock:
            if self._value and time.monotonic() < self._expires_at:
                return self._value
            return None

    def store(self, value: str, lifetime: float) -> None:
        with self._lock:
            self._value = value
            self._expires_at = time.monotonic() + max(lifetime - _EXPIRY_SKEW_SECONDS, 1.0)

    def clear(self) -> None:
        with self._lock:
            self._value = ""
            self._expires_at = 0.0


class KeycloakAdmin:
    """The subset of the Admin API this service is entitled to use."""

    def __init__(
        self,
        base_url: str,
        realm: str,
        client_id: str,
        client_secret: str,
        *,
        timeout: float,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.realm = realm
        self._client_id = client_id
        self._client_secret = client_secret
        self._timeout = timeout
        self._http = client or httpx.Client(timeout=timeout)
        self._token = _ServiceToken()

    # ------------------------------------------------------------------ token
    def _mint(self) -> str:
        url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token"
        try:
            response = self._http.post(
                url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
                headers=outbound_headers(),
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            log.error("cannot reach Keycloak's token endpoint: %s", exc)
            raise ApiError(503, "identity_unavailable", UNAVAILABLE) from exc

        if response.status_code != 200:
            # error_description names the misconfiguration and goes to the log,
            # never to the client — it is about our credentials, not theirs.
            log.error(
                "Keycloak refused ada-api's client credentials: HTTP %s %s",
                response.status_code, response.text[:300],
            )
            raise ApiError(503, "identity_unavailable", UNAVAILABLE)

        payload = response.json()
        self._token.store(payload["access_token"], float(payload.get("expires_in", 60)))
        return payload["access_token"]

    def _bearer(self, *, refresh: bool = False) -> str:
        if refresh:
            self._token.clear()
            return self._mint()
        return self._token.current() or self._mint()

    # ------------------------------------------------------------------- call
    # One 401 retry and no more: a second 401 with a fresh token is a role the
    # service account does not hold, and retrying that forever is a busy loop.
    def _call(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict | None = None,
        forbidden: str | None = None,
    ) -> httpx.Response:
        url = f"{self.base_url}/admin/realms/{self.realm}{path}"
        response = self._send(method, url, json=json, params=params, bearer=self._bearer())
        if response.status_code == 401:
            response = self._send(
                method, url, json=json, params=params, bearer=self._bearer(refresh=True)
            )

        status = response.status_code
        if status < 400 or status == 404:
            return response
        if status == 409:
            raise KeycloakConflict(_message_of(response))
        if status == 400:
            raise KeycloakRejected(_message_of(response))
        if status == 403 and forbidden:
            raise ApiError(503, "identity_admin_forbidden", forbidden)

        log.error("Keycloak answered %s to %s %s: %s", status, method, path,
                  response.text[:300])
        raise ApiError(503, "identity_unavailable", UNAVAILABLE)

    def _send(
        self, method: str, url: str, *, json: Any, params: dict | None, bearer: str
    ) -> httpx.Response:
        try:
            return self._http.request(
                method,
                url,
                json=json,
                params=params,
                headers={"Authorization": f"Bearer {bearer}", **outbound_headers()},
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            log.error("cannot reach Keycloak for %s %s: %s", method, url, exc)
            raise ApiError(503, "identity_unavailable", UNAVAILABLE) from exc

    # ------------------------------------------------------------------ users
    def count_users(self, *, search: str | None = None) -> int:
        params = {"search": search} if search else None
        return int(self._call("GET", "/users/count", params=params).json())

    def list_users(
        self, *, first: int, max_results: int, search: str | None = None
    ) -> list[dict]:
        params: dict[str, Any] = {"first": first, "max": max_results}
        if search:
            params["search"] = search
        return self._call("GET", "/users", params=params).json()

    def get_user(self, user_id: str) -> dict | None:
        response = self._call("GET", f"/users/{quote(user_id, safe='')}")
        return None if response.status_code == 404 else response.json()

    # Keycloak returns the new id in Location and nothing in the body, so a
    # failure to read it back is a user that exists with no id to act on.
    def create_user(self, payload: dict) -> str:
        response = self._call("POST", "/users", json=payload)
        location = response.headers.get("Location", "")
        user_id = location.rstrip("/").rsplit("/", 1)[-1] if location else ""
        if user_id:
            return user_id
        found = self.find_by_username(payload["username"])
        if found is None:
            raise ApiError(
                503,
                "identity_unavailable",
                "Keycloak accepted the officer but did not say which id it gave them.",
            )
        return found["id"]

    def find_by_username(self, username: str) -> dict | None:
        rows = self._call(
            "GET", "/users", params={"username": username, "exact": "true"}
        ).json()
        return rows[0] if rows else None

    def update_user(self, user_id: str, payload: dict) -> None:
        self._call("PUT", f"/users/{quote(user_id, safe='')}", json=payload)

    def reset_password(self, user_id: str, value: str, *, temporary: bool) -> None:
        """temporary=true makes Keycloak add UPDATE_PASSWORD itself, so we do not."""
        self._call(
            "PUT",
            f"/users/{quote(user_id, safe='')}/reset-password",
            json={"type": "password", "value": value, "temporary": temporary},
        )

    # ------------------------------------------------------------------ roles
    def realm_roles(self) -> list[dict]:
        """Every realm role. Needs view-realm, which is why that role is granted."""
        return self._call("GET", "/roles", params={"briefRepresentation": "true"}).json()

    def realm_role(self, name: str) -> dict | None:
        response = self._call("GET", f"/roles/{quote(name, safe='')}")
        return None if response.status_code == 404 else response.json()

    def create_realm_role(self, name: str, description: str | None) -> None:
        """POST /roles. Needs manage-realm; a 409 means it already exists."""
        self._call(
            "POST", "/roles", json={"name": name, "description": description or ""},
            forbidden="ada-api may not create realm roles: its service account needs "
                      "realm-management manage-realm (infra/keycloak/apply-realm-config.sh).",
        )

    def user_realm_roles(self, user_id: str) -> list[dict]:
        response = self._call(
            "GET", f"/users/{quote(user_id, safe='')}/role-mappings/realm"
        )
        return [] if response.status_code == 404 else response.json()

    # Bounded rather than paginated: this answers "is anyone else holding the
    # door open", and a realm with more Super Admins than one page is not the
    # realm that is one edit from being locked out.
    def role_members(self, role_name: str, *, limit: int = 200) -> list[dict]:
        """The accounts this realm role is mapped to directly. Needs view-users."""
        response = self._call(
            "GET",
            f"/roles/{quote(role_name, safe='')}/users",
            params={"first": 0, "max": limit},
        )
        return [] if response.status_code == 404 else response.json()

    def add_realm_roles(self, user_id: str, roles: list[dict]) -> None:
        if not roles:
            return
        self._call(
            "POST",
            f"/users/{quote(user_id, safe='')}/role-mappings/realm",
            json=[{"id": role["id"], "name": role["name"]} for role in roles],
        )

    def remove_realm_roles(self, user_id: str, roles: list[dict]) -> None:
        if not roles:
            return
        self._call(
            "DELETE",
            f"/users/{quote(user_id, safe='')}/role-mappings/realm",
            json=[{"id": role["id"], "name": role["name"]} for role in roles],
        )

    # There is deliberately no delete_user. ICMS rows store the Keycloak subject
    # (icms_case.created_by, icms_case_assignment.assignee_user_id,
    # icms_evidence.uploaded_by, icms_case_event.actor_user_id,
    # icms_zone_assignment.user_id), and deleting the account orphans an audit
    # trail that has to stand up in an enforcement context. Officers are disabled.


def _message_of(response: httpx.Response) -> str:
    """Keycloak's own words for a 400 or 409, which name the offending field."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:200]
    if isinstance(body, dict):
        for key in ("errorMessage", "error_description", "error"):
            value = body.get(key)
            if isinstance(value, str) and value:
                return value
    return response.text[:200]


_singleton: KeycloakAdmin | None = None
_singleton_lock = threading.Lock()


# A module singleton rather than one per request: the point of the cache is that
# it outlives the request that filled it.
def get_admin_client() -> KeycloakAdmin:
    """The shared admin client. Refuses up front when no client secret is set."""
    global _singleton
    if not settings.oidc_admin_client_secret:
        raise ApiError(
            503,
            "identity_admin_not_configured",
            "Officer administration is not configured on this server: ada-api has "
            "no Keycloak client secret, so it cannot reach the user store.",
        )
    if _singleton is None:
        with _singleton_lock:
            if _singleton is None:
                base_url, realm = settings.keycloak_admin
                _singleton = KeycloakAdmin(
                    base_url,
                    realm,
                    settings.oidc_admin_client_id,
                    settings.oidc_admin_client_secret,
                    timeout=settings.keycloak_admin_timeout_seconds,
                )
    return _singleton


def reset_admin_client() -> None:
    """Drop the singleton, so a test or a re-read of settings starts clean."""
    global _singleton
    _singleton = None
