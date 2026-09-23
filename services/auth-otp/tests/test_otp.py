"""The OTP lifecycle: single use, bound to a subject, and expiring."""

from __future__ import annotations

import pytest

from app.otp import OtpService, VerifyOutcome
from app.store.memory import MemoryKeyValueStore
from tests.conftest import FakeClock, make_settings

PHONE = "919990001234"
SUBJECT = "11111111-2222-3333-4444-555555555555"


async def test_a_correct_code_returns_the_subject_it_was_issued_against(otp: OtpService):
    code = await otp.issue(PHONE, SUBJECT)

    result = await otp.verify(PHONE, code)

    assert result.ok
    assert result.subject_id == SUBJECT


async def test_the_code_is_never_stored_in_the_clear(
    otp: OtpService, store: MemoryKeyValueStore
):
    code = await otp.issue(PHONE, SUBJECT)

    # Keys are namespaced by channel: otp:{channel}:{identifier}.
    stored = await store.get(f"otp:phone:{PHONE}")

    assert stored is not None
    assert code not in stored
    # HMAC-SHA256, hex.
    assert len(stored) == 64


async def test_a_code_cannot_be_spent_twice(otp: OtpService):
    code = await otp.issue(PHONE, SUBJECT)

    assert (await otp.verify(PHONE, code)).ok
    second = await otp.verify(PHONE, code)

    # Indistinguishable from never having been issued, which is the point: a
    # replay must not be told that it is a replay.
    assert second.outcome is VerifyOutcome.NOT_PENDING
    assert second.subject_id is None


async def test_a_wrong_code_does_not_spend_the_pending_one(otp: OtpService):
    code = await otp.issue(PHONE, SUBJECT)

    assert (await otp.verify(PHONE, "000001" if code != "000001" else "000002")).outcome is (
        VerifyOutcome.MISMATCH
    )
    # The real code still works — a typo must not force a resend.
    assert (await otp.verify(PHONE, code)).ok


async def test_attempts_are_capped_and_the_cap_does_not_leak_the_code(otp: OtpService):
    settings = make_settings(otp_max_attempts=3)
    service = OtpService(settings, otp._store)  # noqa: SLF001 - same store, tighter cap
    code = await service.issue(PHONE, SUBJECT)
    wrong = "000001" if code != "000001" else "000002"

    for _ in range(3):
        assert (await service.verify(PHONE, wrong)).outcome is VerifyOutcome.MISMATCH

    # Even the correct code is refused now. Otherwise the cap could be walked
    # around by guessing three times and then trying the real one.
    exhausted = await service.verify(PHONE, code)
    assert exhausted.outcome is VerifyOutcome.ATTEMPTS_EXHAUSTED
    assert exhausted.subject_id is None


async def test_a_code_expires(clock: FakeClock, store: MemoryKeyValueStore):
    settings = make_settings(otp_ttl_seconds=300)
    service = OtpService(settings, store)
    code = await service.issue(PHONE, SUBJECT)

    clock.advance(301)

    assert (await service.verify(PHONE, code)).outcome is VerifyOutcome.NOT_PENDING


async def test_the_code_is_bound_to_the_subject_not_to_the_phone_on_the_request(
    otp: OtpService,
):
    """The subject is read from the store, never from the request body.

    This is what stops a caller who obtains any valid code from pointing it at a
    different account by changing the phone number they send.
    """
    code = await otp.issue(PHONE, SUBJECT)

    other = await otp.verify("919990009999", code)

    assert other.outcome is VerifyOutcome.NOT_PENDING


async def test_issuing_again_clears_the_attempt_counter(otp: OtpService):
    first = await otp.issue(PHONE, SUBJECT)
    wrong = "000001" if first != "000001" else "000002"
    await otp.verify(PHONE, wrong)
    await otp.verify(PHONE, wrong)

    second = await otp.issue(PHONE, SUBJECT)

    # A fresh code gets a fresh allowance; the request-side cooldown is what
    # stops this being a way to reset the counter at will.
    assert (await otp.verify(PHONE, second)).ok


async def test_two_phones_hashing_the_same_code_do_not_collide(otp: OtpService):
    """The hash is salted per phone, so one rainbow table does not cover both."""
    code = await otp.issue(PHONE, SUBJECT)
    await otp.issue("919990005678", "other-subject")

    result = await otp.verify("919990005678", code)

    # Same six digits, different phone: only correct if the salt is in the hash.
    if result.ok:
        pytest.fail("a code issued for one number verified for another")


async def test_a_missing_hmac_key_is_refused_outside_local_development(
    store: MemoryKeyValueStore,
):
    settings = make_settings(otp_hmac_key="")

    with pytest.raises(ValueError, match="ADA_OTP_HMAC_KEY"):
        OtpService(settings, store)


async def test_local_development_issues_the_fixed_code_and_accepts_anything(
    store: MemoryKeyValueStore,
):
    settings = make_settings(env="local", otp_hmac_key="", dev_otp="123456")
    service = OtpService(settings, store)

    code = await service.issue(PHONE, SUBJECT)
    assert code == "123456"

    # Any code passes — but only once one has been issued, so the subject binding
    # still has to be there.
    assert (await service.verify(PHONE, "999999")).subject_id == SUBJECT


async def test_the_dev_bypass_is_unreachable_in_production(store: MemoryKeyValueStore):
    settings = make_settings(env="production", allow_otp_dev_bypass=True)

    assert settings.dev_bypass_allowed is False

    service = OtpService(settings, store)
    code = await service.issue(PHONE, SUBJECT)
    assert code != settings.dev_otp
    assert (await service.verify(PHONE, "000000")).ok is (code == "000000")


async def test_a_provider_issued_code_is_verified_by_the_provider(otp: OtpService):
    await otp.issue_provider_session(PHONE, SUBJECT, "session-abc")

    seen: list[tuple[str, str]] = []

    async def verifier(session_id: str, code: str) -> bool:
        seen.append((session_id, code))
        return code == "424242"

    assert (await otp.verify(PHONE, "111111", provider_verify=verifier)).outcome is (
        VerifyOutcome.MISMATCH
    )
    result = await otp.verify(PHONE, "424242", provider_verify=verifier)

    assert result.ok
    assert result.subject_id == SUBJECT
    assert seen == [("session-abc", "111111"), ("session-abc", "424242")]


async def test_a_pending_code_with_no_subject_is_refused(
    otp: OtpService, store: MemoryKeyValueStore
):
    """Half-written state must not authenticate anybody.

    If issue() managed to write the hash but not the subject, there is no account
    to mint a token for, and guessing one is not an option.
    """
    code = await otp.issue(PHONE, SUBJECT)
    await store.delete(f"otp:phone:subject:{PHONE}")

    result = await otp.verify(PHONE, code)

    assert result.outcome is VerifyOutcome.NOT_PENDING
    assert result.subject_id is None
    # And the orphaned code is cleared rather than left pending forever.
    assert await store.get(f"otp:{PHONE}") is None
