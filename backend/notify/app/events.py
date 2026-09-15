"""The event envelope written to the outbox.

Ours, not Redis's. The broker abstraction lands on Day 3 and Redis Streams is
its first adapter, but the envelope is defined now because ingestion writes it
and because the shape is what makes the broker swappable at all (AD-3).

partition_key is the load-bearing field. Redis Streams ignores it entirely.
Kafka would use it to place the message on a partition, and a message published
without one would be distributed round-robin, which silently loses ordering
between two notifications for the same recipient. Setting it at write time now
is what keeps a future broker change a configuration change instead of a data
migration.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

TOPIC_NOTIFICATION_CREATED = "notification.created"

# One topic per channel rather than one shared delivery topic, because the retry
# ladder, the dead-letter queue and the consumer group are all per channel. A
# single topic would make an SMTP outage stall push notifications behind it, and
# would put both channels' failures in one undifferentiated dead-letter queue.
TOPIC_DELIVERY_PREFIX = "delivery"


def delivery_topic(channel: str) -> str:
    """The topic one channel's deliveries are published on, e.g. delivery.email."""
    return f"{TOPIC_DELIVERY_PREFIX}.{channel}"


@dataclass(frozen=True)
class Event:
    event_id: uuid.UUID
    topic: str
    partition_key: str
    payload: dict
    occurred_at: datetime

    def to_payload(self) -> dict:
        """The JSONB written to outbox.payload.

        Deliberately self-contained: a consumer can act on this without reading
        the notifications table. That is what lets fan-out run on a different
        host, and what makes a replay from the DLQ meaningful months later, when
        the row may have been archived.
        """
        return {
            "event_id": str(self.event_id),
            "topic": self.topic,
            "occurred_at": self.occurred_at.isoformat(),
            "schema_version": 1,
            **self.payload,
        }


def notification_created(
    *,
    notification_id: uuid.UUID,
    project_id: uuid.UUID,
    project_key: str,
    recipient_type: str,
    recipient_id: uuid.UUID,
    template_key: str,
    locale: str,
    channels: list[str],
    payload: dict,
) -> Event:
    return Event(
        event_id=uuid.uuid4(),
        topic=TOPIC_NOTIFICATION_CREATED,
        # Keyed on the recipient, so everything addressed to one person stays
        # ordered relative to itself. Keying on the notification id would give
        # perfect distribution and no ordering guarantee at all.
        partition_key=str(recipient_id),
        occurred_at=datetime.now(UTC),
        payload={
            "notification_id": str(notification_id),
            "project_id": str(project_id),
            "project_key": project_key,
            "recipient": {"type": recipient_type, "id": str(recipient_id)},
            "template_key": template_key,
            "locale": locale,
            "channels": channels,
            "payload": payload,
        },
    )


def delivery_requested(
    *,
    delivery_id: uuid.UUID,
    notification_id: uuid.UUID,
    project_id: uuid.UUID,
    project_key: str,
    recipient_id: uuid.UUID,
    channel: str,
    attempt: int = 1,
) -> Event:
    """Ask a channel worker to attempt one delivery.

    Deliberately thin. It carries identifiers, not a rendered message: the
    deliveries row is the authority on status, attempt count and address, and a
    copy of the rendered body sitting in Redis would drift from the template the
    moment anyone corrected a typo in it. The worker reads the row.

    The exception is the identifiers themselves, which are repeated so that a
    dead-letter entry read months later still says which project and which
    notification it belonged to, even if the rows have since been archived.
    """
    return Event(
        event_id=uuid.uuid4(),
        topic=delivery_topic(channel),
        # Still the recipient, not the delivery. Two emails to one person keep
        # their order relative to each other on a broker that honours this.
        partition_key=str(recipient_id),
        occurred_at=datetime.now(UTC),
        payload={
            "delivery_id": str(delivery_id),
            "notification_id": str(notification_id),
            "project_id": str(project_id),
            "project_key": project_key,
            "recipient_id": str(recipient_id),
            "channel": channel,
            "attempt": attempt,
        },
    )
