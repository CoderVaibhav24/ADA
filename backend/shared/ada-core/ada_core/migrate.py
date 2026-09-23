"""Bringing a database up to what the code expects, on every boot.

Alembic owns the schema. `ada_core/alembic/versions/` is the history, revision
0001 is everything that existed on 18 September 2026, and nothing changes the
schema except a revision. `ada-ml` calls `run_migrations()` at startup.

To do the same thing by hand, run the same function — not the Alembic CLI:

    python -m ada_core.migrate

`alembic upgrade head` is NOT equivalent, and the difference is not cosmetic. On
a database that predates the chain the CLI tries to apply revision 0001 to a
schema that already contains it:

    psycopg2.errors.DuplicateTable: relation "projects" already exists

The CLI applies revisions; it cannot know that this database is already at the
baseline without being told. That judgement is in `run_migrations()`. Once a
database is on the chain — it has an `alembic_version` row — the CLI is the
right tool and behaves normally:

    cd backend/shared/ada-core
    alembic -c alembic.ini current
    alembic -c alembic.ini upgrade head --sql    # review before applying
    alembic -c alembic.ini upgrade head
    alembic -c alembic.ini revision --autogenerate -m "add ulpin to case"

## Why Alembic, having managed without it

`create_all` creates a missing table and never alters an existing one, so every
change after the first had to be an idempotent `ALTER ... IF NOT EXISTS` in a
list — and that list can only ever add. It cannot rename a column, narrow a
type, or run a backfill once. It also has no notion of what has been applied, so
a half-applied change is indistinguishable from a complete one. The ICMS schema
was introduced before it had any data, which is the cheapest moment to adopt a
migration chain and the last one that is free.

## Three paths, decided by what the database already contains

  * **No `alembic_version` and no tables** — a fresh database. `upgrade head`.
  * **`alembic_version` present** — the normal case. `upgrade head`.
  * **Tables but no `alembic_version`** — a database that predates Alembic. It
    is brought onto the chain: the pre-Alembic statements run, baseline tables
    that are wholly absent are created, the baseline's functions, triggers and
    seed are applied, the schema is checked against the models, and only then is
    it stamped 0001 and upgraded to head. All of it in one transaction. Tables a
    later revision creates are left to that revision, which also seeds them.

    The check before the stamp is the part that matters. Tables created here are
    right by construction; tables that were already there are an assumption, and
    the stamp is what every later migration trusts. If they do not match the
    models, nothing is committed.

    Two shapes are refused outright: **some** baseline ICMS tables present and
    some not, or any table a later revision creates already present. Something
    else built those, this does not know what shape they are in, and the stamp
    would claim otherwise.

SQLite takes none of these. The suites create a schema from the models directly
(`tests/conftest.py`), and the migrations are PostGIS and PL/pgSQL throughout;
making them portable would mean writing the schema twice, and two schemas
differ.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import NamedTuple

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from .database import Base, get_engine

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

    Used on the SQLite path, by the test fixtures, and by the adoption path —
    where `bind` is the open connection, so creating the tables and stamping the
    revision are one transaction rather than two.

    `create_all` only ever creates what is absent. It does not alter or drop an
    existing table, which is why it is safe to point at a database with data in
    it.

    Importing `models_icms` is not decoration: a mapped class registers itself
    on `Base.metadata` at import, so a module nobody imported contributes no
    tables and the failure is a missing table at runtime. `tables` limits it to
    those names; adoption uses that to create the baseline and nothing later.
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
    """Bring a pre-Alembic database onto the chain, or refuse to.

    Applies the old additive statements — which is what an upgrade from that era
    needed — and stamps the baseline, but only when every table the baseline
    creates is already there. A partial schema is not stamped: there is no
    revision that describes it, and pretending otherwise puts the next migration
    on top of a false premise.
    """
    from . import models, models_app, models_icms  # noqa: F401

    present = set(inspect(conn).get_table_names())
    baseline = _baseline_tables(conn)
    later = (set(Base.metadata.tables) - baseline) & present
    if later:
        raise MigrationRefused(
            f"This database has no alembic_version but already contains "
            f"{', '.join(sorted(later)[:5])}{' ...' if len(later) > 5 else ''}, which "
            f"a revision after 0001 creates, so it matches no revision. Resolve it "
            f"deliberately — drop those tables and run this again, or stamp the "
            f"revision the database is actually at."
        )
    missing = baseline - present
    icms_missing = {t for t in missing if t.startswith("icms_")}
    icms_present = {t for t in present & baseline if t.startswith("icms_")}
    if icms_present and icms_missing:
        raise MigrationRefused(
            f"This database has {len(icms_present)} ICMS tables and is missing "
            f"{len(icms_missing)}, with no alembic_version, so it matches no revision. "
            f"Missing: {', '.join(sorted(icms_missing)[:5])}"
            f"{' ...' if len(icms_missing) > 5 else ''}. Resolve it deliberately — "
            f"drop the partial ICMS schema and run this again, or create the missing "
            f"tables and run `alembic stamp 0001`."
        )

    log.warning(
        "Database predates Alembic. Applying the pre-Alembic statements, creating "
        "%d missing table(s), applying the baseline's functions, triggers and seed, "
        "then stamping. This happens once.", len(missing),
    )
    for stmt in _STATEMENTS:
        try:
            conn.execute(text(stmt))
        except Exception as exc:
            log.warning("pre-Alembic statement skipped (%s): %s", stmt[:60], exc)

    create_tables(bind=conn, tables=missing)

    _apply_baseline_objects(conn)

    _refuse_on_drift(conn, baseline)

    cfg = _alembic_config(conn)
    command.stamp(cfg, "0001")
    command.upgrade(cfg, "head")


def _refuse_on_drift(conn, tables: frozenset[str]) -> None:
    """Refuse to stamp a database that does not match the revision being claimed.

    Adoption is the one place a stamp is applied to a schema this code did not
    build. The tables it created itself are right by construction; the ones that
    were already there are an assumption. This checks that assumption against
    the models and raises if it does not hold, which — inside the adoption
    transaction — undoes everything rather than leaving a database that lies
    about its own version. Only `tables` — the baseline — are compared; a
    later revision's tables do not exist yet and are not expected to.
    """
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

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
    differences = compare_metadata(context, Base.metadata)
    if differences:
        summary = "; ".join(str(d)[:100] for d in differences[:3])
        raise MigrationRefused(
            f"After preparing the schema, {len(differences)} difference(s) remain "
            f"between this database and the models, so it is not at revision 0001 and "
            f"stamping it would be false. Nothing was changed. First: {summary}"
        )


def _apply_baseline_objects(conn) -> None:
    """Create the baseline's functions, triggers and seed on an adopted database.

    Stamping records that a revision has been applied without running it, and
    the things revision 0001 does beyond `create_table` would therefore be
    missing — a database with no append-only guard on its evidence and no
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
    """`python -m ada_core.migrate` — the boot sequence, from a shell.

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

    ensure_postgis()

    with engine.begin() as conn:
        has_version = inspect(conn).has_table("alembic_version")
        has_tables = inspect(conn).has_table(_SENTINEL_TABLE)

        if not has_version and has_tables:
            _adopt(conn)
        else:
            command.upgrade(_alembic_config(conn), "head")

    log.info("Schema is at head")


if __name__ == "__main__":  
    raise SystemExit(main())
