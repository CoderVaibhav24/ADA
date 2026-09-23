"""iOS push over APNs HTTP/2, token-based auth with a .p8 signing key."""

from __future__ import annotations

import time
from pathlib import Path

import httpx
import jwt
import structlog

from app.channels.base import Outgoing, PermanentError, RetryableError, SendResult
from app.channels.fcm import CredentialsError, redact_token, retry_after_seconds

logger = structlog.get_logger(__name__)

HOSTS = {
    "production": "https://api.push.apple.com",
    "sandbox": "https://api.sandbox.push.apple.com",
}

# Apple rejects provider tokens older than an hour and throttles refreshes more
# often than every twenty minutes; fifty minutes sits inside both.
PROVIDER_TOKEN_SECONDS = 50 * 60

_DEAD_TOKEN_REASONS = frozenset({"BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"})
_PROVIDER_TOKEN_REASONS = frozenset(
    {"ExpiredProviderToken", "InvalidProviderToken", "MissingProviderToken"}
)


def load_signing_key(path: str) -> str:
    """Read the APNs .p8 (PKCS#8 EC P-256) key as PEM text."""
    try:
        pem = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise CredentialsError(f"cannot read APNs key at {path}: {exc}") from exc
    if "PRIVATE KEY" not in pem:
        raise CredentialsError(f"APNs key at {path} is not a PEM private key")
    return pem


class ApnsSender:
    """Sends one alert to one iOS device token, choosing the host per device."""

    def __init__(
        self,
        *,
        signing_key: str,
        key_id: str,
        team_id: str,
        bundle_id: str,
        timeout: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._signing_key = signing_key
        self._key_id = key_id
        self._team_id = team_id
        self._bundle_id = bundle_id
        # HTTP/2 is mandatory for APNs; httpx needs the h2 extra for it.
        self._client = client or httpx.AsyncClient(
            http2=True, timeout=httpx.Timeout(timeout, connect=5.0)
        )
        self._provider_token: str | None = None
        self._provider_token_at = 0.0

    # The ES256 provider JWT, reused until it is fifty minutes old.
    def _bearer(self) -> str:
        age = time.monotonic() - self._provider_token_at
        if self._provider_token and age < PROVIDER_TOKEN_SECONDS:
            return self._provider_token
        self._provider_token = jwt.encode(
            {"iss": self._team_id, "iat": int(time.time())},
            self._signing_key,
            algorithm="ES256",
            headers={"kid": self._key_id},
        )
        self._provider_token_at = time.monotonic()
        return self._provider_token

    def _payload(self, message: Outgoing) -> dict:
        alert: dict[str, str] = {"body": message.body}
        if message.subject:
            alert["title"] = message.subject
        return {"aps": {"alert": alert, "sound": "default"}, **message.data}

    async def send(self, message: Outgoing) -> SendResult:
        environment = (message.push.apns_environment if message.push else None) or "production"
        host = HOSTS.get(environment)
        if host is None:
            raise PermanentError(f"unknown APNs environment '{environment}'")

        headers = {
            "authorization": f"bearer {self._bearer()}",
            "apns-topic": self._bundle_id,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "apns-expiration": str(int(time.time()) + 24 * 3600),
        }
        if message.delivery_id:
            # Our delivery id doubles as the apns-id, so Apple's logs and ours agree.
            headers["apns-id"] = str(message.delivery_id)

        try:
            response = await self._client.post(
                f"{host}/3/device/{message.to}", headers=headers, json=self._payload(message)
            )
        except httpx.HTTPError as exc:
            raise RetryableError(f"APNs transport error: {exc}") from exc

        if response.status_code == 200:
            apns_id = response.headers.get("apns-id") or headers.get("apns-id")
            logger.info(
                "push_sent",
                provider="apns",
                environment=environment,
                token=redact_token(message.to),
                apns_id=apns_id,
            )
            return SendResult(provider_message_id=apns_id)

        raise self._classify(response)

    # Map an APNs error response onto the retryable/permanent split.
    def _classify(self, response: httpx.Response) -> RetryableError | PermanentError:
        status = response.status_code
        try:
            reason = str(response.json().get("reason") or "")
        except ValueError:
            reason = ""
        text = f"APNs {status} {reason}".strip()

        if status == 410 or reason in _DEAD_TOKEN_REASONS:
            return PermanentError(text, invalid_address=True)
        if status == 403:
            if reason in _PROVIDER_TOKEN_REASONS:
                self._provider_token = None
            # Key, team or topic configuration: an operator fix, so retry.
            return RetryableError(text)
        if status == 429 or status >= 500:
            return RetryableError(text, retry_after=retry_after_seconds(response.headers))
        return PermanentError(text)

    async def close(self) -> None:
        await self._client.aclose()
