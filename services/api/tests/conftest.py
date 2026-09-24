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
# The policy listener and its revision poll are a background thread. Sharing
# one in-memory SQLite connection with the test it is racing is a flake, not
# a test, so the suite drives reloads synchronously instead.
os.environ.setdefault("ICMS_POLICY_WATCH", "false")
# No test reaches the network: the locator is the null one unless a test builds another.
os.environ.setdefault("GEO_LOCATE_BASE_URL", "")
# The sweeper is driven synchronously by tests/test_sweeper.py, never by the lifespan.
os.environ.setdefault("SWEEPER_ENABLED", "false")
# Reminders are driven synchronously by tests/test_icms_reminders.py with a fake clock.
os.environ.setdefault("REMINDERS_ENABLED", "false")
os.environ.setdefault("COLD_STORE_ENDPOINT", "")

from datetime import date, datetime, timedelta  # noqa: E402
from pathlib import Path  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

import ada_core.database as database  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402

# models_icms is imported for its side effect: a mapped class registers itself on
# Base.metadata when its module is imported, and `create_all` below creates what
# is registered at that moment. Without it the seventeen icms_* tables exist only
# once something else has pulled models_icms in — which the app does, from
# app/icms/security.py, but not until the first test builds a TestClient. The
# symptom is `no such table: icms_code_value` in the FIRST ICMS test of a run and
# nowhere afterwards, which is a miserable thing to debug.
from ada_core import models, models_app, models_icms  # noqa: E402, F401
from ada_core.database import Base, SessionLocal, configure_engine, get_db  # noqa: E402
from ada_platform import Principal  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
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
        # The imagery routers require imagery.read / write / run, which only the
        # nodal officer holds (0012); tests/test_security_hardening.py covers the rest.
        claims={"realm_access": {"roles": ["pcs-nodal-officer", "offline_access"]}},
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


# --------------------------------------------------------------- ICMS rig
#
# The ICMS suites need something the project fixtures above cannot give them: a
# caller whose REALM ROLES vary from test to test. `Principal.roles` reads
# `realm_access.roles` out of the token claims (ada_platform/verify.py), so a
# role-bearing principal is a principal with that claim, and nothing else has to
# change.
#
# Four subjects, one per role, because zone scoping is per user: a test that
# proves a Field Surveyor sees only their zones needs the surveyor to be a
# different person from the nodal officer.

SUPER_ADMIN_ID = "aaaaaaaa-0000-4000-8000-000000000001"
NODAL_ID = "bbbbbbbb-0000-4000-8000-000000000002"
SURVEYOR_ID = "cccccccc-0000-4000-8000-000000000003"
LEAD_ID = "dddddddd-0000-4000-8000-000000000004"

SUPER_ADMIN = "super-admin"
NODAL = "pcs-nodal-officer"
SURVEYOR = "field-surveyor"
LEAD = "ada-project-lead"

ROLE_SUBJECTS = {
    SUPER_ADMIN: SUPER_ADMIN_ID,
    NODAL: NODAL_ID,
    SURVEYOR: SURVEYOR_ID,
    LEAD: LEAD_ID,
}


def icms_principal(subject: str, *roles: str, azp: str | None = None) -> Principal:
    """A verified token's worth of officer, with realm roles attached.

    A Field Surveyor signs in through the field app (azp ada-field) unless the
    test says otherwise; everyone else through the web portal.
    """
    return Principal(
        subject=subject,
        azp=azp or ("ada-field" if SURVEYOR in roles else "ada-web"),
        scopes=frozenset({"openid", "profile", "email"}),
        username=f"officer-{subject[:8]}",
        email=f"{subject[:8]}@pcsmcpl.net",
        # 'offline_access' and 'default-roles-pcsmcpl' are in every real token
        # and are irrelevant to ICMS. They are here so the suite exercises the
        # discarding of unknown roles rather than a tidied-up claim.
        claims={"realm_access": {"roles": [*roles, "offline_access",
                                           "default-roles-pcsmcpl"]}},
    )


# Imported inside the fixture: fake_keycloak reads the four subject constants
# from this module, so a top-level import here would be a cycle.
@pytest.fixture
def keycloak():
    """The realm the officer-administration endpoints talk to, in memory."""
    from tests.fake_keycloak import FakeKeycloak

    return FakeKeycloak()


