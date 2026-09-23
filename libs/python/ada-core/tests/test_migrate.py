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
