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
from sqlalchemy import inspect, make_url, text

from ada_core import models, models_app, models_icms  # noqa: F401  - registers the tables
from ada_core.database import Base, configure_engine, get_engine
from ada_core.migrate import (
    MigrationRefused,
    _alembic_config,
    _baseline_shape,
    _baseline_tables,
    _refuse_on_drift,
    create_tables,
    ensure_postgis,
    run_migrations,
)

URL = os.environ.get("ADA_TEST_DATABASE_URL")

PLATFORM_TABLES = ("projects", "rasters", "red_zones", "analysis_jobs", "change_polygons")

# The baseline's five, measured at head; moves only if a revision adds or drops one.
TRIGGERS_AT_HEAD = 5

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
    # policy from 0004, three boundary tables from 0015, and two added since.
    # Both numbers move with the chain; test_icms_schema.py holds the split.
    assert version == "0024_analysis_parcel_result"
    assert len(tables) == 29


def test_running_it_twice_changes_nothing(clean_database):
    run_migrations()
    with clean_database.connect() as conn:
        seed = conn.execute(text("SELECT count(*) FROM icms_code_value")).scalar()
    # 78 at head (baseline, 0006, 0007, 0011, 0022, 0023), and not 156: the seed is
    # inserted by the migrations, and a second upgrade must be a no-op rather
    # than a second insert.
    assert seed == 78


def test_the_schema_matches_the_models(clean_database):
    """Zero drift. A difference here means a model was changed and no migration
    was written for it — the schema in the test suite and the schema in
    production would then disagree, and only production would notice."""
    with clean_database.connect() as conn:
        differences = _drift_from_models(conn)
    assert differences == [], differences


def _drift_from_models(conn) -> list:
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
    return compare_metadata(context, Base.metadata)


def _empty_database():
    configure_engine(URL)
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    ensure_postgis()


# Revision 0001 built for real with no alembic_version: the shape adoption expects.
def _baseline_database(*, with_objects: bool = True):
    _empty_database()
    with get_engine().begin() as conn:
        command.upgrade(_alembic_config(conn), "0001")
        conn.execute(text("DROP TABLE alembic_version"))
        if not with_objects:
            # What create_all left behind: tables, and none of the triggers or seed.
            conn.execute(text("DROP FUNCTION icms_touch_updated_at() CASCADE"))
            conn.execute(text("DROP FUNCTION icms_refuse_delete() CASCADE"))
            conn.execute(text("DELETE FROM icms_code_value"))


def _leftovers(conn) -> tuple[bool, list[str]]:
    version = inspect(conn).has_table("alembic_version")
    scratch = conn.execute(text(
        "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ada_adopt_ref_%'")).scalars().all()
    return version, scratch


def test_a_pre_alembic_database_is_adopted():
    """The case that actually happened, on a real database.

    A schema built by `create_all` before the migration chain existed has every
    baseline table, no triggers, no seed and no `alembic_version`. `alembic
    upgrade head` fails on it (`DuplicateTable: relation "projects" already
    exists`) because the CLI only knows how to apply revisions.
    `run_migrations()` recognises the state, applies what stamping would
    otherwise skip, stamps 0001 and upgrades through every later revision.
    """
    _baseline_database(with_objects=False)
    with get_engine().connect() as conn:
        assert not inspect(conn).has_table("alembic_version")
        assert conn.execute(text("SELECT count(*) FROM icms_code_value")).scalar() == 0

    run_migrations()

    with get_engine().connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        seed = conn.execute(text("SELECT count(*) FROM icms_code_value")).scalar()
        triggers = conn.execute(text(
            "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_icms%'")).scalar()
        screens = conn.execute(text("SELECT screen_id FROM app_screen")).scalars().all()
        icms = [t for t in inspect(conn).get_table_names() if t.startswith("icms_")]
        _, scratch = _leftovers(conn)
        drift = _drift_from_models(conn)
    assert version == "0024_analysis_parcel_result"
    assert drift == [], drift
    # Stamping alone would leave the triggers and the baseline's 17 rows at zero;
    # the rest of the 78 and the Home screen come from upgrading past the stamp.
    assert seed == 78
    assert triggers == TRIGGERS_AT_HEAD
    assert screens == ["home_sdui"]
    assert len(icms) == 29
    assert scratch == []


def test_a_baseline_shaped_database_shows_no_drift_against_revision_0001():
    """The comparison is against 0001 as reflected, so reflection noise (default
    text, serial sequences, geometry) must cancel out to exactly nothing."""
    _baseline_database()

    with get_engine().begin() as conn:
        shape = _baseline_shape(conn)
        _refuse_on_drift(conn, shape)
        assert set(shape.tables) == _baseline_tables(conn)
        _, scratch = _leftovers(conn)
    assert scratch == []


