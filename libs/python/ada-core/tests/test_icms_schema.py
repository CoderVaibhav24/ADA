"""The ICMS schema: the mapped classes, and the migration that creates them.

The tables are asserted through `Base.metadata`, because that is where they are
defined. The migration chain is asserted separately — that it is linear, that
the baseline does what the models describe, and that the things an ORM cannot
express are in it.

Applying it for real needs PostGIS, which this suite has no server for; it runs
on in-memory SQLite so it runs anywhere. What is checked here is everything
knowable without a server, chosen for the failures that are otherwise found in
production rather than in CI.
"""

from __future__ import annotations

import re
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.pool import StaticPool

from ada_core import models_app, models_icms  # noqa: F401
from ada_core.database import Base, configure_engine
from ada_core.migrate import ALEMBIC_DIR, POSTGIS_EXTENSION, ensure_postgis

ICMS_TABLES = {
    name: table for name, table in Base.metadata.tables.items()
    if name.startswith("icms_")
}

# The policy tables describe rules rather than cases, arrive after the baseline,
# and are counted separately for that reason: a change to the domain schema
# should not be able to hide behind a change to the rules. The first six arrive
# in 0003; icms_upload_policy is the same kind of thing and arrives in 0004.
POLICY_TABLES = frozenset({
    "icms_role",
    "icms_permission",
    "icms_role_permission",
    "icms_workflow_transition",
    "icms_workflow_transition_role",
    "icms_policy_revision",
    "icms_upload_policy",
    # 0018: Super Admin runtime switches (the check-in geofence).
    "icms_runtime_setting",
    # 0021: the deadline-reminder ledger, operational state beside the settings.
    "icms_reminder_sent",
})

# The authority's boundary layers and their import log, from 0015. Reference
# geography rather than cases, counted apart for the same reason as the policy.
BOUNDARY_TABLES = frozenset({"icms_village", "icms_parcel", "icms_boundary_import"})

DOMAIN_TABLES = {
    name: table for name, table in ICMS_TABLES.items()
    if name not in POLICY_TABLES | BOUNDARY_TABLES
}

BASELINE = (ALEMBIC_DIR / "versions" / "0001_baseline.py").read_text(encoding="utf-8")
POLICY_MIGRATION = (
    ALEMBIC_DIR / "versions" / "0003_policy_tables.py"
).read_text(encoding="utf-8")
UPLOAD_MIGRATION = (
    ALEMBIC_DIR / "versions" / "0004_upload_policy.py"
).read_text(encoding="utf-8")
SCREEN_MIGRATION = (
    ALEMBIC_DIR / "versions" / "0005_app_screen.py"
).read_text(encoding="utf-8")
BOUNDARY_MIGRATION = (
    ALEMBIC_DIR / "versions" / "0015_boundary_layers.py"
).read_text(encoding="utf-8")
RUNTIME_SETTING_MIGRATION = (
    ALEMBIC_DIR / "versions" / "0018_runtime_setting.py"
).read_text(encoding="utf-8")
REMINDER_MIGRATION = (
    ALEMBIC_DIR / "versions" / "0021_reminder_settings.py"
).read_text(encoding="utf-8")
PARCEL_RESULT_MIGRATION = (
    ALEMBIC_DIR / "versions" / "0024_analysis_parcel_result.py"
).read_text(encoding="utf-8")


def _scripts() -> ScriptDirectory:
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    return ScriptDirectory.from_config(cfg)


# --- the mapped tables -----------------------------------------------------

def test_all_seventeen_domain_tables_are_mapped():
    assert len(DOMAIN_TABLES) == 17, sorted(DOMAIN_TABLES)


def test_the_three_boundary_tables_are_mapped_and_created_by_0015():
    created = set(re.findall(r"op\.create_table\(\s*[\"\'](\w+)[\"\']", BOUNDARY_MIGRATION))
    assert created == BOUNDARY_TABLES <= set(ICMS_TABLES)


