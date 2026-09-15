"""The half of the system that happens after the 202.

Sunday's definition of done, in order:

  5. the email arrives, rendered from a template, and the delivery is logged
  7. a forced provider failure retries five times and dead-letters with its
     final error
  8. a killed worker's message is reclaimed within five minutes

These are integration tests against the running stack, for the same reason the
ingestion tests are: a mocked broker and a mocked mail server would prove that
the mocks agree with the code, which is not the question. The question is whether
a notification submitted over HTTP turns into a message in a mailbox.

They need the stack up, with mailpit as the mail provider — which is the default:

    make up && make notify-test

Criterion 7 is not asserted here. It takes five real attempts spread over an
hour, and a test that waits an hour is a test nobody runs; compressing the ladder
to prove it needs a worker started with different settings, which is what
`make demo-retry` does. What *is* asserted here is the classification that
decides between retrying and not, because that is the part with the logic in it.
"""

from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest

from tests.conftest import NOTIFY_BASE_URL, auth, body

MAILPIT_BASE_URL = "http://127.0.0.1:8025"

TEMPLATE = {
    "key": "test-delivery",
    "channel": "email",
    "locale": "en",
    "subject": "Test delivery for {{ first_name }}",
    "body": "Hello {{ first_name }},\n\nReference {{ reference }}.\n\n-- ADA\n",
}


async def _store_template(http: httpx.AsyncClient, token: str, **overrides) -> dict:
    response = await http.post(
        f"{NOTIFY_BASE_URL}/v1/templates", headers=auth(token), json={**TEMPLATE, **overrides}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _wait_for_delivery(
    http: httpx.AsyncClient, token: str, notification_id: str, *, give_up_after: float = 45.0
) -> dict:
    """Poll until the delivery reaches a terminal state, or give up.

    Polling rather than a fixed sleep: delivery normally takes under a second,
    and a test that always sleeps for the worst case is a test that slows every
    run down to the worst case.
    """
    deadline = asyncio.get_running_loop().time() + give_up_after
    last: dict = {}

    while asyncio.get_running_loop().time() < deadline:
        response = await http.get(
            f"{NOTIFY_BASE_URL}/v1/notifications/{notification_id}/deliveries",
            headers=auth(token),
        )
        response.raise_for_status()
        last = response.json()
        rows = last.get("deliveries") or []
        if rows and rows[0]["status"] in ("sent", "failed", "dead"):
            return last
        await asyncio.sleep(0.5)

    return last


async def test_a_notification_becomes_a_delivered_email(
    http: httpx.AsyncClient, alpha: dict, recipient: dict
) -> None:
    """Criterion 5, end to end.

    Submitted over HTTP, written to the outbox in the ingestion transaction,
    published by the dispatcher, fanned out, rendered, and handed to a mail
    server — with the provider's message id recorded against the delivery.
    """
    await _store_template(http, alpha["token"])

    reference = uuid.uuid4().hex[:12]
    payload = body(
        f"delivery-{reference}",
        recipient={"type": "kc_sub", "id": recipient["sub"]},
        template_key=TEMPLATE["key"],
        payload={"first_name": "Ada", "reference": reference},
    )

    accepted = await http.post(
        f"{NOTIFY_BASE_URL}/v1/notifications", headers=auth(alpha["token"]), json=payload
    )
    assert accepted.status_code == 202, accepted.text
    notification_id = accepted.json()["id"]

    result = await _wait_for_delivery(http, alpha["token"], notification_id)
    rows = result.get("deliveries") or []

    assert rows, (
        "no delivery row appeared. The worker is what turns an accepted "
        "notification into a delivery — check 'make worker-logs'."
    )
    delivery = rows[0]

    assert delivery["status"] == "sent", (
        f"delivery ended as {delivery['status']}: {delivery.get('last_error')}"
    )
    # Without this, "we sent it" is an assertion with nothing behind it.
    assert delivery["provider_message_id"], "no provider message id was recorded"
    assert delivery["attempts"] == 1, "a working provider should take one attempt"
    # Redacted on the way out: a delivery record is readable by anyone holding
    # the project's token, which is a lower bar than reading someone's address.
    assert delivery["address"] and "***" in delivery["address"]

    # The notification is closed once every channel has finished.
    assert result["status"] == "completed"


async def test_the_message_actually_reaches_the_mail_server(
    http: httpx.AsyncClient, alpha: dict, recipient: dict
) -> None:
    """The other end of criterion 5.

    A delivery row saying 'sent' is ADA's own account of itself. This looks in
    the mail server, which is the only place that can contradict it.
    """
    try:
        await http.get(f"{MAILPIT_BASE_URL}/api/v1/info")
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"mailpit is not reachable at {MAILPIT_BASE_URL}: {exc}")

    await _store_template(http, alpha["token"])

    reference = uuid.uuid4().hex[:12]
    payload = body(
        f"mailbox-{reference}",
        recipient={"type": "kc_sub", "id": recipient["sub"]},
        template_key=TEMPLATE["key"],
        payload={"first_name": "Grace", "reference": reference},
    )

    accepted = await http.post(
        f"{NOTIFY_BASE_URL}/v1/notifications", headers=auth(alpha["token"]), json=payload
    )
    assert accepted.status_code == 202, accepted.text

    await _wait_for_delivery(http, alpha["token"], accepted.json()["id"])

    # Searched by the reference substituted into the body, so this cannot match
    # a message left behind by another test or an earlier run.
    found = await http.get(f"{MAILPIT_BASE_URL}/api/v1/search", params={"query": reference})
    found.raise_for_status()
    messages = found.json().get("messages") or []

    assert messages, f"no message containing {reference!r} reached the mail server"

    message = messages[0]
    assert "Grace" in message["Subject"], (
        f"the subject was not rendered from the template: {message['Subject']!r}"
    )
    assert any(to["Address"] == recipient["email"] for to in message["To"]), (
        "the message went to the wrong address — the Keycloak lookup resolved "
        "something unexpected"
    )


