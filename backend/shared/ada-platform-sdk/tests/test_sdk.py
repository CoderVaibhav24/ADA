"""What the SDK must not stop doing.

These are unit tests over the two behaviours an integrating application relies on
without ever reading the source:

  * send() does not raise, whatever ADA does
  * a token is reused rather than re-fetched per call

Both are the kind of property that a well-meaning refactor removes silently. A
`raise` added to send()'s error path would pass every test that only checks the
happy case, and would then take down a caller's request the first time ADA was
slow.

No network. httpx.MockTransport stands in for ADA and for Keycloak.
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest

from ada_platform import ADAConfigError, ADANotify

ISSUER = "https://auth.example.invalid/realms/pcsmcpl"
NOTIFY = "https://notify.example.invalid"
RECIPIENT = uuid.UUID("6f1b3c7e-2f4a-4f1e-9c3d-5a7b8e9f0a1b")


class Recorder:
    """A fake ADA and Keycloak, counting what it was asked."""

    def __init__(self, *, notify_status: int = 202, notify_body: dict | None = None) -> None:
        self.token_requests = 0
        self.notify_requests = 0
        self.notify_status = notify_status
        self.notify_body = notify_body
        self.last_body: dict | None = None

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/protocol/openid-connect/token"):
            self.token_requests += 1
            return httpx.Response(
                200, json={"access_token": f"token-{self.token_requests}", "expires_in": 3600}
            )

        self.notify_requests += 1
        self.last_body = json.loads(request.content)
        body = self.notify_body or {
            "id": str(uuid.uuid4()),
            "status": "accepted",
            "idempotency_key": self.last_body["idempotency_key"],
            "recipient": self.last_body["recipient"],
            "channels": self.last_body["channels"],
            "created_at": "2026-08-31T09:42:11.412000Z",
        }
        return httpx.Response(self.notify_status, json=body)


def _notify(recorder: Recorder) -> ADANotify:
    client = httpx.Client(transport=httpx.MockTransport(recorder.handle))
    return ADANotify(
        base_url=NOTIFY,
        issuer=ISSUER,
        client_id="hrms-notify",
        client_secret="not-a-real-secret",
        client=client,
    )


# --- configuration ----------------------------------------------------------


def test_missing_configuration_fails_at_construction_not_at_first_send(monkeypatch) -> None:
    # A deployment with the wrong environment should refuse to start, rather
    # than fail on whichever request first happens to send a notification.
    for name in ("ADA_NOTIFY_URL", "ADA_ISSUER", "ADA_CLIENT_ID", "ADA_CLIENT_SECRET"):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(ADAConfigError) as caught:
        ADANotify()

    # The message has to name what is missing. "Configuration error" costs an
    # afternoon; a list of four variable names costs a minute.
    for name in ("ADA_NOTIFY_URL", "ADA_ISSUER", "ADA_CLIENT_ID"):
        assert name in str(caught.value)


# --- send() never raises ----------------------------------------------------


def test_a_202_is_accepted_and_carries_the_notification_id() -> None:
    recorder = Recorder()
    outcome = _notify(recorder).send(
        idempotency_key="leave-approved-0001",
        recipient=RECIPIENT,
        template_key="leave-approved",
        payload={"first_name": "Ada"},
    )

    assert outcome.accepted
    assert bool(outcome) is True  # usable directly in an if
    assert outcome.notification_id is not None


def test_a_rejected_body_does_not_raise() -> None:
    recorder = Recorder(notify_status=422, notify_body={"error": "validation_failed"})
    outcome = _notify(recorder).send(
        idempotency_key="short", recipient=RECIPIENT, template_key="welcome"
    )

    assert not outcome.accepted
    assert outcome.status_code == 422
    # And it is not retried: a rejected body is rejected identically next time.
    assert recorder.notify_requests == 1


def test_a_server_error_does_not_raise_and_is_retried() -> None:
    recorder = Recorder(notify_status=503, notify_body={"error": "unavailable"})
    outcome = _notify(recorder).send(
        idempotency_key="leave-approved-0002", recipient=RECIPIENT, template_key="welcome"
    )

    assert not outcome.accepted
    assert recorder.notify_requests == 3, "a 503 should be retried, not given up on"


def test_a_transport_failure_does_not_raise() -> None:
    """The case this whole design exists for.

    ADA is unreachable. The leave request is already approved and committed.
    Raising here would turn that into a 500 and the user would approve it twice.
    """

    def explode(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/protocol/openid-connect/token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        raise httpx.ConnectError("connection refused", request=request)

    client = httpx.Client(transport=httpx.MockTransport(explode))
    notify = ADANotify(
        base_url=NOTIFY,
        issuer=ISSUER,
        client_id="hrms-notify",
        client_secret="not-a-real-secret",
        client=client,
    )

    outcome = notify.send(
        idempotency_key="leave-approved-0003", recipient=RECIPIENT, template_key="welcome"
    )
    assert not outcome.accepted
    assert "transport error" in (outcome.error or "")


def test_the_replay_header_is_surfaced() -> None:
    def replayed(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/protocol/openid-connect/token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        return httpx.Response(
            202,
            json={"id": str(uuid.uuid4()), "status": "accepted"},
            headers={"Idempotent-Replay": "true"},
        )

    client = httpx.Client(transport=httpx.MockTransport(replayed))
    notify = ADANotify(
        base_url=NOTIFY,
        issuer=ISSUER,
        client_id="hrms-notify",
        client_secret="not-a-real-secret",
        client=client,
    )

    outcome = notify.send(
        idempotency_key="leave-approved-0004", recipient=RECIPIENT, template_key="welcome"
    )
    assert outcome.accepted
    assert outcome.replayed, "a replayed key should be visible to the caller"


# --- the wire contract ------------------------------------------------------


def test_the_recipient_is_sent_as_a_closed_kc_sub() -> None:
    # AD-8. If this ever becomes an email address, every caller in every
    # application has to change, which is why it is pinned here.
    recorder = Recorder()
    _notify(recorder).send(
        idempotency_key="leave-approved-0005", recipient=RECIPIENT, template_key="welcome"
    )

    assert recorder.last_body is not None
    assert recorder.last_body["recipient"] == {"type": "kc_sub", "id": str(RECIPIENT)}


def test_email_is_the_default_channel() -> None:
    recorder = Recorder()
    _notify(recorder).send(
        idempotency_key="leave-approved-0006", recipient=RECIPIENT, template_key="welcome"
    )
    assert recorder.last_body["channels"] == ["email"]


# --- token caching ----------------------------------------------------------


def test_the_token_is_fetched_once_and_reused() -> None:
    """Not an optimisation — see tokens.py.

    Keycloak's token endpoint is shared by the whole estate. An application
    fetching a token per send turns a burst of a thousand notifications into a
    thousand token requests, and the symptom is every other application's logins
    slowing down.
    """
    recorder = Recorder()
    notify = _notify(recorder)

    for index in range(20):
        notify.send(
            idempotency_key=f"leave-approved-{index:04d}",
            recipient=RECIPIENT,
            template_key="welcome",
        )

    assert recorder.notify_requests == 20
    assert recorder.token_requests == 1, (
        f"{recorder.token_requests} token requests for 20 sends — the cache is not working"
    )


def test_a_401_refreshes_the_token_once_and_then_gives_up() -> None:
    class AlwaysUnauthorized(Recorder):
        def handle(self, request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/protocol/openid-connect/token"):
                self.token_requests += 1
                return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
            self.notify_requests += 1
            return httpx.Response(401, json={"error": "unauthorized"})

    recorder = AlwaysUnauthorized()
    outcome = _notify(recorder).send(
        idempotency_key="leave-approved-0007", recipient=RECIPIENT, template_key="welcome"
    )

    assert not outcome.accepted
    # Once with the cached token, once with a fresh one. A third would be a loop
    # on what is really a wrong client secret.
    assert recorder.notify_requests == 2
    assert recorder.token_requests == 2
