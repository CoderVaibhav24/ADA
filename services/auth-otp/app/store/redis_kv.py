"""The Redis adapter — the only module in this service that imports redis.

That rule has a test behind it (tests/test_import_graph.py). It is not
tidiness: the cost of changing where pending OTPs live is measured entirely in
how many modules know what they live in, and the answer has to stay one.

## The key space

    otp:{phone}            HMAC of the issued code       TTL otp_ttl_seconds
    otp:attempts:{phone}   wrong guesses against it      TTL otp_ttl_seconds
    otp:subject:{phone}    the Keycloak user id resolved at request time
    otp:session:{phone}    the provider's session id, when it verifies the code

    otp:cooldown:{phone}   one-code-per-minute sentinel
    otp:req:{phone}        codes requested in the hourly window
    otp:ver:{phone}        verify attempts in the hourly window
    otp:softlock:{phone}   15-minute lock
    otp:softlocks:{phone}  soft locks accumulated, for the hard-lock decision
    otp:hardlock:{phone}   24-hour lock

Every key is namespaced under otp: so that this service's state is separable
from the notification service's, which shares the same Redis instance and its
own ada: prefix.
"""

from __future__ import annotations

import redis.asyncio as redis
import structlog
from redis.exceptions import RedisError

from app.store.base import StoreError

logger = structlog.get_logger(__name__)


class RedisKeyValueStore:
    def __init__(self, url: str) -> None:
        # decode_responses so every read is a str. Without it the OTP comparison
        # is bytes against str, which is False for every correct code — a bug
        # that presents as "OTP never works" and nothing else.
        self._redis = redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> str | None:
        try:
            return await self._redis.get(key)
        except RedisError as exc:
            raise StoreError(f"redis GET failed: {exc}") from exc

    async def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        try:
            await self._redis.setex(key, ttl_seconds, value)
        except RedisError as exc:
            raise StoreError(f"redis SETEX failed: {exc}") from exc

    async def delete(self, *keys: str) -> None:
        if not keys:
            return
        try:
            await self._redis.delete(*keys)
        except RedisError as exc:
            raise StoreError(f"redis DEL failed: {exc}") from exc

    async def exists(self, key: str) -> bool:
        try:
            return bool(await self._redis.exists(key))
        except RedisError as exc:
            raise StoreError(f"redis EXISTS failed: {exc}") from exc

    async def ttl(self, key: str) -> int:
        try:
            remaining = await self._redis.ttl(key)
        except RedisError as exc:
            raise StoreError(f"redis TTL failed: {exc}") from exc
        # -1 no expiry, -2 no key. Neither is a countdown to report.
        return remaining if remaining and remaining > 0 else 0

    async def incr_with_ttl(self, key: str, ttl_seconds: int) -> int:
        try:
            pipe = self._redis.pipeline()
            pipe.incr(key)
            pipe.expire(key, ttl_seconds)
            count, _ = await pipe.execute()
        except RedisError as exc:
            raise StoreError(f"redis INCR failed: {exc}") from exc
        return int(count)

    async def close(self) -> None:
        try:
            await self._redis.aclose()
        except RedisError as exc:  # pragma: no cover - shutdown path
            logger.warning("redis_close_failed", error=str(exc))
