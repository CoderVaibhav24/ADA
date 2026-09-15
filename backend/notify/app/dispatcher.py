"""The outbox dispatcher: the bridge from "written" to "published".

Ingestion writes a notification row and an outbox row in one transaction, so
there is no state in which a notification was accepted and nothing will ever
process it. This is the other half of that promise — it polls unpublished rows
and hands them to the broker.

## Why this cannot lose a message

The row is durable before this process ever sees it. If Redis is down, publish
fails, the transaction rolls back, published_at stays NULL, and the row is picked
up on the next tick. Killing Redis during ingestion loses nothing once it comes
back, which is exactly what Saturday's definition of done asks for.

## Why this can duplicate a message

Publishing and marking-published cannot be one atomic act across two systems.
This publishes first and marks second, so a crash in between republishes the
message on the next tick. That is a deliberate choice: at-least-once with an
idempotent consumer, rather than at-most-once with silent loss. Fan-out's
UNIQUE (notification_id, channel) is what absorbs the duplicate.

The reverse order — mark, then publish — would lose messages instead, and lose
them invisibly.

## Running more than one

FOR UPDATE SKIP LOCKED. Two dispatchers take disjoint batches rather than
fighting over the same rows or serialising behind each other.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.broker import Broker, BrokerError
from app.config import Settings
from app.models import OutboxEvent

logger = structlog.get_logger(__name__)


class _Row:
    """A claimed outbox row, read off into plain values.

    Not an ORM object, on purpose. These are held across an await on the broker,
    and an expired ORM attribute touched after a rollback triggers a lazy refresh
    — synchronous IO inside an async task, which surfaces as MissingGreenlet.
    """

    __slots__ = ("event_id", "id", "partition_key", "payload", "topic")

    def __init__(
        self,
        *,
        id: int,  # noqa: A002 — mirrors the column name deliberately
        event_id: uuid.UUID,
        topic: str,
        partition_key: str,
        payload: dict,
    ) -> None:
        self.id = id
        self.event_id = event_id
        self.topic = topic
        self.partition_key = partition_key
        self.payload = payload


class OutboxDispatcher:
    def __init__(
        self,
        settings: Settings,
        broker: Broker,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self._settings = settings
        self._broker = broker
        self._sessions = session_factory

    async def run(self, stop: asyncio.Event) -> None:
        """Poll until asked to stop. Never raises; a bad tick is logged and retried."""
        logger.info("dispatcher_started", poll_seconds=self._settings.outbox_poll_seconds)
        while not stop.is_set():
            try:
                published = await self.tick()
            except Exception:
                # A dispatcher that dies on a transient database or broker error
                # stops the whole pipeline, and surviving exactly that is the
                # pipeline's purpose.
                logger.exception("dispatcher_tick_failed")
                published = 0

            if published == 0:
                # Only sleep when there was nothing to do, so a backlog drains at
                # full speed rather than one batch per tick.
                try:
                    await asyncio.wait_for(stop.wait(), timeout=self._settings.outbox_poll_seconds)
                except TimeoutError:
                    pass
        logger.info("dispatcher_stopped")

    async def tick(self) -> int:
        """Publish one batch. Returns how many rows were published."""
        async with self._sessions() as session:
            rows = await self._claim(session)
            if not rows:
                return 0

            published_ids: list[int] = []
            for row in rows:
                try:
                    await self._broker.publish(
                        row.topic,
                        event_id=row.event_id,
                        partition_key=row.partition_key,
                        payload=row.payload,
                    )
                except BrokerError:
                    # Stop the batch here rather than skipping this row. The rows
                    # are ordered, and continuing past a failure would publish
                    # later events before earlier ones — which for one recipient
                    # is exactly the reordering the partition key exists to
                    # prevent.
                    logger.warning(
                        "dispatcher_publish_failed",
                        outbox_id=row.id,
                        topic=row.topic,
                        event_id=str(row.event_id),
                    )
                    break
                published_ids.append(row.id)

            if not published_ids:
                # Nothing to record. The rollback releases the row locks, so
                # another dispatcher can try immediately.
                await session.rollback()
                return 0

            await session.execute(
                update(OutboxEvent)
                .where(OutboxEvent.id.in_(published_ids))
                .values(published_at=datetime.now(UTC))
            )
            await session.commit()

        logger.info("outbox_published", count=len(published_ids))
        return len(published_ids)

    async def _claim(self, session: AsyncSession) -> list[_Row]:
        # SKIP LOCKED, so a second dispatcher takes the next batch instead of
        # blocking on this one's locks. Ordered by id, which is insertion order —
        # the outbox is a log and is read as one.
        result = await session.execute(
            select(
                OutboxEvent.id,
                OutboxEvent.event_id,
                OutboxEvent.topic,
                OutboxEvent.partition_key,
                OutboxEvent.payload,
            )
            .where(OutboxEvent.published_at.is_(None))
            .order_by(OutboxEvent.id)
            .limit(self._settings.outbox_batch)
            .with_for_update(skip_locked=True)
        )
        return [
            _Row(id=r[0], event_id=r[1], topic=r[2], partition_key=r[3], payload=r[4])
            for r in result.all()
        ]
