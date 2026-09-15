"""Logs the code instead of sending it. The local default.

This is what makes a clean `docker compose up` produce a working email OTP with
no relay, no credentials and no mailbox. It is also why ADA_ENV matters: the
code is written to the service log at WARNING, so anything that can read logs
can sign in as anyone whose address it knows.

Refuses to be constructed in production, for the same reason the console SMS
provider does — a missing ADA_EMAIL_OTP_PROVIDER there would otherwise fall
back to the default and turn every OTP into a log line.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger(__name__)


class ConsoleEmailProvider:
    def __init__(self, env: str) -> None:
        if env == "production":
            raise RuntimeError(
                "the console email provider writes one-time codes to the log and "
                "must never run in production; set ADA_EMAIL_OTP_PROVIDER=smtp"
            )

    async def send_code(self, address: str, code: str) -> None:
        logger.warning("email_otp_console", address=address, code=code)
