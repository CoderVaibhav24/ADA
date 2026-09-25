"""Bringing a database up to what the code expects, on every boot.

Alembic owns the schema. `ada_core/alembic/versions/` is the history, revision
0001 is everything that existed on 18 September 2026, and nothing changes the
schema except a revision. `ada-ml` calls `run_migrations()` at startup.

To do the same thing by hand, run the same function, not the Alembic CLI:

    python -m ada_core.migrate

`alembic upgrade head` is NOT equivalent, and the difference is not cosmetic. On
a database that predates the chain the CLI tries to apply revision 0001 to a
schema that already contains it:

    psycopg2.errors.DuplicateTable: relation "projects" already exists

The CLI applies revisions; it cannot know that this database is already at the
baseline without being told. That judgement is in `run_migrations()`. Once a
database is on the chain (it has an `alembic_version` row) the CLI is the
right tool and behaves normally:

    cd libs/python/ada-core
    alembic -c alembic.ini current
    alembic -c alembic.ini upgrade head --sql    # review before applying
    alembic -c alembic.ini upgrade head
    alembic -c alembic.ini revision --autogenerate -m "add ulpin to case"

## Why Alembic, having managed without it

`create_all` creates a missing table and never alters an existing one, so every
change after the first had to be an idempotent `ALTER ... IF NOT EXISTS` in a
list, and that list can only ever add. It cannot rename a column, narrow a
type, or run a backfill once. It also has no notion of what has been applied, so
a half-applied change is indistinguishable from a complete one. The ICMS schema
was introduced before it had any data, which is the cheapest moment to adopt a
migration chain and the last one that is free.

## Three paths, decided by what the database already contains

  * **No `alembic_version` and no tables**: a fresh database. `upgrade head`.
  * **`alembic_version` present**: the normal case. `upgrade head`.
  * **Tables but no `alembic_version`**: a database that predates Alembic. It
    is brought onto the chain at revision 0001, not at head. The exact 0001
    shape is learned by running revision 0001 in a scratch schema on the same
    connection, reflecting it and dropping the schema. Then the pre-Alembic
    statements run, baseline tables that are wholly absent are created at that
    shape, the baseline's functions, triggers and seed are applied, the baseline
    tables are compared with the 0001 shape, and only then is the database
    stamped 0001 and upgraded to head, so every later revision applies normally.
    All of it in one transaction; a failure leaves nothing behind, scratch schema
    included. The database user must be allowed to create a schema.

    The comparison before the stamp is the part that matters. Tables created
    here are right by construction; tables that were already there are an
    assumption, and the stamp is what every later migration trusts. If they do
    not match revision 0001, nothing is committed.

    Two shapes are refused outright: **some** baseline ICMS tables present and
    some not, or any table a later revision creates already present. Something
    else built those, this does not know what shape they are in, and the stamp
    would claim otherwise. A database built by `create_all` from the current
    models is the second case: it is at head, not 0001. If it has been checked
    against the models, `alembic -c alembic.ini stamp head` records that
    deliberately.

SQLite takes none of these. The suites create a schema from the models directly
(`tests/conftest.py`), and the migrations are PostGIS and PL/pgSQL throughout;
making them portable would mean writing the schema twice, and two schemas
differ.
"""

from __future__ import annotations

import logging
import re
import secrets
import warnings
from pathlib import Path
from typing import NamedTuple

from alembic import command
from alembic.config import Config
from sqlalchemy import BLANK_SCHEMA, MetaData, event, inspect, text
from sqlalchemy.exc import DBAPIError

from .database import Base, get_engine
from .types import Geometry

log = logging.getLogger("ada.migrate")

ALEMBIC_DIR = Path(__file__).with_name("alembic")


class CodeValueSeed(NamedTuple):
    """One `icms_code_value` row as a migration states it.

    The first four fields are, in order, the 4-tuples revision 0001 was written
    with, so its seventeen rows are read by this unchanged. `label_hi` and
    `parent_code` are the two columns the table has always had and no seed
    populated: a section cannot hang off its act without the second, and this is
    a bilingual product, so it cannot ship without the first. Revision 0006 is
    the first to use all six.
    """

    domain: str
    code: str
    label: str
    sort_order: int = 0
    label_hi: str | None = None
    parent_code: str | None = None


CODE_VALUE_INSERT = (
    "INSERT INTO icms_code_value "
    "(domain, code, label, label_hi, parent_code, sort_order) "
    "VALUES (:domain, :code, :label, :label_hi, :parent_code, :sort_order) "
    "ON CONFLICT (domain, code) DO NOTHING"
)

