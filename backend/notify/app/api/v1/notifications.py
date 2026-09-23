"""POST /v1/notifications — ingestion.

Three things happen here and they are the whole of Friday's work:

1.  Authorisation is resolved from the token's azp claim, never from the body.
2.  The notification row and its outbox row are written in ONE transaction.
3.  Idempotency is a unique constraint plus a caught IntegrityError.

On (3): there is no pre-check SELECT. Two concurrent requests carrying the same
key both pass a pre-check and both insert, so a pre-check races. It passes every
test anyone writes for it, and then fails in production under exactly the retry
storm it was added to handle.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, HTTPException, Path, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import events
from app.dependencies import CurrentProject, DbSession
from app.models import Delivery, Notification, OutboxEvent, RecipientType
from app.schemas import (
    DeliveryList,
    DeliveryResponse,
    ErrorResponse,
    NotificationAccepted,
    NotificationCreate,
    Recipient,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])

# The constraint whose violation means "this is a replay" rather than "this is a
# bug". Matched by name: any other integrity error must not be swallowed as an
# idempotent replay, because that would turn a foreign-key violation into a
# silent success.
_IDEMPOTENCY_CONSTRAINT = "uq_notifications_idempotency"


def _to_response(notification: Notification) -> NotificationAccepted:
    return NotificationAccepted(
        id=notification.id,
        status=notification.status,
        idempotency_key=notification.idempotency_key,
        recipient=Recipient(
            type=notification.recipient_type.value, id=notification.recipient_id
        ),
        channels=list(notification.channels),
        created_at=notification.created_at,
    )


def _is_idempotency_violation(exc: IntegrityError) -> bool:
    # asyncpg names the constraint on the exception. The string fallback covers
    # a driver that does not, and costs nothing.
    constraint = getattr(exc.orig, "constraint_name", None)
    if constraint:
        return constraint == _IDEMPOTENCY_CONSTRAINT
    return _IDEMPOTENCY_CONSTRAINT in str(exc.orig)


async def _existing(
    session: AsyncSession, project_id: uuid.UUID, idempotency_key: str
) -> Notification | None:
    return await session.scalar(
        select(Notification).where(
            Notification.project_id == project_id,
            Notification.idempotency_key == idempotency_key,
        )
    )


@router.post(
    "",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=NotificationAccepted,
    responses={
        401: {"model": ErrorResponse, "description": "No token, or the token is not acceptable"},
        403: {"model": ErrorResponse, "description": "Valid token, but not for a live project"},
        422: {"description": "The body does not satisfy the contract"},
    },
    summary="Submit a notification for delivery",
)
async def create_notification(
    body: NotificationCreate,
    project: CurrentProject,
    session: DbSession,
    response: Response,
) -> NotificationAccepted:
    """Accept a notification and return 202 without delivering anything.

    202 rather than 201: the notification is accepted, and delivery has not
    happened yet and may still fail. Returning 201 would claim a resource whose
    observable effect — an email arriving — does not exist yet.
    """
    # Read off the ORM object BEFORE the transaction, into plain values.
    #
    # session.rollback() expires every object loaded in this session, including
    # the project the dependency resolved. Touching project.id afterwards then
    # triggers a lazy refresh — synchronous IO inside an async handler, which
    # surfaces as sqlalchemy.exc.MissingGreenlet and a 500 on exactly the
    # idempotent-replay path this code exists to serve.
    project_id = project.id
    project_key = project.key

    notification = Notification(
        project_id=project_id,
        idempotency_key=body.idempotency_key,
        recipient_type=RecipientType(body.recipient.type),
        recipient_id=body.recipient.id,
        template_key=body.template_key,
        locale=body.locale,
        payload=body.payload,
        channels=body.channels,
    )

    try:
        session.add(notification)
        # Flushed rather than committed: this assigns the primary key, so the
        # outbox row can reference it, and it surfaces the unique violation here
        # where it can be handled — while both rows are still one transaction.
        await session.flush()

        event = events.notification_created(
            notification_id=notification.id,
            project_id=project_id,
            project_key=project_key,
            recipient_type=body.recipient.type,
            recipient_id=body.recipient.id,
            template_key=body.template_key,
            locale=body.locale,
            channels=body.channels,
            payload=body.payload,
        )
        session.add(
            OutboxEvent(
                event_id=event.event_id,
                notification_id=notification.id,
                topic=event.topic,
                partition_key=event.partition_key,
                payload=event.to_payload(),
            )
        )

        # The single commit. Either both rows exist or neither does; there is no
        # state in which a notification was accepted and nothing will process it.
        await session.commit()

    except IntegrityError as exc:
        await session.rollback()

        if not _is_idempotency_violation(exc):
            logger.exception("ingestion_integrity_error", project=project_key)
            raise

        replayed = await _existing(session, project_id, body.idempotency_key)
        if replayed is None:
            # The row that caused the violation is gone by the time we look for
            # it. Only reachable if something deleted it in between, which
            # nothing does; a 409 is the honest answer rather than a retry loop.
            logger.error("idempotency_replay_vanished", project=project_key)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency key conflicted but the original could not be read back",
            ) from exc

        logger.info(
            "notification_replayed",
            project=project_key,
            notification_id=str(replayed.id),
            idempotency_key=body.idempotency_key,
        )
        # Same status, same body, byte for byte, including the original
        # created_at. A retrying caller cannot tell the two apart, which is what
        # makes retrying safe. The header is for humans reading a trace.
        response.headers["Idempotent-Replay"] = "true"
        return _to_response(replayed)

    logger.info(
        "notification_accepted",
        project=project_key,
        notification_id=str(notification.id),
        channels=body.channels,
        template_key=body.template_key,
    )
    return _to_response(notification)


@router.get(
    "/{notification_id}",
    response_model=NotificationAccepted,
    responses={404: {"model": ErrorResponse}},
    summary="Read back one notification belonging to the calling project",
)
async def get_notification(
    project: CurrentProject,
    session: DbSession,
    notification_id: Annotated[uuid.UUID, Path()],
) -> NotificationAccepted:
    """Read one notification.

    The project_id predicate is not an optimisation. Another project's
    notification returns 404 and not 403, so this cannot be used to discover
    which ids exist elsewhere.
    """
    notification = await session.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.project_id == project.id,
        )
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such notification")
    return _to_response(notification)


def _redact_address(address: str | None) -> str | None:
    """Enough to recognise a wrong address, not enough to harvest one.

    Anyone holding the project's token can read this, which is a lower bar than
    reading a person's contact details. The domain and first character are what
    make "we sent it to the wrong place" diagnosable.
    """
    if not address:
        return None
    local, separator, domain = address.partition("@")
    if not separator:
        return f"{address[:2]}***"
    return f"{local[:1]}***@{domain}"


@router.get(
    "/{notification_id}/deliveries",
    response_model=DeliveryList,
    responses={404: {"model": ErrorResponse}},
    summary="What happened to each channel's copy of one notification",
)
async def list_deliveries(
    project: CurrentProject,
    session: DbSession,
    notification_id: Annotated[uuid.UUID, Path()],
) -> DeliveryList:
    """The diagnostic surface: did it arrive, and if not, why not.

    v0.1 has no admin console, so this endpoint plus the worker's logs is how a
    delivery is investigated. `attempts` and `last_error` are the two fields that
    answer the question in practice — a status of `retrying` on attempt 3 with a
    `next_attempt_at` four minutes out is a complete account of where a message
    is and what is wrong with it.
    """
    notification = await session.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.project_id == project.id,
        )
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such notification")

    rows = await session.scalars(
        select(Delivery)
        .where(
            Delivery.notification_id == notification_id,
            # Belt and braces: the notification is already known to belong to this
            # project, and a tenancy predicate on every project-scoped query is
            # cheaper to keep than to remember to add.
            Delivery.project_id == project.id,
        )
        .order_by(Delivery.channel, Delivery.created_at)
    )

    return DeliveryList(
        notification_id=notification_id,
        status=notification.status,
        deliveries=[
            DeliveryResponse(
                id=row.id,
                channel=row.channel.value,
                device_id=row.device_id,
                status=row.status,
                attempts=row.attempts,
                address=_redact_address(row.address),
                provider_message_id=row.provider_message_id,
                last_error=row.last_error,
                next_attempt_at=row.next_attempt_at,
                sent_at=row.sent_at,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ],
    )