@pytest.fixture
def icms_client(engine, db, keycloak):
    """A TestClient whose signed-in officer can be changed mid-test.

    `client.sign_in(role)` swaps the principal the auth dependency returns, so
    one test can assert what a Super Admin sees and what a Field Surveyor sees
    without building a second application.
    """
    from app import deps
    from app.clients.keycloak import get_admin_client
    from app.icms.actors import actor_directory
    from app.main import app

    state: dict = {"principal": icms_principal(SUPER_ADMIN_ID, SUPER_ADMIN)}

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[deps.require_user] = lambda: state["principal"]
    # Keycloak is a network dependency of six endpoints. Overriding it here means
    # the contract suites exercise them without a server, like every other route.
    app.dependency_overrides[get_admin_client] = lambda: keycloak
    app.dependency_overrides[actor_directory] = lambda: keycloak

    with TestClient(app) as test_client:
        def sign_in(*roles: str, subject: str | None = None, azp: str | None = None):
            if subject is None:
                subject = ROLE_SUBJECTS.get(roles[0], OWNER) if roles else OWNER
            state["principal"] = icms_principal(subject, *roles, azp=azp)
            return test_client

        test_client.sign_in = sign_in  # type: ignore[attr-defined]
        test_client.subject_of = lambda role: ROLE_SUBJECTS[role]  # type: ignore[attr-defined]
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def code_values(db):
    """The lookup seed. `0001_baseline.py` bulk-inserts this on a real database;
    the suite runs on `create_all`, which applies no data, so it is done here."""
    from ada_core.models_icms import CodeValue

    rows = [
        CodeValue(domain="complaint_type", code="unauthorised_construction",
                  label="Unauthorised construction", sort_order=1),
        CodeValue(domain="complaint_type", code="deviation_from_plan",
                  label="Deviation from sanctioned plan", sort_order=2),
        CodeValue(domain="complaint_type", code="encroachment",
                  label="Encroachment on public land", sort_order=3),
        CodeValue(domain="complaint_type", code="illegal_colony",
                  label="Illegal colony development", sort_order=4, active=False),
        CodeValue(domain="property_type", code="residential", label="Residential",
                  sort_order=1),
        CodeValue(domain="property_type", code="commercial", label="Commercial",
                  sort_order=2),
    ]
    db.add_all(rows)
    db.commit()
    return rows


# A small square near Agra, in EPSG:4326. Valid enough for GeoPolygon and small
# enough to read in a failure message.
SQUARE = {
    "type": "Polygon",
    "coordinates": [[[78.00, 27.00], [78.01, 27.00], [78.01, 27.01],
                     [78.00, 27.01], [78.00, 27.00]]],
}


