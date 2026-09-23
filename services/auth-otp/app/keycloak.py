"""Everything this service says to Keycloak.

Three conversations, and no others:

  1. Get a token for our own service account (client credentials).
  2. Find the account behind a phone number (admin API, needs view-users).
  3. Exchange our token for that account's token (needs impersonation).

## Why impersonation, and what it costs

A one-time code proves possession of a phone. It does not produce a Keycloak
session, and Keycloak has no built-in grant that says "this subject
authenticated by a means outside your knowledge". There are three ways to bridge
that, and only one of them is available here:

  * A custom Authenticator SPI, which is the correct answer and is Java.
    README.md rules it out before Phase 2, and it would put a JVM build in the
    path of every fork.
  * Write a credential we control onto the account and then use it — HRMS sets
    the user's password to a server-side nonce and does a direct grant. In
    ADA this is not merely inelegant, it is destructive: the same person's
    primary mechanism is password plus TOTP, and their password would be
    overwritten on every OTP login.
  * Token exchange with `requested_subject`, which mints a token for a subject
    without any credential of theirs. That is what happens below.

The cost is stated plainly because a fork inherits it:

  * `token-exchange:v1` is a PREVIEW feature in Keycloak 26.7.2. Standard token
    exchange (`token-exchange-standard:v2`) is the supported one and refuses
    `requested_subject` outright — "Parameter 'requested_subject' is not
    supported for standard token exchange" — so the preview feature is the only
    one that does this. Preview features are unsupported and may change between
    Keycloak releases; a Keycloak upgrade must re-verify this path.
  * The service account holds `impersonation`, which mints a user token for ANY
    subject in the realm. This service's client is the only holder, it is
    confidential, and it has no browser flow. Do not reuse that client.
  * An exchanged token is a first factor only. TOTP is not evaluated on this
    path — there is no browser flow to prompt in — so an application that
    requires two factors must not accept OTP alone. Password plus TOTP through
    the standard flow remains the two-factor mechanism.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
import structlog

from app.config import Settings

logger = structlog.get_logger(__name__)


def _mask(email: str) -> str:
    """a***@example.com — enough to recognise, not enough to harvest.

    Log lines outlive the incident they were written for, and an address is
    personal data in a way a subject id is not.
    """
    local, _, domain = email.partition("@")
    head = local[:1] if local else ""
    return f"{head}***@{domain}" if domain else "***"

_TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"  # noqa: S105
_ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"  # noqa: S105


class DirectoryUnavailable(Exception):
    """Keycloak could not be asked, or refused us. Never the user's fault.

    Reported as 503. A permissions mistake on our service account must not be
    recorded as "this number is not registered" — that sends the operator
    looking at the wrong thing entirely.
    """


class SubjectNotFound(Exception):
    """No enabled account carries that phone number."""


class RefreshRejected(Exception):
    """Keycloak rejected the refresh token outright. The client should log out."""


@dataclass(frozen=True)
class UserTokens:
    access_token: str
    refresh_token: str | None
    expires_in: int | None


@dataclass(frozen=True)
class Subject:
    id: str
    username: str
    enabled: bool


class KeycloakGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    # --- Our own token ------------------------------------------------------

    async def _service_token(self) -> str:
        # Reused until shortly before expiry. A token request per login would put
        # a second Keycloak round trip in front of every OTP.
        if self._token and time.monotonic() < self._token_expires_at:
            return self._token

        if not self._settings.auth_client_secret:
            raise DirectoryUnavailable(
                "ADA_AUTH_CLIENT_SECRET is not set, so this service cannot "
                "authenticate to Keycloak"
            )

        try:
            response = await self._client.post(
                self._settings.token_endpoint,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._settings.auth_client_id,
                    "client_secret": self._settings.auth_client_secret,
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise DirectoryUnavailable(f"could not obtain a service token: {exc}") from exc

        document = response.json()
        self._token = document["access_token"]
        # Thirty seconds of headroom. A token that expires in flight produces a
        # 401 indistinguishable from a misconfigured client secret.
        self._token_expires_at = time.monotonic() + max(int(document.get("expires_in", 60)) - 30, 5)
        return self._token

    def _forget_service_token(self) -> None:
        self._token = None
        self._token_expires_at = 0.0

    # --- Finding the account behind a number -------------------------------

    async def find_subject_by_email(self, email: str) -> Subject:
        """Resolve an email address to exactly one enabled Keycloak account.

        Simpler than the phone lookup, because email is a first-class Keycloak
        field rather than an attribute: one exact search, no username fallback.
        The realm sets duplicateEmailsAllowed=false, so more than one hit means
        the realm's own constraint has been bypassed — refused rather than
        resolved, for the same reason two accounts sharing a number are.
        """
        candidates = await self._search_users({"email": email, "exact": "true"})
        enabled = [user for user in candidates if user.get("enabled") is not False]

        if not enabled:
            raise SubjectNotFound(f"no enabled account carries the address {_mask(email)}")

        if len(enabled) > 1:
            logger.error(
                "otp_email_ambiguous",
                email=_mask(email),
                count=len(enabled),
                subject_ids=[user.get("id") for user in enabled],
            )
            raise DirectoryUnavailable(
                f"{len(enabled)} accounts share this email address; "
                "resolve the duplicate in Keycloak before OTP login can work"
            )

        user = enabled[0]
        return Subject(
            id=user["id"],
            username=user.get("username") or "",
            enabled=user.get("enabled") is not False,
        )

    async def find_subject_by_phone(self, phone: str) -> Subject:
        """Resolve a phone number to exactly one enabled Keycloak account.

        Two lookups, in order: the configured phone attribute, then an exact
        username match. The second exists because an account migrated from HRMS
        has the number as its username and no attribute at all.
        """
        attribute = self._settings.otp_phone_attribute
        candidates = await self._search_users({"q": f"{attribute}:{phone}"})
        if not candidates:
            candidates = await self._search_users({"username": phone, "exact": "true"})

        enabled = [user for user in candidates if user.get("enabled") is not False]

        if not enabled:
            raise SubjectNotFound(f"no enabled account carries phone ending {phone[-4:]}")

        if len(enabled) > 1:
            # Refused rather than resolved. Two accounts sharing a number means
            # the code would authenticate whichever the search happened to
            # return first, and that is a silent account mix-up. It is a data
            # problem, and it has to be fixed in Keycloak.
            logger.error(
                "otp_phone_ambiguous",
                phone_suffix=phone[-4:],
                count=len(enabled),
                subject_ids=[user.get("id") for user in enabled],
            )
            raise DirectoryUnavailable(
                f"{len(enabled)} accounts share this phone number; "
                "resolve the duplicate in Keycloak before OTP login can work"
            )

        user = enabled[0]
        return Subject(
            id=user["id"],
            username=user.get("username") or "",
            enabled=user.get("enabled") is not False,
        )

    async def _search_users(self, params: dict[str, str]) -> list[dict]:
        token = await self._service_token()
        try:
            response = await self._client.get(
                self._settings.admin_users_url,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            raise DirectoryUnavailable(f"Keycloak admin API unreachable: {exc}") from exc

        if response.status_code in (401, 403):
            self._forget_service_token()
            raise DirectoryUnavailable(
                f"Keycloak refused the user search ({response.status_code}). Does the "
                f"'{self._settings.auth_client_id}' service account hold the "
                "realm-management 'view-users' role?"
            )

        if response.status_code >= 400:
            raise DirectoryUnavailable(
                f"Keycloak admin API returned {response.status_code} for a user search"
            )

        document = response.json()
        return document if isinstance(document, list) else []

    # --- Minting the user's tokens -----------------------------------------

    async def exchange_for_subject(self, subject_id: str) -> UserTokens:
        """Mint an access and refresh token for a subject, with no credential.

        Requires the `token-exchange:v1` feature on the Keycloak server and the
        `impersonation` role on this client's service account. Both are set up by
        keycloak/realm-pcsmcpl.json and the --features flag in
        infra/compose/docker-compose.yml; the failure when either is missing is a 400
        unsupported grant or a 403 "Client not allowed to exchange", and both are
        surfaced verbatim below rather than flattened into a generic error.
        """
        subject_token = await self._service_token()

        data = {
            "grant_type": _TOKEN_EXCHANGE_GRANT,
            "client_id": self._settings.auth_client_id,
            "client_secret": self._settings.auth_client_secret,
            "subject_token": subject_token,
            "subject_token_type": _ACCESS_TOKEN_TYPE,
            "requested_subject": subject_id,
        }
        if self._settings.exchange_audience:
            data["audience"] = self._settings.exchange_audience

        try:
            response = await self._client.post(self._settings.token_endpoint, data=data)
        except httpx.HTTPError as exc:
            raise DirectoryUnavailable(f"Keycloak token endpoint unreachable: {exc}") from exc

        if response.status_code >= 400:
            self._forget_service_token()
            logger.error(
                "token_exchange_failed",
                status=response.status_code,
                # The body names which of the two prerequisites is missing, and
                # losing it turns a five-minute fix into an afternoon.
                body=response.text[:500],
                subject_id=subject_id,
            )
            raise DirectoryUnavailable(
                f"Keycloak refused the token exchange ({response.status_code}). "
                "Check that the server runs with --features=token-exchange:v1 and "
                f"that the '{self._settings.auth_client_id}' service account holds "
                "realm-management 'impersonation'."
            )

        return _tokens_from(response.json())

    async def refresh(self, refresh_token: str) -> UserTokens:
        """Exchange a refresh token for a new pair.

        A failure here has to distinguish a genuinely dead token — the client
        should log out — from a transient one. Blanket-401 on any error throws
        away valid long-lived sessions every time Keycloak restarts, so only a
        real rejection is a 401 and everything else is retried and then reported
        as unavailable, which leaves the client's session intact.
        """
        data = {
            "grant_type": "refresh_token",
            "client_id": self._settings.auth_client_id,
            "client_secret": self._settings.auth_client_secret,
            "refresh_token": refresh_token,
        }

        try:
            response = await self._client.post(self._settings.token_endpoint, data=data)
        except httpx.HTTPError as exc:
            raise DirectoryUnavailable(f"Keycloak token endpoint unreachable: {exc}") from exc

        if response.status_code in (400, 401):
            raise RefreshRejected(response.json().get("error_description", "invalid_grant"))

        if response.status_code >= 400:
            raise DirectoryUnavailable(
                f"Keycloak returned {response.status_code} for a refresh"
            )

        return _tokens_from(response.json())

    async def logout(self, refresh_token: str) -> None:
        """Revoke a refresh token at Keycloak.

        Never raises. A logout that fails still has to end as a logout on the
        client — refusing it would leave the caller holding tokens it believes
        are live, which is strictly worse than a session that lingers in
        Keycloak until it expires on its own.
        """
        try:
            response = await self._client.post(
                self._settings.logout_endpoint,
                data={
                    "client_id": self._settings.auth_client_id,
                    "client_secret": self._settings.auth_client_secret,
                    "refresh_token": refresh_token,
                },
            )
            if response.status_code >= 400:
                logger.warning("logout_refused", status=response.status_code)
        except httpx.HTTPError as exc:
            logger.warning("logout_unreachable", error=str(exc))


def _tokens_from(document: dict) -> UserTokens:
    return UserTokens(
        access_token=document["access_token"],
        refresh_token=document.get("refresh_token"),
        expires_in=document.get("expires_in"),
    )