POSTGIS_EXTENSION = "CREATE EXTENSION IF NOT EXISTS postgis"

_SENTINEL_TABLE = "projects"

# Adoption builds revision 0001 in a throwaway schema of this name plus a random suffix.
_SCRATCH_PREFIX = "ada_adopt_ref_"

# pg_advisory_xact_lock key for run_migrations(); any fixed bigint, unique to this purpose.
MIGRATION_LOCK_KEY = 0x0ADA_5C4E_3A00_0001

_STATEMENTS = [
    "ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS mode VARCHAR(10) DEFAULT 'ai'",
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS review_status "
    "VARCHAR(12) DEFAULT 'pending'",
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS review_note TEXT",
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(64)",
    "ALTER TABLE change_polygons ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS ix_change_polygons_review_status "
    "ON change_polygons (review_status)",
    "ALTER TABLE rasters ADD COLUMN IF NOT EXISTS progress DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE rasters ADD COLUMN IF NOT EXISTS stage VARCHAR(120)",
    "UPDATE rasters SET progress = 1.0 WHERE progress IS NULL AND status = 'ready'",
    "UPDATE rasters SET progress = 0.0 WHERE progress IS NULL",
    "UPDATE analysis_jobs SET mode = 'ai' WHERE mode IS NULL",
    "UPDATE change_polygons SET review_status = 'pending' WHERE review_status IS NULL",
    "ALTER TABLE rasters ALTER COLUMN progress SET NOT NULL",
    "ALTER TABLE analysis_jobs ALTER COLUMN mode SET NOT NULL",
    "ALTER TABLE rasters ALTER COLUMN progress DROP DEFAULT",
]


class MigrationRefused(RuntimeError):
    """The database is in a state this cannot resolve without being told.

    Raised rather than guessed at. A stamp applied to a database that does not
    match the revision is a lie the next migration acts on.
    """


def _is_postgres() -> bool:
    return get_engine().dialect.name == "postgresql"


def _alembic_config(connection) -> Config:
    """An Alembic config bound to an open connection.

    The connection is passed through `attributes` rather than as a URL, so the
    migrations run on the engine the application already configured and no
    password is rendered into a config object that might get logged.
    """
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.attributes["connection"] = connection
    return cfg


def ensure_postgis() -> bool:
    """Create the PostGIS extension. False on a non-PostgreSQL backend.

    Needs a superuser, or a role granted CREATE on the database, the first time;
    on the postgis/postgis image the default role has it. Afterwards it is a
    no-op.
    """
    if not _is_postgres():
        return False
    with get_engine().begin() as conn:
        conn.execute(text(POSTGIS_EXTENSION))
    return True


def create_tables(bind=None, tables=None) -> None:
    """Create every mapped table that does not exist yet, from the models.

    Used on the SQLite path and by the test fixtures. Adoption does not use it:
    the models are at head, and a table adoption creates has to be at 0001.

    `create_all` only ever creates what is absent. It does not alter or drop an
    existing table, which is why it is safe to point at a database with data in
    it.

    Importing `models_icms` is not decoration: a mapped class registers itself
    on `Base.metadata` at import, so a module nobody imported contributes no
    tables and the failure is a missing table at runtime. `tables` limits it to
    those names.
    """
    from . import models, models_app, models_icms  # noqa: F401  - registers the mapped classes

    subset = None if tables is None else [Base.metadata.tables[t] for t in sorted(tables)]
    Base.metadata.create_all(bind=bind if bind is not None else get_engine(), tables=subset)


# The tables revision 0001 creates, read from the frozen revision itself.
def _baseline_tables(conn) -> frozenset[str]:
    from alembic.script import ScriptDirectory

    path = ScriptDirectory.from_config(_alembic_config(conn)).get_revision("0001").path
    source = Path(path).read_text(encoding="utf-8")
    return frozenset(re.findall(r"op\.create_table\(\s*['\"](\w+)['\"]", source))


