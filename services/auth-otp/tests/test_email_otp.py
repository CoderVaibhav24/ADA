"""The email channel, and the isolation between it and the phone channel.

The engine is shared with the phone path and already tested there, so this
suite does not re-prove that a code is single-use or that the ladder locks. It
proves the two things the second channel newly makes possible to get wrong:

  * a code minted for one channel being spendable on the other;
  * the two channels sharing a throttling budget, so asking for an email code
    consumes the phone allowance of whoever owns that identifier.

Both would be invisible in production until someone was locked out, or in.
"""

from __future__ import annotations

import pytest

from app.otp import EMAIL, PHONE, OtpService, VerifyOutcome
from app.store.memory import MemoryKeyValueStore
from app.throttle import OtpThrottle, Throttled
from tests.conftest import make_settings

ADDRESS = "officer@pcsmcpl.net"
NUMBER = "919990001234"
SUBJECT = "11111111-2222-3333-4444-555555555555"
OTHER_SUBJECT = "99999999-8888-7777-6666-555555555555"
IP = "203.0.113.7"


class TestTheEmailChannelWorks:
    async def test_a_correct_code_returns_the_subject_it_was_issued_against(
        self, otp: OtpService
    ):
        code = await otp.issue(ADDRESS, SUBJECT, channel=EMAIL)
        result = await otp.verify(ADDRESS, code, channel=EMAIL)
        assert result.ok
        assert result.subject_id == SUBJECT

    async def test_a_wrong_code_is_refused(self, otp: OtpService):
        await otp.issue(ADDRESS, SUBJECT, channel=EMAIL)
        assert not (await otp.verify(ADDRESS, "000000", channel=EMAIL)).ok

    async def test_a_code_cannot_be_spent_twice(self, otp: OtpService):
        code = await otp.issue(ADDRESS, SUBJECT, channel=EMAIL)
        assert (await otp.verify(ADDRESS, code, channel=EMAIL)).ok
        second = await otp.verify(ADDRESS, code, channel=EMAIL)
        assert second.outcome is VerifyOutcome.NOT_PENDING

    async def test_the_code_is_never_stored_in_the_clear(
        self, otp: OtpService, store: MemoryKeyValueStore
    ):
        code = await otp.issue(ADDRESS, SUBJECT, channel=EMAIL)
        stored = await store.get(f"otp:email:{ADDRESS}")
        assert stored is not None
        assert code not in stored
        assert len(stored) == 64  # HMAC-SHA256, hex


class TestTheChannelsAreIsolated:
    """The property the whole channel-namespacing exists for."""

    async def test_a_code_issued_to_an_address_cannot_be_spent_as_a_number(
        self, otp: OtpService
    ):
        """The identifier being the same string must not make the code portable.

        Contrived as written, and the realistic version is not: an account whose
        username IS its phone number — which is what a migrated HRMS account
        looks like — could otherwise have an emailed code accepted on the phone
        endpoint.
        """
        code = await otp.issue(NUMBER, SUBJECT, channel=EMAIL)
        crossed = await otp.verify(NUMBER, code, channel=PHONE)
        assert not crossed.ok
        assert crossed.subject_id is None

    async def test_a_code_issued_to_a_number_cannot_be_spent_as_an_address(
        self, otp: OtpService
    ):
        code = await otp.issue(NUMBER, SUBJECT, channel=PHONE)
        assert not (await otp.verify(NUMBER, code, channel=EMAIL)).ok

    async def test_each_channel_keeps_its_own_pending_code(self, otp: OtpService):
        """Requesting an email code must not invalidate a phone code already in
        flight — someone who asked for both should be able to use either."""
        by_phone = await otp.issue(NUMBER, SUBJECT, channel=PHONE)
        by_email = await otp.issue(NUMBER, OTHER_SUBJECT, channel=EMAIL)

        assert (await otp.verify(NUMBER, by_email, channel=EMAIL)).subject_id == OTHER_SUBJECT
        assert (await otp.verify(NUMBER, by_phone, channel=PHONE)).subject_id == SUBJECT

    async def test_the_two_channels_use_different_store_keys(
        self, otp: OtpService, store: MemoryKeyValueStore
    ):
        """Not just a different value — a different key. One key would mean the
        second request overwrote the first, which is the bug above seen from
        the store's side."""
        await otp.issue(NUMBER, SUBJECT, channel=PHONE)
        await otp.issue(NUMBER, SUBJECT, channel=EMAIL)
        assert await store.get(f"otp:phone:{NUMBER}") is not None
        assert await store.get(f"otp:email:{NUMBER}") is not None


class TestTheLaddersAreSeparate:
    async def test_an_email_request_does_not_consume_the_phone_cooldown(
        self, throttle: OtpThrottle
    ):
        """Otherwise asking for an email code silently blocks the Resend button
        on the phone form for a minute, for an identifier the person may not
        even have used."""
        await throttle.check_request(NUMBER, IP, channel=EMAIL)
        await throttle.check_request(NUMBER, IP, channel=PHONE)  # must not raise

    async def test_the_cooldown_still_applies_within_one_channel(
        self, throttle: OtpThrottle
    ):
        await throttle.check_request(ADDRESS, IP, channel=EMAIL)
        with pytest.raises(Throttled):
            await throttle.check_request(ADDRESS, IP, channel=EMAIL)

    async def test_failed_email_verifies_do_not_lock_the_phone_channel(
        self, throttle: OtpThrottle
    ):
        settings = make_settings()
        for _ in range(settings.otp_verify_phone_limit):
            await throttle.check_verify(NUMBER, IP, channel=EMAIL)
        with pytest.raises(Throttled):
            await throttle.check_verify(NUMBER, IP, channel=EMAIL)

        # The same identifier on the other channel is untouched.
        await throttle.check_verify(NUMBER, IP, channel=PHONE)

    async def test_clearing_failures_on_one_channel_leaves_the_other(
        self, throttle: OtpThrottle
    ):
        settings = make_settings()
        for _ in range(settings.otp_verify_phone_limit):
            await throttle.check_verify(NUMBER, IP, channel=EMAIL)
            await throttle.check_verify(NUMBER, IP, channel=PHONE)

        await throttle.clear_failures(NUMBER, channel=EMAIL)
        await throttle.check_verify(NUMBER, IP, channel=EMAIL)
        with pytest.raises(Throttled):
            await throttle.check_verify(NUMBER, IP, channel=PHONE)


class TestTheDefaultChannelIsPhone:
    """`channel` is keyword-only with a default of PHONE, so every caller
    written before the email channel existed keeps its exact meaning."""

    async def test_issue_and_verify_default_to_phone(
        self, otp: OtpService, store: MemoryKeyValueStore
    ):
        code = await otp.issue(NUMBER, SUBJECT)
        assert await store.get(f"otp:phone:{NUMBER}") is not None
        assert (await otp.verify(NUMBER, code)).subject_id == SUBJECT

    async def test_throttle_defaults_to_phone(self, throttle: OtpThrottle):
        await throttle.check_request(NUMBER, IP)
        with pytest.raises(Throttled):
            await throttle.check_request(NUMBER, IP, channel=PHONE)