async def test_a_missing_template_fails_permanently_and_says_so(
    http: httpx.AsyncClient, alpha: dict, recipient: dict
) -> None:
    """Criterion 7's other half: the failures that must NOT be retried.

    Retrying this for an hour would change nothing, and the delivery would spend
    that hour looking like it might still succeed. Failing immediately with the
    reason is what makes it fixable.
    """
    payload = body(
        f"no-template-{uuid.uuid4().hex[:12]}",
        recipient={"type": "kc_sub", "id": recipient["sub"]},
        template_key="a-template-that-does-not-exist",
    )

    accepted = await http.post(
        f"{NOTIFY_BASE_URL}/v1/notifications", headers=auth(alpha["token"]), json=payload
    )
    assert accepted.status_code == 202, "ingestion does not know templates; it accepts"

    result = await _wait_for_delivery(http, alpha["token"], accepted.json()["id"])
    rows = result.get("deliveries") or []

    assert rows, "a permanently failed channel must still leave a row saying why"
    delivery = rows[0]

    assert delivery["status"] == "failed", (
        f"expected an immediate permanent failure, got {delivery['status']}"
    )
    assert delivery["attempts"] == 0, "a missing template should cost no send attempts"
    assert "template" in (delivery["last_error"] or "").lower()
    assert delivery["next_attempt_at"] is None, "a permanent failure must not be scheduled"


async def test_an_unrenderable_payload_fails_rather_than_sending_a_gap(
    http: httpx.AsyncClient, alpha: dict, recipient: dict
) -> None:
    """The renderer's strictness, proven where it matters.

    The template needs {{ first_name }} and the payload has none. A lenient
    renderer would send 'Hello ,' to a real person and record a success.
    """
    await _store_template(http, alpha["token"])

    payload = body(
        f"unrenderable-{uuid.uuid4().hex[:12]}",
        recipient={"type": "kc_sub", "id": recipient["sub"]},
        template_key=TEMPLATE["key"],
        payload={"reference": "only-the-reference"},
    )

    accepted = await http.post(
        f"{NOTIFY_BASE_URL}/v1/notifications", headers=auth(alpha["token"]), json=payload
    )
    assert accepted.status_code == 202

    result = await _wait_for_delivery(http, alpha["token"], accepted.json()["id"])
    rows = result.get("deliveries") or []

    assert rows
    assert rows[0]["status"] == "failed"
    assert "first_name" in (rows[0]["last_error"] or "")


async def test_templates_are_versioned_rather_than_edited(
    http: httpx.AsyncClient, alpha: dict
) -> None:
    """Deliveries record which template produced them.

    Editing a row in place would silently rewrite the history of what was sent —
    a delivery from last Tuesday would start claiming today's wording.
    """
    first = await _store_template(http, alpha["token"], body="Version one. {{ first_name }}\n")
    second = await _store_template(http, alpha["token"], body="Version two. {{ first_name }}\n")

    assert second["version"] == first["version"] + 1
    assert second["active"] is True
    assert second["id"] != first["id"], "a new version must be a new row"

    # The superseded version is still readable, which is the whole point.
    old = await http.get(
        f"{NOTIFY_BASE_URL}/v1/templates/{first['id']}", headers=auth(alpha["token"])
    )
    assert old.status_code == 200
    assert old.json()["active"] is False
    assert old.json()["body"] == "Version one. {{ first_name }}\n"


async def test_a_template_with_a_malformed_placeholder_is_refused_at_write_time(
    http: httpx.AsyncClient, alpha: dict
) -> None:
    """Caught when it is written, not when it is sent.

    Discovered at delivery time, this fails one message at a time, hours later,
    for a caller who never sees the error.
    """
    response = await http.post(
        f"{NOTIFY_BASE_URL}/v1/templates",
        headers=auth(alpha["token"]),
        json={**TEMPLATE, "body": "Hello {{ 1nvalid }},\n"},
    )
    assert response.status_code == 422, response.text
    assert "placeholder" in response.text.lower()


async def test_one_project_cannot_read_another_projects_templates(
    http: httpx.AsyncClient, alpha: dict, beta: dict
) -> None:
    """The tenancy boundary again, on the templates it now also protects."""
    stored = await _store_template(http, alpha["token"], key=f"alpha-only-{uuid.uuid4().hex[:8]}")

    # 404 rather than 403, so this cannot be used to discover which ids exist.
    denied = await http.get(
        f"{NOTIFY_BASE_URL}/v1/templates/{stored['id']}", headers=auth(beta["token"])
    )
    assert denied.status_code == 404

    listed = await http.get(f"{NOTIFY_BASE_URL}/v1/templates", headers=auth(beta["token"]))
    listed.raise_for_status()
    assert all(row["id"] != stored["id"] for row in listed.json())
