"""Which store to build, decided in one place.

Redis everywhere except a test run that asked for the in-memory one. There is no
environment in which the in-memory store is correct for a running service — two
replicas would each hold half the pending codes, and a restart would invalidate
every login in flight — so it is not reachable from configuration.
"""

from __future__ import annotations

from app.config import Settings
from app.store.base import KeyValueStore
from app.store.redis_kv import RedisKeyValueStore


def build_store(settings: Settings) -> KeyValueStore:
    return RedisKeyValueStore(settings.redis_url)
