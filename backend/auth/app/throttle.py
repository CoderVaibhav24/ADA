"""The throttling ladder in front of both OTP endpoints.

Four stages, each catching what the one before it lets through:

  1. cooldown   one code per phone per minute. Stops the Resend button being
                held down, and is the only stage a normal user ever meets.
  2. window     N codes per phone per hour. Stops a patient loop that respects
                the cooldown.
  3. soft lock  15 minutes, after too many wrong guesses in an hour. This is
                the one that makes guessing a six-digit code hopeless: the
                allowance is five per hour against a million-entry space.
  4. hard lock  24 hours, after repeated soft locks. Applies to requesting as
                well as verifying, so a locked-out attacker cannot keep the
                SMS bill running.

## Why the cooldown is flat

An exponential cooldown (60, 120, 240, ...) was tried in HRMS and removed. The
login screen shows a single 60-second countdown, so from the second Resend
onward the button was always refused after the timer had already reached zero,
which reads to the user as a broken button. Spam stays bounded by stage 2.

## Why per-IP limits are off by default

Every request reaches this service from the reverse proxy, so one address covers
the entire estate and an IP counter locks out every user simultaneously. HRMS
shipped IP limits, hit exactly that, and commented them out in place. They are a
setting here instead, off unless the real client address survives to this hop.

## Failing open versus failing closed

A store outage raises StoreError, which the API turns into 503. Neither of the
alternatives is acceptable: failing open removes the only defence against code
guessing at the moment we cannot count, and swallowing the error would report a
correct code as invalid.
"""

from __future__ import annotations

import structlog

from app.config import Settings

# Channel names live in app.otp, next to the key builders that use them.
# Re-exported so a caller needs one import for both halves of the ladder.
from app.otp import EMAIL, PHONE  # noqa: F401
from app.store.base import KeyValueStore

logger = structlog.get_logger(__name__)


def _key_cooldown(channel: str, identifier: str) -> str:
    return f"otp:{channel}:cooldown:{identifier}"


def _key_requests(channel: str, identifier: str) -> str:
    return f"otp:{channel}:req:{identifier}"


def _key_verifies(channel: str, identifier: str) -> str:
    return f"otp:{channel}:ver:{identifier}"


def _key_soft_lock(channel: str, identifier: str) -> str:
    return f"otp:{channel}:softlock:{identifier}"


def _key_soft_lock_count(channel: str, identifier: str) -> str:
    return f"otp:{channel}:softlocks:{identifier}"


def _key_hard_lock(channel: str, identifier: str) -> str:
    return f"otp:{channel}:hardlock:{identifier}"


def _key_request_ip(ip: str) -> str:
    return f"otp:req:ip:{ip}"


def _key_verify_ip(ip: str) -> str:
    return f"otp:ver:ip:{ip}"


class Throttled(Exception):
    """Refused by the ladder. `retry_after_seconds` is 0 when it is not known.

    Carries the message the caller may show verbatim. Every one of them says how
    long to wait, because "too many attempts" with no number is the error people
    retry immediately.

    Not a dataclass: @dataclass on an exception skips Exception.__init__, which
    leaves args empty and makes str(exc) — and therefore every log line that
    formats it — the empty string.
    """

    def __init__(self, message: str, retry_after_seconds: int = 0) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after_seconds = retry_after_seconds


