"""The wire contract for ingestion.

The Recipient type here is one of the six things not to cut. It is closed: one
literal type and a UUID, and no third form. The cost of opening it later is
fixing every caller in every application, which is why five lines now is the
right trade.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import Channel, DeliveryStatus, NotificationStatus

# Every channel the enum knows about is a valid database value. Only these are
# accepted at the API boundary in v0.1. Adding SMS is deleting one line here and
# writing one Channel implementation — no migration, no contract change.
ENABLED_CHANNELS: frozenset[str] = frozenset({Channel.EMAIL.value, Channel.PUSH.value})


class Recipient(BaseModel):
    """Who the notification is for. The closed identifier space, AD-8.

    'kc_sub' is the Keycloak subject: the stable, opaque user id from the token.
    Not an email address, not an employee number, not a phone number. Those are
    application-owned identifier spaces, and accepting more than one of them
    produces silent empty-result defects that nothing reports.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["kc_sub"]
    id: uuid.UUID


class NotificationCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    # The idempotency key is deliberately a plain string rather
                    # than a generated one: sending this body twice from the
                    # docs page is how the replay behaviour is demonstrated, and
                    # a fresh key each time would hide it.
                    "idempotency_key": "swagger-demo-0001",
                    "recipient": {
                        "type": "kc_sub",
                        "id": "6f1b3c7e-2f4a-4f1e-9c3d-5a7b8e9f0a1b",
                    },
                    "template_key": "welcome",
                    "locale": "en",
                    "payload": {"first_name": "Ada"},
                    "channels": ["email"],
                }
            ]
        },
    )

    # Supplied by the caller, unique within the project. Callers that have a
    # natural key — an invoice id, a leave-request id — should use it; the point
    # is that a retried submission carries the same one.
    idempotency_key: Annotated[
        str,
        Field(
            min_length=8,
            max_length=255,
            description=(
                "Unique within the project. Use a natural key where one exists — an "
                "invoice id, a leave-request id. Submitting the same key twice returns "
                "the first notification unchanged instead of creating a second."
            ),
        ),
    ]

    recipient: Recipient
    template_key: Annotated[
        str,
        Field(
            min_length=1,
            max_length=128,
            description="Which stored template renders this message.",
        ),
    ]
    locale: Annotated[
        str, Field(max_length=16, description="Template locale to render in.")
    ] = "en"

    # Substituted into the template at fan-out.
    payload: dict = Field(
        default_factory=dict,
        description="Values substituted into the template when it is rendered.",
    )

    # One channel or several — the caller decides. There is no default and no
    # implicit fan-out to everything: a caller that does not say where a message
    # should go has not finished writing the call.
    channels: Annotated[
        list[str],
        Field(
            min_length=1,
            max_length=len(Channel),
            description=(
                "Where to deliver. One or several — the caller chooses, and there is no "
                "default: a call that does not say where a message should go is not "
                "finished. Deliverable in this release: "
                + ", ".join(sorted(ENABLED_CHANNELS))
                + "."
            ),
        ),
    ]

    @field_validator("channels")
    @classmethod
    def _known_and_enabled(cls, value: list[str]) -> list[str]:
        # Order-preserving deduplication. A caller repeating a channel means one
        # delivery, not two, and the unique constraint on deliveries would
        # otherwise turn a harmless duplicate into a 500.
        seen: dict[str, None] = dict.fromkeys(value)
        deduplicated = list(seen)

        unknown = [c for c in deduplicated if c not in {m.value for m in Channel}]
        if unknown:
            raise ValueError(
                f"unknown channel(s): {', '.join(sorted(unknown))}. "
                f"Known: {', '.join(sorted(m.value for m in Channel))}"
            )

        disabled = [c for c in deduplicated if c not in ENABLED_CHANNELS]
        if disabled:
            raise ValueError(
                f"channel(s) not available in this release: {', '.join(sorted(disabled))}. "
                f"Currently deliverable: {', '.join(sorted(ENABLED_CHANNELS))}"
            )
        return deduplicated

    @field_validator("idempotency_key")
    @classmethod
    def _no_surrounding_space(cls, value: str) -> str:
        # ' abc' and 'abc' are different keys to a unique index and the same key
        # to a human reading a log, which is the worst combination.
        stripped = value.strip()
        if stripped != value:
            raise ValueError("idempotency_key must not have leading or trailing whitespace")
        return stripped


class NotificationAccepted(BaseModel):
    """The 202 body.

    A replayed idempotency key returns this same body, byte for byte, including
    the original created_at. A caller that retries cannot tell the difference,
    which is the whole point — it can retry freely.
    """

    id: uuid.UUID
    status: NotificationStatus
    idempotency_key: str
    recipient: Recipient
    channels: list[str]
    created_at: datetime


class ErrorResponse(BaseModel):
    error: str
    detail: str


# --- Templates --------------------------------------------------------------


