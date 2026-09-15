"""The broker interface. About fifty lines, and one of the six not to cut.

AD-3. Redis Streams is today's adapter and it is not the abstraction: every
concept named here exists in Kafka, NATS and SQS too, and nothing named here is
Redis-specific. That is the whole test of whether this interface is doing its
job.

The expensive part of retrofitting a broker abstraction is not writing it — it
is that without one, Redis calls end up scattered through fan-out, delivery,
retry and the scheduler, and each of those has to be rewritten and re-tested to
change anything. The import-graph test in tests/test_import_graph.py fails the
build if `redis` is imported anywhere outside this package, which is what keeps
that from happening quietly.

## Delivery semantics

At-least-once, everywhere. A consumer reads, works, then acknowledges; a message
that is never acknowledged stays pending and is eventually reclaimed by another
consumer. So every consumer in this service must be idempotent, and each one is:

  * fan-out    — UNIQUE (notification_id, channel) makes a second run a no-op
  * delivery   — a delivery already in a terminal state is skipped

## partition_key

Carried on every message even though Redis Streams ignores it entirely. Kafka
would place the message on a partition with it, and messages published without
one are distributed round-robin — which silently loses ordering between two
notifications for the same recipient. Setting it at write time is what keeps a
broker change a configuration change rather than a data migration.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, runtime_checkable


class BrokerError(Exception):
    """The broker could not be reached, or refused an operation.

    Always transient from the caller's point of view: the durable record is the
    outbox row or the deliveries row, so the correct response is to stop and be
    retried, never to drop the work.
    """


@dataclass(frozen=True)
class Message:
    """One message as a consumer sees it.

    handle is the broker's own identifier for this delivery of this message, and
    it is what ack() takes. It is deliberately opaque and deliberately not
    event_id: Redis gives a stream entry id, Kafka would give a
    topic-partition-offset, and a consumer that parsed either would be
    adapter-specific.

    delivery_count is how many times this message has been handed out. Redis
    reports it from the pending-entries list; a broker that does not track it
    reports 1. It is what lets a poison message be dead-lettered rather than
    reclaimed forever.
    """

    handle: str
    event_id: uuid.UUID
    topic: str
    partition_key: str
    payload: dict
    delivery_count: int = 1
    metadata: dict = field(default_factory=dict, repr=False)


@runtime_checkable
class Broker(Protocol):
    """publish / consume / ack / reclaim / schedule, and nothing else.

    Two support operations sit alongside them — promote_due, which is the other
    half of schedule, and dead_letter, which is where a message goes when the
    retry ladder is exhausted. Both belong here rather than in the caller because
    both are storage decisions: Redis uses a sorted set and a stream, and Kafka
    would use a delay topic and a DLQ topic. A caller doing that arithmetic
    itself would be writing an adapter.
    """

    async def publish(
        self,
        topic: str,
        *,
        event_id: uuid.UUID,
        partition_key: str,
        payload: dict,
    ) -> str:
        """Append one message to a topic. Returns the broker's handle for it."""
        ...

    async def consume(
        self,
        topic: str,
        *,
        consumer: str,
        count: int,
        block_ms: int,
    ) -> list[Message]:
        """Read up to `count` messages for this consumer, blocking if idle.

        Messages are handed out exclusively and remain pending until acked.
        Returns an empty list when the block elapses with nothing to read, which
        is the normal idle case and not an error.
        """
        ...

    async def ack(self, topic: str, handle: str) -> None:
        """Mark one message done, so it is neither pending nor reclaimable."""
        ...

    async def reclaim(
        self,
        topic: str,
        *,
        consumer: str,
        min_idle_ms: int,
        count: int,
    ) -> list[Message]:
        """Take over messages pending longer than min_idle_ms.

        This is what makes a killed worker's in-flight message somebody else's
        problem rather than nobody's. Without it, work handed to a process that
        then died is pending forever and no error is ever reported: the message
        is simply never delivered, and nothing anywhere says so.
        """
        ...

    async def schedule(
        self,
        topic: str,
        *,
        event_id: uuid.UUID,
        partition_key: str,
        payload: dict,
        at: datetime,
    ) -> None:
        """Hold a message until `at`, then make it consumable on `topic`.

        Streams have no notion of a future message, so the retry ladder cannot be
        expressed with publish alone. Something has to hold the schedule; this is
        the interface for it, and promote_due is what advances it.
        """
        ...

    async def promote_due(self, topic: str, *, now: datetime, count: int) -> int:
        """Publish everything scheduled at or before `now`. Returns how many.

        Called on a timer by the scheduler. Must be safe to run concurrently in
        several processes — two schedulers promoting the same message would
        otherwise send the same email twice.
        """
        ...

    async def dead_letter(self, topic: str, *, message: Message, error: str) -> None:
        """Record a message whose retries are exhausted, with its final error.

        The final error is the point. A DLQ entry recording only that something
        failed leaves whoever finds it a week later with no way to tell a bad
        address from an expired provider credential.
        """
        ...

    async def health(self) -> bool:
        """Cheap liveness check, for the readiness probe."""
        ...

    async def close(self) -> None:
        ...
