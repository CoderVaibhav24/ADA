"""The migration chain against a real PostgreSQL server.

Skipped unless ADA_TEST_DATABASE_URL is set, because the rest of the suite runs
on in-memory SQLite and must keep running anywhere. Point it at a throwaway
database — these tests drop the schema:

    docker run -d --name ada-migration-test -e POSTGRES_PASSWORD=test \\
        -e POSTGRES_DB=adatest -p 127.0.0.1:55432:5432 postgis/postgis:16-3.4

    ADA_TEST_DATABASE_URL=postgresql+psycopg2://postgres:test@127.0.0.1:55432/adatest \\
        pytest tests/test_migrations_live.py

The drift test is the one worth the setup. Everything else in the suite checks
that the models say the right thing; this checks that what the migrations
actually build matches what the models say — the failure a migration chain
exists to prevent, and the only one that cannot be caught statically.
"""

from __future__ import annotations

import os

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from ada_core import models, models_app, models_icms  # noqa: F401  - registers the tables
from ada_core.database import Base, configure_engine, get_engine
from ada_core.migrate import (
    MigrationRefused,
    _alembic_config,
    _baseline_tables,
    create_tables,
    ensure_postgis,
    run_migrations,
)

URL = os.environ.get("ADA_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not URL, reason="set ADA_TEST_DATABASE_URL to a throwaway PostGIS database")


@pytest.fixture
def clean_database():
    """A database at head, from nothing, for each test."""
    configure_engine(URL)
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    run_migrations()
    return get_engine()


def test_a_fresh_database_reaches_head(clean_database):
    with clean_database.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        tables = [t for t in inspect(conn).get_table_names() if t.startswith("icms_")]
    # 17 domain tables from the baseline, 6 policy tables from 0003, the upload
    # policy from 0004. Both numbers move with the chain; test_icms_schema.py
    # holds the same split against the models.
    assert version == "0007"
    assert len(tables) == 24


def test_running_it_twice_changes_nothing(clean_database):
    run_migrations()
    with clean_database.connect() as conn:
        seed = conn.execute(text("SELECT count(*) FROM icms_code_value")).scalar()
    # 17 from the baseline, 6 from 0006 and 19 from 0007, and not 84: the seed is
    # inserted by the migrations, and a second upgrade must be a no-op rather
    # than a second insert.
    assert seed == 42


def test_the_schema_matches_the_models(clean_database):
    """Zero drift. A difference here means a model was changed and no migration
    was written for it — the schema in the test suite and the schema in
    production would then disagree, and only production would notice."""
    with clean_database.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_object": lambda obj, name, type_, reflected, compare_to: not (
                    type_ == "table" and reflected and name not in Base.metadata.tables
                ),
            },
        )
        differences = compare_metadata(context, Base.metadata)
    assert differences == [], differences


def test_a_pre_alembic_database_is_adopted():
    """The case that actually happened, on a real database.

    A schema built by `create_all` before the migration chain existed has every
    table and no `alembic_version`. `alembic upgrade head` fails on it —
    `DuplicateTable: relation "projects" already exists` — because the CLI only
    knows how to apply revisions. `run_migrations()` recognises the state,
    applies what stamping would otherwise skip, and stamps.
    """
    configure_engine(URL)
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    ensure_postgis()
    with get_engine().connect() as conn:
        baseline = _baseline_tables(conn)
    create_tables(tables=baseline)
    with get_engine().connect() as conn:
        assert not inspect(conn).has_table("alembic_version")

    run_migrations()

    with get_engine().connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        seed = conn.execute(text("SELECT count(*) FROM icms_code_value")).scalar()
        triggers = conn.execute(text(
            "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_icms%'")).scalar()
        screens = conn.execute(text("SELECT screen_id FROM app_screen")).scalars().all()
    assert version == "0007"
    # Stamping alone would leave the triggers and the baseline's 17 rows at zero;
    # the rest of the 42 and the Home screen come from upgrading past the stamp.
    assert seed == 42
    assert triggers == 5
    assert screens == ["home_sdui"]


def test_a_database_holding_a_later_revisions_table_is_refused():
    """Every mapped table with no alembic_version matches no revision: 0003
    would otherwise fail on `relation "icms_role" already exists`."""
    configure_engine(URL)
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    ensure_postgis()
    create_tables()

    with pytest.raises(MigrationRefused, match="matches no revision"):
        run_migrations()


def _platform_only_database():
    """The real ADA deployment before ICMS existed: five tables, with data."""
    configure_engine(URL)
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    ensure_postgis()
    platform = [
        Base.metadata.tables[name] for name in
        ("projects", "rasters", "red_zones", "analysis_jobs", "change_polygons")
    ]
    Base.metadata.create_all(bind=get_engine(), tables=platform)
    with get_engine().begin() as conn:
        conn.execute(text(
            "INSERT INTO projects (user_id, name, created_at) "
            "VALUES ('kc-subject-0001', 'Agra', now())"))


