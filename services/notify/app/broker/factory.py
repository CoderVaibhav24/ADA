"""Choosing an adapter.

One function, so that every process constructs its broker the same way and no
caller anywhere names a concrete adapter. Swapping Redis for something else is
an edit to this file and a new module beside it — which is the entire point of
AD-3, and the reason the interface was written before the second adapter existed.
"""

from __future__ import annotations

from app.broker.base import Broker
from app.config import Settings, get_settings


def create_broker(settings: Settings | None = None) -> Broker:
    settings = settings or get_settings()
    # Imported here rather than at module scope so that importing app.broker
    # does not require the redis package to be present. It keeps the failure for
    # a missing dependency at the one place that actually needs it.
    from app.broker.redis_streams import RedisStreamsBroker

    return RedisStreamsBroker(settings)
