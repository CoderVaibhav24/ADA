"""Fixtures for the ada-api suite.

Two different things are under test here and they need different rigs:

  * token verification — exercised for real, against RS256 tokens this suite
    signs and a JWKS served over an httpx MockTransport. No shortcuts: the
    point is that a wrong algorithm or a stale key is refused, and a mocked
    verifier would prove none of it.
  * everything else — routed through FastAPI dependency overrides, so a test
    about project ownership is about ownership rather than about JWTs.

The database is in-memory SQLite. ada-api issues no DDL in production (ada-ml
owns the schema), so the tables are created here instead.
"""

from __future__ import annotations

import os
import tempfile

# Set before app.config is imported anywhere: it has no default issuer and no
# default database, so an unset one is an import-time failure.
_DATA = tempfile.mkdtemp(prefix="ada-api-tests-")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("DATA_DIR", _DATA)
os.environ.setdefault("OIDC_ISSUER", "https://keycloak.test/realms/pcsmcpl")
os.environ.setdefault("OIDC_CLIENT_ID", "ada-web")
os.environ.setdefault("ML_SERVICE_URL", "http://ada-ml.test:8100")
os.environ.setdefault("ML_SERVICE_TOKEN", "service-token")

import ada_core.database as database  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from ada_core import models  # noqa: E402
from ada_core.database import Base, SessionLocal, configure_engine, get_db  # noqa: E402
from ada_platform import Principal  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

ISSUER = os.environ["OIDC_ISSUER"]
OWNER = "8f14e45f-ceea-467a-9f5a-000000000000"
OTHER = "1c8e9ab0-0000-4000-8000-1111aaaa2222"


# --------------------------------------------------------------------- keys
@pytest.fixture(scope="session")
def signing_key() -> rsa.RSAPrivateKey:
    """One key for the session — generating RSA at 2048 bits is not free."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def jwks(signing_key):
    """The realm's public keys, in the shape Keycloak publishes them."""
    import base64

    numbers = signing_key.public_key().public_numbers()

    def b64(value: int) -> str:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return {
        "keys": [
            {
                "kty": "RSA",
                "kid": "test-key-1",
                "use": "sig",
                "alg": "RS256",
                "n": b64(numbers.n),
                "e": b64(numbers.e),
            }
        ]
    }


@pytest.fixture
def realm_transport(jwks):
    """Keycloak's discovery and JWKS endpoints, and a record of what was hit.

    The call log is the interesting part: local verification means the JWKS is
    fetched once and reused, and a regression to per-request fetching is the
    coupling the whole design exists to avoid.
    """
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.path.endswith("/.well-known/openid-configuration"):
            # `issuer` matters as much as `jwks_uri`: the SDK compares it to the
            # configured issuer and refuses a mismatch up front, rather than
            # letting it present as every token being invalid.
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
                },
            )
        if request.url.path.endswith("/certs"):
            return httpx.Response(200, json=jwks)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    transport.calls = calls  # type: ignore[attr-defined]
    return transport


# ----------------------------------------------------------------- database
@pytest.fixture
def engine():
    """A fresh in-memory database per test, usable from FastAPI's threadpool.

    Two arguments here are not optional and both are easy to lose:

      * StaticPool — the default SQLite pool hands out a NEW in-memory database
        per connection, so the tables created here would be invisible to the
        request.
      * check_same_thread=False — every ada-api endpoint is `def`, not
        `async def`, so FastAPI runs it in a worker thread while the test holds
        the session on the main one. Without this, sqlite3 refuses the
        cross-thread use and the failure reads as a database error.

    The module engine is reset first because configure_engine is idempotent on
    the URL alone: app/config.py already built one at import, and without this
    the options above would be silently discarded in favour of that one.
    """
    if database._engine is not None:
        database._engine.dispose()
    database._engine = None

    eng = configure_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=eng)
    yield eng
    Base.metadata.drop_all(bind=eng)
    eng.dispose()
    database._engine = None


@pytest.fixture
def db(engine):
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------- app
@pytest.fixture
def principal() -> Principal:
    return Principal(
        subject=OWNER,
        azp="ada-web",
        scopes=frozenset({"openid", "profile", "email"}),
        username="officer",
        email="officer@pcsmcpl.net",
    )


@pytest.fixture
def client(engine, db, principal):
    """A TestClient signed in as OWNER."""
    from app import deps
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[deps.require_user] = lambda: principal
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def anonymous_client(engine, db):
    """A TestClient with no session, for asserting that routes are protected."""
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --------------------------------------------------------------------- rows
@pytest.fixture
def project(db):
    row = models.Project(user_id=OWNER, name="Agra", description="POC")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def foreign_project(db):
    """A project belonging to somebody else. The isolation tests turn on it."""
    row = models.Project(user_id=OTHER, name="Not yours")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def ready_rasters(db, project):
    pair = [
        models.Raster(project_id=project.id, name="T1", original_path="/data/t1.tif",
                      cog_path="/data/cogs/t1.tif", status="ready", progress=1.0),
        models.Raster(project_id=project.id, name="T2", original_path="/data/t2.tif",
                      cog_path="/data/cogs/t2.tif", status="ready", progress=1.0),
    ]
    db.add_all(pair)
    db.commit()
    for row in pair:
        db.refresh(row)
    return pair