def test_a_pre_icms_database_is_adopted_without_touching_its_data():
    """The state a running ADA deployment is actually in.

    Five platform tables with rows in them, and ICMS has never existed. Wholly
    absent is not ambiguous: `create_all` adds the seventeen missing tables and
    alters none of the five, so there is nothing to guess about.
    """
    _platform_only_database()

    run_migrations()

    with get_engine().connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        icms = [t for t in inspect(conn).get_table_names() if t.startswith("icms_")]
        seed = conn.execute(text("SELECT count(*) FROM icms_code_value")).scalar()
        triggers = conn.execute(text(
            "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_icms%'")).scalar()
        projects = conn.execute(text("SELECT count(*) FROM projects")).scalar()
        name = conn.execute(text("SELECT name FROM projects LIMIT 1")).scalar()

    assert version == "0007"
    assert len(icms) == 24
    assert seed == 42
    assert triggers == 5
    # The row that was there before is still there, unchanged.
    assert (projects, name) == (1, "Agra")


def test_adoption_repairs_a_column_the_old_alter_left_nullable():
    """Found on the first real database this was pointed at.

    `ALTER TABLE rasters ADD COLUMN IF NOT EXISTS progress DOUBLE PRECISION
    DEFAULT 0` creates a NULLABLE column; `models.py` declares
    `progress: Mapped[float]`, which is NOT NULL. The two never agreed and
    nothing surfaced it, because the Python-side default meant no insert ever
    failed. The drift check refused to stamp, which is exactly its job, and the
    repair belongs in the pre-Alembic statements.
    """
    _platform_only_database()

    with get_engine().begin() as conn:
        # Exactly what the old statement left behind: nullable, with a server
        # default the model does not declare.
        conn.execute(text("ALTER TABLE rasters ALTER COLUMN progress DROP NOT NULL"))
        conn.execute(text("ALTER TABLE rasters ALTER COLUMN progress SET DEFAULT 0"))
        conn.execute(text(
            "INSERT INTO rasters (project_id, name, original_path, status, progress, "
            "uploaded_at) SELECT id, 'tile-a', '/x.tif', 'ready', NULL, now() "
            "FROM projects"))

    run_migrations()

    with get_engine().connect() as conn:
        nullable, default = conn.execute(text(
            "SELECT is_nullable, column_default FROM information_schema.columns "
            "WHERE table_name='rasters' AND column_name='progress'")).one()
        progress = conn.execute(text("SELECT progress FROM rasters")).scalar()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()

    assert nullable == "NO"
    assert default is None
    # Backfilled by status, not blindly to zero: this raster was already ready.
    assert progress == 1.0
    assert version == "0007"


def test_a_half_built_icms_schema_is_refused():
    """The case that genuinely cannot be resolved without being told.

    Some ICMS tables present and some not means another process built them, and
    this has no idea what shape they are in. `create_all` would leave those
    exactly as they are while the stamp claims they match the baseline.
    """
    _platform_only_database()

    some_icms = [Base.metadata.tables[name] for name in
                 ("icms_zone", "icms_code_value", "icms_campus_boundary")]
    Base.metadata.create_all(bind=get_engine(), tables=some_icms)

    with pytest.raises(MigrationRefused, match="matches no revision"):
        run_migrations()


def test_the_baseline_can_be_backed_out(clean_database):
    """A migration that cannot be downgraded is one nobody can back out on the
    night it goes wrong."""
    with clean_database.begin() as conn:
        command.downgrade(_alembic_config(conn), "base")
    with clean_database.connect() as conn:
        remaining = [t for t in inspect(conn).get_table_names() if t.startswith("icms_")]
        triggers = conn.execute(text(
            "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_icms%'")).scalar()
    assert remaining == []
    assert triggers == 0


def test_the_append_only_guard_is_real(clean_database):
    """The trigger is created by the migration, so it is worth proving that it
    fires rather than that the text exists in a file."""
    from sqlalchemy.exc import InternalError, ProgrammingError

    with clean_database.begin() as conn:
        conn.execute(text(
            "INSERT INTO icms_zone (zone_cd, name) VALUES ('Z01','Test')"))
        conn.execute(text(
            "INSERT INTO icms_case (case_ref, zone_id, source, status, stage_no) "
            "SELECT 'CMP-2026-0001', id, 'field', 'raised', 1 FROM icms_zone"))
        conn.execute(text(
            "INSERT INTO icms_evidence (case_id, kind, storage_path, uploaded_by, "
            "idempotency_key, location, accuracy_m, device_timestamp, capture_source) "
            "SELECT id, 'photo', '/x.jpg', 'u', 'k1', "
            "ST_SetSRID(ST_MakePoint(78.05,27.05),4326), 6.5, now(), 'camera' "
            "FROM icms_case"))

    with pytest.raises((InternalError, ProgrammingError), match="append-only"):
        with clean_database.begin() as conn:
            conn.execute(text("DELETE FROM icms_evidence"))


def test_a_photograph_without_its_capture_fields_is_refused(clean_database):
    from sqlalchemy.exc import IntegrityError

    with clean_database.begin() as conn:
        conn.execute(text("INSERT INTO icms_zone (zone_cd, name) VALUES ('Z02','Test')"))
        conn.execute(text(
            "INSERT INTO icms_case (case_ref, zone_id, source, status, stage_no) "
            "SELECT 'CMP-2026-0002', id, 'field', 'raised', 1 FROM icms_zone "
            "WHERE zone_cd='Z02'"))

    with pytest.raises(IntegrityError, match="icms_evidence_geotag_ck"):
        with clean_database.begin() as conn:
            conn.execute(text(
                "INSERT INTO icms_evidence (case_id, kind, storage_path, uploaded_by, "
                "idempotency_key) SELECT id, 'photo', '/x.jpg', 'u', 'k2' "
                "FROM icms_case WHERE case_ref='CMP-2026-0002'"))
