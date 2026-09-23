"""The two background loops nothing calls directly: the scheduler, and the
reclaimer.

Both exist because a queue is not enough on its own. A queue can hold a message
until a consumer asks for it; it cannot hold one until Tuesday, and it cannot
notice that the consumer it handed a message to has since died.

## RetryScheduler

Streams have no notion of a future message, so a scheduled retry lives in a
sorted set and something has to move it across when it comes due. That is all
this is: a timer that asks the broker to promote whatever is due.

The tick interval bounds how late a retry can be — one second by default, which
is noise against a ladder whose shortest rung is ten seconds.

## Reclaimer

This is the one on the protected list, and the reason it is there is that its
absence is invisible.

A worker reads a message, starts sending, and is killed — a deploy, an OOM, a
lost node. The message is not acknowledged, so the broker still has it. It is
also not consumable, because a consumer group hands each message to exactly one
consumer and that consumer is the dead one. Without a reclaimer the message sits
in the pending list forever. Nothing errors. Nothing alerts. The email simply
never arrives, and the delivery row says SENDING for eternity.

It costs about an hour to write, and it is the difference between a system that
survives a worker dying and one that quietly loses whatever that worker held.

### Why five minutes

The idle threshold has to exceed the longest legitimate time a worker can hold a
message. An SMTP send with a ten-second timeout is nowhere near five minutes, so
nothing healthy is ever reclaimed underneath itself. Lower it and a slow provider
starts producing duplicate sends; raise it and definition-of-done 8 — reclaimed
within five minutes — stops being true.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog

from app.broker import Broker, BrokerError, Message
from app.config import Settings

logger = structlog.get_logger(__name__)

Handler = Callable[[Message], Awaitable[None]]


async def _sleep_or_stop(stop: asyncio.Event, seconds: float) -> None:
    """Wait, but wake immediately on shutdown.

    A plain asyncio.sleep would make shutdown take up to a full tick, which for
    the reclaimer is thirty seconds of a container refusing to exit.
    """
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        pass


class RetryScheduler:
    """Moves due entries from retry:{topic} onto the stream."""

    def __init__(self, settings: Settings, broker: Broker, topics: list[str]) -> None:
        self._settings = settings
        self._broker = broker
        self._topics = topics

    async def run(self, stop: asyncio.Event) -> None:
        logger.info(
            "scheduler_started",
            topics=self._topics,
            tick_seconds=self._settings.scheduler_tick_seconds,
        )
        while not stop.is_set():
            try:
                await self.tick()
            except Exception:
                # Never fatal. A scheduler that exits leaves every scheduled retry
                # in the sorted set with nothing to promote it, and the symptom is
                # deliveries stuck in RETRYING with a due time in the past.
                logger.exception("scheduler_tick_failed")
            await _sleep_or_stop(stop, self._settings.scheduler_tick_seconds)
        logger.info("scheduler_stopped")

    async def tick(self) -> int:
        now = datetime.now(UTC)
        promoted = 0
        for topic in self._topics:
            try:
                count = await self._broker.promote_due(
                    topic, now=now, count=self._settings.outbox_batch
                )
            except BrokerError:
                logger.warning("scheduler_promote_failed", topic=topic)
                continue
            if count:
                logger.info("retries_promoted", topic=topic, count=count)
            promoted += count
        return promoted


class Reclaimer:
    """Takes over messages whose consumer stopped without acknowledging them."""

    def __init__(
        self,
        settings: Settings,
        broker: Broker,
        handlers: dict[str, Handler],
        consumer_name: str,
    ) -> None:
        self._settings = settings
        self._broker = broker
        self._handlers = handlers
        self._consumer = consumer_name

    async def run(self, stop: asyncio.Event) -> None:
        logger.info(
            "reclaimer_started",
            topics=sorted(self._handlers),
            min_idle_ms=self._settings.reclaim_min_idle_ms,
            tick_seconds=self._settings.reclaim_tick_seconds,
        )
        while not stop.is_set():
            try:
                await self.tick()
            except Exception:
                logger.exception("reclaim_tick_failed")
            await _sleep_or_stop(stop, self._settings.reclaim_tick_seconds)
        logger.info("reclaimer_stopped")

    async def tick(self) -> int:
        reclaimed = 0
        for topic, handler in self._handlers.items():
            try:
                messages = await self._broker.reclaim(
                    topic,
                    consumer=self._consumer,
                    min_idle_ms=self._settings.reclaim_min_idle_ms,
                    count=self._settings.reclaim_batch,
                )
            except BrokerError:
                logger.warning("reclaim_failed", topic=topic)
                continue

            for message in messages:
                # Handled by exactly the same code path as a fresh message. A
                # reclaimed message that took a different path would be a second
                # implementation of delivery, exercised only by the failure it
                # exists to handle.
                await handler(message)
                reclaimed += 1

        return reclaimed
