"""Phone plus one-time code, as a first factor.

    POST /v1/auth/request-otp   send a code to a registered number
    POST /v1/auth/verify-otp    spend the code, receive Keycloak tokens
    POST /v1/auth/refresh       extend the session
    POST /v1/auth/logout        revoke the refresh token

## What the tokens are

Real Keycloak access and refresh tokens for the person's actual account, signed
by the realm's RS256 key and verifiable by any ADA SDK with no call back here.
This service does not mint tokens of its own and there is no second token format
to support.

## What this mechanism is not

It is one factor. TOTP is not evaluated on this path — there is no browser flow
in which to prompt for it — so an application that needs two factors must send
people through the standard Keycloak login instead. See app/keycloak.py for why
the exchange works this way and what it costs.

## Why the responses say so little

By default /request-otp answers identically whether or not the number belongs to
an account. HRMS chose the opposite and returns "This number is not registered"
so its login screen can show an immediate error; the price is that anybody can
enumerate which numbers exist. ADA is shared by every application, so the
private answer is the default and the friendlier one is
ADA_OTP_REVEAL_UNKNOWN_PHONE=true, taken deliberately.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.dependencies import CurrentSettings, Keycloak, Otp, Sms, Throttle
from app.keycloak import (
    DirectoryUnavailable,
    OtpNotPermitted,
    RefreshRejected,
    SubjectNotFound,
)
from app.otp import VerifyOutcome
from app.sms.base import SmsError
from app.store.base import StoreError
from app.throttle import Throttled

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/auth", tags=["authentication"])

# Digits only, 10 to 15 of them — E.164 allows at most 15 and no national number
# is shorter than 10 in the places this runs. No '+', no spaces, no punctuation:
# the value has to match what is stored on the Keycloak account character for
# character, and accepting several spellings here would mean a number that
# authenticates through one spelling and not another.
_PHONE = Field(..., min_length=10, max_length=15, pattern=r"^\d+$")

# One body for every refused role, naming none of them.
def otp_not_permitted_response() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={
            "error": "otp_not_permitted_for_role",
            "detail": "This account cannot sign in with a one-time code. "
            "Use the standard sign-in instead.",
        },
    )


_GENERIC_REQUEST_RESPONSE = {
    "message": "If this number is registered, a code has been sent."
}


class RequestOtpBody(BaseModel):
    phone: str = _PHONE


class VerifyOtpBody(BaseModel):
    phone: str = _PHONE
    # Length is not pinned to otp_digits: a caller sending the wrong length is a
    # wrong code, and answering 422 instead of 401 tells an attacker how long the
    # code is.
    code: str = Field(..., min_length=4, max_length=10, pattern=r"^\d+$")


class RefreshBody(BaseModel):
    refresh_token: str = Field(..., min_length=20)


class LogoutBody(BaseModel):
    refresh_token: str = Field(..., min_length=20)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None
    expires_in: int | None
    # "Bearer" is the OAuth token TYPE, not a credential. S105 flags the field
    # name, and it cannot tell the two apart.
    token_type: str = "Bearer"  # noqa: S105


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _throttled(exc: Throttled) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=exc.message,
        # Retry-After is what lets a client show an accurate countdown instead of
        # guessing, and what stops a mobile app retrying immediately.
        headers=(
            {"Retry-After": str(exc.retry_after_seconds)} if exc.retry_after_seconds else None
        ),
    )


@router.post(
    "/request-otp",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Send a one-time code to a phone number",
)
async def request_otp(
    body: RequestOtpBody,
    request: Request,
    settings: CurrentSettings,
    keycloak: Keycloak,
    otp: Otp,
    throttle: Throttle,
    sms: Sms,
) -> dict:
    ip = _client_ip(request)

    try:
        await throttle.check_request(body.phone, ip)
    except Throttled as exc:
        raise _throttled(exc) from exc
    except StoreError as exc:
        # The throttle could not count, so nothing is sent. Failing open here
        # would remove the only defence against a code-guessing loop at exactly
        # the moment we cannot observe one.
        logger.error("otp_request_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    try:
        subject = await keycloak.find_subject_by_phone(body.phone)
    except SubjectNotFound:
        logger.info("otp_request_unknown_phone", phone_suffix=body.phone[-4:])
        if settings.otp_reveal_unknown_phone:
            raise HTTPException(
                status_code=404,
                detail="This number is not registered. Contact your administrator.",
            ) from None
        # Same body, same status, same shape as a successful request. The
        # throttle above already ran, so probing is rate-limited as well as
        # uninformative.
        return _GENERIC_REQUEST_RESPONSE
    except DirectoryUnavailable as exc:
        logger.error("otp_request_directory_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    try:
        if sms.verifies_own_code:
            session_id = await sms.start_session(body.phone)
            await otp.issue_provider_session(body.phone, subject.id, session_id)
        else:
            code = await otp.issue(body.phone, subject.id)
            await sms.send_code(body.phone, code)
    except SmsError as exc:
        logger.error("otp_send_failed", error=str(exc), phone_suffix=body.phone[-4:])
        raise HTTPException(
            status_code=503, detail="Could not send the code. Try again shortly."
        ) from exc
    except StoreError as exc:
        logger.error("otp_issue_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    return _GENERIC_REQUEST_RESPONSE


@router.post(
    "/verify-otp",
    response_model=TokenResponse,
    summary="Exchange a valid code for Keycloak tokens",
)
async def verify_otp(
    body: VerifyOtpBody,
    request: Request,
    keycloak: Keycloak,
    otp: Otp,
    throttle: Throttle,
    sms: Sms,
) -> TokenResponse:
    ip = _client_ip(request)

    try:
        await throttle.check_verify(body.phone, ip)
    except Throttled as exc:
        raise _throttled(exc) from exc
    except StoreError as exc:
        logger.error("otp_verify_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    try:
        result = await otp.verify(
            body.phone,
            body.code,
            provider_verify=sms.verify_session if sms.verifies_own_code else None,
        )
    except SmsError as exc:
        # The provider could not be asked, so this is not a wrong code and must
        # not be reported as one — the attempt is not spent.
        logger.error("otp_verify_provider_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc
    except StoreError as exc:
        logger.error("otp_verify_store_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail="Try again shortly.") from exc

    if not result.ok:
        # One response for every failure. Separating "expired" from "wrong"
        # tells an attacker whether a code is still live, which is the one thing
        # worth knowing before guessing at it.
        logger.info(
            "otp_verify_refused", outcome=result.outcome.value, phone_suffix=body.phone[-4:]
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
        logger.error("otp_exchange_failed", error=str(exc), subject_id=result.subject_id)
        raise HTTPException(
            status_code=503, detail="Could not complete sign-in. Try again shortly."
        ) from exc

    # Someone who just proved possession of the phone should not be carrying an
    # hour of failed attempts from before they succeeded. clear_failures, not
    # clear: the request cooldown stays, because it bounds how many messages this
    # number can cause and a login is not a reason to lift that.
    try:
        await throttle.clear_failures(body.phone)
    except StoreError as exc:  # pragma: no cover - best effort
        logger.warning("otp_throttle_clear_failed", error=str(exc))

    logger.info("otp_login", subject_id=result.subject_id, phone_suffix=body.phone[-4:])
    return TokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=tokens.expires_in,
    )


@router.post("/refresh", response_model=TokenResponse, summary="Extend a session")
async def refresh(body: RefreshBody, keycloak: Keycloak) -> TokenResponse:
    """A 401 means log out. A 503 means keep the session and retry.

    The distinction is the whole point of this endpoint existing rather than the
    client calling Keycloak directly through this service's credentials: a
    blanket 401 on any failure makes every Keycloak restart log out every mobile
    client holding a thirty-day session.
    """
    try:
        tokens = await keycloak.refresh(body.refresh_token)
    except RefreshRejected as exc:
        logger.info("refresh_rejected", reason=str(exc))
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.") from exc
    except DirectoryUnavailable as exc:
        logger.warning("refresh_unavailable", error=str(exc))
        raise HTTPException(
            status_code=503, detail="Auth service temporarily unavailable. Retry shortly."
        ) from exc

    return TokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=tokens.expires_in,
    )


@router.post("/logout", summary="Revoke a refresh token")
async def logout(body: LogoutBody, keycloak: Keycloak) -> dict:
    """Always succeeds.

    A logout that returns an error leaves the caller holding tokens it believes
    are live, which is worse than a Keycloak session that lingers until it
    expires on its own. Failures are logged, not returned.
    """
    await keycloak.logout(body.refresh_token)
    return {"message": "Signed out."}
