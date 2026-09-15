"""What a delivery channel is.

One method that matters — send — and an exception hierarchy that carries the one
decision the delivery worker cannot make for itself.

## The classification is the point

Whether a failure is retryable is a fact about the provider's answer, and only
the adapter that spoke to the provider knows it. SMTP says so in the first digit
of its reply code: 4xx is "try again", 5xx is "do not". An HTTP provider says it
in a status code and its own error body. The worker sees neither, so if the
worker tried to classify, it would be pattern-matching on error strings — which
works until a provider rewords a message.

Getting this wrong is expensive in both directions:

  * a permanent failure treated as retryable burns five attempts over an hour
    re-sending to an address that does not exist, and only then records it
  * a retryable failure treated as permanent throws a message away because the
    provider was briefly busy

So the adapter raises one or the other, deliberately, and the worker only obeys.

## invalid_address

A permanent failure that names the address as the cause is different from one
that names the message. `PermanentError(invalid_address=True)` tells the worker
the account's address is bad, and the worker acts on it rather than merely
recording it — otherwise every future notification to that person repeats the
same five attempts to learn the same thing.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


class ChannelError(Exception):
    """Base for anything a channel adapter reports about a send."""


class RetryableError(ChannelError):
    """The send failed and might succeed later. Goes on the retry ladder."""


class PermanentError(ChannelError):
    """The send failed and will fail identically forever. No retries.

    invalid_address means the recipient's address is the reason — a rejected
    mailbox, a number that is not a number. The worker then marks the address
    unusable rather than only recording the error.
    """

    def __init__(self, message: str, *, invalid_address: bool = False) -> None:
        super().__init__(message)
        self.invalid_address = invalid_address


@dataclass(frozen=True)
class Outgoing:
    """One rendered message, ready to hand to a provider."""

    to: str
    body: str
    subject: str | None = None
    # Carried so the adapter can stamp them on the provider's own record — an
    # SMTP header, an API metadata field. When a provider's support desk asks
    # which message you mean, this is the answer.
    notification_id: uuid.UUID | None = None
    delivery_id: uuid.UUID | None = None


@dataclass(frozen=True)
class SendResult:
    """What the provider said when it accepted the message.

    provider_message_id is stored on the delivery row. Without it, "we sent it"
    is an assertion with nothing behind it; with it, a message can be traced in
    the provider's own logs, which is the only place that knows what happened
    after it left here.
    """

    provider_message_id: str | None = None
    detail: str | None = None


@runtime_checkable
class Channel(Protocol):
    """A way of getting a rendered message to a person."""

    name: str

    async def send(self, message: Outgoing) -> SendResult:
        """Deliver one message.

        Raises RetryableError or PermanentError. Any other exception escaping
        this is treated as retryable by the worker, because an unclassified
        failure is more likely a bug here than a permanent fact about the
        recipient — and the recoverable mistake is the one to make.
        """
        ...

    async def close(self) -> None:
        ...
