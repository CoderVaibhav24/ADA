"""The four endpoints, end to end through FastAPI with Keycloak faked.

The app is built here rather than imported from app.main so that the lifespan —
which would open a real Redis connection and a real HTTP client — is bypassed and
app.state is populated with the fakes instead. Everything above app.state is the
real code path: the routers, the response shapes, the exception handlers.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import health
from app.api.v1 import otp as otp_router
from app.config import Settings
from app.main import (
    _error_code,
    http_exception_handler,
    validation_exception_handler,
)
from app.otp import OtpService
from app.sms.stub import StubSmsProvider
from app.store.memory import MemoryKeyValueStore
from app.throttle import OtpThrottle
from tests.conftest import FakeClock, FakeKeycloak, make_settings

PHONE = "919990001234"
SUBJECT = "11111111-2222-3333-4444-555555555555"


def build_app(settings: Settings, store, keycloak, sms) -> FastAPI:
    app = FastAPI()
    app.state.store = store
    app.state.keycloak = keycloak
    app.state.otp = OtpService(settings, store)
    app.state.throttle = OtpThrottle(settings, store)
    app.state.sms = sms
    app.include_router(health.router)
    app.include_router(otp_router.router)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    return app


@pytest.fixture
def wired(monkeypatch, clock: FakeClock):
    """An app, its fakes, and an httpx client bound straight to the ASGI app."""
    settings = make_settings()
    # get_settings is lru_cached and the routers reach it through the dependency,
    # so the override goes on the cached function itself.
    monkeypatch.setattr("app.dependencies.get_settings", lambda: settings)

    store = MemoryKeyValueStore(clock=clock)
    keycloak = FakeKeycloak()
    keycloak.register(PHONE, SUBJECT)
    sms = StubSmsProvider()
    app = build_app(settings, store, keycloak, sms)

    transport = httpx.ASGITransport(app=app)
    client = httpx.AsyncClient(transport=transport, base_url="http://auth")
    return client, keycloak, sms, settings, store


async def test_the_happy_path_returns_real_tokens_for_the_right_subject(wired):
    client, keycloak, sms, _, _ = wired

    requested = await client.post("/v1/auth/request-otp", json={"phone": PHONE})
    assert requested.status_code == 202

    assert len(sms.sent) == 1
    _, code = sms.sent[0]

    verified = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": code})

    assert verified.status_code == 200
    body = verified.json()
    assert body["access_token"] == f"access-for-{SUBJECT}"
    assert body["token_type"] == "Bearer"
    # The token was minted for the subject the code was issued against, not for
    # anything derived from the request body.
    assert keycloak.exchanged == [SUBJECT]


async def test_an_unknown_number_is_indistinguishable_from_a_known_one(wired):
    client, _, sms, _, _ = wired

    known = await client.post("/v1/auth/request-otp", json={"phone": PHONE})
    unknown = await client.post("/v1/auth/request-otp", json={"phone": "919990009999"})

    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    # And nothing was sent for the number that does not exist.
    assert [phone for phone, _ in sms.sent] == [PHONE]


async def test_revealing_an_unknown_number_is_opt_in(monkeypatch, clock: FakeClock):
    settings = make_settings(otp_reveal_unknown_phone=True)
    monkeypatch.setattr("app.dependencies.get_settings", lambda: settings)
    store = MemoryKeyValueStore(clock=clock)
    keycloak = FakeKeycloak()
    app = build_app(settings, store, keycloak, StubSmsProvider())
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://auth")

    response = await client.post("/v1/auth/request-otp", json={"phone": "919990009999"})

    assert response.status_code == 404
    assert response.json()["error"] == "not_found"


async def test_a_wrong_code_is_a_401_that_does_not_say_why(wired):
    client, _, _, _, _ = wired
    await client.post("/v1/auth/request-otp", json={"phone": PHONE})

    response = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": "000001"})

    assert response.status_code == 401
    # Same wording for a wrong code and an expired one — separating them tells an
    # attacker whether a code is still live.
    assert response.json()["detail"] == "That code is invalid or has expired."


async def test_a_code_that_was_never_requested_is_the_same_401(wired):
    client, _, _, _, _ = wired

    response = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": "000001"})

    assert response.status_code == 401
    assert response.json()["detail"] == "That code is invalid or has expired."


async def test_a_second_request_inside_the_cooldown_is_429_with_retry_after(wired):
    client, _, _, _, _ = wired
    await client.post("/v1/auth/request-otp", json={"phone": PHONE})

    response = await client.post("/v1/auth/request-otp", json={"phone": PHONE})

    assert response.status_code == 429
    assert response.json()["error"] == "rate_limited"
    assert int(response.headers["Retry-After"]) > 0


async def test_a_spent_code_cannot_be_replayed(wired):
    client, keycloak, sms, _, _ = wired
    await client.post("/v1/auth/request-otp", json={"phone": PHONE})
    _, code = sms.sent[0]

    first = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": code})
    second = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": code})

    assert first.status_code == 200
    assert second.status_code == 401
    assert keycloak.exchanged == [SUBJECT]


async def test_a_keycloak_outage_on_request_is_503_not_404(wired):
    client, keycloak, _, _, _ = wired
    keycloak.unavailable = True

    response = await client.post("/v1/auth/request-otp", json={"phone": PHONE})

    # A permissions or connectivity problem must not be reported as "this number
    # is not registered" — that sends the operator to the wrong place.
    assert response.status_code == 503
    assert response.json()["error"] == "unavailable"


async def test_a_failed_exchange_does_not_leave_the_code_replayable(wired):
    client, keycloak, sms, _, _ = wired
    await client.post("/v1/auth/request-otp", json={"phone": PHONE})
    _, code = sms.sent[0]
    keycloak.unavailable = True

    failed = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": code})
    assert failed.status_code == 503

    keycloak.unavailable = False
    retried = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": code})

    # The code was spent by the first attempt, deliberately. A used credential
    # does not get a second chance; the user requests a new code.
    assert retried.status_code == 401


async def test_a_successful_login_clears_the_failed_attempts_before_it(
    wired, clock: FakeClock
):
    client, _, sms, _, _ = wired
    await client.post("/v1/auth/request-otp", json={"phone": PHONE})
    _, code = sms.sent[0]

    for _ in range(3):
        await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": "000009"})

    assert (
        await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": code})
    ).status_code == 200

    # The request cooldown is NOT lifted by a successful login.
    assert (
        await client.post("/v1/auth/request-otp", json={"phone": PHONE})
    ).status_code == 429

    # Once it lapses, the next login starts with a full allowance rather than
    # three failures down.
    clock.advance(61)
    assert (
        await client.post("/v1/auth/request-otp", json={"phone": PHONE})
    ).status_code == 202
    _, second_code = sms.sent[-1]
    for _ in range(3):
        await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": "000009"})
    assert (
        await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": second_code})
    ).status_code == 200


async def test_a_rejected_refresh_is_401_and_an_outage_is_503(wired):
    client, keycloak, _, _, _ = wired

    ok = await client.post("/v1/auth/refresh", json={"refresh_token": "x" * 24})
    assert ok.status_code == 200
    assert ok.json()["access_token"] == "fresh-access"

    keycloak.refresh_rejects = True
    dead = await client.post("/v1/auth/refresh", json={"refresh_token": "x" * 24})
    assert dead.status_code == 401

    keycloak.refresh_rejects = False
    keycloak.unavailable = True
    blip = await client.post("/v1/auth/refresh", json={"refresh_token": "x" * 24})
    # Not 401. A Keycloak restart must not log out every client holding a
    # long-lived session.
    assert blip.status_code == 503


async def test_logout_always_succeeds(wired):
    client, keycloak, _, _, _ = wired
    keycloak.unavailable = True

    response = await client.post("/v1/auth/logout", json={"refresh_token": "y" * 24})

    assert response.status_code == 200
    assert keycloak.logged_out == ["y" * 24]


@pytest.mark.parametrize(
    "phone",
    [
        "12345",  # too short
        "1234567890123456",  # too long
        "+919990001234",  # a leading + would not match the stored attribute
        "99900 01234",  # spaces likewise
        "abcdefghij",
    ],
)
async def test_a_phone_number_that_could_not_match_an_account_is_422(wired, phone: str):
    client, _, _, _, _ = wired

    response = await client.post("/v1/auth/request-otp", json={"phone": phone})

    assert response.status_code == 422
    assert response.json()["error"] == "validation_failed"


async def test_the_code_field_does_not_reveal_the_expected_length(wired):
    """A four-digit code must be a 401, not a 422.

    Pinning the field to otp_digits would let a caller learn the length from the
    status code without ever guessing a value.
    """
    client, _, _, _, _ = wired
    await client.post("/v1/auth/request-otp", json={"phone": PHONE})

    response = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": "0000"})

    assert response.status_code == 401


async def test_health_live_needs_nothing_and_ready_checks_the_store(wired):
    client, _, _, _, _ = wired

    assert (await client.get("/health/live")).json() == {"status": "alive"}

    ready = await client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["store"] == "ok"


def test_every_status_the_service_returns_has_an_error_code():
    for status_code in (400, 401, 403, 404, 409, 422, 429, 503):
        assert _error_code(status_code) != "error"
