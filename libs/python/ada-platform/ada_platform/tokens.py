"""The machine token an application sends notifications with.

One exchange — client_credentials — and a cache in front of it.

## Why the cache is not an optimisation

Keycloak's token endpoint is rate limited and, more importantly, it is a shared
resource for the whole estate. An application that fetched a token per send would
turn a burst of a thousand notifications into a thousand token requests, and the
symptom of that is every *other* application's logins slowing down.

The token is reused until shortly before it expires. Thirty seconds of headroom,
because a token that expires in flight comes back as a 401 that looks exactly
like a misconfigured client secret.

## Refresh on 401

A cached token can be invalidated before its expiry — the client is disabled, the
realm's keys are rotated aggressively. So a 401 from ADA clears the cache once
and retries; the second 401 is reported, because retrying forever on a genuinely
wrong secret is a loop, not resilience.
"""

from __future__ import annotations

import threading
import time

import httpx

from ada_platform.errors import ADAUnavailable

# Refresh this long before expiry, so no request is made with a token that dies
# between being read here and arriving at ADA.
_EXPIRY_HEADROOM_SECONDS = 30


class MachineTokenSource:
    def __init__(
        self,
        *,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        client: httpx.Client,
    ) -> None:
        self._token_endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._client = client

        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = threading.Lock()

    def token(self, *, force_refresh: bool = False) -> str:
        with self._lock:
            if not force_refresh and self._token and time.monotonic() < self._expires_at:
                return self._token

            try:
                response = self._client.post(
                    self._token_endpoint,
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self._client_id,
                        "client_secret": self._client_secret,
                    },
                )
            except httpx.HTTPError as exc:
                raise ADAUnavailable(f"could not reach the token endpoint: {exc}") from exc

            if response.status_code >= 400:
                # The body carries Keycloak's own error code — invalid_client for
                # a wrong secret, unauthorized_client for a grant that is not
                # enabled. Both are worth passing through verbatim: they are the
                # difference between a five-minute fix and an afternoon.
                raise ADAUnavailable(
                    f"the token endpoint answered {response.status_code}: {response.text[:300]}"
                )

            document = response.json()
            self._token = document["access_token"]
            lifetime = int(document.get("expires_in", 60))
            self._expires_at = time.monotonic() + max(lifetime - _EXPIRY_HEADROOM_SECONDS, 5)
            return self._token

    def invalidate(self) -> None:
        with self._lock:
            self._token = None
            self._expires_at = 0.0
