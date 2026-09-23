"""What an email provider has to be able to do.

Deliberately narrower than the SMS side. An SMS provider may own the whole code
(2factor.in generates, sends and verifies it), which is why SmsProvider carries
`verifies_own_code` and a session pair. No email provider works that way: we
mint the code, the provider carries the message, and verification is ours. So
this protocol is one method, and the OTP lifecycle for email has exactly one
shape.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


class EmailError(Exception):
    """The message could not be handed to the provider.

    Transient from the caller's point of view: the response is 503 and no code
    is left pending, so the next attempt starts clean rather than colliding
    with a code that was never delivered.
    """


@runtime_checkable
class EmailProvider(Protocol):
    async def send_code(self, address: str, code: str) -> None:
        """Carry a code we generated. Raise EmailError if it was not accepted."""
        ...
