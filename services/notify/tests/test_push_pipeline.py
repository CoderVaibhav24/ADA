"""Device registry, per-device fan-out, dead-token deactivation and the inbox.

Runs against a real PostgreSQL (the constraints are the behaviour under test) but
needs no Keycloak, Redis or running service: each run creates a throwaway
database, migrates it to head, and drops it afterwards. Token verification is
replaced by a fake verifier; the /v1/me authorisation rules on top of it are real.

    ADA_TEST_PG_ADMIN_DSN=postgresql://postgres:pw@127.0.0.1:5432/postgres pytest

Skipped when ADA_TEST_PG_ADMIN_DSN is unset.
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
import secrets
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import events
from app.broker import Message
from app.channels.fcm import FcmSender
from app.channels.push import PushChannel
from app.config import Settings
from app.delivery import DeliveryWorker
from app.fanout import FanoutWorker
from app.models import (
    Channel,
    Delivery,
    DeliveryStatus,
    Notification,
    Project,
    PushDevice,
    RecipientType,
    Template,
)
from app.security import Principal, TokenError
from tests.test_push_channels import SERVICE_ACCOUNT, TOKEN_URI, _apns

NOTIFY_DIR = pathlib.Path(__file__).resolve().parent.parent
ISSUER = "http://localhost:8090/realms/pcsmcpl"

ALICE = uuid.uuid4()
BOB = uuid.uuid4()


@pytest_asyncio.fixture(scope="module")
async def database():
    admin_dsn = os.environ.get("ADA_TEST_PG_ADMIN_DSN")
    if not admin_dsn:
        pytest.skip("ADA_TEST_PG_ADMIN_DSN is not set")
    try:
        admin = await asyncpg.connect(admin_dsn)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"PostgreSQL is not reachable: {exc}")

    name = f"notify_push_{secrets.token_hex(4)}"
    await admin.execute(f'CREATE DATABASE "{name}"')
    base = admin_dsn.rsplit("/", 1)[0].replace("postgresql://", "postgresql+asyncpg://", 1)
    url = f"{base}/{name}"
    env = {**os.environ, "ADA_DATABASE_URL": url, "ADA_ISSUER": ISSUER}
    try:
        # Up, down to 0002 and up again: proves 0003 is reversible on an empty table.
        for step in (["upgrade", "head"], ["downgrade", "0002"], ["upgrade", "head"]):
            await asyncio.to_thread(
                subprocess.run,
                [sys.executable, "-m", "alembic", *step],
                cwd=NOTIFY_DIR,
                env=env,
                check=True,
                capture_output=True,
            )
        yield url
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await admin.close()


@pytest_asyncio.fixture(scope="module")
async def sessions(database: str):
    engine = create_async_engine(database)
    yield async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    await engine.dispose()


@pytest.fixture(scope="module")
def settings(database: str) -> Settings:
    return Settings(  # type: ignore[call-arg]
        issuer=ISSUER,
        database_url=database,
        email_provider="stub",
        push_provider="stub",
        retry_jitter=False,
        user_client_ids="ada-field",
    )


@pytest_asyncio.fixture(scope="module")
async def project(sessions) -> dict:
    async with sessions() as session:
        row = Project(
            key=f"test-push-{secrets.token_hex(3)}", name="Push", client_id=f"tp-{uuid.uuid4()}"
        )
        session.add(row)
        await session.flush()
        session.add(
            Template(
                project_id=row.id,
                key="case_assigned",
                channel=Channel.PUSH,
                subject="New complaint {{ case_ref }}",
                body="Assigned to you in {{ village }}",
            )
        )
        await session.commit()
        return {"id": row.id, "key": row.key}


def _principal(subject: uuid.UUID, azp: str, username: str, typ: str = "Bearer") -> Principal:
    return Principal(
        subject=str(subject),
        azp=azp,
        scopes=frozenset(),
        claims={"typ": typ, "preferred_username": username},
    )


class FakeVerifier:
    """Maps opaque test tokens to principals; anything else is refused."""

    PRINCIPALS = {
        "alice": _principal(ALICE, "ada-field", "alice"),
        "bob": _principal(BOB, "ada-field", "bob"),
        "machine": _principal(uuid.uuid4(), "ada-field", "service-account-ada-ml"),
        "other-client": _principal(uuid.uuid4(), "hrms-web", "carol"),
        "id-token": _principal(ALICE, "ada-field", "alice", typ="ID"),
    }

    async def verify(self, token: str) -> Principal:
        if token not in self.PRINCIPALS:
            raise TokenError("unknown_test_token")
        return self.PRINCIPALS[token]


@pytest_asyncio.fixture(scope="module")
async def client(database: str, sessions, settings: Settings):
    os.environ.setdefault("ADA_ISSUER", ISSUER)
    os.environ.setdefault("ADA_DATABASE_URL", database)
    from app.config import get_settings
    from app.db import get_db
    from app.dependencies import get_verifier
    from app.main import app

    async def _db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_verifier] = lambda: FakeVerifier()
    app.dependency_overrides[get_settings] = lambda: settings
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://notify.test"
    ) as http:
        yield http
    app.dependency_overrides.clear()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _token() -> str:
    return "fcm-" + secrets.token_urlsafe(40)


class FakeBroker:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []
        self.scheduled: list[tuple[str, dict, datetime]] = []
        self.dead: list[str] = []

    async def publish(self, topic, *, event_id, partition_key, payload) -> str:
        self.published.append((topic, payload))
        return f"{len(self.published)}-0"

    async def schedule(self, topic, *, event_id, partition_key, payload, at) -> None:
        self.scheduled.append((topic, payload, at))

    async def dead_letter(self, topic, *, message, error) -> None:
        self.dead.append(error)

    async def ack(self, topic, handle) -> None:
        return None


class FakeDirectory:
    def forget(self, subject) -> None:
        return None


def _message(event: events.Event) -> Message:
    return Message(
        handle="1-0",
        event_id=event.event_id,
        topic=event.topic,
        partition_key=event.partition_key,
        payload=event.to_payload(),
    )


async def _notify(sessions, project: dict, recipient: uuid.UUID, **payload) -> events.Event:
    """Write a notification the way ingestion does and return its created event."""
    payload = {"case_ref": "CMP-4512", "village": "Jamdoli", **payload}
    async with sessions() as session:
        row = Notification(
            project_id=project["id"],
            idempotency_key=f"test-{secrets.token_hex(8)}",
            recipient_type=RecipientType.KC_SUB,
            recipient_id=recipient,
            template_key="case_assigned",
            payload=payload,
            channels=["push"],
        )
        session.add(row)
        await session.commit()
        return events.notification_created(
            notification_id=row.id,
            project_id=project["id"],
            project_key=project["key"],
            recipient_type="kc_sub",
            recipient_id=recipient,
            template_key="case_assigned",
            locale="en",
            channels=["push"],
            payload=payload,
        )


# --- device registration ------------------------------------------------------


async def test_register_is_an_idempotent_upsert_on_token(client, sessions) -> None:
    token = _token()
    body = {"platform": "android", "token": token, "app_version": "1.0.0 (1)"}

    first = await client.post("/v1/me/devices", headers=auth("alice"), json=body)
    again = await client.post(
        "/v1/me/devices", headers=auth("alice"), json={**body, "app_version": "1.0.1 (2)"}
    )

    assert first.status_code == 200, first.text
    assert again.status_code == 200, again.text
    assert first.json()["id"] == again.json()["id"]
    assert again.json()["app_version"] == "1.0.1 (2)"
    async with sessions() as session:
        count = await session.scalar(
            select(func.count()).select_from(PushDevice).where(PushDevice.token == token)
        )
    assert count == 1

    # A handset passed to another user re-binds to them; still one row.
    rebound = await client.post("/v1/me/devices", headers=auth("bob"), json=body)
    assert rebound.json()["id"] == first.json()["id"]
    async with sessions() as session:
        owner = await session.scalar(select(PushDevice.user_sub).where(PushDevice.token == token))
    assert owner == BOB


async def test_ios_needs_an_apns_environment_and_android_refuses_one(client) -> None:
    ios = await client.post(
        "/v1/me/devices", headers=auth("alice"), json={"platform": "ios", "token": "ab" * 32}
    )
    android = await client.post(
        "/v1/me/devices",
        headers=auth("alice"),
        json={"platform": "android", "token": _token(), "apns_environment": "sandbox"},
    )
    assert ios.status_code == 422
    assert android.status_code == 422


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({}, 401),
        (auth("garbage"), 401),
        (auth("id-token"), 401),
        (auth("machine"), 403),
        (auth("other-client"), 403),
    ],
)
async def test_user_endpoints_refuse_everything_but_an_end_user_token(
    client, headers, expected
) -> None:
    body = {"platform": "android", "token": _token()}
    register = await client.post("/v1/me/devices", headers=headers, json=body)
    inbox = await client.get("/v1/me/notifications", headers=headers)
    assert register.status_code == expected
    assert inbox.status_code == expected


async def test_unregister_only_touches_the_callers_own_row(client, sessions) -> None:
    token = _token()
    await client.post(
        "/v1/me/devices", headers=auth("alice"), json={"platform": "android", "token": token}
    )

    response = await client.post(
        "/v1/me/devices/unregister", headers=auth("bob"), json={"token": token}
    )
    assert response.status_code == 204
    async with sessions() as session:
        assert await session.scalar(select(PushDevice.active).where(PushDevice.token == token))

    for _ in range(2):  # idempotent: a retried sign-out is still 204
        response = await client.post(
            "/v1/me/devices/unregister", headers=auth("alice"), json={"token": token}
        )
        assert response.status_code == 204
    async with sessions() as session:
        assert not await session.scalar(select(PushDevice.active).where(PushDevice.token == token))


# --- fan-out and delivery -------------------------------------------------------


async def _device(sessions, user, platform, *, active=True, environment=None) -> PushDevice:
    async with sessions() as session:
        device = PushDevice(
            user_sub=user,
            platform=platform,
            token=("ab" * 32 + secrets.token_hex(4)) if platform == "ios" else _token(),
            apns_environment=environment,
            active=active,
        )
        session.add(device)
        await session.commit()
        return device


def _fanout(settings, broker, sessions) -> FanoutWorker:
    return FanoutWorker(settings, broker, sessions, FakeDirectory(), "test")  # type: ignore[arg-type]


async def test_fanout_writes_one_push_delivery_per_active_device(
    sessions, settings, project
) -> None:
    user = uuid.uuid4()
    android = await _device(sessions, user, "android")
    ios = await _device(sessions, user, "ios", environment="sandbox")
    await _device(sessions, user, "android", active=False)

    event = await _notify(sessions, project, user)
    broker = FakeBroker()
    fanout = _fanout(settings, broker, sessions)

    await fanout.process(_message(event))
    await fanout.process(_message(event))  # at-least-once: the rerun must not duplicate

    notification_id = uuid.UUID(event.payload["notification_id"])
    async with sessions() as session:
        rows = (
            await session.scalars(
                select(Delivery).where(Delivery.notification_id == notification_id)
            )
        ).all()
    assert sorted(str(r.device_id) for r in rows) == sorted([str(android.id), str(ios.id)])
    assert all(r.channel == Channel.PUSH for r in rows)
    assert all(r.status == DeliveryStatus.PENDING for r in rows)
    assert {topic for topic, _ in broker.published} == {"delivery.push"}
    assert {p["delivery_id"] for _, p in broker.published} == {str(r.id) for r in rows}


async def test_no_registered_device_is_a_recorded_permanent_failure(
    sessions, settings, project
) -> None:
    event = await _notify(sessions, project, uuid.uuid4())
    broker = FakeBroker()
    await _fanout(settings, broker, sessions).process(_message(event))

    async with sessions() as session:
        row = await session.scalar(
            select(Delivery).where(
                Delivery.notification_id == uuid.UUID(event.payload["notification_id"])
            )
        )
    assert row.status == DeliveryStatus.FAILED
    assert "no active push devices" in row.last_error
    assert broker.published == []


def _fcm_answering(status: int, body: dict, headers: dict | None = None) -> FcmSender:
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URI:
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        return httpx.Response(status, json=body, headers=headers or {})

    return FcmSender(
        project_id="p",
        service_account=SERVICE_ACCOUNT,
        timeout=5,
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )


async def _fan_out_and_deliver(sessions, settings, project, user, channel: PushChannel):
    event = await _notify(sessions, project, user)
    broker = FakeBroker()
    await _fanout(settings, broker, sessions).process(_message(event))
    worker = DeliveryWorker(
        settings,
        broker,
        sessions,
        channel,
        FakeDirectory(),
        "test",  # type: ignore[arg-type]
    )
    for topic, payload in list(broker.published):
        await worker.process(
            Message(
                handle="1-0",
                event_id=uuid.uuid4(),
                topic=topic,
                partition_key=str(user),
                payload=payload,
            )
        )
    return uuid.UUID(event.payload["notification_id"]), broker


async def test_dead_token_deactivates_its_device_and_other_devices_still_receive(
    sessions, settings, project
) -> None:
    user = uuid.uuid4()
    android = await _device(sessions, user, "android")
    ios = await _device(sessions, user, "ios", environment="production")
    apns, apns_calls = _apns(httpx.Response(200, headers={"apns-id": "A-1"}))
    unregistered = {
        "error": {
            "code": 404,
            "status": "NOT_FOUND",
            "message": "Requested entity was not found.",
            "details": [
                {
                    "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                    "errorCode": "UNREGISTERED",
                }
            ],
        }
    }
    channel = PushChannel(settings, fcm=_fcm_answering(404, unregistered), apns=apns, build=False)

    notification_id, _ = await _fan_out_and_deliver(sessions, settings, project, user, channel)

    async with sessions() as session:
        by_device = {
            r.device_id: r
            for r in await session.scalars(
                select(Delivery).where(Delivery.notification_id == notification_id)
            )
        }
        android_row = await session.get(PushDevice, android.id)
        ios_row = await session.get(PushDevice, ios.id)
    assert by_device[android.id].status == DeliveryStatus.FAILED
    assert android_row.active is False
    assert "NOT_FOUND" in (android_row.deactivated_reason or "")
    assert by_device[ios.id].status == DeliveryStatus.SENT
    assert ios_row.active is True

    # The payload is a routing hint: case_ref and type, no case detail in data.
    sent = json.loads(apns_calls.requests[0].content)
    assert sent["case_ref"] == "CMP-4512"
    assert sent["type"] == "case_assigned"
    assert "village" not in sent
    assert sent["aps"]["alert"]["title"] == "New complaint CMP-4512"

    # The next notification does not fan out to the dead token.
    _, broker = await _fan_out_and_deliver(sessions, settings, project, user, channel)
    assert len(broker.published) == 1


async def test_provider_retry_after_is_a_floor_under_the_ladder(
    sessions, settings, project
) -> None:
    user = uuid.uuid4()
    await _device(sessions, user, "android")
    throttled = {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "quota"}}
    channel = PushChannel(
        settings, fcm=_fcm_answering(429, throttled, {"Retry-After": "900"}), build=False
    )

    before = datetime.now(UTC)
    notification_id, broker = await _fan_out_and_deliver(sessions, settings, project, user, channel)

    async with sessions() as session:
        row = await session.scalar(
            select(Delivery).where(Delivery.notification_id == notification_id)
        )
    assert row.status == DeliveryStatus.RETRYING
    assert row.next_attempt_at >= before + timedelta(seconds=899)
    assert broker.scheduled
    assert broker.scheduled[0][2] == row.next_attempt_at


# --- inbox ----------------------------------------------------------------------


async def test_inbox_lists_only_the_callers_notifications_newest_first(
    client, sessions, project
) -> None:
    mine = [await _notify(sessions, project, ALICE, case_ref=f"CMP-{i}") for i in range(3)]
    await _notify(sessions, project, BOB, case_ref="CMP-BOB")

    params = {"limit": 2, "project": project["key"]}
    first = await client.get("/v1/me/notifications", headers=auth("alice"), params=params)
    assert first.status_code == 200, first.text
    page = first.json()
    assert [i["case_ref"] for i in page["items"]] == ["CMP-2", "CMP-1"]
    assert page["items"][0]["title"] == "New complaint CMP-2"
    assert page["items"][0]["type"] == "case_assigned"
    assert page["items"][0]["read"] is False
    assert page["unread_count"] == 3
    assert page["next_cursor"]

    second = (
        await client.get(
            "/v1/me/notifications",
            headers=auth("alice"),
            params={**params, "cursor": page["next_cursor"]},
        )
    ).json()
    assert [i["case_ref"] for i in second["items"]] == ["CMP-0"]
    assert second["next_cursor"] is None

    everything = (
        await client.get("/v1/me/notifications", headers=auth("alice"), params={"limit": 100})
    ).json()
    assert "CMP-BOB" not in {i["case_ref"] for i in everything["items"]}

    oldest = mine[0].payload["notification_id"]
    foreign = await client.post(f"/v1/me/notifications/{oldest}/read", headers=auth("bob"))
    assert foreign.status_code == 404
    for _ in range(2):  # idempotent
        own = await client.post(f"/v1/me/notifications/{oldest}/read", headers=auth("alice"))
        assert own.status_code == 204
    after = (
        await client.get(
            "/v1/me/notifications", headers=auth("alice"), params={**params, "limit": 5}
        )
    ).json()
    assert after["unread_count"] == 2
    assert [i["read"] for i in after["items"]] == [False, False, True]


async def test_inbox_rejects_a_forged_cursor(client) -> None:
    response = await client.get(
        "/v1/me/notifications", headers=auth("alice"), params={"cursor": "not-a-cursor"}
    )
    assert response.status_code == 400