@pytest.fixture
def zones(db):
    """Three zones. TAJ and CANT are assigned out in the tests; RURAL never is,
    so it is the row a scoping failure would leak."""
    import json

    from ada_core.models_icms import Zone

    rows = [
        Zone(zone_cd="TAJ", name="Taj Ganj", name_hi="ताजगंज",
             geom=json.dumps({"type": "MultiPolygon", "coordinates": [SQUARE["coordinates"]]})),
        Zone(zone_cd="CANT", name="Cantonment", parent_cd="TAJ"),
        Zone(zone_cd="RURAL", name="Rural Belt"),
        Zone(zone_cd="OLD", name="Old Town", active=False),
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return {row.zone_cd: row for row in rows}


@pytest.fixture
def assignments(db, zones):
    """The nodal officer sees TAJ; the surveyor sees CANT. Nobody sees RURAL."""
    from ada_core.models_icms import ZoneAssignment

    rows = [
        ZoneAssignment(zone_id=zones["TAJ"].id, user_id=NODAL_ID, assigned_by=SUPER_ADMIN_ID),
        ZoneAssignment(zone_id=zones["CANT"].id, user_id=SURVEYOR_ID,
                       assigned_by=SUPER_ADMIN_ID),
        # Revoked: history, and proof that a closed assignment grants nothing.
        ZoneAssignment(zone_id=zones["RURAL"].id, user_id=SURVEYOR_ID, active=False,
                       assigned_by=SUPER_ADMIN_ID),
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


# ------------------------------------------------------------- ICMS cases
#
# A second surveyor, assigned to TAJ. He exists so that "assign a TAJ case to a
# surveyor who can see TAJ" and "assign it to one who cannot" are both
# expressible. His zone assignment lives in the `cases` fixture rather than in
# `assignments`, because the Batch 1 suites count the rows in that one.

SURVEYOR_B_ID = "eeeeeeee-0000-4000-8000-000000000005"

# Midday IST, so that the five-and-a-half hour offset cannot push a fixture over
# a date boundary and make a date-range assertion depend on the backend.
IST = ZoneInfo("Asia/Kolkata")


def _filed(day: int, month: int = 9, year: int = 2026) -> datetime:
    return datetime(year, month, day, 12, 0, tzinfo=IST)


@pytest.fixture
def cases(db, zones, assignments):
    """Five cases spread across the zones, the statuses and a fortnight.

    CMP-2026-0004 is in RURAL, which nobody is assigned to. It is the row a
    zone-scoping failure would leak, and several tests exist only to say that it
    did not appear.
    """
    from ada_core.models_icms import Case, CaseAssignment, ZoneAssignment

    db.add_all([
        ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_B_ID,
                       assigned_by=SUPER_ADMIN_ID),
        # The project lead, too. Without sight of a zone the scope answers 404
        # before any role check runs, and "a lead may not assign" would then be
        # untestable — the interesting denial is the one a caller who CAN see the
        # case still gets.
        ZoneAssignment(zone_id=zones["TAJ"].id, user_id=LEAD_ID,
                       assigned_by=SUPER_ADMIN_ID),
    ])

    rows = [
        Case(case_ref="CMP-2026-0001", zone_id=zones["TAJ"].id, source="public",
             status="raised", stage_no=1,
             complaint_type_cd="unauthorised_construction",
             complainant_name="Asha Devi", complainant_phone="9876543210",
             owner_name="Ramesh Gupta",
             property_address="12 Fatehabad Road", landmark="Near Shilpgram",
             priority="high", ulpin="AB12CD34EF56GH",
             village_lgd_code="071234", khasra_no="50/1",
             raised_at=_filed(10), created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0002", zone_id=zones["TAJ"].id, source="field",
             status="assigned", stage_no=2, complaint_type_cd="encroachment",
             complainant_name="Bimal Roy", property_address="4 Taj Road",
             priority="low", village_lgd_code="071234", khasra_no="127/1/2",
             raised_at=_filed(12), created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0003", zone_id=zones["CANT"].id, source="office",
             status="assigned", stage_no=2, complaint_type_cd="deviation_from_plan",
             complainant_name="Chetan Lal", property_address="9 Mall Road",
             priority="medium", village_lgd_code="079999", khasra_no="88",
             raised_at=_filed(14), created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0004", zone_id=zones["RURAL"].id, source="public",
             status="raised", stage_no=1, complaint_type_cd="illegal_colony",
             complainant_name="Deepa Singh", property_address="Village Kheria",
             priority="high", village_lgd_code="079999", khasra_no="204",
             raised_at=_filed(16), created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0005", zone_id=zones["TAJ"].id, source="public",
             status="closed", stage_no=7, complaint_type_cd="encroachment",
             complainant_name="Esha Nair", property_address="7 Purani Mandi",
             raised_at=_filed(18), created_by=NODAL_ID),
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)

    by_ref = {row.case_ref: row for row in rows}

    # The two assigned cases have an open survey assignment, as they must: a case
    # in `assigned` with no assignment row is a state the workflow cannot produce.
    db.add_all([
        CaseAssignment(case_id=by_ref["CMP-2026-0002"].id,
                       assignee_user_id=SURVEYOR_B_ID, assigned_by=NODAL_ID,
                       assignment_type="survey"),
        CaseAssignment(case_id=by_ref["CMP-2026-0003"].id,
                       assignee_user_id=SURVEYOR_ID, assigned_by=NODAL_ID,
                       assignment_type="survey"),
    ])
    db.commit()
    return by_ref


@pytest.fixture
def events(db):
    """Read the audit trail back. Rule 1 says one event row per state change, in
    the same transaction, so counting them is how the tests check it happened."""
    from ada_core.models_icms import CaseEvent

    def read(case_id: int | None = None) -> list:
        statement = select(
            CaseEvent.case_id, CaseEvent.action, CaseEvent.from_status,
            CaseEvent.to_status, CaseEvent.round_no, CaseEvent.actor_user_id,
            CaseEvent.actor_role, CaseEvent.note, CaseEvent.payload,
        ).order_by(CaseEvent.id)
        if case_id is not None:
            statement = statement.where(CaseEvent.case_id == case_id)
        return [dict(row._mapping) for row in db.execute(statement).all()]

    return read


# ------------------------------------------------------- ICMS policy tables
#
# `create_all` applies no data, so the six policy tables start empty here exactly
# as they are on a database that has not run 0003. The loader answers from the
# code seed in that state, which is what keeps every other suite unchanged.


def _load_revision(name: str):
    import importlib.util

    path = (
        Path(__file__).resolve().parents[3]
        / "libs/python/ada-core/ada_core/alembic/versions" / f"{name}.py"
    )
    spec = importlib.util.spec_from_file_location(f"icms_policy_seed_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Revisions after 0003 that add permissions and grants, applied in order.
_POLICY_ADDENDA = (
    "0008_imagery_permissions", "0010_atomic_permissions", "0012_change_detection_nodal_only",
)


def policy_seed():
    """Migration 0003's literals plus later grant revisions, loaded as data."""
    module = _load_revision("0003_policy_tables")
    module.PERMISSIONS = list(module.PERMISSIONS)
    module.GRANTS = {role: list(codes) for role, codes in module.GRANTS.items()}
    for name in _POLICY_ADDENDA:
        addendum = _load_revision(name)
        module.PERMISSIONS.extend(addendum.PERMISSIONS)
        for role, codes in addendum.GRANTS.items():
            module.GRANTS.setdefault(role, []).extend(codes)
        for role, codes in getattr(addendum, "REVOKES", {}).items():
            module.GRANTS[role] = [c for c in module.GRANTS.get(role, []) if c not in codes]
    return module


@pytest.fixture(autouse=True)
def actor_names_are_per_test():
    """The name cache is process-wide; one test's realm must not name the next's rows."""
    from app.icms.actors import reset_actor_cache

    reset_actor_cache()
    yield
    reset_actor_cache()


@pytest.fixture(autouse=True)
def policy_cache_is_per_test():
    """The snapshot is process-wide; one test's reload must not decide the next."""
    from app.icms import policy

    policy.reset()
    yield
    policy.reset()


@pytest.fixture(autouse=True)
def runtime_settings_cache_is_per_test():
    """The runtime-setting cache is process-wide, like the policy snapshot."""
    from app.icms import runtime_settings

    runtime_settings.clear_cache()
    yield
    runtime_settings.clear_cache()


@pytest.fixture
def policy_tables(db):
    """The six tables seeded as 0003 seeds them, with the cache loaded from them."""
    from ada_core.models_icms import (
        Permission,
        PolicyRevision,
        PolicyRole,
        RolePermission,
        TransitionRole,
        WorkflowTransition,
    )

    from app.icms import policy

    seed = policy_seed()
    codes = _load_revision("0010_atomic_permissions").TRANSITION_CODES
    db.add_all([
        PolicyRole(role_cd=cd, label=label, label_hi=label_hi, sort_order=order)
        for cd, label, label_hi, order in seed.ROLES
    ])
    db.add_all([
        Permission(permission_cd=cd, resource=resource, action=action, label=label)
        for cd, resource, action, label in seed.PERMISSIONS
    ])
    db.add_all([
        RolePermission(role_cd=role_cd, permission_cd=code)
        for role_cd, codes in seed.GRANTS.items()
        for code in codes
    ])
    for row in seed.TRANSITIONS:
        transition = WorkflowTransition(
            action_cd=row["action_cd"],
            source_status=row["source_status"],
            target_status=row["target_status"],
            stage_no=row["stage_no"],
            assignee_only=row["assignee_only"],
            opens_round=row["opens_round"],
            requires=list(row["requires"]),
            note=row["note"],
            sort_order=row["sort_order"],
            permission_cd=codes[row["action_cd"]],
        )
        db.add(transition)
        db.flush()
        db.add_all([
            TransitionRole(transition_id=transition.id, role_cd=role_cd)
            for role_cd in row["roles"]
        ])
    db.add(PolicyRevision(id=1, revision=1))
    db.commit()
    return policy.reload(db)


# ------------------------------------------------------- the contract world
#
# One fixture for the contract suites, composed from the ones above rather than
# beside them. It changes two things, and both exist so that a contract test
# varies exactly one thing at a time:
#
#   * the Field Surveyor is given sight of TAJ, so the role matrix is about the
#     ROLE and not about which zones that role happens to be assigned;
#   * the reference counter is moved to match the register the `cases` fixture
#     inserted directly, so POST /cases mints CMP-2026-0006 rather than
#     colliding with CMP-2026-0001.


# ------------------------------------------------------------ ICMS Batch 3
#
# The inspection loop needs three things the case fixtures cannot give it: the
# upload rules (a kind with no policy row rejects every file), a case sitting in
# each state the loop's transitions start from, and — for the evidence
# download — a file actually on disk under DATA_DIR.

# The smallest thing ada_core.uploads will call a JPEG: the magic bytes it
# sniffs, and the end-of-image marker that says it was not cut off in transit.
# No SOF segment, so it has no dimensions and the pixel ceiling never applies.
JPEG_BYTES = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    + b"\x00" * 64
    + b"\xff\xd9"
)


@pytest.fixture
def upload_policies(db):
    """Migration 0004's four rows. `create_all` applies no data, so a suite that
    uploads anything seeds them or every kind rejects every file."""
    from ada_core.models_icms import UploadPolicy

    megabyte = 1024 * 1024
    rows = [
        UploadPolicy(kind="photo", mime_types=["image/jpeg", "image/png", "image/heic"],
                     extensions=[".jpg", ".jpeg", ".png", ".heic", ".heif"],
                     max_bytes=15 * megabyte, max_pixels=40_000_000),
        UploadPolicy(kind="video", mime_types=["video/mp4", "video/quicktime"],
                     extensions=[".mp4", ".mov"], max_bytes=200 * megabyte),
        UploadPolicy(kind="document", mime_types=["application/pdf"],
                     extensions=[".pdf"], max_bytes=25 * megabyte),
        UploadPolicy(kind="signature", mime_types=["image/png"], extensions=[".png"],
                     max_bytes=2 * megabyte, max_pixels=4_000_000),
        # Migration 0009's row.
        UploadPolicy(kind="complaint_photo",
                     mime_types=["image/jpeg", "image/png", "image/webp"],
                     extensions=[".jpg", ".jpeg", ".png", ".webp"],
                     max_bytes=15 * megabyte, max_pixels=40_000_000),
    ]
    db.add_all(rows)
    db.commit()
    return {row.kind: row for row in rows}


# Every suite that submits a round takes this through one of the world fixtures
# below, and the reason is worth stating once: `settings.icms_min_photos_per_round`
# is 3 and `submit` holds a round to it, so a suite about a transition would
# otherwise fail on the photograph count rather than on the transition. The count
# rule has its own suite, test_icms_photo_counts.py, which sets both bounds
# explicitly — and a test here that wants them set may still do so, because it
# monkeypatches after this fixture has run.
@pytest.fixture
def no_photo_minimum(monkeypatch):
    """Stands the submit-time photograph floor down for suites that are not about it."""
    from app.config import settings

    monkeypatch.setattr(settings, "icms_min_photos_per_round", 0)


# The same reasoning for the answer rules R1-R6; test_icms_inspection_answers.py
# turns them back on.
@pytest.fixture
def no_answer_gate(monkeypatch):
    """Stands the submit-time answer rules down for suites that are not about them."""
    from app.config import settings

    monkeypatch.setattr(settings, "icms_require_inspection_answers", False)


@pytest.fixture
def inspection_ready(db, zones, assignments, cases, upload_policies, no_photo_minimum,
                     no_answer_gate):
    """What the Batch 3 suites start from: the Field Surveyor can also see TAJ.

    Without it the surveyor sees CANT alone, and a test about a transition would
    fail on zone scope instead — which proves the wrong thing.
    """
    from ada_core.models_icms import ZoneAssignment

    db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                          assigned_by=SUPER_ADMIN_ID))
    db.commit()
    return cases


