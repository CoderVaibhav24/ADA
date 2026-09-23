"""The OTP lifecycle: issue a code, then spend it exactly once.

## What is stored, and what is not

The code itself is never written down. What goes into the store is
HMAC-SHA256(otp_hmac_key, "{phone}:{code}"), so a dump of the store yields no
live codes, and the per-phone salt means one precomputed table over the
million-entry six-digit space does not cover every pending login at once.

Alongside it sits the Keycloak user id that was resolved when the code was
issued. That is not a cache — it is the security boundary. Resolving the subject
at issue time and spending the stored one at verify time means the code is bound
to the account it was sent to, and the phone number arriving on /verify-otp
cannot select a different account.

## Why there is no nonce here

HRMS, which this is ported from, generates a second secret — a nonce — sets it
as the user's Keycloak password over the admin API, and later uses it as the
password in a direct-grant token request. It does that because it has no
impersonation grant, and a password is the only credential it can write.

ADA must not do that. The same person's primary mechanism is password plus
TOTP; overwriting their password with a server-side nonce on every OTP request
destroys the credential they actually log in with, silently and permanently. So
this service holds an impersonation grant instead and exchanges its own token
for the user's (see app/keycloak.py). No credential of theirs is touched, and
the nonce, its rotation, and the whole failure mode disappear with it.

## Spending

A correct code deletes the hash, the subject and the attempt counter in one
step. There is no path that verifies the same code twice: the second attempt
finds nothing stored and is indistinguishable from an expired one.
"""

from __future__ import annotations

import enum
import hashlib
import hmac
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import structlog

from app.config import Settings
from app.store.base import KeyValueStore

logger = structlog.get_logger(__name__)

# A provider that verifies the code on its own behalf — 2factor.in does — is
# handed the session id it gave us at issue time plus the code the user typed.
ProviderVerifier = Callable[[str, str], Awaitable[bool]]


# Every key and the hash itself carry the channel. Without it a code issued to
# an email address could be spent against a phone number that happens to be the
# same string, and — more realistically — the two channels would share one
# throttling counter, so asking for an email code would consume the phone
# budget of whoever owns that identifier.
# The channel a code belongs to. Keyword-only with a default of "phone" because
# that was the only channel this service had, so every existing caller keeps its
# exact meaning; email must say so. Keys and the HMAC both carry it, which is
# what stops a code issued to an address being spent against a number and stops
# the two channels sharing one throttling budget.
PHONE = "phone"
EMAIL = "email"


def _key_code(channel: str, identifier: str) -> str:
    return f"otp:{channel}:{identifier}"


def _key_attempts(channel: str, identifier: str) -> str:
    return f"otp:{channel}:attempts:{identifier}"


def _key_subject(channel: str, identifier: str) -> str:
    return f"otp:{channel}:subject:{identifier}"


def _key_session(channel: str, identifier: str) -> str:
    return f"otp:{channel}:session:{identifier}"


class VerifyOutcome(enum.Enum):
    OK = "ok"
    # Nothing pending: never issued, already spent, or past its TTL. One outcome
    # rather than three, because the store cannot distinguish them and inventing
    # the distinction would leak whether a code was ever sent.
    NOT_PENDING = "not_pending"
    MISMATCH = "mismatch"
    # Attempts against this code are used up. The code stays pending until its
    # TTL so that a retry does not reset the counter by re-issuing.
    ATTEMPTS_EXHAUSTED = "attempts_exhausted"


@dataclass(frozen=True)
class VerifyResult:
    outcome: VerifyOutcome
    # The Keycloak user id the code was issued against. Set only on OK — every
    # other outcome must not hand a caller a subject it failed to authenticate.
    subject_id: str | None = None

    @property
    def ok(self) -> bool:
        return self.outcome is VerifyOutcome.OK