def _assert_placeholders_are_wellformed(text: str) -> None:
    # Imported inside the function rather than at module scope, so that the
    # rendering module stays out of the import graph used to generate the
    # OpenAPI document.
    from app.rendering import _ANY_PLACEHOLDER, _PLACEHOLDER

    remaining = _PLACEHOLDER.sub("", text)
    malformed = _ANY_PLACEHOLDER.search(remaining)
    if malformed:
        raise ValueError(
            f"malformed placeholder {malformed.group(0)[:60]!r}. "
            "Placeholders look like {{ first_name }} or {{ request.id }} — "
            "letters, digits and underscores, optionally separated by dots."
        )


class TemplateCreate(BaseModel):
    """A new template version for the calling project.

    There is no update. Posting the same key, channel and locale again creates
    the next version and deactivates the previous one, because a delivery records
    which template produced it and editing a row in place would rewrite the
    history of what has already been sent.
    """

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "key": "welcome",
                    "channel": "email",
                    "locale": "en",
                    "subject": "Welcome to ADA, {{ first_name }}",
                    "body": "Hello {{ first_name }},\n\nYour account is ready.\n\n— ADA\n",
                }
            ]
        },
    )

    key: Annotated[str, Field(min_length=1, max_length=128)]
    channel: Annotated[
        str,
        Field(description="Deliverable in this release: " + ", ".join(sorted(ENABLED_CHANNELS))),
    ]
    locale: Annotated[str, Field(max_length=16)] = "en"
    subject: Annotated[str | None, Field(max_length=998)] = None
    body: Annotated[str, Field(min_length=1)]

    @field_validator("channel")
    @classmethod
    def _enabled(cls, value: str) -> str:
        if value not in ENABLED_CHANNELS:
            raise ValueError(
                f"channel '{value}' is not deliverable in this release. "
                f"Currently deliverable: {', '.join(sorted(ENABLED_CHANNELS))}"
            )
        return value

    @field_validator("body")
    @classmethod
    def _renderable(cls, value: str) -> str:
        # Checked at write time, not at send time. A template with a malformed
        # placeholder discovered during delivery fails one message at a time,
        # hours later, for a caller who never sees the error.
        _assert_placeholders_are_wellformed(value)
        return value

    @field_validator("subject")
    @classmethod
    def _subject_renderable(cls, value: str | None) -> str | None:
        if value is not None:
            _assert_placeholders_are_wellformed(value)
        return value


class TemplateResponse(BaseModel):
    id: uuid.UUID
    key: str
    channel: str
    locale: str
    version: int
    subject: str | None
    body: str
    active: bool
    created_at: datetime


# --- Deliveries -------------------------------------------------------------


class DeliveryResponse(BaseModel):
    """What actually happened to one channel's copy of a notification.

    This is the diagnostic surface for v0.1: there is no admin console, so the
    answer to "did it arrive, and if not why not" is this endpoint plus the
    worker's delivery logs.
    """

    id: uuid.UUID
    channel: str
    # Push only: which registered device this copy went to.
    device_id: uuid.UUID | None = None
    status: DeliveryStatus
    attempts: int
    # Redacted before it leaves the handler. A delivery record is readable by
    # anyone holding the project's token, which is a lower bar than reading the
    # recipient's address.
    address: str | None
    provider_message_id: str | None
    last_error: str | None
    next_attempt_at: datetime | None
    sent_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DeliveryList(BaseModel):
    notification_id: uuid.UUID
    status: NotificationStatus
    deliveries: list[DeliveryResponse]


# --- End-user endpoints (/v1/me) -------------------------------------------


class DeviceRegister(BaseModel):
    """Register or refresh this install's native push token. Idempotent on token."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "platform": "ios",
                    "token": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
                    "apns_environment": "sandbox",
                    "app_version": "1.0.0 (42)",
                }
            ]
        },
    )

    platform: Literal["android", "ios"]
    # Native FCM registration token (Android) or hex APNs device token (iOS).
    token: Annotated[str, Field(min_length=16, max_length=4096, pattern=r"^[A-Za-z0-9:_\-]+$")]
    # Required for iOS, forbidden for Android: dev builds get sandbox tokens.
    apns_environment: Literal["sandbox", "production"] | None = None
    app_version: Annotated[str | None, Field(max_length=64)] = None

    @model_validator(mode="after")
    def _environment_matches_platform(self) -> DeviceRegister:
        if self.platform == "ios" and self.apns_environment is None:
            raise ValueError("apns_environment is required for iOS ('sandbox' or 'production')")
        if self.platform == "android" and self.apns_environment is not None:
            raise ValueError("apns_environment applies to iOS only")
        return self


class DeviceUnregister(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: Annotated[str, Field(min_length=16, max_length=4096)]


class DeviceResponse(BaseModel):
    id: uuid.UUID
    platform: str
    apns_environment: str | None
    app_version: str | None
    active: bool
    last_seen: datetime
    created_at: datetime


class InboxItem(BaseModel):
    """One notification addressed to the caller. A routing hint plus display text."""

    id: uuid.UUID
    project: str
    type: str
    case_ref: str | None
    title: str | None
    body: str | None
    read: bool
    read_at: datetime | None
    created_at: datetime


class InboxPage(BaseModel):
    items: list[InboxItem]
    # Opaque; pass back as ?cursor= for the next (older) page. NULL on the last page.
    next_cursor: str | None
    unread_count: int