def _evidence_on_disk(case_ref: str, name: str) -> str:
    """Writes the bytes an evidence row points at; returns its storage_path."""
    from app.config import settings

    folder = settings.icms_evidence_dir / case_ref
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(JPEG_BYTES)
    return f"{case_ref}/{name}"


@pytest.fixture
def inspection_world(db, zones, cases, upload_policies, no_photo_minimum,
                     no_answer_gate):
    """One case in each state the loop moves from, all in TAJ, with round 1 of each.

    All three sit in TAJ on purpose: the role matrix has to be about the role,
    not about which zones that role happens to hold. CMP-2026-0004 stays in
    RURAL and stays the row a scoping failure would leak.
    """
    import json

    from ada_core.models_icms import (
        AUTHORITY_WIDE,
        Case,
        CaseAssignment,
        Evidence,
        Inspection,
        NoticeSequence,
        ResurveyRequest,
    )

    rows = [
        Case(case_ref="CMP-2026-0006", zone_id=zones["TAJ"].id, source="field",
             status="under_inspection", stage_no=3, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Farida Khan",
             property_address="21 Rakabganj", raised_at=_filed(19),
             created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0007", zone_id=zones["TAJ"].id, source="office",
             status="inspection_submitted", stage_no=4, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Gopal Mishra",
             property_address="3 Sadar Bazar", raised_at=_filed(20),
             created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0008", zone_id=zones["TAJ"].id, source="public",
             status="resurvey_requested", stage_no=4, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Hina Qureshi",
             property_address="8 Balkeshwar", raised_at=_filed(21),
             created_by=NODAL_ID),
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    by_ref = {row.case_ref: row for row in rows}

    db.add_all([
        CaseAssignment(case_id=row.id, assignee_user_id=SURVEYOR_ID,
                       assigned_by=NODAL_ID, assignment_type="survey")
        for row in rows
    ])

    rounds = [
        Inspection(inspection_ref="INS-2026-0001", case_id=by_ref["CMP-2026-0006"].id,
                   round_no=1, surveyor_user_id=SURVEYOR_ID, status="in_progress",
                   started_at=_filed(19)),
        Inspection(inspection_ref="INS-2026-0002", case_id=by_ref["CMP-2026-0007"].id,
                   round_no=1, surveyor_user_id=SURVEYOR_ID, status="submitted",
                   started_at=_filed(20), submitted_at=_filed(20)),
        Inspection(inspection_ref="INS-2026-0003", case_id=by_ref["CMP-2026-0008"].id,
                   round_no=1, surveyor_user_id=SURVEYOR_ID, status="submitted",
                   started_at=_filed(21), submitted_at=_filed(21)),
    ]
    db.add_all(rounds)
    db.commit()
    for row in rounds:
        db.refresh(row)

    db.add(Evidence(
        case_id=by_ref["CMP-2026-0006"].id, inspection_id=rounds[0].id, round_no=1,
        kind="photo", storage_path=_evidence_on_disk("CMP-2026-0006", "seeded.jpg"),
        stamped_storage_key=_evidence_on_disk("CMP-2026-0006", "seeded.stamped.jpg"),
        original_filename="seeded.jpg", content_type="image/jpeg",
        byte_size=len(JPEG_BYTES), sha256="0" * 64,
        location=json.dumps({"type": "Point", "coordinates": [78.005, 27.005]}),
        accuracy_m=6.0, device_timestamp=_filed(19), capture_source="camera",
        captured_at=_filed(19), uploaded_by=SURVEYOR_ID,
        idempotency_key="11111111-1111-4111-8111-111111111111",
    ))
    db.add(ResurveyRequest(
        case_id=by_ref["CMP-2026-0008"].id, from_round=1,
        reason="The measurements do not agree with the sanctioned plan.",
        requested_by=NODAL_ID, decision="pending",
    ))
    # The INS counter starts where the seeded rounds left off, so the first round
    # a suite opens is INS-2026-0004 rather than a collision.
    db.add(NoticeSequence(series="INS", scope_cd=AUTHORITY_WIDE, year=2026,
                          last_seq=len(rounds)))
    db.commit()

    return {**cases, **by_ref}


@pytest.fixture
def inspection_loop(db, zones, inspection_world):
    """`inspection_world`, with the Field Surveyor also given sight of TAJ.

    Separated from the data so the grant is made exactly once: the active
    (zone_id, user_id) pair is unique, and two fixtures adding it would fail on
    the index rather than on anything the test is about.
    """
    from ada_core.models_icms import ZoneAssignment

    db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                          assigned_by=SUPER_ADMIN_ID))
    db.commit()
    return inspection_world


