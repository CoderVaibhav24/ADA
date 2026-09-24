"""End-user endpoints: push device registration and the caller's own inbox.

Authenticated with the user's own access token; the Keycloak sub is the only
identity used, so no request can name another user.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, HTTPException, Path, Query, Response, status
from sqlalchemy import func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import CurrentUserSub, DbSession
from app.models import Channel, Notification, Project, PushDevice, Template
from app.rendering import TemplateError, render_message
from app.routing import routing_data
from app.schemas import (
    DeviceRegister,
    DeviceResponse,
    DeviceUnregister,
    ErrorResponse,
    InboxItem,
    InboxPage,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/me", tags=["me"])

_AUTH_RESPONSES: dict = {
    401: {"model": ErrorResponse, "description": "No token, or the token is not acceptable"},
    403: {"model": ErrorResponse, "description": "Not an end-user token from an allowed client"},
}


def _device_response(device: PushDevice) -> DeviceResponse:
    return DeviceResponse(
        id=device.id,
        platform=device.platform,
        apns_environment=device.apns_environment,
        app_version=device.app_version,
        active=device.active,
        last_seen=device.last_seen,
        created_at=device.created_at,
    )


@router.post(
    "/devices",
    response_model=DeviceResponse,
    responses=_AUTH_RESPONSES,
    summary="Register or refresh this device's push token (idempotent on token)",
)
async def register_device(
    body: DeviceRegister, user: CurrentUserSub, session: DbSession
) -> DeviceResponse:
    """Call on sign-in and on every token refresh. Re-binds a token to the caller."""
    previous_owner = await session.scalar(
        select(PushDevice.user_sub).where(PushDevice.token == body.token)
    )
    statement = (
        pg_insert(PushDevice)
        .values(
            id=uuid.uuid4(),
            user_sub=user,
            platform=body.platform,
            token=body.token,
            apns_environment=body.apns_environment,
            app_version=body.app_version,
            active=True,
        )
        .on_conflict_do_update(
            constraint="uq_push_devices_token",
            set_={
                "user_sub": user,
                "platform": body.platform,
                "apns_environment": body.apns_environment,
                "app_version": body.app_version,
                "active": True,
                "deactivated_reason": None,
                "last_seen": func.now(),
                "updated_at": func.now(),
            },
        )
        .returning(PushDevice)
        .execution_options(populate_existing=True)
    )
    device = (await session.scalars(statement)).one()
    response = _device_response(device)
    await session.commit()

    if previous_owner is not None and previous_owner != user:
        # A shared handset: the token now follows whoever signed in last.
        logger.info("push_device_rebound", device_id=str(response.id))
    logger.info(
        "push_device_registered",
        device_id=str(response.id),
        platform=body.platform,
        refreshed=previous_owner is not None,
    )
    return response


@router.post(
    "/devices/unregister",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_AUTH_RESPONSES,
    summary="Stop push to this device (call on sign-out; idempotent)",
)
async def unregister_device(
    body: DeviceUnregister, user: CurrentUserSub, session: DbSession
) -> Response:
    """Deactivates the caller's own row for this token; 204 whether or not one existed."""
    await session.execute(
        update(PushDevice)
        .where(PushDevice.token == body.token, PushDevice.user_sub == user)
        .values(active=False, deactivated_reason="unregistered by user", updated_at=func.now())
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _encode_cursor(created_at: datetime, notification_id: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{notification_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        stamp, _, ident = base64.urlsafe_b64decode(padded).decode().partition("|")
        return datetime.fromisoformat(stamp), uuid.UUID(ident)
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid cursor"
        ) from exc


# The inbox text for a row: the in-app template, else the push one, else (None, None).
async def _display_text(
    session: AsyncSession,
    cache: dict,
    *,
    project_id: uuid.UUID,
    key: str,
    locale: str,
    payload: dict,
) -> tuple[str | None, str | None]:
    lookup = (project_id, key, locale)
    if lookup not in cache:
        template = None
        for channel in (Channel.INAPP, Channel.PUSH):
            for candidate in (locale, "en") if locale != "en" else ("en",):
                template = await session.scalar(
                    select(Template)
                    .where(
                        Template.project_id == project_id,
                        Template.key == key,
                        Template.channel == channel,
                        Template.locale == candidate,
                        Template.active.is_(True),
                    )
                    .order_by(Template.version.desc())
                    .limit(1)
                )
                if template is not None:
                    break
            if template is not None:
                break
        cache[lookup] = (template.subject, template.body) if template else None
    found = cache[lookup]
    if found is None:
        return None, None
    try:
        rendered = render_message(subject=found[0], body=found[1], payload=payload)
    except TemplateError:
        return None, None
    return rendered.subject, rendered.body


@router.get(
    "/notifications",
    response_model=InboxPage,
    responses={**_AUTH_RESPONSES, 400: {"model": ErrorResponse}},
    summary="The caller's notifications, newest first",
)
async def list_my_notifications(
    user: CurrentUserSub,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    project: Annotated[
        str | None, Query(max_length=64, description="Filter by project key, e.g. 'ada'")
    ] = None,
    locale: Annotated[
        str | None,
        Query(max_length=16, description="Render title/body in this locale, e.g. 'hi'"),
    ] = None,
) -> InboxPage:
    query = (
        select(Notification, Project.key)
        .join(Project, Project.id == Notification.project_id)
        .where(Notification.recipient_id == user)
    )
    unread = (
        select(func.count())
        .select_from(Notification)
        .join(Project, Project.id == Notification.project_id)
        .where(Notification.recipient_id == user, Notification.read_at.is_(None))
    )
    if project:
        query = query.where(Project.key == project)
        unread = unread.where(Project.key == project)
    if cursor:
        before_at, before_id = _decode_cursor(cursor)
        query = query.where(
            tuple_(Notification.created_at, Notification.id) < tuple_(before_at, before_id)
        )
    rows = (
        await session.execute(
            query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit + 1)
        )
    ).all()

    cache: dict = {}
    items: list[InboxItem] = []
    for notification, project_key in rows[:limit]:
        payload = dict(notification.payload or {})
        title, text = await _display_text(
            session,
            cache,
            project_id=notification.project_id,
            key=notification.template_key,
            locale=locale or notification.locale,
            payload=payload,
        )
        case_ref = payload.get("case_ref")
        items.append(
            InboxItem(
                id=notification.id,
                project=project_key,
                type=notification.template_key,
                case_ref=str(case_ref) if isinstance(case_ref, (str, int)) else None,
                title=title,
                body=text,
                read=notification.read_at is not None,
                read_at=notification.read_at,
                created_at=notification.created_at,
                data=routing_data(template_key=notification.template_key, payload=payload),
            )
        )

    next_cursor = None
    if len(rows) > limit and items:
        next_cursor = _encode_cursor(items[-1].created_at, items[-1].id)
    unread_count = int(await session.scalar(unread) or 0)
    return InboxPage(items=items, next_cursor=next_cursor, unread_count=unread_count)


@router.post(
    "/notifications/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={**_AUTH_RESPONSES, 404: {"model": ErrorResponse}},
    summary="Mark one of the caller's notifications read (idempotent)",
)
async def mark_read(
    user: CurrentUserSub,
    session: DbSession,
    notification_id: Annotated[uuid.UUID, Path()],
) -> Response:
    """Another user's notification is a 404, never a 403, so ids cannot be probed."""
    exists = await session.scalar(
        select(Notification.id).where(
            Notification.id == notification_id, Notification.recipient_id == user
        )
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such notification")
    # Keeps the first read time when a flaky connection repeats the call.
    await session.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.recipient_id == user,
            Notification.read_at.is_(None),
        )
        .values(read_at=func.now())
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
