"""S-01 and S-02: the dev bypass is opt-in and local-only, and privileged roles
cannot sign in by one-time code."""

from __future__ import annotations

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.keycloak import KeycloakGateway, OtpNotPermitted
from tests.conftest import BASE_ENV, FakeClock, FakeKeycloak, make_settings
from tests.test_api import PHONE, SUBJECT, build_app

LOCAL_ISSUER = "http://localhost:8090/realms/pcsmcpl"
PUBLIC_ISSUER = "https://id.example.gov.in/realms/pcsmcpl"


# --- S-01 ------------------------------------------------------------------


def test_env_defaults_to_production(monkeypatch):
    monkeypatch.delenv("ADA_ENV", raising=False)
    settings = Settings(issuer=PUBLIC_ISSUER)  # type: ignore[call-arg]
    assert settings.env == "production"
    assert settings.dev_bypass_allowed is False


def test_bypass_off_in_production_even_with_the_flag():
    settings = make_settings(env="production", allow_otp_dev_bypass=True)
    assert settings.dev_bypass_allowed is False


def test_bypass_off_in_staging_even_with_the_flag():
    settings = make_settings(env="staging", allow_otp_dev_bypass=True)
    assert settings.dev_bypass_allowed is False


def test_bypass_off_in_local_without_the_flag():
    settings = make_settings(env="local")
    assert settings.dev_bypass_allowed is False


@pytest.mark.parametrize(
    "issuer",
    [
        "http://localhost:8090/realms/pcsmcpl",
        "http://127.0.0.1:8090/idp/realms/pcsmcpl",
        "http://keycloak:8090/realms/pcsmcpl",
    ],
)
def test_bypass_on_only_with_local_flag_and_localhost_issuer(issuer: str):
    settings = make_settings(env="local", allow_otp_dev_bypass=True, issuer=issuer)
    assert settings.dev_bypass_allowed is True


def test_bypass_off_for_a_private_but_non_localhost_issuer():
    settings = make_settings(
        env="local", allow_otp_dev_bypass=True, issuer="http://10.0.0.5/realms/pcsmcpl"
    )
    assert settings.dev_bypass_allowed is False


@pytest.mark.parametrize("env", ["local", "staging"])
def test_non_production_with_a_public_issuer_refuses_to_start(env: str):
    with pytest.raises(ValidationError, match="public host"):
        make_settings(env=env, issuer=PUBLIC_ISSUER)


def test_production_with_a_public_issuer_starts():
    assert make_settings(env="production", issuer=PUBLIC_ISSUER).env == "production"


def test_denied_roles_default_and_env_parsing(monkeypatch):
    assert make_settings().otp_denied_roles == ["super-admin"]
    monkeypatch.setenv("ADA_OTP_DENIED_ROLES", "super-admin, pcs-nodal-officer")
    settings = Settings(issuer=LOCAL_ISSUER, env="staging")  # type: ignore[call-arg]
    assert settings.otp_denied_roles == ["super-admin", "pcs-nodal-officer"]


# --- S-02: the gateway against a fake Keycloak -------------------------------


class FakeKeycloakServer:
    """Answers the three endpoints exchange_for_subject touches."""

    def __init__(self, roles: dict[str, list[str]], role_status: int = 200) -> None:
        self.roles = roles
        self.role_status = role_status
        self.exchanges: list[dict[str, str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/protocol/openid-connect/token"):
            form = dict(httpx.QueryParams(request.content.decode()))
            if form["grant_type"] == "client_credentials":
                return httpx.Response(200, json={"access_token": "svc", "expires_in": 300})
            self.exchanges.append(form)
            return httpx.Response(
                200, json={"access_token": "user", "refresh_token": "r", "expires_in": 300}
            )
        if path.endswith("/role-mappings/realm/composite"):
            if self.role_status != 200:
                return httpx.Response(self.role_status)
            subject = path.split("/users/")[1].split("/")[0]
            return httpx.Response(
                200, json=[{"name": name} for name in self.roles.get(subject, [])]
            )
        return httpx.Response(404)


def _gateway(server: FakeKeycloakServer, **overrides) -> KeycloakGateway:
    client = httpx.AsyncClient(transport=httpx.MockTransport(server))
    return KeycloakGateway(make_settings(**overrides), client)


async def test_exchange_refused_for_super_admin():
    server = FakeKeycloakServer({"admin-id": ["default-roles-pcsmcpl", "super-admin"]})

    with pytest.raises(OtpNotPermitted):
        await _gateway(server).exchange_for_subject("admin-id")

    assert server.exchanges == []  # nothing was minted


async def test_exchange_allowed_for_ordinary_role_and_sends_the_audience():
    server = FakeKeycloakServer({"surveyor-id": ["field-surveyor"]})

    tokens = await _gateway(server).exchange_for_subject("surveyor-id")

    assert tokens.access_token == "user"
    assert server.exchanges[0]["requested_subject"] == "surveyor-id"
    assert server.exchanges[0]["audience"] == "ada-web"


async def test_exchange_audience_empty_omits_the_parameter():
    server = FakeKeycloakServer({"surveyor-id": []})
    await _gateway(server, exchange_audience="").exchange_for_subject("surveyor-id")
    assert "audience" not in server.exchanges[0]


async def test_denied_roles_are_configurable():
    server = FakeKeycloakServer({"nodal-id": ["pcs-nodal-officer"]})
    gateway = _gateway(server, otp_denied_roles=["super-admin", "pcs-nodal-officer"])
    with pytest.raises(OtpNotPermitted):
        await gateway.exchange_for_subject("nodal-id")


async def test_an_unreadable_role_list_fails_closed():
    from app.keycloak import DirectoryUnavailable

    server = FakeKeycloakServer({}, role_status=403)
    with pytest.raises(DirectoryUnavailable):
        await _gateway(server).exchange_for_subject("anyone")
    assert server.exchanges == []


# --- S-02: the router maps the refusal to a generic 403 ----------------------


class RefusingKeycloak(FakeKeycloak):
    async def exchange_for_subject(self, subject_id: str):
        raise OtpNotPermitted(subject_id)


async def test_verify_otp_for_a_super_admin_is_403_otp_not_permitted_for_role(
    monkeypatch, clock: FakeClock
):
    from app.sms.stub import StubSmsProvider
    from app.store.memory import MemoryKeyValueStore

    settings = Settings(**BASE_ENV)  # type: ignore[arg-type]
    monkeypatch.setattr("app.dependencies.get_settings", lambda: settings)
    keycloak = RefusingKeycloak()
    keycloak.register(PHONE, SUBJECT)
    sms = StubSmsProvider()
    app = build_app(settings, MemoryKeyValueStore(clock=clock), keycloak, sms)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://auth"
    ) as client:
        assert (await client.post("/v1/auth/request-otp", json={"phone": PHONE})).status_code == 202
        code = sms.sent[-1][1]
        response = await client.post("/v1/auth/verify-otp", json={"phone": PHONE, "code": code})

    assert response.status_code == 403
    body = response.json()
    assert body["error"] == "otp_not_permitted_for_role"
    assert "super-admin" not in body["detail"]


def test_a_blank_env_means_production():
    assert make_settings(env="").env == "production"
