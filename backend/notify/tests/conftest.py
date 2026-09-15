"""Fixtures for the ada-notify integration suite.

These are integration tests on purpose. The things Friday has to prove — a real
machine token is accepted, a duplicate idempotency key produces one row, project
A cannot read project B — are all properties of the running system, and a suite
that mocked Keycloak and the database would prove none of them.

So: the stack must be up. Everything else the tests need, they create.

Every row and every Keycloak client this suite touches is prefixed 'test-'.
Nothing here reads or writes a real project.

Run with:  make notify-test
"""

from __future__ import annotations

import os
import secrets
import urllib.parse

import asyncpg
import httpx
import pytest
import pytest_asyncio

NOTIFY_BASE_URL = os.environ.get("ADA_NOTIFY_BASE_URL", "http://127.0.0.1:8001")
KC_BASE_URL = os.environ.get("ADA_KC_BASE_URL", "http://127.0.0.1:8090")
REALM = os.environ.get("ADA_REALM", "pcsmcpl")
# The operating admin, not the bootstrap one. KC_BOOTSTRAP_ADMIN_* creates a
# temporary account on a first start only, so it goes stale the moment that
# account is replaced with a named one — which is what Keycloak advises doing.
KC_ADMIN_USER = os.environ.get("KC_ADMIN_USERNAME") or os.environ.get(
    "KC_BOOTSTRAP_ADMIN_USERNAME", "admin"
)
KC_ADMIN_PASSWORD = os.environ.get("KC_ADMIN_PASSWORD") or os.environ.get(
    "KC_BOOTSTRAP_ADMIN_PASSWORD", "admin"
)

# The realm issues 60-second access tokens, deliberately: they are for people,
# and a short life is most of what makes a leaked one harmless. Machine clients
# are the exception — the shipped realm already gives ada-notify an
# access.token.lifespan of 3600 — and the clients this fixture creates are
# machine clients too.
#
# Without this, the session-scoped `projects` fixture below mints each token
# exactly once, so any run taking longer than a minute starts failing partway
# through with {"error":"unauthorized","detail":"Token has expired"}. That is a
# real 401 for a genuinely expired token, reported against whichever test
# happened to cross the boundary — it reads as a broken service and is not one.
TEST_CLIENT_ATTRIBUTES = {"access.token.lifespan": "3600"}

# Two projects, so tenancy isolation is a thing that can be tested rather than
# asserted. Fixed keys, reused across runs — creating a new Keycloak client on
# every run would litter the realm.
ALPHA = {"key": "test-alpha", "client_id": "test-alpha-notify", "name": "Test Alpha"}
BETA = {"key": "test-beta", "client_id": "test-beta-notify", "name": "Test Beta"}
# A third client that authenticates perfectly well and is not a project. This is
# what proves the 403 path is reached by "unregistered" and not by "bad token".
UNREGISTERED = {"client_id": "test-unregistered-notify", "name": "Test Unregistered"}


def _asyncpg_dsn() -> str:
    """Turn the service's SQLAlchemy URL into one asyncpg accepts, host-side.

    Two edits: drop the +asyncpg driver suffix, and rewrite the in-network
    hostname to the loopback port the compose file publishes. The tests run on
    the host, not inside the compose network.
    """
    explicit = os.environ.get("ADA_TEST_DB_DSN")
    if explicit:
        return explicit

    url = os.environ.get("ADA_DATABASE_URL", "")
    if not url:
        pytest.skip("ADA_DATABASE_URL is not set — run through 'make notify-test'")

    url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urllib.parse.urlsplit(url)
    host_port = os.environ.get("ADA_TEST_DB_HOSTPORT", "127.0.0.1:5400")
    netloc = f"{parsed.username}:{urllib.parse.quote(parsed.password or '')}@{host_port}"
    return urllib.parse.urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))


