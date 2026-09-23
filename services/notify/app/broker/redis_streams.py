"""The Redis Streams adapter — the only module in this codebase importing redis.

That is a rule with a test behind it (tests/test_import_graph.py). It is not
tidiness: the cost of a broker change is measured entirely in how many modules
know which broker it is, and the answer has to stay one.

## The key space

    ada:stream:{topic}   the stream, read through a consumer group
    ada:retry:{topic}    a sorted set, score = the epoch second it is due
    ada:dlq:{topic}      a stream, appended to and never consumed by us

## Why a sorted set for the schedule

Streams cannot schedule. There is no "deliver this in ten minutes" in the Streams
API, and the retry ladder is entirely made of that. So a scheduled message is
held in a sorted set scored by its due time, and a scheduler tick moves whatever
is due onto the stream.

That move has to be atomic across processes. Two schedulers each reading the same
due entry and each publishing it is a duplicate email, and it is the kind of
duplicate that only appears under the load that made you run two schedulers. The
Lua script below does the read, the removal and the publish in one server-side
step, and the ZREM return value decides which caller owns the entry.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import redis.asyncio as redis
import structlog
from redis.exceptions import RedisError, ResponseError

from app.broker.base import BrokerError, Message
from app.config import Settings

logger = structlog.get_logger(__name__)

# ZRANGEBYSCORE, then ZREM, then XADD — atomically, per entry.
#
# The ZREM return value is the lock: exactly one caller gets 1 for a given
# member, and only that caller publishes. Everyone else gets 0 and moves on. The
# whole script runs on one thread inside Redis, so no interleaving is possible.
_PROMOTE_DUE = """
local zkey   = KEYS[1]
local skey   = KEYS[2]
local now    = ARGV[1]
local count  = tonumber(ARGV[2])
local maxlen = tonumber(ARGV[3])

local due = redis.call('ZRANGEBYSCORE', zkey, '-inf', now, 'LIMIT', 0, count)
local moved = 0

for i = 1, #due do
  local member = due[i]
  if redis.call('ZREM', zkey, member) == 1 then
    local envelope = cjson.decode(member)
    redis.call('XADD', skey, 'MAXLEN', '~', maxlen, '*',
      'event_id',      envelope['event_id'],
      'partition_key', envelope['partition_key'],
      'payload',       envelope['payload'])
    moved = moved + 1
  end
end