def test_a_baseline_table_that_differs_from_revision_0001_is_refused():
    """And the comparison is not vacuous: a column 0001 never had is caught, and
    the refusal leaves the database exactly as it was, scratch schema included."""
    _baseline_database()
    with get_engine().begin() as conn:
        conn.execute(text("ALTER TABLE icms_zone ADD COLUMN stray TEXT"))
        conn.execute(text("ALTER TABLE icms_zone ALTER COLUMN name TYPE TEXT"))

    with pytest.raises(MigrationRefused, match="revision 0001"):
        run_migrations()

    with get_engine().connect() as conn:
        version, scratch = _leftovers(conn)
        columns = {c["name"] for c in inspect(conn).get_columns("icms_zone")}
    assert (version, scratch) == (False, [])
    assert "stray" in columns


def test_a_database_holding_a_later_revisions_table_is_refused():
    """The baseline plus one table a later revision creates matches no revision:
    0003 would otherwise fail on `relation "icms_role" already exists`."""
    _baseline_database()
    create_tables(tables={"icms_role"})

    with pytest.raises(MigrationRefused, match="matches no revision"):
        run_migrations()


def test_a_head_shaped_database_without_alembic_version_is_refused_with_stamp_advice():
    """`create_all` from today's models builds head, not 0001. Adopting it through
    0001 would replay every later revision onto tables that already have their
    changes, so it is refused, and the message names the deliberate remedy."""
    _empty_database()
    create_tables()

    with pytest.raises(MigrationRefused, match="alembic -c alembic.ini stamp head"):
        run_migrations()

    with get_engine().connect() as conn:
        assert _leftovers(conn) == (False, [])


def test_adoption_is_refused_when_the_user_cannot_create_a_schema():
    """The 0001 shape is learned in a scratch schema; without CREATE on the
    database that is impossible, and the refusal says so rather than failing
    somewhere inside Alembic."""
    _baseline_database()
    role = "ada_adopt_no_create"
    with get_engine().begin() as conn:
        conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
        conn.execute(text(f"CREATE ROLE {role} LOGIN PASSWORD 'x'"))
        conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {role}"))
        conn.execute(text(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}"))
    try:
        configure_engine(make_url(URL).set(username=role, password="x")
                         .render_as_string(hide_password=False))
        with pytest.raises(MigrationRefused, match="may not create schemas"):
            run_migrations()
    finally:
        configure_engine(URL)
        with get_engine().begin() as conn:
            conn.execute(text(f"DROP OWNED BY {role}"))
            conn.execute(text(f"DROP ROLE {role}"))


def _platform_only_database():
    """The real ADA deployment before ICMS existed: five tables, with data."""
    _baseline_database()
    with get_engine().begin() as conn:
        icms = [t for t in inspect(conn).get_table_names() if t.startswith("icms_")]
        conn.execute(text(f"DROP TABLE {', '.join(icms)} CASCADE"))
        conn.execute(text("DROP FUNCTION icms_touch_updated_at()"))
        conn.execute(text("DROP FUNCTION icms_refuse_delete()"))
        remaining = sorted(set(inspect(conn).get_table_names()) - {"spatial_ref_sys"})
        conn.execute(text(
            "INSERT INTO projects (user_id, name, created_at) "
            "VALUES ('kc-subject-0001', 'Agra', now())"))
    assert remaining == sorted(PLATFORM_TABLES)


def test_a_pre_icms_database_is_adopted_without_touching_its_data():
    """The state a running ADA deployment is actually in.

    Five platform tables with rows in them, and ICMS has never existed. Wholly
    absent is not ambiguous: the seventeen missing tables are created at the
    0001 shape, none of the five is altered, and the later revisions take it to
    head.
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
        drift = _drift_from_models(conn)
        # Reflection cannot see geometry types, so the drift check cannot either.
        geometry = conn.execute(text(
            "SELECT type, srid FROM geometry_columns WHERE f_table_name LIKE 'icms_%'")).all()

    assert version == "0024_analysis_parcel_result"
    assert geometry and all(kind != "GEOMETRY" and srid == 4326 for kind, srid in geometry)
    # Tables created at 0001 and carried up the chain end exactly where the models are.
    assert drift == [], drift
    assert len(icms) == 29
    assert seed == 78
    assert triggers == TRIGGERS_AT_HEAD
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
    assert version == "0024_analysis_parcel_result"


def test_a_half_built_icms_schema_is_refused():
    """The case that genuinely cannot be resolved without being told.

    Some ICMS tables present and some not means another process built them, and
    this has no idea what shape they are in. `create_all` would leave those
    exactly as they are while the stamp claims they match the baseline.
    """
    _platform_only_database()

    create_tables(tables={"icms_zone", "icms_code_value"})

    with pytest.raises(MigrationRefused, match="ICMS tables and is missing 15"):
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
