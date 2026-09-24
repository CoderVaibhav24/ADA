"""The delivery worker: one message, one send attempt, one recorded outcome.

Consumes `delivery.{channel}` and hands the rendered message to that channel's
adapter. Everything about *what happens next* is decided here — the adapter only
says whether the failure was retryable.

## The attempt counter moves first

`attempts` is incremented and committed before the send is attempted, not after
it returns. A worker killed mid-send has therefore already spent its attempt,
which is the conservative direction: the alternative counts nothing for a send
that may well have been delivered, and a message that crashes its worker would
then be retried forever, being delivered every time.

## Ordering of the retry path

Schedule, then acknowledge. A crash in between leaves the stream message pending
*and* a scheduled copy in the sorted set, so the message can be processed twice.
The guard for that is at the top of process(): a delivery already RETRYING with a
future next_attempt_at is acknowledged and skipped, because a scheduled copy
already exists and will arrive when it is due.

The other order — acknowledge, then schedule — would drop the delivery entirely
if the process died in between, leaving the row RETRYING with nothing anywhere
that would ever pick it up again.

## Rendering happens here, not at fan-out

Fan-out renders to fail fast and throws the result away. This renders again from
the template row, which means a template corrected between attempt two and
attempt three is what attempt three actually sends.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import events, retry
from app.broker import Broker, BrokerError, Message
from app.channels import Channel as ChannelAdapter
from app.channels import Outgoing, PermanentError, PushTarget, RetryableError
from app.config import Settings
from app.models import (
    Delivery,
    DeliveryStatus,
    Notification,
    NotificationStatus,
    PushDevice,
    Template,
)
from app.recipients import RecipientDirectory
from app.rendering import TemplateError, render_message
from app.routing import routing_data

logger = structlog.get_logger(__name__)

_TERMINAL = (DeliveryStatus.SENT, DeliveryStatus.FAILED, DeliveryStatus.DEAD)


def push_data(*, notification_id: uuid.UUID, template_key: str, payload: dict) -> dict[str, str]:
    """The push routing hint (push-and-permissions.md §5): type and refs, no detail."""
    return {
        **routing_data(template_key=template_key, payload=payload),
        "notification_id": str(notification_id),
    }


class DeliveryWorker:
    def __init__(
        self,
        settings: Settings,
        broker: Broker,
        session_factory: async_sessionmaker[AsyncSession],
        adapter: ChannelAdapter,
        directory: RecipientDirectory,
        consumer_name: str,
    ) -> None:
        self._settings = settings
        self._broker = broker
        self._sessions = session_factory
        self._adapter = adapter
        self._directory = directory
        self._consumer = consumer_name
        self.channel = adapter.name
        self.topic = events.delivery_topic(adapter.name)

    async def run(self, stop: asyncio.Event) -> None:
        logger.info(
            "delivery_worker_started",
            topic=self.topic,
            consumer=self._consumer,
            retry_ladder_seconds=retry.describe_ladder(self._settings),
        )
        while not stop.is_set():
            try:
                messages = await self._broker.consume(
                    self.topic,
                    consumer=self._consumer,
                    count=self._settings.consume_batch,
                    block_ms=self._settings.consume_block_ms,
                )
            except BrokerError:
                logger.exception("delivery_consume_failed", topic=self.topic)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=2.0)
                except TimeoutError:
                    pass
                continue

            for message in messages:
                await self.handle(message)
        logger.info("delivery_worker_stopped", topic=self.topic)

    async def handle(self, message: Message) -> None:
        """Process one message and acknowledge it unless it must be redelivered."""
        try:
            acknowledge = await self.process(message)
        except Exception:
            logger.exception(
                "delivery_handler_failed",
                topic=self.topic,
                event_id=str(message.event_id),
                delivery_count=message.delivery_count,
            )
            # Left pending for the reclaimer — except for a message that has now
            # crashed this worker as many times as the ladder allows, which is
            # dead-lettered so it stops taking a worker down with it.
            if message.delivery_count >= self._settings.retry_max_attempts:
                await self._broker.dead_letter(
                    self.topic,
                    message=message,
                    error=(
                        "delivery handler raised repeatedly; "
                        f"{message.delivery_count} deliveries attempted"
                    ),
                )
                await self._broker.ack(self.topic, message.handle)
            return

        if acknowledge:
            await self._broker.ack(self.topic, message.handle)

    async def process(self, message: Message) -> bool:
        """Attempt one delivery. Returns whether the message may be acknowledged."""
        delivery_id = uuid.UUID(message.payload["delivery_id"])
        now = datetime.now(UTC)

        async with self._sessions() as session:
            delivery = await session.get(Delivery, delivery_id)
            if delivery is None:
                # The row is gone. Nothing to do and nothing to retry; keeping
                # the message would only reclaim it forever.
                logger.warning("delivery_row_missing", delivery_id=str(delivery_id))
                return True

            if delivery.status in _TERMINAL:
                # The idempotency guard. A duplicate message — from a republished
                # outbox row, from fan-out repairing itself, from a reclaim — must
                # not produce a second email.
                logger.info(
                    "delivery_already_final",
                    delivery_id=str(delivery_id),
                    status=delivery.status.value,
                )
                return True

            if (
                delivery.status == DeliveryStatus.RETRYING
                and delivery.next_attempt_at is not None
                and delivery.next_attempt_at > now
            ):
                # A scheduled copy exists and is not due. See the module
                # docstring: this is the crash-between-schedule-and-ack case.
                logger.info(
                    "delivery_not_due",
                    delivery_id=str(delivery_id),
                    due_at=delivery.next_attempt_at.isoformat(),
                )
                return True

            notification = await session.get(Notification, delivery.notification_id)
            if notification is None:
                logger.warning(
                    "delivery_notification_missing",
                    delivery_id=str(delivery_id),
                    notification_id=str(delivery.notification_id),
                )
                return True

            template = (
                await session.get(Template, delivery.template_id) if delivery.template_id else None
            )
            if template is None:
                # The row's template was deleted, or fan-out never recorded one.
                # Look one up rather than failing: an administrator replacing a
                # template should not strand the deliveries it created.
                template = await session.scalar(
                    select(Template)
                    .where(
                        Template.project_id == delivery.project_id,
                        Template.key == notification.template_key,
                        Template.channel == delivery.channel,
                        Template.active.is_(True),
                    )
                    .order_by(Template.version.desc())
                    .limit(1)
                )

            # Spend the attempt before making it. A crash mid-send has still cost
            # an attempt, which is the safe direction.
            attempts = delivery.attempts + 1
            delivery.attempts = attempts
            delivery.status = DeliveryStatus.SENDING

            # Read into plain values before the commit that follows. Everything
            # below survives across awaits and past further commits, and an
            # expired ORM attribute touched later would trigger a lazy refresh —
            # synchronous IO in an async task, i.e. MissingGreenlet.
            address = delivery.address
            device_id = delivery.device_id
            channel = delivery.channel.value
            notification_id = delivery.notification_id
            recipient_id = notification.recipient_id
            variables = dict(notification.payload or {})
            template_key = notification.template_key
            subject = template.subject if template is not None else None
            body = template.body if template is not None else None
            await session.commit()

            if body is None:
                await self._finish_permanent(
                    session,
                    delivery_id=delivery_id,
                    error=(
                        f"no active template '{template_key}' for channel "
                        f"'{channel}' at delivery time"
                    ),
                )
                return True

            if not address:
                await self._finish_permanent(
                    session,
                    delivery_id=delivery_id,
                    error="delivery has no address; fan-out could not resolve one",
                )
                return True

            target: PushTarget | None = None
            if device_id is not None:
                device = await session.get(PushDevice, device_id)
                if device is None or not device.active:
                    await self._finish_permanent(
                        session,
                        delivery_id=delivery_id,
                        error="push device was unregistered before this delivery was sent",
                    )
                    return True
                target = PushTarget(
                    platform=device.platform, apns_environment=device.apns_environment
                )

            try:
                rendered = render_message(subject=subject, body=body, payload=variables)
            except TemplateError as exc:
                await self._finish_permanent(
                    session, delivery_id=delivery_id, error=f"render failed: {exc}"
                )
                return True

            try:
                result = await self._adapter.send(
                    Outgoing(
                        to=address,
                        subject=rendered.subject,
                        body=rendered.body,
                        notification_id=notification_id,
                        delivery_id=delivery_id,
                        push=target,
                        data=push_data(
                            notification_id=notification_id,
                            template_key=template_key,
                            payload=variables,
                        )
                        if target is not None
                        else {},
                    )
                )
            except PermanentError as exc:
                if exc.invalid_address:
                    # The cached profile said this address was usable and the
                    # provider disagrees. Dropping it means the next notification
                    # re-reads Keycloak rather than repeating the same mistake
                    # out of cache.
                    self._directory.forget(recipient_id)
                    if device_id is not None:
                        await self._deactivate_device(session, device_id, reason=str(exc))
                await self._finish_permanent(session, delivery_id=delivery_id, error=str(exc))
                return True
            except RetryableError as exc:
                return await self._schedule_retry(
                    session,
                    message=message,
                    delivery_id=delivery_id,
                    notification_id=notification_id,
                    recipient_id=recipient_id,
                    attempts=attempts,
                    error=str(exc),
                    retry_after=exc.retry_after,
                )
            except Exception as exc:
                # An adapter that raised something unclassified is more likely
                # buggy than authoritative, so treat it as retryable: the
                # recoverable mistake is the one to make.
                logger.exception("channel_raised_unclassified", channel=channel)
                return await self._schedule_retry(
                    session,
                    message=message,
                    delivery_id=delivery_id,
                    notification_id=notification_id,
                    recipient_id=recipient_id,
                    attempts=attempts,
                    error=f"unclassified {type(exc).__name__}: {exc}",
                )

            await self._finish_sent(
                session, delivery_id=delivery_id, provider_message_id=result.provider_message_id
            )
            logger.info(
                "delivery_sent",
                delivery_id=str(delivery_id),
                notification_id=str(notification_id),
                channel=channel,
                attempts=attempts,
                provider_message_id=result.provider_message_id,
            )
            return True

    # --- outcomes -----------------------------------------------------------

    # A provider said this token is dead; stop fanning out to it.
    async def _deactivate_device(
        self, session: AsyncSession, device_id: uuid.UUID, *, reason: str
    ) -> None:
        device = await session.get(PushDevice, device_id)
        if device is None or not device.active:
            return
        device.active = False
        device.deactivated_reason = reason[:500]
        await session.commit()
        logger.warning("push_device_deactivated", device_id=str(device_id), reason=reason[:200])

    async def _finish_sent(
        self, session: AsyncSession, *, delivery_id: uuid.UUID, provider_message_id: str | None
    ) -> None:
        delivery = await session.get(Delivery, delivery_id)
        if delivery is None:  # pragma: no cover — it was read moments ago
            return
        delivery.status = DeliveryStatus.SENT
        delivery.sent_at = datetime.now(UTC)
        delivery.provider_message_id = provider_message_id
        delivery.last_error = None
        delivery.next_attempt_at = None
        await self._complete_notification_if_done(session, delivery.notification_id)
        await session.commit()

    async def _finish_permanent(
        self, session: AsyncSession, *, delivery_id: uuid.UUID, error: str
    ) -> None:
        delivery = await session.get(Delivery, delivery_id)
        if delivery is None:  # pragma: no cover
            return
        delivery.status = DeliveryStatus.FAILED
        delivery.last_error = error[:2000]
        delivery.next_attempt_at = None
        await self._complete_notification_if_done(session, delivery.notification_id)
        await session.commit()
        logger.warning(
            "delivery_failed_permanently",
            delivery_id=str(delivery_id),
            channel=self.channel,
            error=error[:500],
        )

    async def _schedule_retry(
        self,
        session: AsyncSession,
        *,
        message: Message,
        delivery_id: uuid.UUID,
        notification_id: uuid.UUID,
        recipient_id: uuid.UUID,
        attempts: int,
        error: str,
        retry_after: float | None = None,
    ) -> bool:
        if retry.is_exhausted(attempts, self._settings):
            delivery = await session.get(Delivery, delivery_id)
            if delivery is not None:
                delivery.status = DeliveryStatus.DEAD
                delivery.last_error = error[:2000]
                delivery.next_attempt_at = None
                await self._complete_notification_if_done(session, notification_id)
                await session.commit()

            # The dead-letter entry carries the final error, which is the thing
            # that makes it actionable months later.
            await self._broker.dead_letter(
                self.topic,
                message=message,
                error=f"exhausted {attempts} attempts; final error: {error}",
            )
            logger.error(
                "delivery_dead_lettered",
                delivery_id=str(delivery_id),
                channel=self.channel,
                attempts=attempts,
                error=error[:500],
            )
            return True

        due = retry.next_attempt_at(attempts, self._settings)
        if retry_after:
            # The provider's Retry-After is a floor; the ladder may still be later.
            due = max(due, datetime.now(UTC) + timedelta(seconds=retry_after))

        delivery = await session.get(Delivery, delivery_id)
        if delivery is not None:
            delivery.status = DeliveryStatus.RETRYING
            delivery.last_error = error[:2000]
            delivery.next_attempt_at = due
            await session.commit()

        event = events.delivery_requested(
            delivery_id=delivery_id,
            notification_id=notification_id,
            project_id=uuid.UUID(message.payload["project_id"]),
            project_key=str(message.payload.get("project_key") or ""),
            recipient_id=recipient_id,
            channel=self.channel,
            attempt=attempts + 1,
        )
        # Scheduled before acknowledging. See the module docstring for why this
        # order and not the other one.
        await self._broker.schedule(
            self.topic,
            event_id=event.event_id,
            partition_key=event.partition_key,
            payload=event.to_payload(),
            at=due,
        )
        logger.info(
            "delivery_retry_scheduled",
            delivery_id=str(delivery_id),
            channel=self.channel,
            attempt=attempts,
            next_attempt_at=due.isoformat(),
            error=error[:200],
        )
        return True

    async def _complete_notification_if_done(
        self, session: AsyncSession, notification_id: uuid.UUID
    ) -> None:
        """Mark the notification completed once every delivery has finished.

        'Completed' means every channel reached a terminal state, not that every
        channel succeeded — a notification with one sent and one dead delivery is
        finished, and calling it anything else would leave rows that nothing ever
        closes.
        """
        # The caller has just assigned this delivery its terminal status and has
        # NOT committed yet, and the session is created with autoflush=False so
        # the ingestion path can flush deliberately and catch IntegrityError.
        # Without this flush the query below runs against a database that still
        # shows this delivery as in flight, always finds it "remaining", and
        # returns early — so a notification whose every delivery succeeded stays
        # at 'fanned_out' forever and nothing ever closes it.
        await session.flush()

        remaining = await session.scalar(
            select(Delivery.id)
            .where(
                Delivery.notification_id == notification_id,
                Delivery.status.notin_(_TERMINAL),
            )
            .limit(1)
        )
        if remaining is not None:
            return
        notification = await session.get(Notification, notification_id)
        if notification is not None and notification.status != NotificationStatus.COMPLETED:
            notification.status = NotificationStatus.COMPLETED