def _adopt(conn) -> None:
    """Bring a pre-Alembic database onto the chain at revision 0001, or refuse to.

    The database is judged against what revision 0001 builds, not against the
    current models: the stamp claims 0001, and every revision after it then
    runs normally and brings the schema to head. The 0001 shape is built for
    real in a scratch schema by running the revision, reflected, and dropped
    (`_baseline_shape`), so there is no second copy of it to fall out of step.

    Refused: a partial ICMS baseline, and any table a later revision creates. A
    database built by `create_all` from the current models is the second case;
    it is at head, not at 0001, and `alembic stamp head` is the deliberate way
    to record that once somebody has checked it.
    """
    from . import models, models_app, models_icms  # noqa: F401

    present = set(inspect(conn).get_table_names())
    baseline = _baseline_tables(conn)
    later = (set(Base.metadata.tables) - baseline) & present
    if later:
        head_shaped = set(Base.metadata.tables) <= present
        raise MigrationRefused(
            f"This database has no alembic_version but already contains "
            f"{', '.join(sorted(later)[:5])}{' ...' if len(later) > 5 else ''}, which "
            f"a revision after 0001 creates, so it matches no revision"
            f"{' (every table the current models declare is present)' if head_shaped else ''}. "
            f"Resolve it deliberately. If it was built from the current models and "
            f"matches them, run `alembic -c alembic.ini stamp head`; if it is at an "
            f"earlier revision, stamp that one; otherwise drop those tables and run "
            f"this again."
        )
    missing = baseline - present
    icms_missing = {t for t in missing if t.startswith("icms_")}
    icms_present = {t for t in present & baseline if t.startswith("icms_")}
    if icms_present and icms_missing:
        raise MigrationRefused(
            f"This database has {len(icms_present)} ICMS tables and is missing "
            f"{len(icms_missing)}, with no alembic_version, so it matches no revision. "
            f"Missing: {', '.join(sorted(icms_missing)[:5])}"
            f"{' ...' if len(icms_missing) > 5 else ''}. Resolve it deliberately: "
            f"drop the partial ICMS schema and run this again, or create the missing "
            f"tables and run `alembic stamp 0001`."
        )

    log.warning(
        "Database predates Alembic. Applying the pre-Alembic statements, creating "
        "%d missing table(s) at revision 0001, applying the baseline's functions, "
        "triggers and seed, then stamping 0001 and upgrading. This happens once.",
        len(missing),
    )
    shape = _baseline_shape(conn)

    for stmt in _STATEMENTS:
        try:
            with conn.begin_nested():
                conn.execute(text(stmt))
        except Exception as exc:
            log.warning("pre-Alembic statement skipped (%s): %s", stmt[:60], exc)

    shape.create_all(bind=conn, tables=[shape.tables[t] for t in missing])

    _apply_baseline_objects(conn)

    _refuse_on_drift(conn, shape)

    cfg = _alembic_config(conn)
    command.stamp(cfg, "0001")
    command.upgrade(cfg, "head")


# Revision 0001's tables, built in a scratch schema, reflected, and returned with schema None.
def _baseline_shape(conn) -> MetaData:
    from alembic.runtime.environment import EnvironmentContext
    from alembic.script import ScriptDirectory

    scratch = f"{_SCRATCH_PREFIX}{secrets.token_hex(6)}"
    try:
        with conn.begin_nested():
            conn.execute(text(f'CREATE SCHEMA "{scratch}"'))
    except DBAPIError as exc:
        if getattr(exc.orig, "pgcode", None) == "42501":
            raise MigrationRefused(
                "Adopting a pre-Alembic database builds revision 0001 in a scratch "
                "schema to learn its exact shape, and this database user may not "
                "create schemas. Grant it CREATE on the database for this one run, "
                "or run the migration as a role that has it. Nothing was changed."
            ) from exc
        raise

    search_path = conn.execute(text("SHOW search_path")).scalar()
    conn.execute(text(f'SET LOCAL search_path TO "{scratch}", {search_path}'))

    cfg = _alembic_config(conn)
    script = ScriptDirectory.from_config(cfg)

    def upgrade(rev, context):
        return script._upgrade_revs("0001", rev)

    with EnvironmentContext(cfg, script, fn=upgrade, destination_rev="0001") as env:
        env.configure(connection=conn, version_table_schema=scratch)
        with env.begin_transaction():
            env.run_migrations()

    geometry = {
        (table, column): (kind, srid)
        for table, column, kind, srid in conn.execute(text(
            "SELECT f_table_name, f_geometry_column, type, srid FROM geometry_columns "
            "WHERE f_table_schema = :schema"), {"schema": scratch})
    }

    def column_reflect(inspector, table, column_info) -> None:
        spec = geometry.get((table.name, column_info["name"]))
        if spec is not None:
            column_info["type"] = Geometry(*spec)
        # A serial's nextval() names the scratch sequence; autoincrement recreates its own.
        if str(column_info.get("default") or "").startswith("nextval("):
            column_info["default"] = None

    reflected = MetaData()
    event.listen(reflected, "column_reflect", column_reflect)
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Did not recognize type 'geometry'")
        reflected.reflect(bind=conn, schema=scratch)
    reflected.remove(reflected.tables[f"{scratch}.alembic_version"])

    shape = MetaData()
    for table in reflected.sorted_tables:
        table.to_metadata(
            shape, schema=None,
            referred_schema_fn=lambda table, to, fk, referred: (
                BLANK_SCHEMA if referred == scratch else referred))

    conn.execute(text(f"SET LOCAL search_path TO {search_path}"))
    conn.execute(text(f'DROP SCHEMA "{scratch}" CASCADE'))
    return shape