return moved
"""


class RedisStreamsBroker:
    """Implements app.broker.base.Broker.

    Not declared as inheriting from it: Broker is a Protocol, and structural
    typing is what makes a second adapter a new file rather than an edit to a
    base class. tests/test_import_graph.py asserts the conformance instead.
    """

    def __init__(self, settings: Settings, client: redis.Redis | None = None) -> None:
        self._settings = settings
        self._client = client or redis.from_url(
            settings.redis_url,
            # Every value written here is JSON or a decimal string, so decoding
            # centrally beats decoding at eleven call sites.
            decode_responses=True,
            # A worker blocked in XREADGROUP for consume_block_ms must not have
            # the socket timeout fire underneath it. Redis' own timeout is the
            # one that should end that call.
            socket_timeout=(settings.consume_block_ms / 1000) + 10,
            socket_connect_timeout=5,
            health_check_interval=30,
            retry_on_timeout=True,
        )
        self._group = settings.consumer_group
        self._prefix = settings.stream_prefix
        self._maxlen = settings.stream_max_length
        # Which topics have had their consumer group created. Creating it is
        # idempotent but it is a round trip, and consume() is the hot loop.
        self._groups_ready: set[str] = set()
        self._promote = self._client.register_script(_PROMOTE_DUE)

    # --- key naming ---------------------------------------------------------

    def stream_key(self, topic: str) -> str:
        return f"{self._prefix}:stream:{topic}"

    def retry_key(self, topic: str) -> str:
        return f"{self._prefix}:retry:{topic}"

    def dlq_key(self, topic: str) -> str:
        return f"{self._prefix}:dlq:{topic}"

    # --- internals ----------------------------------------------------------

    async def _ensure_group(self, topic: str) -> None:
        if topic in self._groups_ready:
            return
        try:
            # MKSTREAM, so a consumer can start before any producer has run. id
            # '0' rather than '$': '$' means "only messages added after now", and
            # a worker restarting would skip everything published while it was
            # down. Anything already handled is acknowledged, so starting at 0
            # replays nothing that was finished.
            await self._client.xgroup_create(
                name=self.stream_key(topic), groupname=self._group, id="0", mkstream=True
            )
            logger.info("consumer_group_created", topic=topic, group=self._group)
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise BrokerError(f"could not create consumer group for {topic}") from exc
        except RedisError as exc:
            raise BrokerError(f"redis unavailable while preparing {topic}") from exc
        self._groups_ready.add(topic)

    def _to_message(self, topic: str, handle: str, fields: dict, delivery_count: int) -> Message:
        raw = fields.get("payload") or "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            # Refuse to guess. A message whose payload is not JSON cannot be
            # processed by anything downstream, and returning it with an empty
            # payload would turn a corrupt message into a silently empty send.
            raise BrokerError(f"message {handle} on {topic} carries a malformed payload") from None

        event_id = fields.get("event_id") or ""
        try:
            parsed_event_id = uuid.UUID(event_id)
        except ValueError:
            raise BrokerError(f"message {handle} on {topic} carries no usable event_id") from None

        return Message(
            handle=handle,
            event_id=parsed_event_id,
            topic=topic,
            partition_key=fields.get("partition_key", ""),
            payload=payload,
            delivery_count=delivery_count,
        )

    # --- the interface ------------------------------------------------------

    async def publish(
        self,
        topic: str,
        *,
        event_id: uuid.UUID,
        partition_key: str,
        payload: dict,
    ) -> str:
        await self._ensure_group(topic)
        try:
            # MAXLEN ~ rather than an exact trim: approximate trimming stops at a
            # macro-node boundary and is O(1), exact trimming is not. The stream
            # is not the durable record — the outbox and the deliveries table are
            # — so the exact length does not matter.
            return await self._client.xadd(
                name=self.stream_key(topic),
                fields={
                    "event_id": str(event_id),
                    "partition_key": partition_key,
                    "payload": json.dumps(payload, separators=(",", ":")),
                },
                maxlen=self._maxlen,
                approximate=True,
            )
        except RedisError as exc:
            raise BrokerError(f"publish to {topic} failed") from exc

    async def consume(
        self,
        topic: str,
        *,
        consumer: str,
        count: int,
        block_ms: int,
    ) -> list[Message]:
        await self._ensure_group(topic)
        try:
            # '>' means "messages never delivered to any consumer in this group".
            # Anything already delivered and not acked belongs to reclaim(), not
            # here — reading it with an explicit id would hand one worker's
            # in-flight message to another.
            response = await self._client.xreadgroup(
                groupname=self._group,
                consumername=consumer,
                streams={self.stream_key(topic): ">"},
                count=count,
                block=block_ms,
            )
        except RedisError as exc:
            raise BrokerError(f"consume from {topic} failed") from exc

        if not response:
            return []

        messages: list[Message] = []
        for _stream, entries in response:
            for handle, fields in entries:
                messages.append(self._to_message(topic, handle, fields, delivery_count=1))
        return messages

    async def ack(self, topic: str, handle: str) -> None:
        try:
            await self._client.xack(self.stream_key(topic), self._group, handle)
        except RedisError as exc:
            raise BrokerError(f"ack on {topic} failed") from exc

    async def reclaim(
        self,
        topic: str,
        *,
        consumer: str,
        min_idle_ms: int,
        count: int,
    ) -> list[Message]:
        await self._ensure_group(topic)
        try:
            # XAUTOCLAIM rather than XPENDING+XCLAIM for the claim itself: it
            # scans with a cursor, and it also drops references to entries that
            # were trimmed out of the stream while pending, which XCLAIM leaves
            # in the pending list forever.
            _cursor, entries, _deleted = await self._client.xautoclaim(
                name=self.stream_key(topic),
                groupname=self._group,
                consumername=consumer,
                min_idle_time=min_idle_ms,
                count=count,
            )
        except RedisError as exc:
            raise BrokerError(f"reclaim on {topic} failed") from exc

        if not entries:
            return []

        # XAUTOCLAIM does not report how many times each entry has been
        # delivered, and that count is what stops a message that crashes its
        # consumer from being reclaimed forever. One XPENDING range attaches it.
        counts: dict[str, int] = {}
        try:
            for record in await self._client.xpending_range(
                name=self.stream_key(topic),
                groupname=self._group,
                min="-",
                max="+",
                count=max(count, len(entries)),
                consumername=consumer,
            ):
                counts[record["message_id"]] = int(record["times_delivered"])
        except RedisError:
            # The count refines a decision; it does not gate one. Losing it means
            # a poison message is reclaimed once more than it should be, which is
            # a better outcome than refusing to reclaim anything.
            logger.warning("reclaim_delivery_counts_unavailable", topic=topic)

        messages = []
        for handle, fields in entries:
            messages.append(
                self._to_message(topic, handle, fields, delivery_count=counts.get(handle, 1))
            )
        if messages:
            logger.info(
                "messages_reclaimed",
                topic=topic,
                consumer=consumer,
                count=len(messages),
                min_idle_ms=min_idle_ms,
            )
        return messages

    async def schedule(
        self,
        topic: str,
        *,
        event_id: uuid.UUID,
        partition_key: str,
        payload: dict,
        at: datetime,
    ) -> None:
        # The member is the whole envelope, so scheduling the same event twice
        # collapses to one entry rather than producing two sends. That matters:
        # the delivery worker is at-least-once, so a message it scheduled and
        # then failed to ack will be reclaimed and scheduled again.
        member = json.dumps(
            {
                "event_id": str(event_id),
                "partition_key": partition_key,
                "payload": json.dumps(payload, separators=(",", ":")),
            },
            separators=(",", ":"),
            sort_keys=True,  # so the same envelope is byte-identical every time
        )
        try:
            await self._client.zadd(self.retry_key(topic), {member: at.timestamp()})
        except RedisError as exc:
            raise BrokerError(f"schedule on {topic} failed") from exc

    async def promote_due(self, topic: str, *, now: datetime, count: int) -> int:
        await self._ensure_group(topic)
        try:
            moved = await self._promote(
                keys=[self.retry_key(topic), self.stream_key(topic)],
                args=[now.timestamp(), count, self._maxlen],
            )
        except RedisError as exc:
            raise BrokerError(f"promoting scheduled messages on {topic} failed") from exc
        return int(moved or 0)

    async def dead_letter(self, topic: str, *, message: Message, error: str) -> None:
        try:
            await self._client.xadd(
                name=self.dlq_key(topic),
                fields={
                    "event_id": str(message.event_id),
                    "partition_key": message.partition_key,
                    "payload": json.dumps(message.payload, separators=(",", ":")),
                    # The reason this entry exists. Truncated, because a provider
                    # can return a multi-kilobyte HTML error page and the DLQ is
                    # meant to be readable.
                    "error": error[:2000],
                    "delivery_count": str(message.delivery_count),
                    "dead_at": datetime.now(UTC).isoformat(),
                },
                # Ten times the stream cap. A DLQ that trims as aggressively as
                # the stream discards the evidence you kept it for.
                maxlen=self._maxlen * 10,
                approximate=True,
            )
        except RedisError as exc:
            raise BrokerError(f"dead-lettering on {topic} failed") from exc
        logger.error(
            "message_dead_lettered",
            topic=topic,
            event_id=str(message.event_id),
            delivery_count=message.delivery_count,
            error=error[:500],
        )

    async def health(self) -> bool:
        try:
            return bool(await self._client.ping())
        except RedisError:
            return False

    async def close(self) -> None:
        await self._client.aclose()