@pytest_asyncio.fixture(scope="session")
async def db():
    try:
        connection = await asyncpg.connect(_asyncpg_dsn())
    except Exception as exc:  # noqa: BLE001 — any connection failure is the same skip
        pytest.skip(f"PostgreSQL is not reachable: {exc}")
    try:
        yield connection
    finally:
        await connection.close()


@pytest_asyncio.fixture(scope="session")
async def http():
    async with httpx.AsyncClient(timeout=10.0) as client:
        yield client


@pytest_asyncio.fixture(scope="session")
async def service_is_up(http: httpx.AsyncClient) -> None:
    try:
        response = await http.get(f"{NOTIFY_BASE_URL}/health/live")
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"ada-notify is not reachable at {NOTIFY_BASE_URL}: {exc}")


@pytest_asyncio.fixture(scope="session")
async def kc_admin_token(http: httpx.AsyncClient) -> str:
    try:
        response = await http.post(
            f"{KC_BASE_URL}/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": KC_ADMIN_USER,
                "password": KC_ADMIN_PASSWORD,
            },
        )
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Keycloak admin login failed: {exc}")
    return response.json()["access_token"]


async def _ensure_client(
    http: httpx.AsyncClient, admin_token: str, client_id: str, name: str, *, with_scope: bool
) -> str:
    """Create the confidential client if absent, and return its secret."""
    api = f"{KC_BASE_URL}/admin/realms/{REALM}/clients"
    headers = {"Authorization": f"Bearer {admin_token}"}

    scopes = ["basic", "roles"] + (["notify:send"] if with_scope else [])
    await http.post(
        api,
        headers=headers,
        json={
            "clientId": client_id,
            "name": name,
            "enabled": True,
            "publicClient": False,
            "serviceAccountsEnabled": True,
            "standardFlowEnabled": False,
            "implicitFlowEnabled": False,
            "directAccessGrantsEnabled": False,
            "protocol": "openid-connect",
            "defaultClientScopes": scopes,
            "optionalClientScopes": [],
            "attributes": TEST_CLIENT_ATTRIBUTES,
        },
    )  # 201 or 409; both are fine, and 409 is the normal case on a re-run

    found = await http.get(api, headers=headers, params={"clientId": client_id})
    found.raise_for_status()
    entries = found.json()
    assert entries, f"client {client_id} was neither created nor found"
    uuid = entries[0]["id"]

    # The POST above is a no-op when the client already exists (409), so one
    # created by an earlier run keeps whatever attributes it had. This PUT is
    # what makes the token lifespan true on a re-run as well as a first run,
    # and it is what lets this fixture claim to be idempotent.
    existing = entries[0]
    attributes = {**existing.get("attributes", {}), **TEST_CLIENT_ATTRIBUTES}
    if attributes != existing.get("attributes"):
        existing["attributes"] = attributes
        updated = await http.put(f"{api}/{uuid}", headers=headers, json=existing)
        updated.raise_for_status()

    secret = await http.get(f"{api}/{uuid}/client-secret", headers=headers)
    secret.raise_for_status()
    return secret.json()["value"]


async def _token_for(http: httpx.AsyncClient, client_id: str, secret: str) -> str:
    response = await http.post(
        f"{KC_BASE_URL}/realms/{REALM}/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": secret,
        },
    )
    response.raise_for_status()
    return response.json()["access_token"]


