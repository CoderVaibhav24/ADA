"""SMTP, over aiosmtplib.

Deliberately NOT routed through ada-notify, even though that service exists and
owns the estate's email. Two reasons, and the first is the one that decides it:

  * A one-time code is worth nothing five minutes after it is minted, and
    ada-notify is an OUTBOX — it accepts a notification durably and delivers it
    when it can, with a retry ladder measured in minutes. That is exactly right
    for "your analysis finished" and exactly wrong for a code someone is
    waiting on with the login form open.
  * ada-auth holds no database and no queue by design, so that a fork can
    delete it and lose no identity data. Making it depend on another service's
    outbox to let anyone in would undo that.

aiosmtplib rather than smtplib: this runs on the event loop, and one slow relay
would otherwise stall every other request in the process, including the OTP
someone else is waiting for.
"""

from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib
import structlog

from app.email.base import EmailError

logger = structlog.get_logger(__name__)

SUBJECT = "Your ADA sign-in code"

BODY = """\
{code} is your ADA sign-in code.

It expires in {minutes} minutes and can be used once. If you did not ask to
sign in, you can ignore this message — nobody can use the code without it.
"""


class SmtpEmailProvider:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        use_starttls: bool,
        use_ssl: bool,
        sender: str,
        sender_name: str,
        timeout: float,
        ttl_seconds: int,
    ) -> None:
        if not host:
            raise RuntimeError(
                "ADA_EMAIL_OTP_PROVIDER=smtp needs ADA_AUTH_SMTP_HOST; refusing to "
                "start rather than accepting logins and silently sending nothing"
            )
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._starttls = use_starttls
        self._ssl = use_ssl
        self._sender = sender
        self._sender_name = sender_name
        self._timeout = timeout
        self._ttl_minutes = max(1, ttl_seconds // 60)

    async def send_code(self, address: str, code: str) -> None:
        message = EmailMessage()
        message["From"] = f"{self._sender_name} <{self._sender}>"
        message["To"] = address
        message["Subject"] = SUBJECT
        # No HTML part. A one-time code is six digits; a multipart message buys
        # nothing and gives a filter more to dislike.
        message.set_content(BODY.format(code=code, minutes=self._ttl_minutes))

        try:
            await aiosmtplib.send(
                message,
                hostname=self._host,
                port=self._port,
                username=self._username or None,
                password=self._password or None,
                start_tls=self._starttls,
                use_tls=self._ssl,
                timeout=self._timeout,
            )
        except Exception as exc:  # noqa: BLE001 - every aiosmtplib failure is the same to us
            # The reason goes to the log; the caller gets a 503 and no pending
            # code, so the next attempt starts clean.
            logger.warning("email_otp_send_failed", host=self._host, error=str(exc))
            raise EmailError(str(exc)) from exc
