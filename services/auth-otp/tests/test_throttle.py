"""The throttling ladder: cooldown, window, soft lock, hard lock."""

from __future__ import annotations

import pytest

from app.store.memory import MemoryKeyValueStore
from app.throttle import OtpThrottle, Throttled
from tests.conftest import FakeClock, make_settings

PHONE = "919990001234"
IP = "10.0.0.1"


def build(store: MemoryKeyValueStore, **overrides) -> OtpThrottle:
    return OtpThrottle(make_settings(**overrides), store)


async def test_the_first_request_passes(throttle: OtpThrottle):
    await throttle.check_request(PHONE, IP)


async def test_a_second_request_inside_the_cooldown_is_refused_with_a_countdown(
    throttle: OtpThrottle,
):
    await throttle.check_request(PHONE, IP)

    with pytest.raises(Throttled) as caught:
        await throttle.check_request(PHONE, IP)

    assert caught.value.retry_after_seconds > 0
    assert "seconds" in caught.value.message


async def test_the_cooldown_is_flat_not_exponential(
    clock: FakeClock, store: MemoryKeyValueStore
):
    """Every wait is 60 seconds, so a 60-second countdown on screen is honest.

    HRMS doubled it and the second Resend then always failed after the client's
    timer had already reached zero, which reads as a broken button.
    """
    throttle = build(store, otp_request_cooldown_seconds=60)

    for _ in range(4):
        await throttle.check_request(PHONE, IP)
        with pytest.raises(Throttled) as caught:
            await throttle.check_request(PHONE, IP)
        assert caught.value.retry_after_seconds == 60
        clock.advance(60)


async def test_the_hourly_window_bounds_requests_even_when_the_cooldown_is_respected(
    clock: FakeClock, store: MemoryKeyValueStore
):
    throttle = build(store, otp_request_phone_limit=3, otp_request_cooldown_seconds=60)

    for _ in range(3):
        await throttle.check_request(PHONE, IP)
        clock.advance(61)

    with pytest.raises(Throttled) as caught:
        await throttle.check_request(PHONE, IP)

    assert "Too many codes" in caught.value.message


async def test_a_refused_request_does_not_also_start_a_cooldown(
    clock: FakeClock, store: MemoryKeyValueStore
):
    """One attempt, one penalty.

    The cooldown is set only after every other stage has passed, so a request
    rejected by the hourly window does not additionally cost 60 seconds.
    """
    throttle = build(store, otp_request_phone_limit=1, otp_request_cooldown_seconds=60)

    await throttle.check_request(PHONE, IP)
    clock.advance(61)

    with pytest.raises(Throttled) as caught:
        await throttle.check_request(PHONE, IP)

    # The window's countdown, not the cooldown's.
    assert caught.value.retry_after_seconds > 60


async def test_too_many_wrong_codes_soft_locks_for_fifteen_minutes(
    store: MemoryKeyValueStore,
):
    throttle = build(store, otp_verify_phone_limit=5, otp_soft_lock_seconds=900)

    for _ in range(5):
        await throttle.check_verify(PHONE, IP)

    with pytest.raises(Throttled) as caught:
        await throttle.check_verify(PHONE, IP)

    assert caught.value.retry_after_seconds == 900


async def test_a_soft_lock_expires(clock: FakeClock, store: MemoryKeyValueStore):
    throttle = build(store, otp_verify_phone_limit=2, otp_soft_lock_seconds=900)

    await throttle.check_verify(PHONE, IP)
    await throttle.check_verify(PHONE, IP)
    with pytest.raises(Throttled):
        await throttle.check_verify(PHONE, IP)

    clock.advance(901)

    # The hourly verify counter is sliding, so it has also moved on.
    clock.advance(3601)
    await throttle.check_verify(PHONE, IP)