@pytest.fixture
def contract_world(db, zones, assignments, cases, code_values, act_sections,
                   policy_tables, inspection_loop):
    """Every role can see TAJ and every counter agrees with the register.

    Three cases beyond the inspection loop, in TAJ so the role matrix is about
    the role: CMP-2026-0009 sits in `verified`, which is the only status
    `hand_over` moves from, CMP-2026-0010 in `handed_over`, which is the only
    status `confirm` moves from, and CMP-2026-0011 in `confirmed`, which is the
    only status `issue_notice` moves from.

    NTC-2026-0001 hangs off CMP-2026-0005, the closed case: a case that was
    closed after a notice is the ordinary history, and it gives the Batch 6
    reads a row without adding a twelfth case to every count in the suite.
    """
    from ada_core.models_icms import AUTHORITY_WIDE, Case, Evidence, NoticeSequence

    stages = [
        Case(case_ref="CMP-2026-0009", zone_id=zones["TAJ"].id, source="field",
             status="verified", stage_no=5, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Imran Sheikh",
             property_address="14 Nai Ki Mandi", raised_at=_filed(22),
             created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0010", zone_id=zones["TAJ"].id, source="office",
             status="handed_over", stage_no=6, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Jyoti Saxena",
             property_address="2 Shahganj", raised_at=_filed(23),
             created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0011", zone_id=zones["TAJ"].id, source="field",
             status="confirmed", stage_no=7, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Kavita Rao",
             owner_name="Suresh Chand", property_address="19 Wazirpura Road",
             khasra_no="77/3", district="Agra", state="Uttar Pradesh",
             pin_code="282003", raised_at=_filed(24), created_by=NODAL_ID),
        # `notice_issued`, the only status `close` moves from.
        Case(case_ref="CMP-2026-0012", zone_id=zones["TAJ"].id, source="office",
             status="notice_issued", stage_no=7, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Lata Mehra",
             property_address="3 Rawatpara", raised_at=_filed(25), created_by=NODAL_ID),
    ]
    db.add_all(stages)
    db.commit()
    for row in stages:
        db.refresh(row)

    # One complaint photograph on CMP-2026-0006, the case every role can read,
    # so the case evidence reads have a row. It is evidence id 2.
    db.add(Evidence(
        case_id=inspection_loop["CMP-2026-0006"].id, inspection_id=None,
        kind="complaint_photo",
        storage_path=_evidence_on_disk("CMP-2026-0006", "complaint.jpg"),
        original_filename="complaint.jpg", content_type="image/jpeg",
        byte_size=len(JPEG_BYTES), sha256="1" * 64, capture_source="upload",
        caption="Front elevation", uploaded_by=NODAL_ID,
        idempotency_key="22222222-2222-4222-8222-222222222222",
    ))
    db.commit()

    world = {**inspection_loop, **{row.case_ref: row for row in stages}}
    db.add(NoticeSequence(series="CMP", scope_cd=AUTHORITY_WIDE, year=2026,
                          last_seq=len(world)))
    db.add(NoticeSequence(series="NTC", scope_cd=AUTHORITY_WIDE, year=2026, last_seq=1))
    db.commit()

    today = datetime.now(IST).date()
    seed_notice(db, world["CMP-2026-0005"], notice_ref="NTC-2026-0001",
                compliance_due=today + timedelta(days=25),
                issued_at=_at(today - timedelta(days=5)), issued_by=LEAD_ID)
    return world


