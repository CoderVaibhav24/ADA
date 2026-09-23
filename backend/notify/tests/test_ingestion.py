"""Friday's definition of done, as executable assertions.

  - a machine token from project A is accepted, an unauthenticated call refused
  - the same idempotency key submitted twice yields one row and the same body
  - ingestion returns inside 200 ms
  - project A cannot read project B's data (test_tenancy.py)
"""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest

from tests.conftest import auth, body


async def test_unauthenticated_is_refused(http: httpx.AsyncClient, notify_url, idempotency_key):
    response = await http.post(f"{notify_url}/v1/notifications", json=body(idempotency_key))
    assert response.status_code == 401
    # Without this header a client has no way to know it should refresh rather
    # than give up, and with a 60-second token lifetime it will need to, often.
    assert "bearer" in response.headers.get("WWW-Authenticate", "").lower()


async def test_garbage_token_is_refused(http: httpx.AsyncClient, notify_url, idempotency_key):
    response = await http.post(
        f"{notify_url}/v1/notifications",
        json=body(idempotency_key),
        headers=auth("not.a.token"),
    )
    assert response.status_code == 401
    # The reason is logged, never returned. Telling a caller which check failed
    # tells an attacker which one they passed.
    assert "invalid" in response.json()["detail"].lower()


async def test_wrong_auth_scheme_is_refused(http: httpx.AsyncClient, notify_url, idempotency_key):
    response = await http.post(
        f"{notify_url}/v1/notifications",
        json=body(idempotency_key),
        headers={"Authorization": "Basic dXNlcjpwYXNz"},
    )
    assert response.status_code == 401


async def test_authenticated_but_unregistered_client_is_forbidden(
    http: httpx.AsyncClient, notify_url, unregistered, idempotency_key
):
    """A perfectly valid token for a client that is not a project.

    403 rather than 401: the token is fine. And 403 rather than an implicit
    default project, because there is no request field by which a caller names
    the project it acts as — if azp does not resolve, nothing does.
    """
    response = await http.post(
        f"{notify_url}/v1/notifications",
        json=body(idempotency_key),
        headers=auth(unregistered["token"]),
    )
    assert response.status_code == 403
    assert "not registered" in response.json()["detail"].lower()


async def test_accepts_a_notification(http: httpx.AsyncClient, notify_url, alpha, idempotency_key):
    payload = body(idempotency_key)
    response = await http.post(
        f"{notify_url}/v1/notifications", json=payload, headers=auth(alpha["token"])
    )
    assert response.status_code == 202, response.text

    data = response.json()
    assert data["status"] == "accepted"
    assert data["idempotency_key"] == idempotency_key
    assert data["recipient"] == payload["recipient"]
    assert data["channels"] == ["email"]
    assert data["id"]
    assert data["created_at"]


async def test_notification_and_outbox_are_written_together(
    http: httpx.AsyncClient, notify_url, alpha, idempotency_key, db
):
    """The outbox row is the reason ingestion can return 202 honestly.

    One transaction, both rows. If this ever returns a notification with no
    outbox row, the notification is accepted and nothing will ever deliver it,
    and nothing anywhere will report that.
    """
    response = await http.post(
        f"{notify_url}/v1/notifications",
        json=body(idempotency_key),
        headers=auth(alpha["token"]),
    )
    assert response.status_code == 202
    notification_id = response.json()["id"]

    row = await db.fetchrow(
        "SELECT id, project_id, status, channels FROM notifications WHERE id = $1",
        notification_id,
    )
    assert row is not None
    assert str(row["project_id"]) == str(alpha["id"])
    # Any state REACHABLE from acceptance, not "accepted" exactly. The worker
    # picks the outbox row up within about half a second, so by the time this
    # query runs the notification may already be fanned_out — or failed, if the
    # project has no matching template. Pinning it to "accepted" makes the test
    # a race against the dispatcher, which is what it was before the dispatcher
    # existed. What this test is actually about is the two rows being written
    # together; the status merely has to prove ingestion got that far.
    assert row["status"] in {"accepted", "fanned_out", "completed", "failed"}

    outbox = await db.fetchrow(
        "SELECT topic, partition_key, payload, published_at FROM outbox WHERE notification_id = $1",
        notification_id,
    )
    assert outbox is not None, "notification written with no outbox row"
    assert outbox["topic"] == "notification.created"
    # Keyed on the recipient, not the notification: everything for one person
    # stays ordered relative to itself once this reaches a partitioned broker.
    assert outbox["partition_key"] == "6f1b3c7e-2f4a-4f1e-9c3d-5a7b8e9f0a1b"
    # published_at is deliberately NOT asserted to be None. It was when this
    # was written and the dispatcher did not exist; it does now, and it stamps
    # this column within a second of the insert. The atomicity claim does not
    # depend on the row being unpublished — only on it existing.


async def test_duplicate_key_yields_one_row_and_the_same_body(
    http: httpx.AsyncClient, notify_url, alpha, idempotency_key, db
):
    payload = body(idempotency_key)
    headers = auth(alpha["token"])

    first = await http.post(f"{notify_url}/v1/notifications", json=payload, headers=headers)
    second = await http.post(f"{notify_url}/v1/notifications", json=payload, headers=headers)

    assert first.status_code == 202
    assert second.status_code == 202
    # Byte for byte, including the original created_at. A retrying caller must
    # not be able to tell the two apart — that is what makes retrying safe.
    assert first.json() == second.json()
    assert second.headers.get("Idempotent-Replay") == "true"
    assert first.headers.get("Idempotent-Replay") is None

    count = await db.fetchval(
        "SELECT count(*) FROM notifications WHERE project_id = $1 AND idempotency_key = $2",
        alpha["id"],
        idempotency_key,
    )
    assert count == 1

    outbox_count = await db.fetchval(
        "SELECT count(*) FROM outbox WHERE notification_id = $1",
        first.json()["id"],
    )
    assert outbox_count == 1, "a replay must not enqueue a second delivery"