def test_all_seven_policy_tables_are_mapped():
    """Workflow transitions, RBAC and the upload rules live in the database from
    revisions 0003 and 0004. A policy table present in the migration and absent
    from the models is a set of rules nothing can read."""
    missing = POLICY_TABLES - set(ICMS_TABLES)
    assert not missing, sorted(missing)


def test_every_evidence_kind_has_an_upload_policy_seeded():
    """A kind with no row rejects every upload, so a kind icms_evidence accepts
    and 0004 did not seed is an evidence type the field app cannot send at all."""
    seeded = set(re.findall(r'\("(\w+)", \[', UPLOAD_MIGRATION))
    assert seeded == set(models_icms.EVIDENCE_KINDS), sorted(seeded)
    for expected in ("image/jpeg", "image/png", "image/heic", "video/mp4",
                     "video/quicktime", "application/pdf"):
        assert expected in UPLOAD_MIGRATION, expected


def test_every_table_is_namespaced():
    """ICMS shares a database with the platform's own tables. A table called
    `case` or `zone` is a collision waiting for the next subsystem."""
    for cls in vars(models_icms).values():
        table = getattr(cls, "__tablename__", None)
        if isinstance(table, str):
            assert table.startswith("icms_"), table


def test_the_schema_creates_on_sqlite(engine):
    """The variant types in ada_core.types are what make this possible: the
    geometry columns render as TEXT here and as geometry(...) on PostGIS. If
    this breaks, every suite in the repo needs a PostgreSQL server."""
    assert "icms_case" in Base.metadata.tables
    assert engine.dialect.name == "sqlite"


def test_a_photograph_cannot_exist_without_its_capture_fields():
    """Geo-tag integrity is a property of the evidence, so it is a constraint,
    not a validation the API could be talked out of."""
    checks = {
        c.name: str(c.sqltext)
        for c in models_icms.Evidence.__table__.constraints
        if isinstance(c, CheckConstraint)
    }
    assert "icms_evidence_geotag_ck" in checks
    clause = checks["icms_evidence_geotag_ck"]
    for column in ("location", "accuracy_m", "device_timestamp", "capture_source"):
        assert column in clause, column


def test_a_round_number_is_unique_per_case():
    # The legacy defect: a re-survey was a second inspection row with nothing
    # distinguishing it from the first.
    uniques = {
        c.name: tuple(col.name for col in c.columns)
        for c in models_icms.Inspection.__table__.constraints
        if isinstance(c, UniqueConstraint)
    }
    assert uniques.get("icms_inspection_round_uq") == ("case_id", "round_no")


def test_the_case_status_check_lists_every_status():
    checks = {
        c.name: str(c.sqltext)
        for c in models_icms.Case.__table__.constraints
        if isinstance(c, CheckConstraint)
    }
    clause = checks["icms_case_status_ck"]
    assert set(re.findall(r"'([a-z_]+)'", clause)) == set(models_icms.CASE_STATUSES)


def test_the_open_assignment_index_is_partial():
    """Without the partial predicate a case could be assigned exactly once ever
    — the closed rows would collide with the new one."""
    index = next(
        i for i in models_icms.CaseAssignment.__table__.indexes
        if i.name == "uq_icms_case_assignment_open"
    )
    assert index.unique
    assert index.dialect_options["postgresql"]["where"] is not None


def test_notice_numbering_uses_a_table_not_a_sequence():
    """A PostgreSQL sequence is non-transactional and leaves gaps on rollback.
    A gap in a statutory notice register is a question nobody wants to answer."""
    assert models_icms.NoticeSequence.__tablename__ == "icms_notice_sequence"
    assert "CREATE SEQUENCE" not in BASELINE.upper()


def test_geometry_columns_are_indexed_for_search():
    """A geometry column with no GiST index makes ST_Contains a sequential scan,
    which is the legacy behaviour this replaces — it tested containment in
    JavaScript, one vertex row at a time."""
    gist = [
        i.name for t in ICMS_TABLES.values() for i in t.indexes
        if i.dialect_options["postgresql"].get("using") == "gist"
    ]
    assert len(gist) >= 6, gist


