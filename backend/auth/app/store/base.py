"""The key/value interface the OTP lifecycle and the throttling ladder speak.

Six primitives, chosen because they are exactly what those two modules need and
nothing more. The point of keeping the surface this small is that the in-memory
implementation used by the unit tests is a faithful substitute rather than an
approximation — a fake that has to guess at the semantics of a wider API is a
fake that lets bugs through.

Nothing here mentions Redis. app/store/redis_kv.py is the only module in the
service that imports it, and tests/test_import_graph.py fails the build if that
stops being true.
"""

from __future__ import annotations

from typing import Protocol


class StoreError(Exception):
    """The store could not be reached or refused the operation.

    Always treated as "cannot serve right now" — a 503 — never as "the code was
    wrong". Failing an OTP check because Redis blipped would tell a legitimate
    person their correct code was invalid, and burn one of their attempts.
    """


class KeyValueStore(Protocol):
    async def get(self, key: str) -> str | None: ...

    async def setex(self, key: str, ttl_seconds: int, value: str) -> None: ...

    async def delete(self, *keys: str) -> None: ...

    async def exists(self, key: str) -> bool: ...

    async def ttl(self, key: str) -> int:
        """Seconds remaining, or 0 when the key is absent or has no expiry.

        Redis distinguishes -1 (no expiry) from -2 (no key); the callers here do
        not, and collapsing both to 0 keeps every use site from repeating the
        same two comparisons.
        """
        ...

    async def incr_with_ttl(self, key: str, ttl_seconds: int) -> int:
        """Increment, and set the expiry, in one round trip.

        One call rather than two because the pair must not be separable: an INCR
        whose EXPIRE never lands leaves a counter that never resets, which
        eventually locks a phone number out permanently.

        The expiry is refreshed on every increment, making the window sliding
        rather than fixed. That is the stricter reading and the intended one — a
        caller cannot wait out a fixed window while still making requests.
        """
        ...

    async def close(self) -> None: ...
