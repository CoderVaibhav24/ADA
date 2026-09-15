"""Sending a notification, without ever breaking the caller's request.

    notify = ADANotify()          # reads ADA_* from the environment

    outcome = notify.send(
        idempotency_key=f"leave-approved-{request.id}",
        recipient=user.subject,       # the Principal from ADAAuth
        template_key="leave-approved",
        payload={"first_name": user.username, "days": 3},
    )

## send() does not raise

This is the single most important behaviour in the SDK, and it is a deliberate
inversion of the usual advice about swallowing exceptions.

A notification is a side effect of something that already happened. The leave
request *is* approved; the row is committed. If ADA is unreachable at that
moment, raising would turn a successful approval into a 500, the user would retry,
and the approval would happen twice — a real failure caused entirely by the
mechanism for telling somebody about it.

So send() returns a SendOutcome. `accepted` is a boolean, and an application that
cares can log it or check it. An application that does not care can ignore the
return value and be correct.

The one thing send() will never do is fail silently *and* invisibly: every
non-accepted outcome is logged at warning with its reason.

## Idempotency is the caller's lever

The idempotency key is required, not generated. A generated key would make every
retry a new notification, which is precisely the duplicate-email problem the
server-side constraint exists to prevent. Use a natural key — the id of the thing
that happened. `f"leave-approved-{request.id}"` sent five times is one email.

## Retries here, and retries there

This retries the *submission* — network failures and 5xx, with backoff. It does
not retry a 4xx, because a rejected body will be rejected identically next time.

Retrying delivery is ADA's job and happens on the retry ladder inside the
worker. The two do not overlap: this one ends the moment ADA answers 202.
"""

from __future__ import annotations

import logging
import os
import random
import time
import uuid
from dataclasses import dataclass

import httpx

from ada_platform.errors import ADAConfigError
from ada_platform.tokens import MachineTokenSource

logger = logging.getLogger("ada_platform.notify")

# Short, because this runs inside somebody's request. Three attempts over about a
# second, then give up and let the caller carry on — ADA is not the thing the
# user is waiting for.
_MAX_ATTEMPTS = 3
_BASE_BACKOFF_SECONDS = 0.2


@dataclass(frozen=True)
class SendOutcome:
    """What happened when the notification was submitted.

    accepted is True only for a 202 — ADA has the notification durably and
    will deliver it. It is not a claim that anything has been delivered yet.
    """

    accepted: bool
    notification_id: uuid.UUID | None = None
    status_code: int | None = None
    error: str | None = None
    replayed: bool = False

    def __bool__(self) -> bool:
        return self.accepted


class ADANotify:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        issuer: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        timeout_seconds: float = 5.0,
        client: httpx.Client | None = None,
    ) -> None:
        base_url = base_url or os.environ.get("ADA_NOTIFY_URL", "")
        issuer = issuer or os.environ.get("ADA_ISSUER", "")
        client_id = client_id or os.environ.get("ADA_CLIENT_ID", "")
        client_secret = client_secret or os.environ.get("ADA_CLIENT_SECRET", "")

        missing = [
            name
            for name, value in (
                ("ADA_NOTIFY_URL", base_url),
                ("ADA_ISSUER", issuer),
                ("ADA_CLIENT_ID", client_id),
                ("ADA_CLIENT_SECRET", client_secret),
            )
            if not value
        ]
        if missing:
            raise ADAConfigError(
                "ADANotify is missing configuration: "
                + ", ".join(missing)
                + ". Pass them as arguments or set them in the environment."
            )

        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=timeout_seconds)
        self._tokens = MachineTokenSource(
            token_endpoint=f"{issuer.rstrip('/')}/protocol/openid-connect/token",
            client_id=client_id,
            client_secret=client_secret,
            client=self._client,
        )

    def send(
        self,
        *,
        idempotency_key: str,
        recipient: str | uuid.UUID,
        template_key: str,
        payload: dict | None = None,
        channels: list[str] | None = None,
        locale: str = "en",
    ) -> SendOutcome:
        """Submit one notification. Never raises."""
        body = {
            "idempotency_key": idempotency_key,
            # The closed recipient type (AD-8). Not an email address — ADA
            # reads the address from the account at delivery time, so a person
            # who changes it receives the next message at the new one and no
            # caller has to be told.
            "recipient": {"type": "kc_sub", "id": str(recipient)},
            "template_key": template_key,
            "locale": locale,
            "payload": payload or {},
            "channels": channels or ["email"],
        }

        last_error = "not attempted"
        last_status: int | None = None

        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                token = self._tokens.token()
            except Exception as exc:  # noqa: BLE001 — see the module docstring
                last_error = f"could not obtain a token: {exc}"
                logger.warning("ada: %s", last_error)
                break

            try:
                response = self._client.post(
                    f"{self._base_url}/v1/notifications",
                    json=body,
                    headers={"Authorization": f"Bearer {token}"},
                )
            except httpx.HTTPError as exc:
                last_error = f"transport error: {exc}"
                last_status = None
                if attempt < _MAX_ATTEMPTS:
                    self._backoff(attempt)
                    continue
                break

            last_status = response.status_code

            if response.status_code == 202:
                document = response.json()
                return SendOutcome(
                    accepted=True,
                    notification_id=uuid.UUID(document["id"]),
                    status_code=202,
                    # ADA marks a replayed idempotency key with this header.
                    # Surfaced because it is genuinely useful: it says the retry
                    # worked, rather than that a second message went out.
                    replayed=response.headers.get("Idempotent-Replay") == "true",
                )

            if response.status_code == 401 and attempt == 1:
                # The token may have been invalidated before its expiry. Clear it
                # and try once more; a second 401 is a real credential problem and
                # retrying it forever is a loop, not resilience.
                self._tokens.invalidate()
                continue

            if 400 <= response.status_code < 500:
                # A rejected body is rejected identically next time. Retrying a
                # 422 just delays the log line that explains what is wrong.
                last_error = f"refused: {response.text[:300]}"
                break

            last_error = f"ADA answered {response.status_code}: {response.text[:200]}"
            if attempt < _MAX_ATTEMPTS:
                self._backoff(attempt)

        logger.warning(
            "ada: notification not accepted (template=%s, key=%s): %s",
            template_key,
            idempotency_key,
            last_error,
        )
        return SendOutcome(accepted=False, status_code=last_status, error=last_error)

    def _backoff(self, attempt: int) -> None:
        # Jittered, for the same reason the server's ladder is: without it, a
        # thousand requests that failed together retry together.
        ceiling = _BASE_BACKOFF_SECONDS * (2 ** (attempt - 1))
        time.sleep(random.uniform(0, ceiling))  # noqa: S311 — load spreading, not crypto

    def close(self) -> None:
        self._client.close()