@pytest_asyncio.fixture(scope="session")
async def projects(http: httpx.AsyncClient, kc_admin_token: str, db, service_is_up: None) -> dict:
    """Two registered projects and one authenticated-but-unregistered client.

    Idempotent: safe to run repeatedly against the same realm and database.
    """
    result: dict = {}

    for spec in (ALPHA, BETA):
        secret = await _ensure_client(
            http, kc_admin_token, spec["client_id"], spec["name"], with_scope=True
        )
        await db.execute(
            """
            INSERT INTO projects (id, key, name, client_id, enabled)
            VALUES (gen_random_uuid(), $1, $2, $3, true)
            ON CONFLICT (key) DO UPDATE
              SET client_id = EXCLUDED.client_id, enabled = true, updated_at = now()
            """,
            spec["key"],
            spec["name"],
            spec["client_id"],
        )
        project_id = await db.fetchval("SELECT id FROM projects WHERE key = $1", spec["key"])
        result[spec["key"]] = {
            "id": project_id,
            "client_id": spec["client_id"],
            "token": await _token_for(http, spec["client_id"], secret),
        }

    # Registered in Keycloak with the right scope, and deliberately absent from
    # the projects table — the 403 it earns is the tenancy boundary refusing to
    # default to anything. The removal is scoped to this one test-only
    # client_id, and the row it removes is one an earlier run of this same
    # fixture may have left behind.
    unregistered_secret = await _ensure_client(
        http, kc_admin_token, UNREGISTERED["client_id"], UNREGISTERED["name"], with_scope=True
    )
    await db.execute("DELETE FROM projects WHERE client_id = $1", UNREGISTERED["client_id"])
    result["unregistered"] = {
        "client_id": UNREGISTERED["client_id"],
        "token": await _token_for(http, UNREGISTERED["client_id"], unregistered_secret),
    }

    return result


# A recipient for the delivery tests. It has to be a real account in the realm,
# because the delivery path resolves an address from Keycloak rather than taking
# one from the request (AD-8) — a fake subject would only ever prove the
# permanent-failure path.
#
# Named 'test-recipient' and addressed at .invalid, which RFC 2606 reserves so
# that nothing can ever be delivered to it outside this stack. Created if absent
# and reused thereafter; this fixture never touches an account it did not make.
RECIPIENT = {
    "username": "test-recipient",
    "email": "test-recipient@example.invalid",
    "firstName": "Test",
    "lastName": "Recipient",
}


@pytest_asyncio.fixture(scope="session")
async def recipient(http: httpx.AsyncClient, kc_admin_token: str) -> dict:
    """A realm user with an email address, so a delivery has somewhere to go."""
    api = f"{KC_BASE_URL}/admin/realms/{REALM}/users"
    headers = {"Authorization": f"Bearer {kc_admin_token}"}

    await http.post(
        api,
        headers=headers,
        json={
            **RECIPIENT,
            "enabled": True,
            "emailVerified": True,
            # No credentials and no required actions: nothing logs in as this
            # account. It exists to be addressed.
            "requiredActions": [],
        },
    )  # 201 or 409; 409 is the normal case on a re-run

    found = await http.get(
        api, headers=headers, params={"username": RECIPIENT["username"], "exact": True}
    )
    found.raise_for_status()
    entries = found.json()
    if not entries:
        pytest.skip("could not create or find the test recipient in the realm")

    return {"sub": entries[0]["id"], "email": RECIPIENT["email"]}


@pytest.fixture
def alpha(projects: dict) -> dict:
    return projects[ALPHA["key"]]


@pytest.fixture
def beta(projects: dict) -> dict:
    return projects[BETA["key"]]


@pytest.fixture
def unregistered(projects: dict) -> dict:
    return projects["unregistered"]


@pytest.fixture
def notify_url() -> str:
    return NOTIFY_BASE_URL


@pytest.fixture
def idempotency_key() -> str:
    # Fresh per test: reusing one across tests would make them order-dependent,
    # and the whole point of the key is that a repeat is a replay.
    return f"test-{secrets.token_hex(12)}"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def body(idempotency_key: str, **overrides) -> dict:
    payload = {
        "idempotency_key": idempotency_key,
        "recipient": {"type": "kc_sub", "id": "6f1b3c7e-2f4a-4f1e-9c3d-5a7b8e9f0a1b"},
        "template_key": "welcome",
        "locale": "en",
        "payload": {"first_name": "Ada"},
        "channels": ["email"],
    }
    payload.update(overrides)
    return payload
