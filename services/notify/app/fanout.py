"""Fan-out: one accepted notification becomes one delivery per channel.

Push is the exception: one delivery per active registered device, so each
device has its own attempt counter, retry schedule and dead-token outcome.

Consumes `notification.created`. For each channel the caller asked for, it finds
the template, resolves the recipient's address, writes a `deliveries` row, and
publishes a `delivery.{channel}` message for a channel worker to act on.

## Idempotency

This consumer is at-least-once, so it must be safe to run twice for the same
notification. UNIQUE (notification_id, channel) is what makes it so — the second
run conflicts instead of inserting a duplicate.

But "conflict, therefore skip" is subtly wrong, and the failure it causes is
permanent silence. Consider a crash between inserting the delivery row and
publishing its message: the row exists, PENDING, and no message exists to act on
it. A second run that skipped on conflict would leave it PENDING forever, with no
error recorded anywhere.

So the conflict path re-reads the row and republishes whenever it is still in a
non-terminal state. The delivery worker is itself idempotent — it skips a
delivery that has already been sent — so a duplicate message costs one wasted
read, while the alternative costs a message that never arrives.

## Retryable versus permanent, again

  * no template, no address, unrenderable payload — permanent. The delivery is
    written as failed with the reason, so it is visible in the table rather than
    absent from it. Nothing is retried, because nothing would change.
  * Keycloak or the database unavailable — retryable, and handled by *not*
    acknowledging the message. It stays pending and the reclaimer hands it to
    another worker after the idle threshold. That is slower than an explicit
    retry, and it is the same mechanism that covers a worker being killed, which
    means it is exercised constantly rather than only in the rare case.

## The template is rendered here, and thrown away

Rendering at fan-out means an unrenderable payload fails immediately, with the
notification in front of us, rather than five minutes later inside a channel
worker. The rendered text is deliberately not stored: the delivery worker renders
again from the same template row, so a corrected template applies to a retry.
"""

from __future__ import annotations

import asyncio
import uuid

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import events
from app.broker import Broker, BrokerError, Message
from app.config import Settings
from app.models import (
    Channel,
    Delivery,
    DeliveryStatus,
    Notification,
    NotificationStatus,
    PushDevice,
    Template,
)
from app.recipients import DirectoryUnavailable, RecipientDirectory, RecipientNotFound
from app.rendering import TemplateError, render_message

logger = structlog.get_logger(__name__)

# A delivery in one of these has finished. Fan-out running again must not
# resurrect it, or a completed send becomes a second email.
_TERMINAL = (DeliveryStatus.SENT, DeliveryStatus.FAILED, DeliveryStatus.DEAD)

_UNIQUE = "uq_deliveries_notification_channel_device"


class _Permanent(Exception):
    """This channel cannot be delivered, now or ever. Record it and move on."""


class _Retryable(Exception):
    """Something outside this process was unavailable. Do not acknowledge."""


async def _find_template(
    session: AsyncSession, *, project_id: uuid.UUID, key: str, channel: str, locale: str
) -> Template | None:
    """The active template for this channel, preferring the asked-for locale.

    Falls back to 'en'. A missing translation should send an English message
    rather than nothing at all — the alternative is that adding a locale to a
    caller silently stops their notifications.
    """
    for candidate in (locale, "en") if locale != "en" else (locale,):
        template = await session.scalar(
            select(Template)
            .where(
                Template.project_id == project_id,
                Template.key == key,
                Template.channel == Channel(channel),
                Template.locale == candidate,
                Template.active.is_(True),
            )
            # Highest version wins. Templates are versioned by row so that
            # editing one does not rewrite the history of what was already sent.
            .order_by(Template.version.desc())
            .limit(1)
        )
        if template is not None:
            return template
    return None


