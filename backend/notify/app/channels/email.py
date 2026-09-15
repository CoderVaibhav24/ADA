"""The email channel, over SMTP.

SMTP rather than a vendor API because it is what the organisation already has,
and because a provider swap is then a hostname change rather than a code change.
The Channel protocol is what makes an API-based provider a sibling of this file
if that stops being true.

## Classification

SMTP hands us the retryable/permanent decision in the first digit of its reply
code, and this adapter does nothing cleverer than read it:

  4xx  — a transient negative reply. Mailbox busy, greylisted, out of space,
         rate limited. Retryable.
  5xx  — a permanent negative reply. No such mailbox, message refused.
         Permanent, and when it names a recipient, invalid_address.

Authentication failure is the deliberate exception. By the letter of the protocol
it is permanent, but the actual cause is almost always an expired or rotated
credential — something an operator fixes in minutes. Treating it as permanent
would destroy every message sent during that window, so it is retryable and the
retry ladder gives an hour to notice.

## Why plain text

v0.1 sends text/plain. An HTML message needs a plain-text alternative to survive
spam filtering and text-only clients, which means every template becomes two
templates. That is a template-authoring decision rather than a transport one, and
it is not on the critical path for 1 September.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import format_datetime, formataddr, make_msgid, parseaddr

import aiosmtplib
import structlog

from app.channels.base import Outgoing, PermanentError, RetryableError, SendResult
from app.config import Settings

logger = structlog.get_logger(__name__)


def _redact(address: str) -> str:
    """Log the domain and the first character, never the whole address.

    Delivery logs are read by more people than the mailbox belongs to, and a full
    address in a log is a full address in every aggregator downstream of it.
    """
    local, _, domain = address.partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}***@{domain}"


class EmailChannel:
    """Implements app.channels.base.Channel for the 'email' channel."""

    name = "email"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        if not settings.smtp_host:
            raise ValueError(
                "ADA_SMTP_HOST is not set. Set it, or set "
                "ADA_EMAIL_PROVIDER=stub to run without a mail server."
            )
        if not settings.email_from:
            raise ValueError("ADA_EMAIL_FROM is not set; a message needs a sender")

    def _build(self, message: Outgoing) -> tuple[EmailMessage, str]:
        outgoing = EmailMessage()
        outgoing["From"] = formataddr((self._settings.email_from_name, self._settings.email_from))
        outgoing["To"] = message.to
        outgoing["Subject"] = message.subject or "(no subject)"
        # Set explicitly rather than left to the relay. A message with no Date is
        # penalised by spam filters, and one dated by an intermediary is dated
        # whenever its queue happened to drain rather than when it was sent.
        outgoing["Date"] = format_datetime(datetime.now(UTC))

        # Generated here, not by the relay, because it is what gets stored as the
        # provider_message_id. A relay-assigned id is never seen by this process,
        # so "we sent it" would have nothing traceable attached to it.
        domain = self._settings.email_from.rsplit("@", 1)[-1] or "ada"
        message_id = make_msgid(domain=domain)
        outgoing["Message-ID"] = message_id

        # Both ids on the message itself, so a copy found in someone's mailbox can
        # be traced back to a row without asking them to forward it.
        if message.notification_id:
            outgoing["X-ADA-Notification-Id"] = str(message.notification_id)
        if message.delivery_id:
            outgoing["X-ADA-Delivery-Id"] = str(message.delivery_id)

        outgoing.set_content(message.body)
        return outgoing, message_id

    async def send(self, message: Outgoing) -> SendResult:
        # Checked before opening a connection: an address the local parser cannot
        # read will be refused by the server anyway, and refusing here costs no
        # round trip and produces a clearer error.
        if not parseaddr(message.to)[1] or "@" not in message.to:
            raise PermanentError(
                f"'{message.to}' is not a usable email address", invalid_address=True
            )

        outgoing, message_id = self._build(message)

        try:
            await aiosmtplib.send(
                outgoing,
                hostname=self._settings.smtp_host,
                port=self._settings.smtp_port,
                username=self._settings.smtp_username or None,
                password=self._settings.smtp_password or None,
                start_tls=self._settings.smtp_starttls,
                use_tls=self._settings.smtp_ssl,
                timeout=self._settings.email_timeout_seconds,
            )
        except aiosmtplib.SMTPRecipientsRefused as exc:
            # Every recipient rejected. One recipient per message here, so this is
            # unambiguous: the address is the problem.
            codes = [r.code for r in exc.recipients] if exc.recipients else []
            if codes and all(400 <= code < 500 for code in codes):
                raise RetryableError(f"recipient temporarily refused: {codes}") from exc
            raise PermanentError(f"recipient refused: {exc}", invalid_address=True) from exc
        except aiosmtplib.SMTPAuthenticationError as exc:
            # Deliberately retryable. See the module docstring: the usual cause is
            # a rotated credential, and treating it as permanent would discard
            # every message sent before somebody noticed.
            raise RetryableError(f"SMTP authentication failed: {exc}") from exc
        except aiosmtplib.SMTPResponseException as exc:
            if 400 <= exc.code < 500:
                raise RetryableError(f"SMTP {exc.code}: {exc.message}") from exc
            raise PermanentError(f"SMTP {exc.code}: {exc.message}") from exc
        except (aiosmtplib.SMTPConnectError, aiosmtplib.SMTPServerDisconnected) as exc:
            raise RetryableError(f"SMTP connection failed: {exc}") from exc
        except (TimeoutError, OSError) as exc:
            # A timeout is genuinely ambiguous: the message may have been
            # accepted. Retrying can duplicate it, and not retrying can lose it.
            # Duplicating is the recoverable half of that, so it retries.
            raise RetryableError(f"SMTP transport error: {exc}") from exc

        logger.info(
            "email_sent",
            to=_redact(message.to),
            message_id=message_id,
            delivery_id=str(message.delivery_id) if message.delivery_id else None,
        )
        return SendResult(provider_message_id=message_id)

    async def close(self) -> None:
        # aiosmtplib.send opens and closes a connection per message, so nothing is
        # held open. A pooled implementation would close its pool here.
        return None


class StubEmailChannel:
    """Accepts everything and sends nothing. For local work with no mail server."""

    name = "email"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def send(self, message: Outgoing) -> SendResult:
        logger.info(
            "email_stubbed",
            to=_redact(message.to),
            subject=message.subject,
            body_bytes=len(message.body.encode("utf-8")),
        )
        return SendResult(provider_message_id=f"stub-{uuid.uuid4()}", detail="stub provider")

    async def close(self) -> None:
        return None


class FailingEmailChannel:
    """Fails every send, retryably. Exists to prove the retry ladder.

    Definition of done 7: a stub provider that always fails produces exactly five
    attempts on schedule, then a dead-letter entry carrying the final error. That
    is not a property anyone can demonstrate against a working mail server, so the
    always-failing provider is part of the product rather than part of the tests.
    """

    name = "email"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def send(self, message: Outgoing) -> SendResult:
        raise RetryableError(
            "ADA_EMAIL_PROVIDER=failing_stub — this provider refuses every "
            "message on purpose, to exercise the retry ladder"
        )

    async def close(self) -> None:
        return None
