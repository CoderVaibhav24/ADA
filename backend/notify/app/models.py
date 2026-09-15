"""The v0.1 data model.

Five tables: projects, templates, notifications, deliveries, outbox.
user_preferences, inapp_messages and audit_log are deliberately absent — no
channel needs preferences while email is the only one, and Keycloak's realm
events carry the audit for v0.1 (build-plan.md, Friday 28 August).

Two things in here are on the list of six not to cut at any pace: the unique
constraint on (project_id, idempotency_key), and the outbox table that makes
"row written" and "event published" one transaction rather than two.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    # server_default rather than a Python default: the database's clock is the
    # one that orders rows, and it is the same clock for every worker.
    return mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )


def _updated_at() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Channel(str, enum.Enum):
    """Delivery channels.

    Only EMAIL is implemented in v0.1. The rest are named here because this is a
    native PostgreSQL enum type: adding a value later is a migration, and having
    the values present from the start makes each new channel one Channel
    implementation rather than a migration plus a deploy-ordering problem.

    A request naming an unimplemented channel is refused at the API boundary
    (schemas.ENABLED_CHANNELS), not here.
    """

    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    INAPP = "inapp"
    SSE = "sse"


class NotificationStatus(str, enum.Enum):
    ACCEPTED = "accepted"  # written; outbox row pending
    FANNED_OUT = "fanned_out"  # deliveries rows created
    COMPLETED = "completed"  # every delivery reached a terminal state
    FAILED = "failed"  # fan-out itself failed, e.g. no template


class DeliveryStatus(str, enum.Enum):
    PENDING = "pending"
    SENDING = "sending"
    SENT = "sent"
    RETRYING = "retrying"
    FAILED = "failed"  # permanent, classified by the channel adapter
    DEAD = "dead"  # retries exhausted, in the DLQ


class RecipientType(str, enum.Enum):
    """The closed recipient identifier space (AD-8).

    One member, and it stays that way. Multiple identifier spaces produce silent
    empty-result defects that nothing reports — a caller passes an email address
    where a subject is expected, no row matches, and the send is dropped with no
    error recorded anywhere.
    """

    KC_SUB = "kc_sub"


def _pg_enum(python_enum: type[enum.Enum], name: str) -> Enum:
    """A native PostgreSQL enum storing the *values*, not the member names.

    Without values_callable SQLAlchemy persists 'EMAIL' rather than 'email',
    which then disagrees with every hand-written SQL query and with the JSON on
    the wire.
    """
    return Enum(python_enum, name=name, values_callable=lambda e: [m.value for m in e])


_channel_enum = _pg_enum(Channel, "channel")
_notification_status_enum = _pg_enum(NotificationStatus, "notification_status")
_delivery_status_enum = _pg_enum(DeliveryStatus, "delivery_status")
_recipient_type_enum = _pg_enum(RecipientType, "recipient_type")


class Project(Base):
    """A consuming application: HRMS, PMS, ADA.

    client_id is the Keycloak confidential client whose service account submits
    notifications, and it is what the 'azp' claim on an incoming machine token is
    matched against. That match is the entire tenancy boundary — a project can
    only ever address rows whose project_id is its own.
    """

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = _uuid_pk()
    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    templates: Mapped[list[Template]] = relationship(back_populates="project")

    __table_args__ = (
        CheckConstraint("key ~ '^[a-z0-9][a-z0-9_-]*$'", name="ck_projects_key_slug"),
    )


class Template(Base):
    """A renderable message body for one project, key, channel and locale.

    Versioned by row rather than in place: a delivery records which template
    produced it, and editing a template must not rewrite the history of what has
    already been sent.
    """

    __tablename__ = "templates"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    channel: Mapped[Channel] = mapped_column(_channel_enum, nullable=False)
    locale: Mapped[str] = mapped_column(String(16), nullable=False, server_default="en")
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    # NULL for channels with no subject line, required for email. Enforced by the
    # check constraint below rather than by convention.
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    project: Mapped[Project] = relationship(back_populates="templates")

    __table_args__ = (
        UniqueConstraint(
            "project_id", "key", "channel", "locale", "version", name="uq_templates_identity"
        ),
        CheckConstraint(
            "channel <> 'email' OR subject IS NOT NULL", name="ck_templates_email_has_subject"
        ),
        # Partial: fan-out only ever selects the active row, and the inactive
        # history is what this table accumulates.
        Index(
            "ix_templates_active_lookup",
            "project_id",
            "key",
            "channel",
            "locale",
            postgresql_where=text("active"),
        ),
    )


class Notification(Base):
    """One accepted submission, written in the same transaction as its outbox row.

    The unique constraint on (project_id, idempotency_key) is the idempotency
    mechanism in full. There is no pre-check SELECT anywhere in the ingestion
    path: two concurrent requests carrying the same key both pass a pre-check and
    both insert, and that race is invisible in every test written before it fails
    in production. The insert is attempted and the integrity error is caught.
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)

    recipient_type: Mapped[RecipientType] = mapped_column(_recipient_type_enum, nullable=False)
    recipient_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)

    template_key: Mapped[str] = mapped_column(String(128), nullable=False)
    locale: Mapped[str] = mapped_column(String(16), nullable=False, server_default="en")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")

    # The channels the caller asked for. One or several — the caller chooses, and
    # a single-channel request is as valid as a multi-channel one.
    channels: Mapped[list[str]] = mapped_column(JSONB, nullable=False)

    status: Mapped[NotificationStatus] = mapped_column(
        _notification_status_enum, nullable=False, server_default=NotificationStatus.ACCEPTED.value
    )
    created_at: Mapped[datetime] = _created_at()

    deliveries: Mapped[list[Delivery]] = relationship(back_populates="notification")

    __table_args__ = (
        # Not to be cut. The alternative is deduplication logic over historical
        # data, and it is not equivalent.
        UniqueConstraint("project_id", "idempotency_key", name="uq_notifications_idempotency"),
        Index("ix_notifications_project_created", "project_id", "created_at"),
        Index("ix_notifications_recipient", "project_id", "recipient_id"),
        CheckConstraint(
            "jsonb_typeof(channels) = 'array'", name="ck_notifications_channels_array"
        ),
        CheckConstraint(
            "jsonb_array_length(channels) > 0", name="ck_notifications_channels_nonempty"
        ),
    )


