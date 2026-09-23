"""Project A cannot read or affect project B.

The last of Friday's done-when criteria, and the one worth the most scrutiny,
because a tenancy leak is not a bug that shows up in normal use — it shows up
once, in front of a customer, permanently.

The boundary is one predicate: the project is resolved from the token's azp
claim, and every project-scoped query filters on that project's id. There is no
request field by which a caller can name a different project, which is why these
tests attack the identifier rather than the request body.
"""

from __future__ import annotations

import uuid

import httpx

from tests.conftest import auth, body


async def _submit(http: httpx.AsyncClient, notify_url: str, project: dict, key: str) -> str:
    response = await http.post(
        f"{notify_url}/v1/notifications", json=body(key), headers=auth(project["token"])
    )
    assert response.status_code == 202, response.text
    return response.json()["id"]


async def test_project_cannot_read_another_projects_notification(
    http: httpx.AsyncClient, notify_url, alpha, beta, idempotency_key
):
    """404, not 403.

    403 would confirm the id exists, which turns this endpoint into an oracle
    for enumerating another project's notification ids. A caller with no right
    to a row should be unable to distinguish it from a row that does not exist.
    """
    beta_notification = await _submit(http, notify_url, beta, idempotency_key)

    # Beta can read its own.
    own = await http.get(
        f"{notify_url}/v1/notifications/{beta_notification}", headers=auth(beta["token"])
    )
    assert own.status_code == 200
    assert own.json()["id"] == beta_notification

    # Alpha cannot, and cannot tell that it exists.
    foreign = await http.get(
        f"{notify_url}/v1/notifications/{beta_notification}", headers=auth(alpha["token"])
    )
    assert foreign.status_code == 404

    absent = await http.get(
        f"{notify_url}/v1/notifications/{uuid.uuid4()}", headers=auth(alpha["token"])
    )
    assert absent.status_code == 404
    assert foreign.json() == absent.json(), "a foreign row is distinguishable from a missing one"


async def test_the_same_idempotency_key_is_independent_per_project(
    http: httpx.AsyncClient, notify_url, alpha, beta, idempotency_key, db
):
    """The unique constraint is (project_id, idempotency_key), not the key alone.

    Two projects choosing the same natural key — 'invoice-42' — must not
    collide. A global unique index would make one project's submission silently
    return the other's notification, which is a cross-tenant data leak wearing
    the costume of an idempotency feature.
    """
    alpha_id = await _submit(http, notify_url, alpha, idempotency_key)
    beta_id = await _submit(http, notify_url, beta, idempotency_key)

    assert alpha_id != beta_id

    rows = await db.fetch(
        "SELECT project_id FROM notifications WHERE idempotency_key = $1", idempotency_key
    )
    assert len(rows) == 2
    assert {str(r["project_id"]) for r in rows} == {str(alpha["id"]), str(beta["id"])}


async def test_notification_is_stamped_with_the_tokens_project(
    http: httpx.AsyncClient, notify_url, alpha, idempotency_key, db
):
    """project_id comes from azp and from nowhere else."""
    notification_id = await _submit(http, notify_url, alpha, idempotency_key)

    project_id = await db.fetchval(
        "SELECT project_id FROM notifications WHERE id = $1", notification_id
    )
    assert str(project_id) == str(alpha["id"])


async def test_disabled_project_is_refused(
    http: httpx.AsyncClient, notify_url, beta, idempotency_key, db
):
    """Disabling a project stops it sending, immediately and without a restart.

    Restored in a finally block: leaving beta disabled would make every
    subsequent run of this suite fail somewhere else entirely.
    """
    await db.execute("UPDATE projects SET enabled = false WHERE id = $1", beta["id"])
    try:
        response = await http.post(
            f"{notify_url}/v1/notifications",
            json=body(idempotency_key),
            headers=auth(beta["token"]),
        )
        assert response.status_code == 403
        assert "disabled" in response.json()["detail"].lower()
    finally:
        await db.execute("UPDATE projects SET enabled = true WHERE id = $1", beta["id"])

    # And it works again once re-enabled, in the same process — the check is a
    # query, not a value cached at startup.
    recovered = await http.post(
        f"{notify_url}/v1/notifications",
        json=body(idempotency_key),
        headers=auth(beta["token"]),
    )
    assert recovered.status_code == 202
