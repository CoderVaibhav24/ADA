"""The in-app channel, the deep-link hint, and the ICMS workflow template seed."""

from __future__ import annotations

import importlib.util
import pathlib
import uuid
from collections import defaultdict

import pytest

from app.channels.base import Channel, Outgoing
from app.channels.inapp import INBOX_ADDRESS, InAppChannel
from app.channels.registry import create_channels
from app.config import Settings
from app.delivery import push_data
from app.routing import routing_data
from app.schemas import NotificationCreate, TemplateCreate

MIGRATION = (
    pathlib.Path(__file__).resolve().parent.parent
    / "alembic"
    / "versions"
    / "0005_icms_workflow_templates.py"
)

# The API's event -> channels contract (services/api/app/icms/notifier.py).
PUSH_KEYS = {
    "case_unassigned",
    "inspection_assigned",
    "resurvey_requested",
    "resurvey_request_raised",
    "resurvey_approved",
}
INAPP_KEYS = PUSH_KEYS | {
    "case_assigned",
    "case_raised",
    "inspection_submitted",
    "findings_accepted",
    "resurvey_refused",
    "case_handed_over",
    "case_confirmed",
    "notice_issued",
}


def _settings(**overrides) -> Settings:
    base = {
        "issuer": "http://localhost:8090/realms/pcsmcpl",
        "database_url": "postgresql+asyncpg://ada:x@localhost:5400/ada",
        "email_provider": "stub",
        "push_provider": "stub",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def _templates() -> list[tuple[str, str, str, str, str]]:
    spec = importlib.util.spec_from_file_location("seed_0005", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.TEMPLATES


async def test_inapp_send_touches_no_provider_and_reports_the_inbox() -> None:
    channel = InAppChannel(_settings())
    notification_id = uuid.uuid4()
    result = await channel.send(
        Outgoing(to=INBOX_ADDRESS, body="b", subject="s", notification_id=notification_id)
    )
    assert result.provider_message_id == f"inbox-{notification_id}"
    assert isinstance(channel, Channel)


def test_the_worker_builds_an_inapp_consumer() -> None:
    assert set(create_channels(_settings())) == {"email", "push", "inapp"}


def test_inapp_is_accepted_alone_and_beside_push() -> None:
    body = {
        "idempotency_key": "case_raised-CMP-2026-0001-x",
        "recipient": {"type": "kc_sub", "id": str(uuid.uuid4())},
        "template_key": "case_raised",
        "payload": {"case_ref": "CMP-2026-0001"},
    }
    assert NotificationCreate(**body, channels=["inapp"]).channels == ["inapp"]
    assert NotificationCreate(**body, channels=["push", "inapp"]).channels == ["push", "inapp"]
    with pytest.raises(ValueError):
        NotificationCreate(**body, channels=["sms"])


def test_portal_clients_may_read_their_inbox_by_default() -> None:
    assert {"ada-field", "ada-web", "ada-auth"} <= _settings().user_clients


def test_routing_data_carries_refs_and_route_and_nothing_else() -> None:
    data = routing_data(
        template_key="resurvey_requested",
        payload={
            "case_ref": "CMP-2026-0001",
            "inspection_ref": "INS-2026-0003",
            "route": "/inspection/CMP-2026-0001",
            "reason": "blurred photographs",
            "zone_name": "Zone 4",
            "notice_ref": None,
        },
    )
    assert data == {
        "type": "resurvey_requested",
        "case_ref": "CMP-2026-0001",
        "inspection_ref": "INS-2026-0003",
        "route": "/inspection/CMP-2026-0001",
    }
    assert routing_data(template_key="t", payload={"case_ref": True}) == {"type": "t"}


def test_push_data_is_the_routing_hint_plus_the_notification_id() -> None:
    notification_id = uuid.uuid4()
    data = push_data(
        notification_id=notification_id,
        template_key="case_assigned",
        payload={"case_ref": "CMP-2026-0001", "reason": "x"},
    )
    assert data == {
        "type": "case_assigned",
        "case_ref": "CMP-2026-0001",
        "notification_id": str(notification_id),
    }


def test_every_workflow_event_has_en_and_hi_templates_on_its_channels() -> None:
    locales: dict[tuple[str, str], set[str]] = defaultdict(set)
    for key, channel, locale, _subject, _body in _templates():
        locales[(key, channel)].add(locale)
    expected = {(k, "inapp") for k in INAPP_KEYS} | {(k, "push") for k in PUSH_KEYS}
    assert set(locales) == expected
    assert all(found == {"en", "hi"} for found in locales.values())


def test_seeded_templates_are_valid_and_push_text_carries_no_reason() -> None:
    for key, channel, locale, subject, body in _templates():
        TemplateCreate(key=key, channel=channel, locale=locale, subject=subject, body=body)
        if channel == "push":
            assert "reason" not in body and "zone_name" not in body, key


REMINDER_MIGRATION = MIGRATION.with_name("0006_icms_reminder_templates.py")
# services/api/app/icms/reminders.py: only the surveyor's reminder is pushed.
REMINDER_PUSH_KEYS = {"inspection_reminder"}
REMINDER_INAPP_KEYS = REMINDER_PUSH_KEYS | {
    "inspection_overdue",
    "verification_pending",
    "resurvey_decision_pending",
    "notice_compliance_due",
}


def _reminder_templates() -> list[tuple[str, str, str, str, str]]:
    spec = importlib.util.spec_from_file_location("seed_0006", REMINDER_MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    assert module.down_revision == "0005"
    return module.TEMPLATES


def test_every_reminder_has_en_and_hi_templates_on_its_channels() -> None:
    locales: dict[tuple[str, str], set[str]] = defaultdict(set)
    for key, channel, locale, subject, body in _reminder_templates():
        locales[(key, channel)].add(locale)
        TemplateCreate(key=key, channel=channel, locale=locale, subject=subject, body=body)
        if channel == "push":
            assert "zone_name" not in body and "days" not in body, key
    expected = {(k, "inapp") for k in REMINDER_INAPP_KEYS} | {
        (k, "push") for k in REMINDER_PUSH_KEYS
    }
    assert set(locales) == expected
    assert all(found == {"en", "hi"} for found in locales.values())
    assert not {key for key, *_ in _reminder_templates()} & {key for key, *_ in _templates()}


OUTCOME_MIGRATION = MIGRATION.with_name("0007_icms_case_outcome_templates.py")
# services/api/app/icms/notifier.py: only the released surveyor is pushed a rejection.
OUTCOME_PUSH_KEYS = {"case_rejected"}
OUTCOME_INAPP_KEYS = {"case_rejected", "case_closed"}


def _outcome_templates() -> list[tuple[str, str, str, str, str]]:
    spec = importlib.util.spec_from_file_location("seed_0007", OUTCOME_MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    assert module.down_revision == "0006"
    return module.TEMPLATES


def test_every_case_outcome_has_en_and_hi_templates_on_its_channels() -> None:
    locales: dict[tuple[str, str], set[str]] = defaultdict(set)
    for key, channel, locale, subject, body in _outcome_templates():
        locales[(key, channel)].add(locale)
        TemplateCreate(key=key, channel=channel, locale=locale, subject=subject, body=body)
        if channel == "push":
            assert "outcome" not in body and "zone_name" not in body, key
    expected = {(k, "inapp") for k in OUTCOME_INAPP_KEYS} | {
        (k, "push") for k in OUTCOME_PUSH_KEYS
    }
    assert set(locales) == expected
    assert all(found == {"en", "hi"} for found in locales.values())
    earlier = {key for key, *_ in _templates()} | {key for key, *_ in _reminder_templates()}
    assert not {key for key, *_ in _outcome_templates()} & earlier
