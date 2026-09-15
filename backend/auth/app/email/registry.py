"""Which email provider to build, decided in one place.

The console provider refuses to be constructed in production and the SMTP
provider refuses to be constructed without a host, so a misconfiguration is a
process that will not start rather than a service that accepts logins and
silently sends nothing.
"""

from __future__ import annotations

from app.config import Settings
from app.email.base import EmailProvider
from app.email.console import ConsoleEmailProvider
from app.email.smtp import SmtpEmailProvider
from app.email.stub import StubEmailProvider


def build_email_provider(settings: Settings) -> EmailProvider:
    if settings.email_otp_provider == "console":
        return ConsoleEmailProvider(settings.env)
    if settings.email_otp_provider == "stub":
        return StubEmailProvider()
    return SmtpEmailProvider(
        host=settings.auth_smtp_host,
        port=settings.auth_smtp_port,
        username=settings.auth_smtp_username,
        password=settings.auth_smtp_password,
        use_starttls=settings.auth_smtp_starttls,
        use_ssl=settings.auth_smtp_ssl,
        sender=settings.auth_email_from,
        sender_name=settings.auth_email_from_name,
        timeout=settings.sms_timeout_seconds,
        ttl_seconds=settings.otp_ttl_seconds,
    )