async def test_three_soft_locks_inside_a_day_become_a_hard_lock(
    clock: FakeClock, store: MemoryKeyValueStore
):
    throttle = build(
        store,
        otp_verify_phone_limit=1,
        otp_soft_lock_seconds=900,
        otp_soft_locks_before_hard_lock=3,
        otp_hard_lock_seconds=86400,
    )

    for _ in range(2):
        await throttle.check_verify(PHONE, IP)
        with pytest.raises(Throttled):
            await throttle.check_verify(PHONE, IP)
        clock.advance(3700)  # past the soft lock and the verify window

    await throttle.check_verify(PHONE, IP)
    with pytest.raises(Throttled) as caught:
        await throttle.check_verify(PHONE, IP)

    assert "24 hours" in caught.value.message
    assert caught.value.retry_after_seconds == 86400


async def test_a_hard_lock_blocks_requesting_as_well_as_verifying(
    clock: FakeClock, store: MemoryKeyValueStore
):
    """Otherwise a locked-out attacker can still run up the SMS bill."""
    throttle = build(
        store, otp_verify_phone_limit=1, otp_soft_locks_before_hard_lock=1
    )

    await throttle.check_verify(PHONE, IP)
    with pytest.raises(Throttled):
        await throttle.check_verify(PHONE, IP)

    with pytest.raises(Throttled) as caught:
        await throttle.check_request(PHONE, IP)

    assert "24 hours" in caught.value.message


async def test_per_ip_limits_are_off_by_default(store: MemoryKeyValueStore):
    """One proxy address covers the estate, so an IP counter locks everyone out.

    Two different numbers behind the same address must not interfere.
    """
    throttle = build(store, otp_verify_phone_limit=100)

    for index in range(30):
        await throttle.check_verify(f"91999000{index:04d}", IP)


async def test_per_ip_limits_apply_when_switched_on(store: MemoryKeyValueStore):
    throttle = build(
        store,
        otp_ip_limits_enabled=True,
        otp_verify_ip_limit=3,
        otp_verify_phone_limit=100,
    )

    for index in range(3):
        await throttle.check_verify(f"91999000{index:04d}", IP)

    with pytest.raises(Throttled) as caught:
        await throttle.check_verify("919990009999", IP)

    assert "network" in caught.value.message


async def test_a_successful_login_forgets_the_failed_attempts(store: MemoryKeyValueStore):
    throttle = build(store, otp_verify_phone_limit=2)

    await throttle.check_verify(PHONE, IP)
    await throttle.check_verify(PHONE, IP)
    with pytest.raises(Throttled):
        await throttle.check_verify(PHONE, IP)

    await throttle.clear_failures(PHONE)

    await throttle.check_verify(PHONE, IP)


async def test_a_successful_login_does_not_lift_the_request_cooldown(
    store: MemoryKeyValueStore,
):
    """Otherwise every login grants one free code outside the cooldown."""
    throttle = build(store)
    await throttle.check_request(PHONE, IP)

    await throttle.clear_failures(PHONE)

    with pytest.raises(Throttled):
        await throttle.check_request(PHONE, IP)


async def test_a_full_clear_lifts_even_a_hard_lock(store: MemoryKeyValueStore):
    """The support lever. No endpoint reaches it, deliberately."""
    throttle = build(store, otp_verify_phone_limit=1, otp_soft_locks_before_hard_lock=1)

    await throttle.check_verify(PHONE, IP)
    with pytest.raises(Throttled):
        await throttle.check_verify(PHONE, IP)
    with pytest.raises(Throttled):
        await throttle.check_request(PHONE, IP)

    await throttle.clear(PHONE)

    await throttle.check_request(PHONE, IP)


async def test_the_throttled_message_survives_str(store: MemoryKeyValueStore):
    """A dataclass exception would make str(exc) empty and every log line blank."""
    throttle = build(store)
    await throttle.check_request(PHONE, IP)

    with pytest.raises(Throttled) as caught:
        await throttle.check_request(PHONE, IP)

    assert str(caught.value) == caught.value.message
    assert str(caught.value) != ""