class Delivery(Base):
    """One attempt-tracked send of one notification down one channel."""

    __tablename__ = "deliveries"

    id: Mapped[uuid.UUID] = _uuid_pk()
    notification_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False
    )
    # Denormalised from the notification so that every tenancy-scoped query and
    # every index on this table can filter without a join.
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )

    channel: Mapped[Channel] = mapped_column(_channel_enum, nullable=False)
    status: Mapped[DeliveryStatus] = mapped_column(
        _delivery_status_enum, nullable=False, server_default=DeliveryStatus.PENDING.value
    )

    # The resolved destination — an email address, a phone number, a device
    # token. Populated at fan-out, not at ingestion: ingestion knows a subject,
    # not an address.
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("templates.id", ondelete="SET NULL"), nullable=True
    )

    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Set by the retry ladder. NULL means eligible now.
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    notification: Mapped[Notification] = relationship(back_populates="deliveries")

    __table_args__ = (
        # Fan-out is at-least-once, so it can run twice for the same message.
        # This is what makes the second run a no-op rather than a duplicate email.
        UniqueConstraint("notification_id", "channel", name="uq_deliveries_notification_channel"),
        Index("ix_deliveries_status_due", "status", "next_attempt_at"),
        Index("ix_deliveries_project_created", "project_id", "created_at"),
        CheckConstraint("attempts >= 0", name="ck_deliveries_attempts_nonnegative"),
    )


class OutboxEvent(Base):
    """The transactional outbox.

    Written in the same transaction as the notification it describes, so there is
    no window in which a notification exists but nothing will ever process it,
    and none in which an event is published for a row that was rolled back. A
    dispatcher polls unpublished rows and hands them to the broker.

    published_at NULL means unpublished. The partial index below is the one the
    dispatcher uses; a full index on published_at would grow without bound while
    only ever being read for the NULLs.
    """

    __tablename__ = "outbox"

    # BIGSERIAL rather than a UUID: the dispatcher reads this table in insertion
    # order, and a monotonic key makes "everything after X" a range scan.
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # The broker-level event identity, ours rather than Redis's. Carried into the
    # Event envelope so a consumer can deduplicate across a reclaim.
    event_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), nullable=False, unique=True, default=uuid.uuid4
    )

    notification_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False
    )
    topic: Mapped[str] = mapped_column(String(128), nullable=False)

    # Redis Streams ignores this. Kafka would partition on it, and setting it at
    # write time is what makes the broker swap a configuration change rather than
    # a data migration (AD-3). Recipient-keyed, so one recipient's messages stay
    # ordered relative to each other.
    partition_key: Mapped[str] = mapped_column(String(255), nullable=False)

    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)

    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _created_at()

    __table_args__ = (
        Index("ix_outbox_unpublished", "id", postgresql_where=text("published_at IS NULL")),
    )
