"""The additive migrations that run on every ada-ml boot."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.pool import StaticPool

import ada_core.database as database
from ada_core.migrate import _STATEMENTS, CODE_VALUE_INSERT, CodeValueSeed, run_migrations


def test_every_statement_is_idempotent():
    """These run on every boot, against a fresh database and a populated one
    alike. A statement without IF NOT EXISTS fails the second start, and the
    failure is swallowed and logged — so it would be silent as well as wrong."""
    for statement in _STATEMENTS:
        head = statement.split()[0].upper()
        if head == "ALTER":
            if "ADD COLUMN" in statement.upper():
                assert "IF NOT EXISTS" in statement, statement
            else:
                # SET NOT NULL, DROP NOT NULL and DROP DEFAULT are repeatable by
                # nature: applying one to a column already in that state is a
                # no-op, and PostgreSQL offers no IF NOT EXISTS form to write.
                assert any(k in statement.upper() for k in
                           ("SET NOT NULL", "DROP NOT NULL", "DROP DEFAULT",
                            "SET DEFAULT")), statement
        elif head == "CREATE":
            assert "IF NOT EXISTS" in statement, statement
        elif head == "UPDATE":
            # Backfills are guarded by a WHERE that stops matching once applied.
            assert "WHERE" in statement, statement
        else:
            pytest.fail(f"unexpected statement kind {head!r}: {statement}")


def test_backfills_only_touch_rows_that_predate_the_column():
    """A backfill without IS NULL would rewrite live data on every restart —
    resetting every officer's review decision, in the worst case here."""
    for statement in _STATEMENTS:
        if statement.upper().startswith("UPDATE"):
            assert "IS NULL" in statement.upper(), statement


def test_it_covers_every_column_added_after_its_table():
    """The columns that exist in models.py but not in the original schema. If
    one is added to the model and not here, an upgraded deployment gets
    'column does not exist' on the first query rather than at startup."""
    joined = " ".join(_STATEMENTS)
    for column in ("mode", "review_status", "review_note", "reviewed_by",
                   "reviewed_at", "progress", "stage"):
        assert column in joined, f"no migration for {column}"


def test_run_migrations_uses_the_configured_engine(monkeypatch):
    """It used to import the engine at module load. Configuring one and having
    the migrations run against another is the kind of fault that only shows up
    against a second database."""
    previous = database._engine
    database._engine = None
    try:
        database.configure_engine("sqlite://", poolclass=StaticPool)
        # SQLite rejects this PostgreSQL syntax; run_migrations logs and
        # continues, which is the documented behaviour. What is asserted here
        # is that it reached an engine at all rather than raising RuntimeError.
        run_migrations()
        with database.get_engine().connect() as conn:
            assert conn.execute(text("SELECT 1")).scalar() == 1
    finally:
        if database._engine is not None:
            database._engine.dispose()
        database._engine = previous


def test_run_migrations_without_an_engine_is_a_clear_error(monkeypatch):
    previous = database._engine
    database._engine = None
    try:
        with pytest.raises(RuntimeError, match="configure_engine"):
            run_migrations()
    finally:
        database._engine = previous


def test_the_baselines_four_field_seed_rows_still_load():
    """0001 is frozen and states its seventeen rows as
    (domain, code, label, sort_order). The loader writes six columns now, so the
    fifth and sixth have to default rather than shift the fourth."""
    row = CodeValueSeed(*("delivery_mode", "affixation", "Affixation at site", 3))

    assert (row.label, row.sort_order) == ("Affixation at site", 3)
    assert (row.label_hi, row.parent_code) == (None, None)


def test_a_seed_row_carries_a_parent_and_a_hindi_label():
    """What the act and section domains need: a section hangs off its act, and
    the label exists in both languages."""
    row = CodeValueSeed("section", "sec_27", "Section 27", 3, "धारा 27", "up_upda_1973")

    assert row.parent_code == "up_upda_1973"
    assert set(row._asdict()) == {
        "domain", "code", "label", "sort_order", "label_hi", "parent_code"}


def test_the_seed_insert_is_bound_and_skips_what_is_already_there():
    """Every value is a bind parameter, and a row that exists is left alone —
    the seed runs against databases that have been hand-corrected."""
    for name in ("domain", "code", "label", "label_hi", "parent_code", "sort_order"):
        assert f":{name}" in CODE_VALUE_INSERT
    assert "ON CONFLICT (domain, code) DO NOTHING" in CODE_VALUE_INSERT


class _RecordingConn:
    """Stands in for a PostgreSQL connection; records every statement in order."""

    def __init__(self, log):
        self.log = log

    def execute(self, clause, params=None):
        self.log.append(("sql", str(clause), params))


class _RecordingEngine:
    class dialect:
        name = "postgresql"

    def __init__(self, log):
        self.log = log

    def begin(self):
        import contextlib

        @contextlib.contextmanager
        def _tx():
            self.log.append(("begin",))
            yield _RecordingConn(self.log)
            self.log.append(("commit",))
        return _tx()


def test_postgres_migrations_hold_an_advisory_lock_for_the_whole_upgrade(monkeypatch):
    """Two starters (api-migrate and ada-ml, or two replicas) must not both run
    the upgrade. The lock is the first statement of the transaction the upgrade
    runs in, so the second starter waits and then finds the schema at head."""
    import ada_core.migrate as migrate

    log: list = []
    monkeypatch.setattr(migrate, "get_engine", lambda: _RecordingEngine(log))

    class _Inspector:
        def has_table(self, name):
            return True

    monkeypatch.setattr(migrate, "inspect", lambda conn: _Inspector())
    monkeypatch.setattr(migrate.command, "upgrade",
                        lambda cfg, rev: log.append(("upgrade", rev)))

    migrate.run_migrations()

    assert log[0] == ("begin",)
    kind, sql, params = log[1]
    assert "pg_advisory_xact_lock" in sql
    assert params == {"key": migrate.MIGRATION_LOCK_KEY}
    upgrade_at = log.index(("upgrade", "head"))
    assert 1 < upgrade_at < log.index(("commit",))


def test_the_lock_key_fits_a_postgres_bigint():
    import ada_core.migrate as migrate

    assert -(2**63) <= migrate.MIGRATION_LOCK_KEY < 2**63


def test_sqlite_takes_no_advisory_lock(monkeypatch):
    """pg_advisory_xact_lock does not exist on SQLite; the test path must not call it."""
    from sqlalchemy import event

    previous = database._engine
    database._engine = None
    seen: list[str] = []
    try:
        engine = database.configure_engine("sqlite://", poolclass=StaticPool)
        event.listen(engine, "before_cursor_execute",
                     lambda conn, cur, stmt, *a: seen.append(stmt))
        run_migrations()
        assert not any("advisory" in s for s in seen)
    finally:
        if database._engine is not None:
            database._engine.dispose()
        database._engine = previous


def test_python_dash_m_is_an_entrypoint():
    import ada_core.migrate as migrate

    source = open(migrate.__file__, encoding="utf-8").read()
    assert 'if __name__ == "__main__":' in source
    assert callable(migrate.main)
