"""The in-app channel: the notification row is the inbox entry, so nothing leaves the service."""

from __future__ import annotations

from app.channels.base import Outgoing, SendResult
from app.config import Settings

# The delivery address for every in-app copy; there is no device or mailbox.
INBOX_ADDRESS = "inbox"


class InAppChannel:
    """Implements app.channels.base.Channel for 'inapp'. Marks the copy sent; /v1/me reads it."""

    name = "inapp"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def send(self, message: Outgoing) -> SendResult:
        return SendResult(provider_message_id=f"inbox-{message.notification_id}", detail="inbox")

    async def close(self) -> None:
        return None
