"""Which adapter serves which channel.

The registry is what keeps ENABLED_CHANNELS in schemas.py and the worker's set of
consumers derived from one place, rather than being two lists that can disagree.
A channel accepted at the API boundary with no adapter behind it produces
notifications that are accepted, fanned out, and then consumed by nobody — which
looks exactly like success, right up until someone asks why no message arrived.
"""

from __future__ import annotations

import structlog

from app.channels.base import Channel
from app.channels.email import EmailChannel, FailingEmailChannel, StubEmailChannel
from app.channels.push import FailingPushChannel, PushChannel, StubPushChannel
from app.config import Settings

logger = structlog.get_logger(__name__)

_EMAIL_PROVIDERS = {
    "smtp": EmailChannel,
    "stub": StubEmailChannel,
    "failing_stub": FailingEmailChannel,
}

_PUSH_PROVIDERS = {
    "native": PushChannel,
    "stub": StubPushChannel,
    "failing_stub": FailingPushChannel,
}


def create_channels(settings: Settings) -> dict[str, Channel]:
    """Build every channel this deployment can deliver on, keyed by name."""
    provider = _EMAIL_PROVIDERS[settings.email_provider]
    channels: dict[str, Channel] = {
        "email": provider(settings),
        # Always registered, even with no credentials: a push delivery then fails
        # with a stated reason instead of sitting on a topic nobody consumes.
        "push": _PUSH_PROVIDERS[settings.push_provider](settings),
    }

    logger.info(
        "channels_ready",
        channels=sorted(channels),
        email_provider=settings.email_provider,
        push_provider=settings.push_provider,
    )
    if settings.push_provider != "native":
        logger.warning(
            "push_provider_is_not_native",
            provider=settings.push_provider,
            detail="no real push will be sent",
        )
    if settings.email_provider != "smtp":
        # Loud, because this is the setting that makes a system look healthy
        # while delivering nothing. Someone should have had to decide it.
        logger.warning(
            "email_provider_is_not_smtp",
            provider=settings.email_provider,
            detail="no real mail will be sent",
        )
    return channels
