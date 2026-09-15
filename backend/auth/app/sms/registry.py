"""Which SMS provider to build, decided in one place.

The console provider refuses to be constructed in production and the 2factor
provider refuses to be constructed without an API key, so a misconfiguration is
a process that will not start rather than a service that accepts logins and
silently sends nothing.
"""

from __future__ import annotations

import httpx

from app.config import Settings
from app.sms.base import SmsProvider
from app.sms.console import ConsoleSmsProvider
from app.sms.stub import StubSmsProvider
from app.sms.twofactor import TwoFactorSmsProvider


def build_sms_provider(settings: Settings, client: httpx.AsyncClient) -> SmsProvider:
    if settings.sms_provider == "console":
        return ConsoleSmsProvider(settings.env)
    if settings.sms_provider == "stub":
        return StubSmsProvider()
    return TwoFactorSmsProvider(
        api_key=settings.twofactor_api_key,
        template=settings.twofactor_template,
        client=client,
    )
