"""An in-memory store, for the unit tests and for `sms_provider=stub` runs.

Expiry is real — it is checked against a clock — because a fake that never
expires anything cannot exercise the one behaviour the OTP lifecycle depends on
most. The clock is injectable so a test can prove a code has expired without
sleeping for five minutes.
"""

from __future__ import annotations

import time
from collections.abc import Callable


class MemoryKeyValueStore:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._values: dict[str, tuple[float, str]] = {}

    def _live(self, key: str) -> tuple[float, str] | None:
        entry = self._values.get(key)
        if entry is None:
            return None
        if entry[0] <= self._clock():
            del self._values[key]
            return None
        return entry

    async def get(self, key: str) -> str | None:
        entry = self._live(key)
        return entry[1] if entry else None

    async def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        self._values[key] = (self._clock() + ttl_seconds, value)

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self._values.pop(key, None)

    async def exists(self, key: str) -> bool:
        return self._live(key) is not None

    async def ttl(self, key: str) -> int:
        entry = self._live(key)
        if entry is None:
            return 0
        return max(int(entry[0] - self._clock()), 0)

    async def incr_with_ttl(self, key: str, ttl_seconds: int) -> int:
        current = int(await self.get(key) or 0) + 1
        await self.setex(key, ttl_seconds, str(current))
        return current

    async def close(self) -> None:
        self._values.clear()
