"""Turning a Keycloak subject into an address.

A recipient is a `kc_sub` and nothing else (AD-8), which is the right thing for a
caller to pass — HRMS knows who a leave request belongs to, and should not have
to know their current email address. But email needs an address, so somebody has
to make the translation, and this is it.

## Why not a column

Because the address would be a copy, and a copy drifts. Someone changes their
email in Keycloak, every stored copy is now wrong, and the failure is silent:
mail keeps being delivered, to the old address. Keycloak owns the account, so
Keycloak is asked.

The cost is a lookup on the fan-out path, which is why there is a cache. The
cache is short and in-process on purpose — long enough to collapse a burst of
notifications to one person, short enough that an address change takes effect
within minutes rather than at the next restart.

## Retryable versus permanent

The distinction is load-bearing, and it is made here rather than by the caller:

  * no such user, or no address on the account — permanent. Retrying for an hour
    will not conjure an address, and the delivery should fail now with a reason
    somebody can act on.
  * Keycloak unreachable, 5xx, timeout, or a missing role — retryable. The
    address may well exist; we could not read it this second.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

import httpx
import structlog

from app.config import Settings

logger = structlog.get_logger(__name__)


class RecipientNotFound(Exception):
    """No such subject, or the account carries nothing to deliver to. Permanent."""


class DirectoryUnavailable(Exception):
    """Keycloak could not be asked. Retryable — nothing is known to be wrong."""


@dataclass(frozen=True)
class RecipientProfile:
    subject: uuid.UUID
    email: str | None
    email_verified: bool
    first_name: str
    last_name: str
    username: str
    locale: str | None

    def address_for(self, channel: str) -> str:
        if channel == "email":
            if not self.email:
                raise RecipientNotFound(
                    f"user {self.subject} has no email address on their Keycloak account"
                )
            return self.email
        # Reached only if a channel is enabled at the API boundary before this
        # function learns how to address it, which would otherwise present as an
        # empty address and an unhelpful provider rejection.
        raise RecipientNotFound(f"no address resolver for channel '{channel}'")


class RecipientDirectory:
    """Reads user accounts from Keycloak's admin API, with a short cache.

    The service account used here needs the realm-management `view-users` role.
    Without it Keycloak answers 403, which this reports as unavailable rather
    than as a missing user — a permissions mistake must not be recorded as "this
    person does not exist".
    """

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._cache: dict[uuid.UUID, tuple[float, RecipientProfile]] = {}
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    async def _access_token(self) -> str:
        # Reused until shortly before expiry. A token request per lookup would put
        # a second Keycloak round trip on every delivery, and Keycloak issues
        # these with a lifetime measured in minutes.
        if self._token and time.monotonic() < self._token_expires_at:
            return self._token

        if not self._settings.admin_client_secret:
            raise DirectoryUnavailable(
                "ADA_ADMIN_CLIENT_SECRET is not set, so recipient addresses "
                "cannot be read from Keycloak"
            )

        try:
            response = await self._client.post(
                self._settings.token_endpoint,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._settings.admin_client_id,
                    "client_secret": self._settings.admin_client_secret,
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise DirectoryUnavailable(f"could not obtain an admin token: {exc}") from exc

        document = response.json()
        self._token = document["access_token"]
        # Thirty seconds of headroom. A token that expires in flight produces a
        # 401 that looks exactly like a misconfigured client.
        self._token_expires_at = time.monotonic() + max(int(document.get("expires_in", 60)) - 30, 5)
        return self._token

    async def resolve(self, subject: uuid.UUID) -> RecipientProfile:
        cached = self._cache.get(subject)
        if cached and time.monotonic() < cached[0]:
            return cached[1]

        token = await self._access_token()
        url = f"{self._settings.server_base}/admin/realms/{self._settings.realm}/users/{subject}"

        try:
            response = await self._client.get(url, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            raise DirectoryUnavailable(f"Keycloak admin API unreachable: {exc}") from exc

        if response.status_code == 404:
            raise RecipientNotFound(f"no user {subject} in realm '{self._settings.realm}'")

        if response.status_code in (401, 403):
            # A permissions problem, not a missing person. Reported as unavailable
            # so the delivery retries rather than being marked permanently failed
            # against an account that is perfectly fine.
            self._token = None
            raise DirectoryUnavailable(
                f"Keycloak refused the admin lookup ({response.status_code}). "
                f"Does the '{self._settings.admin_client_id}' service account hold "
                "the realm-management 'view-users' role?"
            )

        if response.status_code >= 400:
            raise DirectoryUnavailable(
                f"Keycloak admin API returned {response.status_code} for user {subject}"
            )

        document = response.json()
        attributes = document.get("attributes") or {}
        locale = attributes.get("locale")
        if isinstance(locale, list):  # Keycloak returns user attributes as lists
            locale = locale[0] if locale else None

        profile = RecipientProfile(
            subject=subject,
            email=document.get("email") or None,
            email_verified=bool(document.get("emailVerified")),
            first_name=document.get("firstName") or "",
            last_name=document.get("lastName") or "",
            username=document.get("username") or "",
            locale=locale,
        )

        self._cache[subject] = (time.monotonic() + self._settings.recipient_cache_seconds, profile)
        return profile

    def forget(self, subject: uuid.UUID) -> None:
        """Drop one cached profile — after a delivery failed on its address."""
        self._cache.pop(subject, None)
