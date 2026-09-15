"""What an SMS provider has to be able to do.

Two shapes exist, and the difference reaches the OTP lifecycle rather than
stopping at this module:

  * We mint the code and the provider carries it (`send_code`). The hash lives in
    our store and we verify it ourselves.
  * The provider mints the code, sends it, and hands back a session id
    (`start_session` / `verify_session`). The code never enters this process, so
    there is nothing here to hash and verification is a call back out.

2factor.in's OTP product is the second kind. A plain SMS gateway is the first.
Both are supported because the second is cheaper to operate and the first is the
only one that works on a laptop, in tests, and with no provider account at all.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


class SmsError(Exception):
    """The message could not be handed to the provider.

    Transient from the caller's point of view: the response is 503 and no code is
    left pending, so the next attempt starts clean rather than colliding with a
    code that was never delivered.
    """


@runtime_checkable
class SmsProvider(Protocol):
    #: True when the provider generates and checks the code itself.
    verifies_own_code: bool

    async def send_code(self, phone: str, code: str) -> None:
        """Carry a code we generated. Raise SmsError if it was not accepted."""
        ...

    async def start_session(self, phone: str) -> str:
        """Have the provider generate and send a code. Returns its session id."""
        ...

    async def verify_session(self, session_id: str, code: str) -> bool:
        """Ask the provider whether the code matches the session."""
        ...
