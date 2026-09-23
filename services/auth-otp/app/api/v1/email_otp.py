"""Email plus one-time code — the phone flow, over a different carrier.

Everything that makes the phone path safe is reused rather than re-implemented:
the same code generator, the same HMAC-at-rest, the same four-stage throttling
ladder, the same single-use semantics, the same refusal to say whether an
identifier is registered. Only two things differ, and they are the two that
have to:

  * the lookup — an address is a first-class Keycloak field, so one exact
    search, where a phone number needs an attribute search and a username
    fallback;
  * the carrier — an SMTP relay instead of an SMS gateway.

Keys and the HMAC are namespaced by channel (see app/otp.py), so a code issued
to an address cannot be spent against a phone number, and the two channels do
not share a throttling budget.

## This is still a first factor only

Same as the phone path. TOTP is not evaluated here, because there is no browser
flow in which to prompt for it. An application that requires two factors sends
people through Keycloak's standard login instead.

## Why an emailed code is weaker than a texted one

Worth stating plainly, because the two endpoints look identical: a mailbox is
usually reachable from the same device and the same password manager as the
account itself, so email OTP is closer to a password reset than to possession
of a second device. It is offered because an officer without a registered
number still needs a way in, not because it is equivalent.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from app.api.v1.otp import otp_not_permitted_response
from app.dependencies import CurrentSettings, Email, Keycloak, Otp, Throttle
from app.email.base import EmailError
from app.keycloak import DirectoryUnavailable, OtpNotPermitted, SubjectNotFound
from app.otp import EMAIL, VerifyOutcome
from app.store.base import StoreError
from app.throttle import Throttled

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/auth/email", tags=["authentication"])

# Deliberately the same body as the phone path's, for the same reason: the
# answer must not depend on whether the address is registered.
_GENERIC_REQUEST_RESPONSE = {
    "status": "sent",
    "detail": "If that address is registered, a code is on its way.",
}


def _mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _throttled(exc: Throttled) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=str(exc),
        headers=(
            {"Retry-After": str(exc.retry_after_seconds)} if exc.retry_after_seconds else None
        ),
    )


class RequestEmailOtpBody(BaseModel):
    # EmailStr rather than a loose string: a malformed address is a 422 here
    # instead of an SMTP rejection three calls later, and it stops the store
    # accumulating keys for things that could never receive a message.
    email: EmailStr


class VerifyEmailOtpBody(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=10, pattern=r"^\d+$")


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None
    expires_in: int
    token_type: str = "Bearer"  # noqa: S105


@router.post(
    "/request-otp",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Send a one-time code to an email address",
)
async def request_email_otp(
    body: RequestEmailOtpBody,
    request: Request,
    settings: CurrentSettings,
    keycloak: Keycloak,
    otp: Otp,
    throttle: Throttle,
    email: Email,
) -> dict:
    address = str(body.email).strip().lower()
    ip = _client_ip(request)

    try:
        await throttle.check_request(address, ip, channel=EMAIL)
    except Throttled as exc:
        raise _throttled(exc) from exc
    except StoreError as exc:
        # The throttle could not count, so nothing is sent. Failing open here
        # would remove the only defence against a code-guessing loop at exactly
        # the moment we cannot observe one.
        logger.error("email_otp_request_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    try:
        subject = await keycloak.find_subject_by_email(address)
    except SubjectNotFound:
        logger.info("email_otp_request_unknown_address", email=_mask(address))
        if settings.otp_reveal_unknown_email:
            raise HTTPException(
                status_code=404,
                detail="This address is not registered. Contact your administrator.",
            ) from None
        # Same body, same status, same shape as a successful request. The
        # throttle above already ran, so probing is rate-limited as well as
        # uninformative.
        return _GENERIC_REQUEST_RESPONSE
    except DirectoryUnavailable as exc:
        logger.error("email_otp_request_directory_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    try:
        code = await otp.issue(address, subject.id, channel=EMAIL)
        await email.send_code(address, code)
    except EmailError as exc:
        logger.error("email_otp_send_failed", error=str(exc), email=_mask(address))
        raise HTTPException(
            status_code=503, detail="Could not send the code. Try again shortly."
        ) from exc
    except StoreError as exc:
        logger.error("email_otp_issue_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    return _GENERIC_REQUEST_RESPONSE


@router.post(
    "/verify-otp",
    response_model=TokenResponse,
    summary="Exchange a valid emailed code for Keycloak tokens",
)
async def verify_email_otp(
    body: VerifyEmailOtpBody,
    request: Request,
    keycloak: Keycloak,
    otp: Otp,
    throttle: Throttle,
) -> TokenResponse:
    address = str(body.email).strip().lower()
    ip = _client_ip(request)

    try:
        await throttle.check_verify(address, ip, channel=EMAIL)
    except Throttled as exc:
        raise _throttled(exc) from exc
    except StoreError as exc:
        logger.error("email_otp_verify_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    # No provider_verify: no email provider mints its own code, so verification
    # is always ours. That is why EmailProvider has one method where
    # SmsProvider has three.
    try:
        result = await otp.verify(address, body.code, channel=EMAIL)
    except StoreError as exc:
        logger.error("email_otp_verify_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    if not result.ok:
        # One response for every failure. Separating "expired" from "wrong"
        # tells an attacker whether a code is still live, which is the one thing
        # worth knowing before guessing at it.
        logger.info(
            "email_otp_verify_refused", outcome=result.outcome.value, email=_mask(address)
        )
        detail = (
            "Too many incorrect codes. Request a new one."
            if result.outcome is VerifyOutcome.ATTEMPTS_EXHAUSTED
            else "That code is invalid or has expired."
        )
        raise HTTPException(status_code=401, detail=detail)

    assert result.subject_id is not None  # guaranteed by VerifyResult on OK

    try:
        tokens = await keycloak.exchange_for_subject(result.subject_id)
    except OtpNotPermitted:
        return otp_not_permitted_response()
    except DirectoryUnavailable as exc:
        # The code has already been spent at this point, deliberately: replaying
        # it after a failed exchange would be a second chance at a credential
        # that has been used. The user requests a new code.
        logger.error("email_otp_exchange_failed", error=str(exc), subject_id=result.subject_id)
        raise HTTPException(
            status_code=503, detail="Could not complete sign-in. Try again shortly."
        ) from exc

    # clear_failures, not clear: the request cooldown stays, because it bounds
    # how many messages this address can cause and a login is not a reason to
    # lift that.
    try:
        await throttle.clear_failures(address, channel=EMAIL)
    except StoreError as exc:  # pragma: no cover - best effort
        logger.warning("email_otp_throttle_clear_failed", error=str(exc))

    logger.info("email_otp_login", subject_id=result.subject_id, email=_mask(address))
    return TokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=tokens.expires_in,
    )
