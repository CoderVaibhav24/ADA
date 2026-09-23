"""Reference numbers: unique, gap-free, and given back on rollback.

The three properties that matter, and the third is the one a PostgreSQL SEQUENCE
does not have. `nextval` is deliberately non-transactional, so a rolled-back
insert burns the number and the register gets a hole; the counter row here is
rolled back with everything else, so the number comes back. That is the whole
reason the spec refuses a sequence, and it is asserted below rather than
asserted in a comment.

The concurrency test runs real threads against a file-backed SQLite database
with WAL enabled, so the writers genuinely contend for the same row rather than
taking turns on one shared connection. It is not PostgreSQL, but the statement
under test — `UPDATE ... SET last_seq = last_seq + 1 ... RETURNING` — is the same
one, and the property being proved is that the increment happens in the database
rather than in Python.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from ada_core.database import Base
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from app.errors import ApiError
from app.icms import numbering
from app.icms.numbering import Series, allocate, current_year, next_sequence

YEAR = 2026


@pytest.fixture
def sessions(tmp_path):
    """A file-backed database and a session factory, for genuine concurrency.

    In-memory SQLite with StaticPool — what the rest of the suite uses — hands
    every thread the SAME connection, so writers would serialise on the
    connection rather than on the row and the test would prove nothing.
    """
    url = f"sqlite:///{tmp_path / 'sequences.db'}"
    engine = create_engine(
        url, connect_args={"check_same_thread": False, "timeout": 30}
    )

    @event.listens_for(engine, "connect")
    def _wal(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        # One writer at a time either way; WAL just stops readers blocking it.
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


class TestFormat:
    def test_the_first_reference_of_a_year(self, sessions):
        with sessions() as db:
            reference = allocate(db, Series.CASE, year=YEAR)
            db.commit()

        assert reference == "CMP-2026-0001"

    def test_the_sequence_is_zero_padded_to_four_digits(self, sessions):
        with sessions() as db:
            for _ in range(11):
                reference = allocate(db, Series.CASE, year=YEAR)
            db.commit()

        assert reference == "CMP-2026-0011"

    def test_the_format_matches_the_shared_validator(self, sessions):
        """`ada_core.validation.CaseRef` is what every other endpoint parses a
        reference with. A minted value that it refuses is a case nobody can look
        up."""
        from ada_core.validation import CaseRef
        from pydantic import BaseModel

        class Probe(BaseModel):
            ref: CaseRef

        with sessions() as db:
            reference = allocate(db, Series.CASE, year=YEAR)
            db.commit()

        assert Probe(ref=reference).ref == reference

    def test_each_year_starts_again_at_one(self, sessions):
        with sessions() as db:
            allocate(db, Series.CASE, year=2026)
            allocate(db, Series.CASE, year=2026)
            next_year = allocate(db, Series.CASE, year=2027)
            db.commit()

        assert next_year == "CMP-2027-0001"

    def test_the_year_is_agra_local_time_not_utc(self):
        """A complaint filed at 05:00 IST on 1 January is 23:30 UTC on 31
        December. Taking the year from UTC files it in the previous year's
        register, and the annual return is what finds out."""
        new_year_ist = datetime(2026, 12, 31, 23, 30, tzinfo=UTC)

        assert current_year(new_year_ist) == 2027
        assert new_year_ist.year == 2026

    def test_the_local_year_is_the_indian_one(self):
        assert numbering.IST == ZoneInfo("Asia/Kolkata")


class TestGapFreedom:
    def test_a_rolled_back_allocation_gives_the_number_back(self, sessions):
        """THE property. A PostgreSQL SEQUENCE would have burned 0001 here and
        the register would start at 0002, with nothing to explain the hole."""
        with sessions() as db:
            first = allocate(db, Series.CASE, year=YEAR)
            db.rollback()

        with sessions() as db:
            second = allocate(db, Series.CASE, year=YEAR)
            db.commit()

        assert first == second == "CMP-2026-0001"

    def test_a_committed_allocation_does_not_come_back(self, sessions):
        with sessions() as db:
            first = allocate(db, Series.CASE, year=YEAR)
            db.commit()
        with sessions() as db:
            second = allocate(db, Series.CASE, year=YEAR)
            db.commit()

        assert (first, second) == ("CMP-2026-0001", "CMP-2026-0002")

    def test_the_counter_row_is_created_once_and_then_incremented(self, sessions):
        from ada_core.models_icms import NoticeSequence

        with sessions() as db:
            for _ in range(5):
                next_sequence(db, YEAR)
            db.commit()

        with sessions() as db:
            rows = db.execute(select(NoticeSequence.year, NoticeSequence.last_seq)).all()

        assert rows == [(YEAR, 5)]


class TestConcurrency:
    THREADS = 8
    PER_THREAD = 12

    def test_concurrent_allocation_produces_no_duplicate_and_no_gap(self, sessions):
        """The legacy system does `SELECT max(id) + 1` in twenty-two places. Two
        writers read the same maximum and mint the same reference; this is the
        test that would have caught it."""
        barrier = threading.Barrier(self.THREADS)
        errors: list[Exception] = []

        def worker() -> list[str]:
            taken: list[str] = []
            # Start together, so the contention is real rather than incidental.
            barrier.wait(timeout=30)
            for _ in range(self.PER_THREAD):
                try:
                    with sessions() as db:
                        taken.append(allocate(db, Series.CASE, year=YEAR))
                        db.commit()
                except Exception as exc:  # noqa: BLE001 - recorded and asserted below
                    errors.append(exc)
            return taken

        with ThreadPoolExecutor(max_workers=self.THREADS) as pool:
            results = [future.result() for future in
                       [pool.submit(worker) for _ in range(self.THREADS)]]

        assert errors == []
        minted = [reference for batch in results for reference in batch]
        expected = self.THREADS * self.PER_THREAD

        assert len(minted) == expected
        # No duplicate.
        assert len(set(minted)) == expected
        # No gap: the set is exactly 1..N, with nothing missing and nothing extra.
        assert {int(reference.rsplit("-", 1)[1]) for reference in minted} == set(
            range(1, expected + 1))

    def test_the_counter_agrees_with_what_was_minted(self, sessions):
        from ada_core.models_icms import NoticeSequence

        def worker() -> None:
            with sessions() as db:
                allocate(db, Series.CASE, year=YEAR)
                db.commit()

        with ThreadPoolExecutor(max_workers=6) as pool:
            for future in [pool.submit(worker) for _ in range(30)]:
                future.result()

        with sessions() as db:
            last = db.execute(
                select(NoticeSequence.last_seq).where(NoticeSequence.year == YEAR)
            ).scalar_one()

        assert last == 30


class TestGuards:
    def test_an_exhausted_year_fails_rather_than_minting_a_five_digit_sequence(
        self, sessions
    ):
        """CMP-2026-10000 is fourteen characters, so String(16) would accept it
        and the CaseRef pattern would then refuse to parse it anywhere else."""
        from ada_core.models_icms import NoticeSequence
        from sqlalchemy import insert

        with sessions() as db:
            db.execute(insert(NoticeSequence).values(year=YEAR, last_seq=9999))
            db.commit()

            with pytest.raises(ApiError) as exc:
                allocate(db, Series.CASE, year=YEAR)

        assert exc.value.status_code == 409
        assert exc.value.code == "sequence_exhausted"


class TestSeriesAreIndependent:
    """Revision 0002 re-keyed the counter on (series, scope_cd, year).

    These two tests replace the tripwire that used to refuse every series but
    CMP. The property they assert is the one the tripwire was protecting: two
    series minting in the same year take their numbers from different rows, so
    neither register ends up full of the other's holes.
    """

    def test_each_series_starts_at_one_in_the_same_year(self, sessions):
        with sessions() as db:
            case = allocate(db, Series.CASE, year=YEAR)
            inspection = allocate(db, Series.INSPECTION, year=YEAR)
            notice = allocate(db, Series.NOTICE, year=YEAR)
            db.commit()

        assert case == "CMP-2026-0001"
        assert inspection == "INS-2026-0001"
        assert notice == "NTC-2026-0001"

    def test_one_series_advancing_does_not_move_another(self, sessions):
        """The exact defect the old tripwire existed to prevent. On the single
        counter this table used to have, minting five cases would have made the
        first inspection INS-2026-0006."""
        with sessions() as db:
            for _ in range(5):
                allocate(db, Series.CASE, year=YEAR)
            inspection = allocate(db, Series.INSPECTION, year=YEAR)
            db.commit()

        assert inspection == "INS-2026-0001"

    def test_every_series_matches_its_shared_validator(self, sessions):
        """Each format is parsed elsewhere by a tested type. A minted value one
        of them refuses is a record nobody can look up."""
        from ada_core.validation import CaseRef, InspectionRef, NoticeRef
        from pydantic import BaseModel

        class Probe(BaseModel):
            case: CaseRef
            inspection: InspectionRef
            notice: NoticeRef

        with sessions() as db:
            probe = Probe(
                case=allocate(db, Series.CASE, year=YEAR),
                inspection=allocate(db, Series.INSPECTION, year=YEAR),
                notice=allocate(db, Series.NOTICE, year=YEAR),
            )
            db.commit()

        assert probe.case.startswith("CMP-")
        assert probe.inspection.startswith("INS-")
        assert probe.notice.startswith("NTC-")

    def test_a_scoped_series_counts_separately_per_scope(self, sessions):
        """`scope_cd` is in the key so that Batch 6 can number notices per zone
        without re-keying a live table a second time."""
        with sessions() as db:
            taj = allocate(db, Series.NOTICE, year=YEAR, scope_cd="TAJ")
            cant = allocate(db, Series.NOTICE, year=YEAR, scope_cd="CANT")
            taj_again = allocate(db, Series.NOTICE, year=YEAR, scope_cd="TAJ")
            db.commit()

        assert taj == "NTC-2026-0001"
        assert cant == "NTC-2026-0001"
        assert taj_again == "NTC-2026-0002"

    def test_a_scoped_series_does_not_disturb_the_authority_wide_one(self, sessions):
        with sessions() as db:
            allocate(db, Series.NOTICE, year=YEAR, scope_cd="TAJ")
            authority_wide = allocate(db, Series.NOTICE, year=YEAR)
            db.commit()

        assert authority_wide == "NTC-2026-0001"

    def test_the_counter_rows_are_one_per_series_and_scope(self, sessions):
        from ada_core.models_icms import NoticeSequence

        with sessions() as db:
            allocate(db, Series.CASE, year=YEAR)
            allocate(db, Series.CASE, year=YEAR)
            allocate(db, Series.INSPECTION, year=YEAR)
            allocate(db, Series.NOTICE, year=YEAR, scope_cd="TAJ")
            db.commit()

            rows = db.execute(
                select(NoticeSequence.series, NoticeSequence.scope_cd,
                       NoticeSequence.year, NoticeSequence.last_seq)
                .order_by(NoticeSequence.series, NoticeSequence.scope_cd)
            ).all()

        assert rows == [
            ("CMP", "*", YEAR, 2),
            ("INS", "*", YEAR, 1),
            ("NTC", "TAJ", YEAR, 1),
        ]

    def test_concurrent_allocation_of_two_series_stays_gap_free_in_both(self, sessions):
        """Contention across series as well as within one. Both registers must
        come out complete."""
        from concurrent.futures import ThreadPoolExecutor

        def worker(series):
            def run():
                with sessions() as db:
                    reference = allocate(db, series, year=YEAR)
                    db.commit()
                    return reference
            return run

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(worker(Series.CASE if n % 2 else Series.INSPECTION))
                       for n in range(40)]
            minted = [f.result() for f in futures]

        cases = sorted(int(r.rsplit("-", 1)[1]) for r in minted if r.startswith("CMP"))
        inspections = sorted(int(r.rsplit("-", 1)[1]) for r in minted if r.startswith("INS"))

        assert cases == list(range(1, len(cases) + 1))
        assert inspections == list(range(1, len(inspections) + 1))
