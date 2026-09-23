"""FCM and APNs adapters against mocked HTTP: payload shape and error mapping.

No stack needed. Provider behaviour is simulated with httpx.MockTransport, and
keys are generated in memory, so nothing here touches Google or Apple.
"""

from __future__ import annotations

import json
import urllib.parse
import uuid

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from app.channels import Outgoing, PermanentError, PushTarget, RetryableError
from app.channels.apns import ApnsSender
from app.channels.fcm import FcmSender
from app.channels.push import FailingPushChannel, PushChannel, StubPushChannel
from app.channels.registry import create_channels
from app.config import Settings

TOKEN_URI = "https://oauth2.example.test/token"
DATA = {"type": "case_assigned", "case_ref": "CMP-4512", "notification_id": str(uuid.uuid4())}


def _settings(**overrides) -> Settings:
    base = {
        "issuer": "http://localhost:8090/realms/pcsmcpl",
        "database_url": "postgresql+asyncpg://ada:x@localhost:5400/ada",
        "email_provider": "stub",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def _pem(key) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
EC_KEY = ec.generate_private_key(ec.SECP256R1())
SERVICE_ACCOUNT = {
    "client_email": "notify@test-project.iam.gserviceaccount.com",
    "private_key": _pem(RSA_KEY),
    "private_key_id": "k1",
    "token_uri": TOKEN_URI,
}


def _message(platform: str, environment: str | None = None, token: str = "tok-" + "a" * 60):
    return Outgoing(
        to=token,
        subject="New complaint CMP-4512",
        body="Assigned to you",
        delivery_id=uuid.uuid4(),
        push=PushTarget(platform=platform, apns_environment=environment),
        data=DATA,
    )


class _Recorder:
    """A MockTransport handler: answers OAuth itself, replays one canned send response."""

    def __init__(self, send: httpx.Response) -> None:
        self.send = send
        self.requests: list[httpx.Request] = []
        self.oauth: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URI:
            self.oauth.append(request)
            return httpx.Response(200, json={"access_token": "ya29.test", "expires_in": 3599})
        self.requests.append(request)
        return self.send


def _fcm(response: httpx.Response) -> tuple[FcmSender, _Recorder]:
    recorder = _Recorder(response)
    sender = FcmSender(
        project_id="test-project",
        service_account=SERVICE_ACCOUNT,
        timeout=5,
        client=httpx.AsyncClient(transport=httpx.MockTransport(recorder)),
    )
    return sender, recorder


def _apns(response: httpx.Response) -> tuple[ApnsSender, _Recorder]:
    recorder = _Recorder(response)
    sender = ApnsSender(
        signing_key=_pem(EC_KEY),
        key_id="ABC123DEFG",
        team_id="TEAM123456",
        bundle_id="com.adaicms.field",
        timeout=5,
        client=httpx.AsyncClient(transport=httpx.MockTransport(recorder)),
    )
    return sender, recorder


def _fcm_error(status: int, grpc: str, code: str | None = None, field: str | None = None) -> dict:
    details: list[dict] = []
    if code:
        details.append(
            {"@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode": code}
        )
    if field:
        details.append(
            {
                "@type": "type.googleapis.com/google.rpc.BadRequest",
                "fieldViolations": [{"field": field, "description": "bad"}],
            }
        )
    return {"error": {"code": status, "message": "x", "status": grpc, "details": details}}


# --- FCM --------------------------------------------------------------------


async def test_fcm_sends_v1_message_with_routing_data_and_caches_oauth() -> None:
    sender, recorder = _fcm(httpx.Response(200, json={"name": "projects/p/messages/42"}))

    first = await sender.send(_message("android"))
    await sender.send(_message("android"))

    assert first.provider_message_id == "projects/p/messages/42"
    assert len(recorder.oauth) == 1, "the OAuth token must be cached, not minted per send"
    request = recorder.requests[0]
    assert str(request.url) == "https://fcm.googleapis.com/v1/projects/test-project/messages:send"
    assert request.headers["authorization"] == "Bearer ya29.test"
    message = json.loads(request.content)["message"]
    assert message["token"] == "tok-" + "a" * 60
    assert message["notification"] == {"title": "New complaint CMP-4512", "body": "Assigned to you"}
    assert message["data"] == DATA

    form = urllib.parse.parse_qs(recorder.oauth[0].content.decode())
    assert form["grant_type"] == ["urn:ietf:params:oauth:grant-type:jwt-bearer"]
    claims = jwt.decode(
        form["assertion"][0], RSA_KEY.public_key(), algorithms=["RS256"], audience=TOKEN_URI
    )
    assert claims["scope"] == "https://www.googleapis.com/auth/firebase.messaging"
    assert claims["iss"] == SERVICE_ACCOUNT["client_email"]


@pytest.mark.parametrize(
    ("status", "grpc", "code", "field", "invalid"),
    [
        (404, "NOT_FOUND", "UNREGISTERED", None, True),
        (400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "message.token", True),
        (403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH", None, True),
        (400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "message.data", False),
    ],
)
async def test_fcm_permanent_errors(status, grpc, code, field, invalid) -> None:
    sender, _ = _fcm(httpx.Response(status, json=_fcm_error(status, grpc, code, field)))
    with pytest.raises(PermanentError) as caught:
        await sender.send(_message("android"))
    assert caught.value.invalid_address is invalid


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_fcm_throttling_and_outages_retry_with_retry_after(status) -> None:
    grpc = "RESOURCE_EXHAUSTED" if status == 429 else "UNAVAILABLE"
    sender, _ = _fcm(
        httpx.Response(status, headers={"Retry-After": "30"}, json=_fcm_error(status, grpc))
    )
    with pytest.raises(RetryableError) as caught:
        await sender.send(_message("android"))
    assert caught.value.retry_after == 30.0


async def test_fcm_401_drops_the_cached_oauth_token_and_retries() -> None:
    sender, recorder = _fcm(httpx.Response(401, json=_fcm_error(401, "UNAUTHENTICATED")))
    with pytest.raises(RetryableError):
        await sender.send(_message("android"))
    with pytest.raises(RetryableError):
        await sender.send(_message("android"))
    assert len(recorder.oauth) == 2


# --- APNs -------------------------------------------------------------------


async def test_apns_uses_device_environment_topic_and_es256_token() -> None:
    sender, recorder = _apns(httpx.Response(200, headers={"apns-id": "A-1"}))

    result = await sender.send(_message("ios", "sandbox", token="ab" * 32))
    await sender.send(_message("ios", "production", token="cd" * 32))

    assert result.provider_message_id == "A-1"
    sandbox, production = recorder.requests
    assert str(sandbox.url) == f"https://api.sandbox.push.apple.com/3/device/{'ab' * 32}"
    assert str(production.url) == f"https://api.push.apple.com/3/device/{'cd' * 32}"
    assert sandbox.headers["apns-topic"] == "com.adaicms.field"
    assert sandbox.headers["apns-push-type"] == "alert"

    bearer = sandbox.headers["authorization"].removeprefix("bearer ")
    assert jwt.get_unverified_header(bearer)["kid"] == "ABC123DEFG"
    claims = jwt.decode(bearer, EC_KEY.public_key(), algorithms=["ES256"])
    assert claims["iss"] == "TEAM123456"
    assert sandbox.headers["authorization"] == production.headers["authorization"], (
        "the provider token must be reused, not re-signed per request"
    )

    body = json.loads(sandbox.content)
    assert body["aps"]["alert"] == {"title": "New complaint CMP-4512", "body": "Assigned to you"}
    assert {k: body[k] for k in DATA} == DATA


@pytest.mark.parametrize(
    ("status", "reason"),
    [(410, "Unregistered"), (400, "BadDeviceToken"), (400, "DeviceTokenNotForTopic")],
)
async def test_apns_dead_tokens_are_permanent_invalid_address(status, reason) -> None:
    sender, _ = _apns(httpx.Response(status, json={"reason": reason}))
    with pytest.raises(PermanentError) as caught:
        await sender.send(_message("ios", "production"))
    assert caught.value.invalid_address is True


async def test_apns_payload_errors_are_permanent_but_keep_the_device() -> None:
    sender, _ = _apns(httpx.Response(413, json={"reason": "PayloadTooLarge"}))
    with pytest.raises(PermanentError) as caught:
        await sender.send(_message("ios", "production"))
    assert caught.value.invalid_address is False


@pytest.mark.parametrize(
    ("status", "reason"),
    [(429, "TooManyRequests"), (500, "InternalServerError"), (503, "ServiceUnavailable")],
)
async def test_apns_throttling_and_outages_retry(status, reason) -> None:
    sender, _ = _apns(
        httpx.Response(status, headers={"Retry-After": "12"}, json={"reason": reason})
    )
    with pytest.raises(RetryableError) as caught:
        await sender.send(_message("ios", "production"))
    assert caught.value.retry_after == 12.0


async def test_apns_expired_provider_token_is_retryable_and_re_signed() -> None:
    sender, _ = _apns(httpx.Response(403, json={"reason": "ExpiredProviderToken"}))
    with pytest.raises(RetryableError):
        await sender.send(_message("ios", "production"))
    assert sender._provider_token is None  # the next send signs a fresh one


# --- the channel and the registry --------------------------------------------


async def test_push_channel_routes_by_platform_and_refuses_unconfigured_ones() -> None:
    fcm, fcm_calls = _fcm(httpx.Response(200, json={"name": "n"}))
    channel = PushChannel(_settings(), fcm=fcm, apns=None, build=False)

    await channel.send(_message("android"))
    assert len(fcm_calls.requests) == 1

    with pytest.raises(PermanentError, match="ios push is not configured") as caught:
        await channel.send(_message("ios", "production"))
    assert caught.value.invalid_address is False, "missing config must not kill the device"


def test_absent_credentials_disable_push_without_failing_startup() -> None:
    channels = create_channels(_settings(push_provider="native"))
    assert set(channels) == {"email", "push"}
    assert channels["push"]._fcm is None
    assert channels["push"]._apns is None


def test_a_missing_credential_file_disables_that_platform_only(tmp_path) -> None:
    key = tmp_path / "apns.p8"
    key.write_text(_pem(EC_KEY))
    channel = PushChannel(
        _settings(
            fcm_project_id="p",
            fcm_service_account_file=str(tmp_path / "absent.json"),
            apns_key_file=str(key),
            apns_key_id="K",
            apns_team_id="T",
            apns_bundle_id="com.adaicms.field",
        )
    )
    assert channel._fcm is None
    assert channel._apns is not None


def test_push_adapters_satisfy_the_channel_protocol() -> None:
    for adapter in (PushChannel, StubPushChannel, FailingPushChannel):
        assert getattr(adapter, "name", None) == "push"
        assert hasattr(adapter, "send")
        assert hasattr(adapter, "close")


async def test_failing_stub_is_retryable() -> None:
    with pytest.raises(RetryableError):
        await FailingPushChannel(_settings()).send(_message("android"))