class FanoutWorker:
    def __init__(
        self,
        settings: Settings,
        broker: Broker,
        session_factory: async_sessionmaker[AsyncSession],
        directory: RecipientDirectory,
        consumer_name: str,
    ) -> None:
        self._settings = settings
        self._broker = broker
        self._sessions = session_factory
        self._directory = directory
        self._consumer = consumer_name
        self.topic = events.TOPIC_NOTIFICATION_CREATED

    async def run(self, stop: asyncio.Event) -> None:
        logger.info("fanout_started", topic=self.topic, consumer=self._consumer)
        while not stop.is_set():
            try:
                messages = await self._broker.consume(
                    self.topic,
                    consumer=self._consumer,
                    count=self._settings.consume_batch,
                    block_ms=self._settings.consume_block_ms,
                )
            except BrokerError:
                logger.exception("fanout_consume_failed")
                # Back off rather than spin. Redis being down is not something
                # this loop can fix by asking more often.
                try:
                    await asyncio.wait_for(stop.wait(), timeout=2.0)
                except TimeoutError:
                    pass
                continue

            for message in messages:
                await self.handle(message)
        logger.info("fanout_stopped")

    async def handle(self, message: Message) -> None:
        try:
            await self.process(message)
        except _Retryable as exc:
            # Deliberately not acknowledged, so the message stays in the pending
            # list and the reclaimer redelivers it.
            logger.warning(
                "fanout_deferred",
                event_id=str(message.event_id),
                reason=str(exc),
                detail="left pending for the reclaimer",
            )
            return
        except Exception:
            # An unexpected exception here is a bug, and acknowledging would hide
            # it by discarding the message. Left pending instead — but only up to
            # a point: a message that crashes every consumer it touches is
            # dead-lettered rather than reclaimed forever.
            logger.exception("fanout_failed", event_id=str(message.event_id))
            if message.delivery_count >= self._settings.retry_max_attempts:
                await self._broker.dead_letter(
                    self.topic,
                    message=message,
                    error=(
                        "fan-out raised repeatedly; "
                        f"{message.delivery_count} deliveries attempted"
                    ),
                )
                await self._broker.ack(self.topic, message.handle)
            return

        await self._broker.ack(self.topic, message.handle)

    async def process(self, message: Message) -> None:
        payload = message.payload
        notification_id = uuid.UUID(payload["notification_id"])
        project_id = uuid.UUID(payload["project_id"])
        project_key = str(payload.get("project_key") or "")
        recipient_id = uuid.UUID(payload["recipient"]["id"])
        channels: list[str] = list(payload.get("channels") or [])
        template_key = str(payload["template_key"])
        locale = str(payload.get("locale") or "en")
        variables: dict = payload.get("payload") or {}

        # (delivery_id, channel) for everything that needs a message publishing.
        to_publish: list[tuple[uuid.UUID, str]] = []
        permanent_failures = 0

        async with self._sessions() as session:
            for channel in channels:
                try:
                    prepared = await self._prepare(
                        session,
                        notification_id=notification_id,
                        project_id=project_id,
                        recipient_id=recipient_id,
                        channel=channel,
                        template_key=template_key,
                        locale=locale,
                        variables=variables,
                    )
                except _Permanent as exc:
                    permanent_failures += 1
                    await self._record_failure(
                        session,
                        notification_id=notification_id,
                        project_id=project_id,
                        channel=channel,
                        error=str(exc),
                    )
                    logger.warning(
                        "fanout_channel_failed",
                        notification_id=str(notification_id),
                        channel=channel,
                        error=str(exc),
                    )
                    continue

                to_publish.extend((delivery_id, channel) for delivery_id in prepared)

            notification = await session.get(Notification, notification_id)
            if notification is not None and notification.status == NotificationStatus.ACCEPTED:
                notification.status = (
                    NotificationStatus.FAILED
                    if channels and permanent_failures == len(channels)
                    else NotificationStatus.FANNED_OUT
                )

            # Committed before anything is published. A message published for a
            # row that was then rolled back is a worker chasing a delivery that
            # does not exist.
            await session.commit()

        # A crash here leaves rows PENDING with no message — which is precisely
        # the case _prepare repairs on the next delivery of this same message.
        for delivery_id, channel in to_publish:
            event = events.delivery_requested(
                delivery_id=delivery_id,
                notification_id=notification_id,
                project_id=project_id,
                project_key=project_key,
                recipient_id=recipient_id,
                channel=channel,
            )
            try:
                await self._broker.publish(
                    event.topic,
                    event_id=event.event_id,
                    partition_key=event.partition_key,
                    payload=event.to_payload(),
                )
            except BrokerError as exc:
                # The rows are committed, so nothing is lost: not acknowledging
                # brings this whole message back and the remaining publishes
                # happen then.
                raise _Retryable(f"could not publish delivery message: {exc}") from exc

        logger.info(
            "notification_fanned_out",
            notification_id=str(notification_id),
            project=project_key,
            channels=channels,
            published=len(to_publish),
            failed=permanent_failures,
        )

    async def _prepare(
        self,
        session: AsyncSession,
        *,
        notification_id: uuid.UUID,
        project_id: uuid.UUID,
        recipient_id: uuid.UUID,
        channel: str,
        template_key: str,
        locale: str,
        variables: dict,
    ) -> list[uuid.UUID]:
        """Write the delivery rows. Returns the ids that need a message published."""
        template = await _find_template(
            session, project_id=project_id, key=template_key, channel=channel, locale=locale
        )
        if template is None:
            raise _Permanent(
                f"no active '{template_key}' template for channel '{channel}' "
                f"in locale '{locale}' (or 'en')"
            )

        # Rendered here purely to fail fast. The result is discarded: the channel
        # worker renders again at send time, so that correcting a template between
        # attempts actually takes effect.
        try:
            render_message(subject=template.subject, body=template.body, payload=variables)
        except TemplateError as exc:
            raise _Permanent(f"template '{template_key}' cannot be rendered: {exc}") from exc

        targets = await self._targets(session, recipient_id=recipient_id, channel=channel)

        publish: list[uuid.UUID] = []
        for address, device_id in targets:
            delivery_id = await self._upsert(
                session,
                notification_id=notification_id,
                project_id=project_id,
                channel=channel,
                address=address,
                device_id=device_id,
                template_id=template.id,
            )
            if delivery_id is not None:
                publish.append(delivery_id)
        return publish

    async def _targets(
        self, session: AsyncSession, *, recipient_id: uuid.UUID, channel: str
    ) -> list[tuple[str, uuid.UUID | None]]:
        """(address, device_id) pairs for one channel; device_id is set for push only."""
        if channel == Channel.PUSH.value:
            devices = (
                await session.execute(
                    select(PushDevice.token, PushDevice.id)
                    .where(PushDevice.user_sub == recipient_id, PushDevice.active.is_(True))
                    .order_by(PushDevice.created_at)
                )
            ).all()
            if not devices:
                raise _Permanent(f"user {recipient_id} has no active push devices")
            return [(token, device_id) for token, device_id in devices]

        try:
            profile = await self._directory.resolve(recipient_id)
            return [(profile.address_for(channel), None)]
        except RecipientNotFound as exc:
            raise _Permanent(str(exc)) from exc
        except DirectoryUnavailable as exc:
            raise _Retryable(str(exc)) from exc

    async def _upsert(
        self,
        session: AsyncSession,
        *,
        notification_id: uuid.UUID,
        project_id: uuid.UUID,
        channel: str,
        address: str,
        device_id: uuid.UUID | None,
        template_id: uuid.UUID,
    ) -> uuid.UUID | None:
        """Insert or refresh one delivery row; its id if it still needs sending."""
        # ON CONFLICT DO UPDATE rather than DO NOTHING, so the row comes back
        # either way and the status can be inspected. DO NOTHING returns no row
        # on conflict, which is what makes the "crashed before publishing" case
        # invisible.
        statement = (
            pg_insert(Delivery)
            .values(
                id=uuid.uuid4(),
                notification_id=notification_id,
                project_id=project_id,
                channel=Channel(channel),
                status=DeliveryStatus.PENDING,
                address=address,
                device_id=device_id,
                template_id=template_id,
            )
            .on_conflict_do_update(
                constraint=_UNIQUE,
                # Refresh the address: the account may have been corrected since
                # the first attempt, and that is usually why it is being retried.
                set_={"address": address},
            )
            .returning(Delivery.id, Delivery.status)
        )
        row = (await session.execute(statement)).one()
        delivery_id, status = row[0], row[1]

        if status in _TERMINAL:
            # Already finished. Republishing would send a second copy of a
            # message somebody has already received.
            logger.info(
                "fanout_skipped_terminal_delivery",
                delivery_id=str(delivery_id),
                channel=channel,
                status=status.value,
            )
            return None
        return delivery_id

    async def _record_failure(
        self,
        session: AsyncSession,
        *,
        notification_id: uuid.UUID,
        project_id: uuid.UUID,
        channel: str,
        error: str,
    ) -> None:
        """Write the permanent failure down, rather than leaving a gap.

        A channel that fails at fan-out has no row at all unless one is made
        here, and "no row" is indistinguishable from "not asked for". Somebody
        asking why no email arrived deserves a row that says why.
        """
        statement = (
            pg_insert(Delivery)
            .values(
                id=uuid.uuid4(),
                notification_id=notification_id,
                project_id=project_id,
                channel=Channel(channel),
                status=DeliveryStatus.FAILED,
                last_error=error[:2000],
            )
            .on_conflict_do_update(
                constraint=_UNIQUE,
                set_={"status": DeliveryStatus.FAILED, "last_error": error[:2000]},
                # Do not overwrite a delivery that already succeeded. Reachable
                # when a template is deactivated between two runs of fan-out for
                # the same notification.
                where=Delivery.status.notin_(_TERMINAL),
            )
        )
        await session.execute(statement)
