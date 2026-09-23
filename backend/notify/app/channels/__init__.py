"""Delivery channels. One adapter per way of reaching a person.

    from app.channels import Channel, Outgoing, PermanentError, RetryableError
    from app.channels import create_channels
"""

from app.channels.base import (
    Channel,
    ChannelError,
    Outgoing,
    PermanentError,
    PushTarget,
    RetryableError,
    SendResult,
)
from app.channels.registry import create_channels

__all__ = [
    "Channel",
    "ChannelError",
    "Outgoing",
    "PermanentError",
    "PushTarget",
    "RetryableError",
    "SendResult",
    "create_channels",
]