def _refuse_on_drift(conn, shape: MetaData) -> None:
    """Refuse to stamp a database that does not match revision 0001.

    Adoption is the one place a stamp is applied to a schema this code did not
    build. The tables it created itself are right by construction; the ones that
    were already there are an assumption. This checks that assumption against
    `shape`, the reflected 0001 tables, and raises if it does not hold, which,
    inside the adoption transaction, undoes everything rather than leaving a
    database that lies about its own version. Both sides are reflections of
    PostgreSQL, so defaults and types come back in the same textual form.
    """
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    tables = set(shape.tables)
    context = MigrationContext.configure(
        conn,
        opts={
            "compare_type": True,
            "compare_server_default": True,
            "include_object": lambda obj, name, type_, reflected, compare_to: not (
                type_ == "table" and name not in tables
            ),
        },
    )
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Did not recognize type 'geometry'")
        differences = compare_metadata(context, shape)
    if differences:
        summary = "; ".join(str(d)[:100] for d in differences[:3])
        raise MigrationRefused(
            f"After preparing the schema, {len(differences)} difference(s) remain "
            f"between this database and revision 0001, so stamping it 0001 would be "
            f"false. Nothing was changed. First: {summary}"
        )


def _apply_baseline_objects(conn) -> None:
    """Create the baseline's functions, triggers and seed on an adopted database.

    Stamping records that a revision has been applied without running it, and
    the things revision 0001 does beyond `create_table` would therefore be
    missing: a database with no append-only guard on its evidence and no
    lookup vocabulary, with nothing to show that anything is wrong.

    The definitions are read out of the revision module rather than copied here,
    so there is still exactly one statement of them, and it is the frozen one.
    """
    from alembic.script import ScriptDirectory

    module = ScriptDirectory.from_config(_alembic_config(conn)).get_revision("0001").module

    conn.execute(text(module.FUNCTIONS))
    for name, table, timing, function in module.TRIGGERS:
        conn.execute(text(f"DROP TRIGGER IF EXISTS {name} ON {table}"))
        conn.execute(text(
            f"CREATE TRIGGER {name} {timing} ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {function}()"))

    for row in module.SEED:
        conn.execute(text(CODE_VALUE_INSERT), CodeValueSeed(*row)._asdict())


def main() -> int:
    """`python -m ada_core.migrate`: the boot sequence, from a shell.

    This exists because `alembic upgrade head` is not equivalent to it, and the
    difference bites exactly once, on a database that predates the chain:

        psycopg2.errors.DuplicateTable: relation "projects" already exists

    The Alembic CLI knows only how to apply revisions. It cannot know that this
    particular database already contains what revision 0001 creates, and it has
    no business guessing. `run_migrations()` is where that judgement lives, so
    on an existing database this is the command to run first. Afterwards the CLI
    works normally, because the database is on the chain.
    """
    import sys

    logging.basicConfig(
        level=logging.INFO, format="%(levelname)-5.5s [%(name)s] %(message)s")

    from .config import CoreSettings
    from .database import configure_engine

    settings = CoreSettings()
    configure_engine(settings.database_url)
    log.info("Migrating %s", get_engine().url.render_as_string(hide_password=True))

    try:
        run_migrations()
    except MigrationRefused as exc:
        print(f"\nRefused to migrate:\n\n  {exc}\n", file=sys.stderr)
        return 2
    return 0


def run_migrations() -> None:
    engine = get_engine()

    if engine.dialect.name != "postgresql":
        log.info("Alembic skipped: dialect is %s. Creating tables from the models.",
                 engine.dialect.name)
        create_tables()
        return

    with engine.begin() as conn:
        # Serialises concurrent starters (api-migrate, ada-ml, a hand run); released at commit.
        conn.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": MIGRATION_LOCK_KEY})
        conn.execute(text(POSTGIS_EXTENSION))
        has_version = inspect(conn).has_table("alembic_version")
        has_tables = inspect(conn).has_table(_SENTINEL_TABLE)

        if not has_version and has_tables:
            _adopt(conn)
        else:
            command.upgrade(_alembic_config(conn), "head")

    log.info("Schema is at head")


if __name__ == "__main__":
    raise SystemExit(main())
