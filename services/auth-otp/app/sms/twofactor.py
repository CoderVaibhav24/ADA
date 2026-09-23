"""2factor.in — the provider HRMS sends its OTPs through.

Its OTP product owns the whole code: a GET to
/{api_key}/SMS/{phone}/AUTOGEN/{template} generates one, sends it, and returns a
session id, and a second GET to /{api_key}/SMS/VERIFY/{session}/{code} checks it.
So no code is ever stored here, and `verifies_own_code` is True.

## Reading the response

The API answers 200 with {"Status": "Success"|"Error", "Details": "..."} and puts
the failure in the body rather than the status line. Checking only the HTTP
status therefore reports every rejected send as a success, and the user waits for
an SMS that was never sent. Both fields are read below.

## The key is in the path

2factor.in puts the API key in the URL, which means it lands in any access log
that records paths. Nothing can be done about that from this side; it is the
reason the key is treated as a secret in .env and never logged here, and it is
worth knowing about when choosing where this service's egress is proxied.
"""

from __future__ import annotations

import httpx
import structlog

from app.sms.base import SmsError

logger = structlog.get_logger(__name__)

_BASE = "https://2factor.in/API/V1"


class TwoFactorSmsProvider:
    verifies_own_code = True

    def __init__(self, api_key: str, template: str, client: httpx.AsyncClient) -> None:
        if not api_key:
            raise ValueError(
                "ADA_TWOFACTOR_API_KEY is required when ADA_SMS_PROVIDER=twofactor"
            )
        self._api_key = api_key
        self._template = template
        self._client = client

    async def send_code(self, phone: str, code: str) -> None:  # pragma: no cover
        # Reachable only through a wiring mistake: this provider is selected for
        # its AUTOGEN flow, and a caller that has already generated a code has
        # taken the wrong branch in app/api/v1/otp.py.
        raise SmsError("2factor.in generates its own codes; use start_session")

    async def start_session(self, phone: str) -> str:
        url = f"{_BASE}/{self._api_key}/SMS/{phone}/AUTOGEN/{self._template}"
        try:
            response = await self._client.get(url)
        except httpx.HTTPError as exc:
            raise SmsError(f"2factor.in unreachable: {exc}") from exc

        if response.status_code >= 400:
            raise SmsError(f"2factor.in returned HTTP {response.status_code}")

        document = response.json()
        if document.get("Status") != "Success":
            # Details carries the reason — an exhausted balance, an unapproved
            # template, a blocked number. Logged, not returned: it is operator
            # information and some of it names the account.
            logger.error(
                "twofactor_send_failed",
                details=str(document.get("Details"))[:200],
                phone_suffix=phone[-4:],
            )
            raise SmsError("the SMS provider refused the message")

        return str(document["Details"])

    async def verify_session(self, session_id: str, code: str) -> bool:
        url = f"{_BASE}/{self._api_key}/SMS/VERIFY/{session_id}/{code}"
        try:
            response = await self._client.get(url)
        except httpx.HTTPError as exc:
            # Not False. A network failure is not a wrong code, and returning
            # False would spend one of the user's attempts on our outage.
            raise SmsError(f"2factor.in unreachable: {exc}") from exc

        # A mismatch comes back as HTTP 200 with Status=Error, and also as 400
        # depending on the failure. Only an explicit Success is a match.
        if response.status_code >= 500:
            raise SmsError(f"2factor.in returned HTTP {response.status_code}")

        try:
            document = response.json()
        except ValueError as exc:
            raise SmsError("2factor.in returned a non-JSON body") from exc

        return document.get("Status") == "Success"