def test_every_column_with_a_python_default_also_has_a_server_default():
    """`default` is applied by the ORM in Python and is invisible to anything
    else, so a row inserted by a data load or a psql session hits NOT NULL on a
    column the DDL never gave a default. This was a real regression, caught by a
    probe insert rather than by a test — hence the test."""
    for table in ICMS_TABLES.values():
        for column in table.columns:
            if column.default is not None and not column.primary_key:
                assert column.server_default is not None, f"{table.name}.{column.name}"


# --- the migration chain ---------------------------------------------------

def test_the_chain_is_linear_with_one_head():
    """Two heads mean two people generated a revision against the same parent,
    and `upgrade head` then fails with 'Multiple head revisions are present'."""
    assert len(_scripts().get_heads()) == 1


def test_every_revision_can_be_downgraded():
    """A revision with `pass` for a downgrade is one that cannot be backed out
    on the night it goes wrong."""
    for script in _scripts().walk_revisions():
        body = Path(script.path).read_text().split("def downgrade()", 1)[1]
        assert body.split("\n", 1)[1].strip() not in ("pass", ""), script.revision


def test_the_baseline_is_the_root():
    scripts = _scripts()
    base = scripts.get_revision("0001")
    assert base.down_revision is None


def test_postgis_is_created_before_the_tables_that_need_it():
    """Ordering, asserted as a fact rather than a comment: a create_table with a
    geometry column against a database without the extension fails on
    'type "geometry" does not exist'."""
    upgrade = BASELINE.split("def upgrade()", 1)[1]
    extension_at = upgrade.index("CREATE EXTENSION IF NOT EXISTS postgis")
    first_table_at = upgrade.index("op.create_table")
    assert extension_at < first_table_at


def test_the_baseline_carries_what_the_orm_cannot_express():
    for function in ("icms_touch_updated_at", "icms_refuse_delete"):
        assert f"CREATE OR REPLACE FUNCTION {function}" in BASELINE, function
    for trigger in ("trg_icms_case_touch", "trg_icms_inspection_touch",
                    "trg_icms_notice_touch", "trg_icms_evidence_no_delete",
                    "trg_icms_case_event_no_delete"):
        assert trigger in BASELINE, trigger
    assert "op.bulk_insert" in BASELINE


def test_the_migrations_create_every_mapped_table():
    """A table added to the models and not to a migration exists in the test
    suite and nowhere else."""
    created = set(re.findall(
        r"op\.create_table\(\s*[\"\'](\w+)[\"\']",
        BASELINE + POLICY_MIGRATION + UPLOAD_MIGRATION + SCREEN_MIGRATION
        + BOUNDARY_MIGRATION + RUNTIME_SETTING_MIGRATION + REMINDER_MIGRATION
            + PARCEL_RESULT_MIGRATION))
    assert created == set(Base.metadata.tables)


def test_the_baseline_creates_no_policy_table():
    """The policy tables belong to 0003. Creating one in the baseline too would
    make a fresh database and an upgraded one disagree about which revision
    introduced the rules."""
    created = set(re.findall(r"op\.create_table\(\s*[\"\'](\w+)[\"\']", BASELINE))
    assert not (created & POLICY_TABLES), sorted(created & POLICY_TABLES)


def test_the_baseline_drops_nothing_it_did_not_create():
    """The first autogenerate emitted drop_table for the PostGIS tiger geocoder
    — `edges`, `bg`, `tabblock` — because they are in the database and not in
    the metadata. env.py now filters them; this is the regression test."""
    dropped = set(re.findall(r"op\.drop_table\('(\w+)'", BASELINE))
    assert dropped <= set(Base.metadata.tables), dropped - set(Base.metadata.tables)


def test_postgres_only_steps_are_skipped_on_sqlite_rather_than_failing():
    """The suite runs on in-memory SQLite, which understands none of PostGIS,
    PL/pgSQL or ON CONFLICT."""
    configure_engine("sqlite://", poolclass=StaticPool,
                     connect_args={"check_same_thread": False})
    assert ensure_postgis() is False
    assert POSTGIS_EXTENSION == "CREATE EXTENSION IF NOT EXISTS postgis"
