"""The additive migrations that run on every ada-ml boot."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.pool import StaticPool

import ada_core.database as database
from ada_core.migrate import _STATEMENTS, run_migrations


def test_every_statement_is_idempotent():
    """These run on every boot, against a fresh database and a populated one
    alike. A statement without IF NOT EXISTS fails the second start, and the
    failure is swallowed and logged — so it would be silent as well as wrong."""
    for statement in _STATEMENTS:
        head = statement.split()[0].upper()
        if head == "ALTER":
            assert "IF NOT EXISTS" in statement, statement
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