# ------------------------------------------------------------ ICMS Batch 6
#
# Two things the case fixtures cannot give the notice suites: the act and its
# sections (a notice citing a code that is not in `icms_code_value` is refused,
# so with no rows every issue would fail on validation rather than on the thing
# under test), and a notice that already exists to be read, printed and counted.

ACT_CD = "up_upda_1973"
ACT_LABEL = "Uttar Pradesh Urban Planning and Development Act, 1973"


# Midday IST on a given day, for the same reason `_filed` is: the offset must not
# be able to push a fixture across a date boundary.
def _at(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, 12, 0, tzinfo=IST)


@pytest.fixture
def act_sections(db):
    """Migration 0006's six rows: one act and its five sections.

    Separate from `code_values` on purpose — the reference suites count the rows
    in that fixture, and a test about paging should not change because Batch 6
    needed an act.
    """
    from ada_core.models_icms import CodeValue

    rows = [
        CodeValue(domain="act", code=ACT_CD, label=ACT_LABEL, sort_order=1,
                  label_hi="उत्तर प्रदेश नगर योजना एवं विकास अधिनियम, 1973"),
        CodeValue(domain="section", code="sec_14", parent_code=ACT_CD, sort_order=1,
                  label="Section 14 - permission for development"),
        CodeValue(domain="section", code="sec_26", parent_code=ACT_CD, sort_order=2,
                  label="Section 26 - notice to show cause before demolition"),
        CodeValue(domain="section", code="sec_27", parent_code=ACT_CD, sort_order=3,
                  label="Section 27 - order for removal of unauthorised development"),
        CodeValue(domain="section", code="sec_28", parent_code=ACT_CD, sort_order=4,
                  label="Section 28 - order to discontinue development"),
        CodeValue(domain="section", code="sec_28a", parent_code=ACT_CD, sort_order=5,
                  label="Section 28-A - power to seal unauthorised development",
                  active=False),
    ]
    db.add_all(rows)
    db.commit()
    return {row.code: row for row in rows}