async def test_concurrent_duplicates_still_yield_one_row(
    http: httpx.AsyncClient, notify_url, alpha, idempotency_key, db
):
    """The race a pre-check SELECT loses.

    Eight simultaneous submissions of the same key. A pre-check passes in all
    eight before any of them inserts, and the constraint is the only thing that
    actually holds. This is the test that would fail if the implementation ever
    'optimised' the caught integrity error away.
    """
    payload = body(idempotency_key)
    headers = auth(alpha["token"])

    responses = await asyncio.gather(
        *(
            http.post(f"{notify_url}/v1/notifications", json=payload, headers=headers)
            for _ in range(8)
        )
    )

    assert all(r.status_code == 202 for r in responses), [r.status_code for r in responses]
    ids = {r.json()["id"] for r in responses}
    assert len(ids) == 1, f"expected one notification, got {len(ids)}"

    count = await db.fetchval(
        "SELECT count(*) FROM notifications WHERE project_id = $1 AND idempotency_key = $2",
        alpha["id"],
        idempotency_key,
    )
    assert count == 1


async def test_ingestion_is_under_200ms(http: httpx.AsyncClient, notify_url, alpha):
    """NFR: accepted in under 200 ms.

    Measured over several requests and asserted on the median, because the first
    request of a process pays for the JWKS fetch and a cold connection pool, and
    failing the build on that would be measuring the wrong thing.
    """
    headers = auth(alpha["token"])
    # Warm the JWKS cache and the pool first. This is not the measurement.
    await http.post(
        f"{notify_url}/v1/notifications",
        json=body(f"test-warmup-{time.time_ns()}"),
        headers=headers,
    )

    timings = []
    for index in range(10):
        payload = body(f"test-latency-{index}-{time.time_ns()}")
        started = time.perf_counter()
        response = await http.post(
            f"{notify_url}/v1/notifications", json=payload, headers=headers
        )
        timings.append((time.perf_counter() - started) * 1000)
        assert response.status_code == 202

    timings.sort()
    median = timings[len(timings) // 2]
    assert median < 200, f"median ingestion latency {median:.1f}ms exceeds the 200ms budget"


# --- The closed contract ---------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        # AD-8: one identifier space. An email address is an application-owned
        # identifier, and accepting it here is what produces silent
        # empty-result defects later.
        ("recipient", {"type": "email", "id": "ada@pcsmcpl.net"}),
        ("recipient", {"type": "kc_sub", "id": "not-a-uuid"}),
        ("recipient", {"type": "kc_sub"}),
        ("channels", []),
        ("channels", ["carrier-pigeon"]),
        # Known to the enum, not deliverable in v0.1. Refused at the boundary
        # rather than accepted and silently never sent.
        ("channels", ["sms"]),
        ("channels", ["email", "inapp"]),
        ("idempotency_key", "short"),
        ("idempotency_key", "  padded-key-value  "),
    ],
)
async def test_contract_violations_are_422(
    http: httpx.AsyncClient, notify_url, alpha, idempotency_key, field, value
):
    # {**body(...), field: value}, not body(..., **{field: value}): the helper
    # takes idempotency_key positionally, so the keyword form raises
    # "body() got multiple values for argument 'idempotency_key'" for exactly
    # the two cases that exercise that field — the TypeError is reported as the
    # value having been accepted, which is the opposite of what happened.
    payload = {**body(idempotency_key), field: value}
    response = await http.post(
        f"{notify_url}/v1/notifications", json=payload, headers=auth(alpha["token"])
    )
    assert response.status_code == 422, f"{field}={value!r} was accepted"
    assert response.json()["error"] == "validation_failed"


async def test_unknown_field_is_rejected(
    http: httpx.AsyncClient, notify_url, alpha, idempotency_key
):
    """extra='forbid'. A caller misspelling 'template_key' should hear about it.

    Silently ignoring an unrecognised field is how a caller ends up believing it
    set something it did not.
    """
    payload = body(idempotency_key)
    payload["templateKey"] = "welcome"
    response = await http.post(
        f"{notify_url}/v1/notifications", json=payload, headers=auth(alpha["token"])
    )
    assert response.status_code == 422


async def test_duplicate_channels_are_deduplicated(
    http: httpx.AsyncClient, notify_url, alpha, idempotency_key
):
    """['email', 'email'] means one delivery, not two, and is not an error."""
    response = await http.post(
        f"{notify_url}/v1/notifications",
        json=body(idempotency_key, channels=["email", "email"]),
        headers=auth(alpha["token"]),
    )
    assert response.status_code == 202
    assert response.json()["channels"] == ["email"]


async def test_health_endpoints(http: httpx.AsyncClient, notify_url, service_is_up):
    live = await http.get(f"{notify_url}/health/live")
    assert live.status_code == 200
    assert live.json()["status"] == "alive"

    ready = await http.get(f"{notify_url}/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["database"] == "ok"
