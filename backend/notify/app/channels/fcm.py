"""Android push over FCM HTTP v1, authenticated with a service-account JSON."""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
import jwt
import structlog

from app.channels.base import Outgoing, PermanentError, RetryableError, SendResult

logger = structlog.get_logger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"  # noqa: S105 — a URL, not a secret
SEND_URL = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"

# Error codes that mean the registration token itself is dead or foreign.
_DEAD_TOKEN_CODES = frozenset({"UNREGISTERED", "SENDER_ID_MISMATCH"})


# Must match the channel the app creates at startup (app/src/services/push/constants.ts).
ANDROID_CHANNEL_ID = "case-updates"

class CredentialsError(Exception):
    """A push credential file is missing or unusable."""


def redact_token(token: str) -> str:
    return f"{token[:6]}…({len(token)})"


def retry_after_seconds(headers: httpx.Headers) -> float | None:
    """Retry-After as seconds; the HTTP-date form is ignored in favour of the ladder."""
    value = headers.get("retry-after")
    if not value:
        return None
    try:
        return max(float(value), 0.0)
    except ValueError:
        return None


def load_service_account(path: str) -> dict:
    """Read and sanity-check a Google service-account JSON file."""
    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CredentialsError(f"cannot read FCM service account at {path}: {exc}") from exc
    missing = [k for k in ("client_email", "private_key") if not document.get(k)]
    if missing:
        raise CredentialsError(f"FCM service account at {path} lacks {', '.join(missing)}")
    return document


class FcmSender:
    """Sends one message to one Android registration token."""

    def __init__(
        self,
        *,
        project_id: str,
        service_account: dict,
        timeout: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._project_id = project_id
        self._account = service_account
        self._token_uri = service_account.get("token_uri") or DEFAULT_TOKEN_URI
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0))
        self._access_token: str | None = None
        self._access_expires_at = 0.0

    # Mint (or reuse) an OAuth2 access token; refreshed five minutes before expiry.
    async def _bearer(self) -> str:
        if self._access_token and time.monotonic() < self._access_expires_at:
            return self._access_token
        now = int(time.time())
        key_id = self._account.get("private_key_id")
        assertion = jwt.encode(
            {
                "iss": self._account["client_email"],
                "scope": FCM_SCOPE,
                "aud": self._token_uri,
                "iat": now,
                "exp": now + 3600,
            },
            self._account["private_key"],
            algorithm="RS256",
            headers={"kid": key_id} if key_id else None,
        )
        try:
            response = await self._client.post(
                self._token_uri,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
        except httpx.HTTPError as exc:
            raise RetryableError(f"FCM OAuth token request failed: {exc}") from exc
        if response.status_code != 200:
            # A rejected service account is an operator fix, not a dead message.
            raise RetryableError(
                f"FCM OAuth token request returned {response.status_code}: {response.text[:300]}",
                retry_after=retry_after_seconds(response.headers),
            )
        document = response.json()
        self._access_token = str(document["access_token"])
        lifetime = int(document.get("expires_in", 3600))
        self._access_expires_at = time.monotonic() + max(lifetime - 300, 30)
        return self._access_token

    def _body(self, message: Outgoing) -> dict:
        notification: dict[str, str] = {"body": message.body}
        if message.subject:
            notification["title"] = message.subject
        return {
            "message": {
                "token": message.to,
                "notification": notification,
                "data": {k: str(v) for k, v in message.data.items()},
                "android": {"priority": "HIGH", "notification": {"channel_id": ANDROID_CHANNEL_ID}},
            }
        }

    async def send(self, message: Outgoing) -> SendResult:
        bearer = await self._bearer()
        try:
            response = await self._client.post(
                SEND_URL.format(project_id=self._project_id),
                headers={"Authorization": f"Bearer {bearer}"},
                json=self._body(message),
            )
        except httpx.HTTPError as exc:
            raise RetryableError(f"FCM transport error: {exc}") from exc

        if response.status_code == 200:
            name = str(response.json().get("name") or "")
            logger.info("push_sent", provider="fcm", token=redact_token(message.to), name=name)
            return SendResult(provider_message_id=name or None)

        raise self._classify(response)

    # Map an FCM error response onto the retryable/permanent split.
    def _classify(self, response: httpx.Response) -> RetryableError | PermanentError:
        status = response.status_code
        try:
            error = response.json().get("error") or {}
        except ValueError:
            error = {}
        text = f"FCM {status} {error.get('status', '')}: {str(error.get('message', ''))[:300]}"

        codes: set[str] = set()
        token_field = False
        for detail in error.get("details") or []:
            if code := detail.get("errorCode"):
                codes.add(str(code))
            for violation in detail.get("fieldViolations") or []:
                if "token" in str(violation.get("field", "")):
                    token_field = True
        if error.get("status"):
            codes.add(str(error["status"]))

        if codes & _DEAD_TOKEN_CODES:
            return PermanentError(text, invalid_address=True)
        if status == 400 and "INVALID_ARGUMENT" in codes:
            names_token = token_field or "registration token" in text.lower()
            return PermanentError(text, invalid_address=names_token)
        if status == 401:
            self._access_token = None
            return RetryableError(text)
        if status == 429 or status >= 500:
            return RetryableError(text, retry_after=retry_after_seconds(response.headers))
        if status == 403 or "THIRD_PARTY_AUTH_ERROR" in codes:
            # Credential or project configuration: an operator fix, so retry.
            return RetryableError(text)
        return PermanentError(text)

    async def close(self) -> None:
        await self._client.aclose()