# Rendered with the real template rather than with fixed bytes: the suites assert
# that /pdf serves what was stored, and a placeholder would let a re-render pass.
def seed_notice(db, case, *, notice_ref: str, compliance_due, issued_at,
                issued_by: str, sections=("sec_27",), status: str = "issued"):
    """One issued notice on `case`, with its artefact actually on disk."""
    import hashlib

    from ada_core.models_icms import Notice

    from app.config import settings
    from app.icms.notice_template import NoticeFacts, build_body, render

    body = build_body(NoticeFacts(
        notice_ref=notice_ref,
        case_ref=case.case_ref,
        issued_on=issued_at.date(),
        compliance_due=compliance_due,
        compliance_days=(compliance_due - issued_at.date()).days,
        representation_days=7,
        issued_by=issued_by,
        issuing_authority="Vice Chairman, Agra Development Authority",
        act_cd=ACT_CD,
        act_label=ACT_LABEL,
        sections=tuple((code, f"Section {code}") for code in sections),
        recipient_name=case.owner_name or "Occupier",
        recipient_address=case.property_address,
        property_address=case.property_address,
        zone_cd="TAJ",
        grounds=("Seeded for the Batch 6 suites.",),
    ))
    content = render(body)
    digest = hashlib.sha256(content).hexdigest()
    folder = settings.icms_notice_dir / notice_ref
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{digest}.pdf").write_bytes(content)

    row = Notice(
        notice_ref=notice_ref, case_id=case.id, act_cd=ACT_CD,
        section_cds=list(sections), body=body,
        issuing_authority="Vice Chairman, Agra Development Authority",
        status=status, issued_by=issued_by, issued_at=issued_at,
        compliance_due=compliance_due,
        artefact_path=f"{notice_ref}/{digest}.pdf", artefact_sha256=digest,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def notice_world(db, zones, assignments, cases, code_values, act_sections,
                 inspection_loop):
    """A case in `confirmed` — the only status `issue_notice` moves from — plus
    one already-issued notice, one overdue and one in the zone nobody can see.

    CMP-2026-0014 sits in RURAL, which nobody is assigned to, so its notice is
    the row a zone-scoping failure would leak.
    """
    from ada_core.models_icms import AUTHORITY_WIDE, Case, CaseAssignment, NoticeSequence

    rows = [
        Case(case_ref="CMP-2026-0011", zone_id=zones["TAJ"].id, source="field",
             status="confirmed", stage_no=7, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Kavita Rao",
             owner_name="Suresh Chand", property_address="19 Wazirpura Road",
             landmark="Opposite the water works", khasra_no="77/3",
             village_lgd_code="071234", district="Agra", state="Uttar Pradesh",
             pin_code="282003", police_station="Tajganj",
             raised_at=_filed(24), created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0012", zone_id=zones["TAJ"].id, source="office",
             status="notice_issued", stage_no=7, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Lalit Kumar",
             owner_name="Meena Agarwal", property_address="5 Belanganj",
             raised_at=_filed(25), created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0013", zone_id=zones["TAJ"].id, source="public",
             status="notice_issued", stage_no=7, current_round=1,
             complaint_type_cd="encroachment", complainant_name="Nadia Beg",
             owner_name="Pranav Joshi", property_address="31 Dayalbagh Road",
             raised_at=_filed(26), created_by=NODAL_ID),
        Case(case_ref="CMP-2026-0014", zone_id=zones["RURAL"].id, source="public",
             status="notice_issued", stage_no=7, current_round=1,
             complaint_type_cd="illegal_colony", complainant_name="Omkar Yadav",
             owner_name="Ritu Bansal", property_address="Village Runkata",
             raised_at=_filed(27), created_by=NODAL_ID),
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    by_ref = {row.case_ref: row for row in rows}

    # The lead is the officer who issues, so the confirmed case carries an open
    # assignment the same way every other case at this stage does.
    db.add(CaseAssignment(case_id=by_ref["CMP-2026-0011"].id,
                          assignee_user_id=SURVEYOR_ID, assigned_by=NODAL_ID,
                          assignment_type="survey"))
    db.commit()

    # Relative to today, not to a literal date: `overdue` is derived from the
    # clock, so a fixture pinned to 2026 would become a different test in 2027.
    today = datetime.now(IST).date()
    issued = _at(today - timedelta(days=5))
    seed_notice(db, by_ref["CMP-2026-0012"], notice_ref="NTC-2026-0001",
                compliance_due=today + timedelta(days=25), issued_at=issued,
                issued_by=LEAD_ID)
    # Compliance due in the past, so the register must report it `overdue` while
    # the stored row still says `issued`.
    seed_notice(db, by_ref["CMP-2026-0013"], notice_ref="NTC-2026-0002",
                compliance_due=today - timedelta(days=2),
                issued_at=_at(today - timedelta(days=32)),
                issued_by=LEAD_ID, sections=("sec_26",))
    seed_notice(db, by_ref["CMP-2026-0014"], notice_ref="NTC-2026-0003",
                compliance_due=today + timedelta(days=20), issued_at=issued,
                issued_by=LEAD_ID)

    db.add(NoticeSequence(series="NTC", scope_cd=AUTHORITY_WIDE, year=2026, last_seq=3))
    db.commit()
    return {**inspection_loop, **by_ref}