class OtpService:
    def __init__(self, settings: Settings, store: KeyValueStore) -> None:
        self._settings = settings
        self._store = store
        if not settings.otp_hmac_key and not settings.dev_bypass_allowed:
            # Refused at construction, not at first use. An empty key makes the
            # stored value a keyed hash with a known key, which is not a hash,
            # and discovering that on the first production login is too late.
            raise ValueError(
                "ADA_OTP_HMAC_KEY is required outside local development: "
                "without it, stored OTP hashes are trivially reversible"
            )

    def _hash(self, channel: str, identifier: str, code: str) -> str:
        key = (self._settings.otp_hmac_key or "local-development-only").encode()
        return hmac.new(
            key, f"{channel}:{identifier}:{code}".encode(), hashlib.sha256
        ).hexdigest()

    def _generate(self) -> str:
        if self._settings.dev_bypass_allowed:
            # A fixed, known code so a developer or a staging tester can log in
            # without an SMS provider. Never reachable in production — see
            # Settings.dev_bypass_allowed, which ignores the flag there.
            return self._settings.dev_otp
        digits = self._settings.otp_digits
        # secrets, not random: the code is a credential, and random's Mersenne
        # Twister is reconstructible from a handful of prior outputs.
        return f"{secrets.randbelow(10**digits):0{digits}d}"

    async def issue(self, phone: str, subject_id: str, *, channel: str = PHONE) -> str:
        """Mint a code, bind it to the subject, and return it for sending."""
        code = self._generate()
        ttl = self._settings.otp_ttl_seconds

        await self._store.setex(_key_code(channel, phone), ttl, self._hash(channel, phone, code))
        await self._store.setex(_key_subject(channel, phone), ttl, subject_id)
        # A fresh code starts with a fresh allowance. The request-side throttle
        # is what stops someone clearing their attempt counter by asking again.
        await self._store.delete(_key_attempts(channel, phone), _key_session(channel, phone))

        if self._settings.dev_bypass_allowed:
            logger.warning("otp_dev_fixed_code", phone_suffix=phone[-4:])
        logger.info("otp_issued", phone_suffix=phone[-4:], subject_id=subject_id)
        return code

    async def issue_provider_session(
        self, phone: str, subject_id: str, session_id: str, *, channel: str = PHONE
    ) -> None:
        """Record a code that the SMS provider generated and will verify itself.

        2factor.in's OTP endpoint mints the code, sends it, and hands back a
        session id; the code never passes through this process. So there is no
        hash to store — the session id takes its place, and verification is a
        call back to the provider.
        """
        ttl = self._settings.otp_ttl_seconds
        await self._store.setex(_key_session(channel, phone), ttl, session_id)
        await self._store.setex(_key_subject(channel, phone), ttl, subject_id)
        await self._store.delete(_key_attempts(channel, phone), _key_code(channel, phone))
        logger.info("otp_issued_via_provider", phone_suffix=phone[-4:], subject_id=subject_id)

    async def verify(
        self,
        phone: str,
        code: str,
        provider_verify: ProviderVerifier | None = None,
        *,
        channel: str = PHONE,
    ) -> VerifyResult:
        attempts = int(await self._store.get(_key_attempts(channel, phone)) or 0)
        if attempts >= self._settings.otp_max_attempts:
            logger.warning("otp_attempts_exhausted", phone_suffix=phone[-4:], attempts=attempts)
            return VerifyResult(VerifyOutcome.ATTEMPTS_EXHAUSTED)

        session_id = await self._store.get(_key_session(channel, phone))
        stored_hash = await self._store.get(_key_code(channel, phone))
        if session_id is None and stored_hash is None:
            logger.warning("otp_not_pending", phone_suffix=phone[-4:])
            return VerifyResult(VerifyOutcome.NOT_PENDING)

        # The subject is read before anything is deleted. A pending code with no
        # subject means the two writes in issue() did not both land, and
        # authenticating anyone on that basis is not an option.
        subject_id = await self._store.get(_key_subject(channel, phone))
        if subject_id is None:
            logger.warning("otp_pending_without_subject", phone_suffix=phone[-4:])
            await self._spend(phone, channel=channel)
            return VerifyResult(VerifyOutcome.NOT_PENDING)

        if self._settings.dev_bypass_allowed:
            # Any code is accepted, but a code must still have been issued — the
            # subject binding above is what makes this a bypass of the code and
            # not a bypass of the flow.
            logger.warning("otp_dev_bypass", phone_suffix=phone[-4:])
            matched = True
        elif session_id is not None:
            if provider_verify is None:  # pragma: no cover - wiring error
                raise ValueError("a provider-issued OTP needs a provider verifier")
            matched = await provider_verify(session_id, code)
        else:
            # compare_digest, not ==: string equality short-circuits on the
            # first differing byte and leaks the length of the shared prefix.
            matched = hmac.compare_digest(str(stored_hash), self._hash(channel, phone, code))

        if not matched:
            count = await self._store.incr_with_ttl(
                _key_attempts(channel, phone), self._settings.otp_ttl_seconds
            )
            logger.warning("otp_mismatch", phone_suffix=phone[-4:], attempt=count)
            return VerifyResult(VerifyOutcome.MISMATCH)

        await self._spend(phone, channel=channel)
        logger.info("otp_verified", phone_suffix=phone[-4:], subject_id=subject_id)
        return VerifyResult(VerifyOutcome.OK, subject_id=subject_id)

    async def _spend(self, phone: str, *, channel: str = PHONE) -> None:
        await self._store.delete(
            _key_code(channel, phone),
            _key_session(channel, phone),
            _key_subject(channel, phone),
            _key_attempts(channel, phone),
        )
