"""Fixtures for the ada-auth suite.

Unlike ada-notify's suite, these are unit tests and need no running stack.
That is a property of the service rather than a shortcut: it holds no database,
and its two collaborators — the OTP store and Keycloak — are both behind
interfaces narrow enough that a faithful substitute is a few dozen lines. What is
being proved here is the throttling ladder, the single-use property of a code and
the shape of every response, and none of those are properties of Redis.

The one thing a fake cannot prove is that Keycloak actually performs the token
exchange. scripts/otp-test.sh does that against the real stack.
"""

from __future__ import annotations

import os

import pytest

# Set before app.config is imported anywhere: Settings has no default issuer, so
# an unset one is an import-time failure rather than a test failure.
os.environ.setdefault("ADA_ISSUER", "http://localhost:8090/realms/pcsmcpl")
os.environ.setdefault("ADA_ENV", "staging")
os.environ.setdefault("ADA_OTP_HMAC_KEY", "test-hmac-key")
os.environ.setdefault("ADA_AUTH_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("ADA_SMS_PROVIDER", "stub")
os.environ.setdefault("ADA_EMAIL_OTP_PROVIDER", "stub")

from app.config import Settings  # noqa: E402
from app.email.stub import StubEmailProvider  # noqa: E402
from app.keycloak import Subject, UserTokens  # noqa: E402
from app.otp import OtpService  # noqa: E402
from app.sms.stub import StubSmsProvider  # noqa: E402
from app.store.memory import MemoryKeyValueStore  # noqa: E402
from app.throttle import OtpThrottle  # noqa: E402

# staging, not local: local turns the dev bypass on, which makes every code
# valid and would silently pass every test that thinks it is checking a code.
BASE_ENV = {
    "issuer": "http://localhost:8090/realms/pcsmcpl",
    "env": "staging",
    "otp_hmac_key": "test-hmac-key",
    "auth_client_secret": "test-client-secret",
    "sms_provider": "stub",
    "email_otp_provider": "stub",
}


class FakeClock:
    """A monotonic clock a test can advance, so TTLs are provable without sleeping."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeKeycloak:
    """Stands in for KeycloakGateway.

    Records what it was asked so a test can assert that the subject the token was
    minted for is the subject the code was issued against — the property that
    stops a phone number on /verify-otp selecting a different account.
    """

    def __init__(self) -> None:
        self.subjects: dict[str, Subject] = {}
        self.emails: dict[str, Subject] = {}
        self.exchanged: list[str] = []
        self.logged_out: list[str] = []
        self.unavailable = False
        self.refresh_rejects = False

    def register(self, phone: str, subject_id: str, username: str = "someone") -> Subject:
        subject = Subject(id=subject_id, username=username, enabled=True)
        self.subjects[phone] = subject
        return subject

    def register_email(self, email: str, subject_id: str, username: str = "someone") -> Subject:
        subject = Subject(id=subject_id, username=username, enabled=True)
        self.emails[email] = subject
        return subject

    async def find_subject_by_email(self, email: str) -> Subject:
        from app.keycloak import DirectoryUnavailable, SubjectNotFound

        if self.unavailable:
            raise DirectoryUnavailable("fake outage")
        if email not in self.emails:
            raise SubjectNotFound(email)
        return self.emails[email]

    async def find_subject_by_phone(self, phone: str) -> Subject:
        from app.keycloak import DirectoryUnavailable, SubjectNotFound

        if self.unavailable:
            raise DirectoryUnavailable("fake outage")
        if phone not in self.subjects:
            raise SubjectNotFound(phone)
        return self.subjects[phone]

    async def exchange_for_subject(self, subject_id: str) -> UserTokens:
        from app.keycloak import DirectoryUnavailable

        if self.unavailable:
            raise DirectoryUnavailable("fake outage")
        self.exchanged.append(subject_id)
        return UserTokens(
            access_token=f"access-for-{subject_id}", refresh_token="refresh-token", expires_in=60
        )

    async def refresh(self, refresh_token: str) -> UserTokens:
        from app.keycloak import DirectoryUnavailable, RefreshRejected

        if self.refresh_rejects:
            raise RefreshRejected("invalid_grant")
        if self.unavailable:
            raise DirectoryUnavailable("fake outage")
        return UserTokens(access_token="fresh-access", refresh_token="fresh-refresh", expires_in=60)

    async def logout(self, refresh_token: str) -> None:
        self.logged_out.append(refresh_token)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def store(clock: FakeClock) -> MemoryKeyValueStore:
    return MemoryKeyValueStore(clock=clock)


def make_settings(**overrides) -> Settings:
    return Settings(**{**BASE_ENV, **overrides})  # type: ignore[arg-type]


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def otp(settings: Settings, store: MemoryKeyValueStore) -> OtpService:
    return OtpService(settings, store)


@pytest.fixture
def throttle(settings: Settings, store: MemoryKeyValueStore) -> OtpThrottle:
    return OtpThrottle(settings, store)


@pytest.fixture
def keycloak() -> FakeKeycloak:
    return FakeKeycloak()


@pytest.fixture
def sms() -> StubSmsProvider:
    return StubSmsProvider()


@pytest.fixture
def email() -> StubEmailProvider:
    return StubEmailProvider()