class OtpThrottle:
    def __init__(self, settings: Settings, store: KeyValueStore) -> None:
        self._settings = settings
        self._store = store

    async def check_request(self, phone: str, ip: str, *, channel: str = PHONE) -> None:
        """Called before a code is minted. Raises Throttled to refuse."""
        settings = self._settings

        await self._assert_not_hard_locked(phone, channel=channel)

        remaining = await self._store.ttl(_key_cooldown(channel, phone))
        if remaining > 0:
            raise Throttled(
                f"A code was already sent. Try again in {remaining} seconds.",
                retry_after_seconds=remaining,
            )

        count = await self._store.incr_with_ttl(
            _key_requests(channel, phone), settings.otp_request_window_seconds
        )
        if count > settings.otp_request_phone_limit:
            window_minutes = settings.otp_request_window_seconds // 60
            raise Throttled(
                f"Too many codes requested for this number. "
                f"Try again in {window_minutes} minutes.",
                retry_after_seconds=settings.otp_request_window_seconds,
            )

        if settings.otp_ip_limits_enabled:
            ip_count = await self._store.incr_with_ttl(
                _key_request_ip(ip), settings.otp_request_window_seconds
            )
            if ip_count > settings.otp_request_ip_limit:
                raise Throttled(
                    "Too many codes requested from this network.",
                    retry_after_seconds=settings.otp_request_window_seconds,
                )

        # Set last, and only once everything above has passed. Setting it before
        # the window check would start a 60-second cooldown on a request that was
        # refused anyway, which reads as two penalties for one attempt.
        await self._store.setex(
            _key_cooldown(channel, phone), settings.otp_request_cooldown_seconds, "1"
        )

    async def check_verify(self, phone: str, ip: str, *, channel: str = PHONE) -> None:
        """Called before a code is checked. Raises Throttled to refuse."""
        settings = self._settings

        await self._assert_not_hard_locked(phone, channel=channel)

        remaining = await self._store.ttl(_key_soft_lock(channel, phone))
        if remaining > 0:
            raise Throttled(
                f"Too many incorrect codes. Try again in {remaining} seconds.",
                retry_after_seconds=remaining,
            )

        count = await self._store.incr_with_ttl(
            _key_verifies(channel, phone), settings.otp_verify_window_seconds
        )
        if count > settings.otp_verify_phone_limit:
            await self._apply_soft_lock(phone, channel=channel)

        if settings.otp_ip_limits_enabled:
            ip_count = await self._store.incr_with_ttl(
                _key_verify_ip(ip), settings.otp_verify_window_seconds
            )
            if ip_count > settings.otp_verify_ip_limit:
                raise Throttled(
                    "Too many attempts from this network.",
                    retry_after_seconds=settings.otp_verify_window_seconds,
                )

    async def _assert_not_hard_locked(self, phone: str, *, channel: str = PHONE) -> None:
        remaining = await self._store.ttl(_key_hard_lock(channel, phone))
        if remaining > 0:
            # No countdown in the message. Twenty-four hours is long enough that
            # the answer is to contact support, not to wait, and telling someone
            # to come back in 71,000 seconds is not useful.
            raise Throttled(
                "This number is locked for 24 hours. Contact support.",
                retry_after_seconds=remaining,
            )

    async def _apply_soft_lock(self, phone: str, *, channel: str = PHONE) -> None:
        settings = self._settings
        await self._store.setex(_key_soft_lock(channel, phone), settings.otp_soft_lock_seconds, "1")

        # Counted over the hard-lock window, not the soft-lock one: three
        # separate 15-minute lockouts inside a day is the pattern worth
        # escalating, and a counter that expired with the soft lock could never
        # observe it.
        soft_locks = await self._store.incr_with_ttl(
            _key_soft_lock_count(channel, phone), settings.otp_hard_lock_seconds
        )

        if soft_locks >= settings.otp_soft_locks_before_hard_lock:
            await self._store.setex(
                _key_hard_lock(channel, phone), settings.otp_hard_lock_seconds, "1"
            )
            # The soft lock goes, so its shorter countdown cannot be reported in
            # place of the hard one on the next attempt.
            await self._store.delete(_key_soft_lock(channel, phone))
            logger.warning("otp_hard_locked", phone_suffix=phone[-4:], soft_locks=soft_locks)
            raise Throttled(
                "This number is locked for 24 hours. Contact support.",
                retry_after_seconds=settings.otp_hard_lock_seconds,
            )

        logger.warning("otp_soft_locked", phone_suffix=phone[-4:], soft_locks=soft_locks)
        raise Throttled(
            f"Too many incorrect codes. Try again in "
            f"{settings.otp_soft_lock_seconds // 60} minutes.",
            retry_after_seconds=settings.otp_soft_lock_seconds,
        )

    async def clear_failures(self, phone: str, *, channel: str = PHONE) -> None:
        """Forget the failed attempts, and only those. Called on a successful login.

        Someone who has just proved they hold the phone should not be carrying an
        hour of wrong guesses from before they got it right.

        What is deliberately NOT cleared is the request-side cooldown and hourly
        window. Those are not a punishment, they bound how many messages one
        number can cause, and a successful login is not a reason to lift that —
        otherwise every login grants one free code outside the cooldown.
        """
        await self._store.delete(
            _key_verifies(channel, phone),
            _key_soft_lock(channel, phone),
            _key_soft_lock_count(channel, phone),
        )

    async def clear(self, phone: str, *, channel: str = PHONE) -> None:
        """Reset every counter, locks included. For support, not for the API.

        This is the lever for "a real user is hard-locked and needs to get in
        now". No endpoint reaches it: an attacker who could would have a way to
        clear their own 24-hour lock.
        """
        await self._store.delete(
            _key_cooldown(channel, phone),
            _key_requests(channel, phone),
            _key_verifies(channel, phone),
            _key_soft_lock(channel, phone),
            _key_soft_lock_count(channel, phone),
            _key_hard_lock(channel, phone),
        )
