"""Logs the code instead of sending it. The local default.

This is what makes `make up` produce a working OTP login with no SMS account,
no API key and no spend. It is also why ADA_ENV matters: the code is written
to the service log at WARNING, so anything that can read logs can log in as
anyone whose number it knows.

Refuses to be constructed in production. A missing ADA_SMS_PROVIDER there
would otherwise fall back to the default and turn every OTP into a log line,
which is the single worst failure this service could have.
"""

from __future__ import annotations

import structlog

from app.sms.base import SmsError

logger = structlog.get_logger(__name__)


class ConsoleSmsProvider:
    verifies_own_code = False

    def __init__(self, env: str) -> None:
        if env == "production":
            raise ValueError(
                "sms_provider=console writes OTPs to the service log and must "
                "not run in production; set ADA_SMS_PROVIDER=twofactor"
            )

    async def send_code(self, phone: str, code: str) -> None:
        logger.warning("otp_console_delivery", phone=phone, code=code)

    async def start_session(self, phone: str) -> str:  # pragma: no cover - not this shape
        raise SmsError("the console provider does not generate codes")

    async def verify_session(self, session_id: str, code: str) -> bool:  # pragma: no cover
        raise SmsError("the console provider does not verify codes")
