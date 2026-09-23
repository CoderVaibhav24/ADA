"""parcel identity, priority, idempotent raise, and a re-keyed reference counter

Four gaps found while building Batches 1 and 2, folded into one revision because
they all alter the same two tables and a live table should be locked once rather
than four times.

  1. `icms_case` gains the land-parcel identity — `ulpin`, `khasra_no`,
     `village_lgd_code`, `district_lgd_code` — and the composite index on
     (village_lgd_code, khasra_no). Names, widths and that index are taken
     verbatim from docs/ICMS-Government-Data-Standards.md section 7, which
     scoped them and deferred the work. Without them the Complaints register
     cannot render its `Parcel ID` column and its search box, labelled
     "Search parcel / Khasra No.", searches neither.

  2. `icms_case.priority`, with a CHECK holding it to high | medium | low, and
     an index for the `All Priorities` dropdown.

  3. `ix_icms_case_type` on `complaint_type_cd`, which has backed a shipped
     register filter since Batch 2 with no index under it.

  4. `icms_notice_sequence` is re-keyed from (year) to (series, scope_cd, year).
     Keyed on year alone it holds ONE counter for the whole system, so the
     moment Batch 3 mints INS-2026-nnnn it would draw from the same row as
     CMP-2026-nnnn and both registers would be full of holes — the precise
     defect the table exists to prevent.

  5. `icms_case.idempotency_key`, matching `icms_check_in` and `icms_evidence`,
     so a field app can retry a raise over a bad connection without filing the
     complaint twice.

  6. `icms_notice_sequence.year` loses the `DEFAULT nextval(...)` and the owned
     sequence that revision 0001 gave it by accident. `year` was the lone
     integer primary key there, so SQLAlchemy rendered `sa.SmallInteger()` as
     SMALLSERIAL. Re-keying the primary key does not remove a column default, so
     without this the register's year column would keep defaulting to 1, 2, 3.
     The model has always said SMALLINT; this makes the database agree, which
     also keeps `ada_core.migrate`'s drift check from refusing to stamp.

## Safety

Additive only. No column is dropped, no type narrowed, no data rewritten.

Every new column is nullable with no default, which on PostgreSQL 11 and later
is a catalogue-only change: no table rewrite, no scan, and the ACCESS EXCLUSIVE
lock is held for microseconds rather than for the length of a scan. The two
columns that DO carry a server default are on `icms_notice_sequence`, which
holds one row per year; and since PostgreSQL 11 a default on ADD COLUMN is also
catalogue-only.

Both CHECK constraints are added NOT VALID and validated in a second statement.
`ADD CONSTRAINT ... CHECK` normally scans the whole table under ACCESS
EXCLUSIVE; NOT VALID takes the lock for an instant, and VALIDATE CONSTRAINT then
scans under SHARE UPDATE EXCLUSIVE, which does not block reads or writes. The
constraints are trivially true anyway — both columns are new and entirely NULL —
but the pattern is the one to have in the file, because the next one will not be.

## CREATE INDEX CONCURRENTLY is deliberately NOT used here

It cannot run inside a transaction, and every path that applies this revision
wraps it in one:

  * `alembic/env.py` runs all migrations inside a single
    `context.begin_transaction()`.
  * `ada_core.migrate.run_migrations()` additionally wraps the whole thing in
    `engine.begin()`, because the adoption path's all-or-nothing promise depends
    on it.

Alembic's `autocommit_block()` would commit both of those early to get outside a
transaction, which silently turns "the adoption is one transaction" into a
falsehood — and that promise is load-bearing: `_refuse_on_drift` relies on being
able to roll the whole adoption back.

So the indexes below are created with plain `CREATE INDEX`, which is correct and
transactional. Two of the three index brand-new, entirely-NULL columns and are
effectively instant. `ix_icms_case_type` indexes a populated column and takes a
SHARE lock, which blocks writes to `icms_case` while it builds.

**If `icms_case` is large enough for that to matter, the operator creates the
three indexes by hand, CONCURRENTLY, BEFORE running this revision.** Every
`CREATE INDEX` below is `IF NOT EXISTS`, so the revision then finds them already
there and does nothing. The commands are in the report accompanying this change.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-22

"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The sentinel for a series that is not numbered per zone. Mirrors
# ada_core.models_icms.AUTHORITY_WIDE; stated here as a literal because a
# migration must keep working when the models move on.
AUTHORITY_WIDE = "*"

PRIORITIES = ("high", "medium", "low")


def upgrade() -> None:
    # --- 1, 2, 5: new columns on icms_case --------------------------------
    #
    # `IF NOT EXISTS` on every one. The adoption path in ada_core.migrate
    # creates absent tables from the CURRENT models — which already carry these
    # columns — and then upgrades to head, so on a database adopted after this
    # revision was written the columns are already present and a bare ADD COLUMN
    # would fail with DuplicateColumn.
    for column, ddl in (
        ("ulpin", "varchar(14)"),
        ("khasra_no", "varchar(24)"),
        ("village_lgd_code", "varchar(12)"),
        ("district_lgd_code", "varchar(12)"),
        ("priority", "varchar(10)"),
        ("idempotency_key", "varchar(36)"),
    ):
        op.execute(f"ALTER TABLE icms_case ADD COLUMN IF NOT EXISTS {column} {ddl}")

    # --- CHECK constraints, NOT VALID then validated ----------------------
    values = ", ".join(f"'{value}'" for value in PRIORITIES)
    _add_constraint(
        "icms_case", "icms_case_priority_ck",
        f"CHECK (priority IN ({values}) OR priority IS NULL)",
    )
    # Exactly fourteen characters. varchar(14) caps the top end; this catches a
    # thirteen-character typo. Upper-case and alphanumeric are enforced by
    # ada_core.validation.ULPIN at the edge — `~` is a PostgreSQL operator and
    # the models must still build on SQLite for the suites.
    _add_constraint(
        "icms_case", "icms_case_ulpin_ck",
        "CHECK (ulpin IS NULL OR length(ulpin) = 14)",
    )

    # --- the unique guard on the retry key ---------------------------------
    # A unique INDEX rather than a unique CONSTRAINT, so it can be created
    # concurrently by hand if this ever has to be redone on a big table.
    # PostgreSQL permits many NULLs in a unique index, which is what makes this
    # safe to add to a table whose existing rows have no key.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_icms_case_idempotency "
        "ON icms_case (idempotency_key)"
    )

    # --- 1, 2, 3: the indexes ---------------------------------------------
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_icms_case_type ON icms_case (complaint_type_cd)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_icms_case_priority ON icms_case (priority)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_icms_case_parcel "
        "ON icms_case (village_lgd_code, khasra_no)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_icms_case_ulpin "
        "ON icms_case (ulpin) WHERE ulpin IS NOT NULL")

    # --- 4: re-key the reference counter -----------------------------------
    #
    # The defaults are not cosmetic: they are the correct reading of the rows
    # already in the table. CMP is the only series ever allocated — Batch 2 is
    # the only code that has minted anything — and it is authority-wide. So
    # every existing row IS ('CMP', '*', year), and the defaults say so without
    # a data rewrite.
    op.execute(
        "ALTER TABLE icms_notice_sequence "
        "ADD COLUMN IF NOT EXISTS series varchar(3) NOT NULL DEFAULT 'CMP'")
    op.execute(
        "ALTER TABLE icms_notice_sequence "
        f"ADD COLUMN IF NOT EXISTS scope_cd varchar(40) NOT NULL "
        f"DEFAULT '{AUTHORITY_WIDE}'")

    # One row per year, so rebuilding this primary key is instant. On a big
    # table it would be the one genuinely blocking step in this revision.
    op.execute("ALTER TABLE icms_notice_sequence DROP CONSTRAINT IF EXISTS "
               "icms_notice_sequence_pkey")
    op.execute("ALTER TABLE icms_notice_sequence "
               "ADD CONSTRAINT icms_notice_sequence_pkey "
               "PRIMARY KEY (series, scope_cd, year)")

    # --- disarm the SMALLSERIAL that 0001 did not mean to create -----------
    #
    # `year` was the lone integer primary key in revision 0001, so SQLAlchemy
    # promoted `sa.SmallInteger()` to SMALLSERIAL and PostgreSQL created a
    # sequence owned by the column plus a `DEFAULT nextval(...)`. The model
    # never asked for that and, now that the key is composite, no longer renders
    # it either.
    #
    # Re-keying does not remove a column default, so without this the table
    # would still default `year` to nextval — on a column holding a calendar
    # year. An INSERT that omitted it would file 1, then 2, then 3. The
    # allocator always supplies the year, so it would not fire today; but this
    # is the table whose entire purpose is a gap-free statutory register, and a
    # notice filed under year 3 is a notice in the wrong register.
    #
    # It is also a drift fix. The model renders `year SMALLINT`; a database
    # still carrying the nextval default does not match it, and
    # `ada_core.migrate._refuse_on_drift` would refuse to stamp.
    #
    # The sequence name is NOT hardcoded. PostgreSQL derives it as
    # <table>_<column>_seq — here `icms_notice_sequence_year_seq` — but a
    # database built some other way may have no sequence at all, so it is looked
    # up and the drop is skipped when there is none. Order matters: the default
    # depends on the sequence, so DROP SEQUENCE fails until the default is gone.
    op.execute(
        "DO $$\n"
        "DECLARE\n"
        "    owned_sequence text;\n"
        "BEGIN\n"
        "    owned_sequence := pg_get_serial_sequence('icms_notice_sequence', 'year');\n"
        "    ALTER TABLE icms_notice_sequence ALTER COLUMN year DROP DEFAULT;\n"
        "    IF owned_sequence IS NOT NULL THEN\n"
        "        EXECUTE format('DROP SEQUENCE IF EXISTS %s', owned_sequence);\n"
        "    END IF;\n"
        "END $$"
    )


def downgrade() -> None:
    """Reverse every statement above, newest first.

    A real downgrade, not `pass`. It drops columns this revision added and no
    others, so running it loses the parcel identity and the priorities entered
    since the upgrade — which is what reversing an additive migration means and
    is why it should be read before it is run.

    **One thing does not round-trip, deliberately.** The upgrade removes the
    SMALLSERIAL default and owned sequence from `icms_notice_sequence.year`, and
    this does not put them back. Reconstructing them faithfully is possible —
    CREATE SEQUENCE, setval past the highest year, SET DEFAULT nextval, ALTER
    SEQUENCE OWNED BY — but all it would restore is a defect: a nextval default
    on a column holding a calendar year, which revision 0001 created by accident
    and which the model has never declared. Re-arming it to satisfy a symmetry
    nobody wants would also put the schema back out of step with the model and
    make the drift check refuse.

    So `year` is left as a plain SMALLINT, which is what the model says it is.
    Downgrading to 0001 and upgrading again is therefore not a no-op on this one
    column, and that is the honest outcome rather than a hidden one.
    """
    # --- 4: back to a counter keyed on the year ---------------------------
    #
    # Safe only while CMP is authority-wide and the only series with rows. If
    # INS or NTC rows exist, collapsing the key would make duplicates of `year`
    # and the ADD PRIMARY KEY below would fail — loudly, before anything is
    # lost, which is the right failure.
    op.execute("ALTER TABLE icms_notice_sequence DROP CONSTRAINT IF EXISTS "
               "icms_notice_sequence_pkey")
    op.execute("ALTER TABLE icms_notice_sequence ADD CONSTRAINT "
               "icms_notice_sequence_pkey PRIMARY KEY (year)")
    op.execute("ALTER TABLE icms_notice_sequence DROP COLUMN IF EXISTS scope_cd")
    op.execute("ALTER TABLE icms_notice_sequence DROP COLUMN IF EXISTS series")

    # --- 3, 2, 1: indexes, then constraints, then columns ------------------
    for index in (
        "ix_icms_case_ulpin",
        "ix_icms_case_parcel",
        "ix_icms_case_priority",
        "ix_icms_case_type",
        "uq_icms_case_idempotency",
    ):
        op.execute(f"DROP INDEX IF EXISTS {index}")

    for constraint in ("icms_case_ulpin_ck", "icms_case_priority_ck"):
        op.execute(f"ALTER TABLE icms_case DROP CONSTRAINT IF EXISTS {constraint}")

    for column in (
        "idempotency_key",
        "priority",
        "district_lgd_code",
        "village_lgd_code",
        "khasra_no",
        "ulpin",
    ):
        op.execute(f"ALTER TABLE icms_case DROP COLUMN IF EXISTS {column}")


def _add_constraint(table: str, name: str, definition: str) -> None:
    """Add a CHECK as NOT VALID, then validate it, idempotently.

    `ADD CONSTRAINT` has no `IF NOT EXISTS`, so the guard is a catalogue lookup.
    It is needed for the same reason the columns above use `IF NOT EXISTS`: a
    database adopted after this revision was written already has the constraint,
    because `create_all` built the table from the current models.
    """
    # No trailing semicolon: Alembic adds one, and `END $$;;` in a reviewed
    # script is the kind of thing that makes a reader wonder what else is sloppy.
    op.execute(
        "DO $$\n"
        "BEGIN\n"
        f"    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{name}') THEN\n"
        f"        ALTER TABLE {table} ADD CONSTRAINT {name} {definition} NOT VALID;\n"
        f"        ALTER TABLE {table} VALIDATE CONSTRAINT {name};\n"
        "    END IF;\n"
        "END $$"
    )
