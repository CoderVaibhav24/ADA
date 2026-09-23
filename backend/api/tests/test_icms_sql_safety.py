"""What the suite cannot prove by running: the PostgreSQL branch, and binding.

Two things the SQLite suites above cannot reach.

The first is the PostGIS half of `app/icms/geo.py`. A geometry is written with
`ST_GeomFromGeoJSON` and read with `ST_AsGeoJSON` on the server and neither
exists on SQLite, so those branches are never executed by the tests that create
a zone. They are compiled here against the PostgreSQL dialect instead, which
needs no server and no driver.

The second is the claim that nothing is concatenated. It is easy to assert in a
comment and easy to break later, so it is asserted against the compiled SQL:
the caller's value must appear in the parameters and NOT in the statement text.
This is the property the legacy routes do not have — `complain.js` builds
`zone_cd in (${obj.zone_cd.join(',')})`, which is injectable by anybody who can
post a complaint.
"""

from __future__ import annotations

import json

from ada_core.models_icms import Zone
from sqlalchemy import insert, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app.icms.geo import as_geojson_column, geojson_value, parse_geojson, to_multipolygon

PG = postgresql.dialect()
RING = [[78.0, 27.0], [78.1, 27.0], [78.1, 27.1], [78.0, 27.0]]
POLYGON = {"type": "Polygon", "coordinates": [RING]}


class FakeSession:
    """Just enough session for `geo.py`, which asks only for the dialect name."""

    def __init__(self, name: str) -> None:
        self._bind = type("Bind", (), {"dialect": type("D", (), {"name": name})()})()

    def get_bind(self):
        return self._bind


def compiled(statement, dialect=PG):
    return statement.compile(dialect=dialect)


def _revision_source() -> str:
    """Revision 0002, read as text.

    Asserting against the source rather than against a live database is the only
    option here — the suites have no PostgreSQL — and it is worth being clear
    that it proves the revision SAYS the right thing, not that PostgreSQL did
    it. The live migration suite is what proves the second half, and it needs a
    server."""
    from pathlib import Path

    return (
        Path(__file__).resolve().parents[2]
        / "shared/ada-core/ada_core/alembic/versions"
        / "0002_parcel_priority_and_series.py"
    ).read_text()


class TestGeometryOnPostgres:
    def test_a_boundary_is_written_through_st_geomfromgeojson(self):
        value = geojson_value(FakeSession("postgresql"), POLYGON)
        sql = compiled(insert(Zone).values(zone_cd="Z", name="Z", geom=value))

        assert "ST_GeomFromGeoJSON" in str(sql)
        assert "ST_SetSRID" in str(sql), "a column typed 4326 refuses SRID 0"

    def test_the_geojson_is_a_bound_parameter_and_not_text(self):
        """The whole point. A polygon interpolated into the statement is the
        legacy defect with a different data type."""
        value = geojson_value(FakeSession("postgresql"), POLYGON)
        sql = compiled(insert(Zone).values(zone_cd="Z", name="Z", geom=value))

        assert "78.1" not in str(sql)
        assert any(
            isinstance(v, str) and "MultiPolygon" in v for v in sql.params.values()
        )

    def test_a_polygon_is_stored_as_the_multipolygon_the_column_declares(self):
        assert to_multipolygon(POLYGON) == {
            "type": "MultiPolygon", "coordinates": [[RING]]}

    def test_a_multipolygon_passes_through_unchanged(self):
        multi = {"type": "MultiPolygon", "coordinates": [[RING]]}

        assert to_multipolygon(multi) == multi

    def test_a_boundary_is_read_back_through_st_asgeojson(self):
        column = as_geojson_column(FakeSession("postgresql"), Zone.geom)
        sql = str(compiled(select(column)))

        assert "ST_AsGeoJSON" in sql

    def test_sqlite_uses_the_column_itself(self):
        """The TEXT variant holds the GeoJSON, so no function is involved."""
        column = as_geojson_column(FakeSession("sqlite"), Zone.geom)

        assert "ST_AsGeoJSON" not in str(compiled(select(column), None))

    def test_what_postgres_returns_parses(self):
        returned = json.dumps({"type": "MultiPolygon", "coordinates": [[RING]]})

        assert parse_geojson(returned)["type"] == "MultiPolygon"

    def test_a_null_boundary_is_none_rather_than_a_failure(self):
        assert parse_geojson(None) is None
        assert parse_geojson("") is None

    def test_an_unreadable_value_is_none_rather_than_a_crash(self):
        """A 500 on a list of zones because one boundary is malformed would take
        the whole register down for one bad row."""
        assert parse_geojson("not json at all") is None


class TestNothingIsConcatenated:
    def test_a_code_filter_binds_its_values(self):
        from app.icms.repository import _ZONE_COLUMNS

        hostile = "TAJ') OR 1=1 --"
        sql = compiled(select(*_ZONE_COLUMNS).where(Zone.zone_cd.in_(["TAJ", hostile])))

        assert hostile not in str(sql)
        # An IN list compiles to one expanding parameter, so the values arrive
        # as a list under a single key rather than as one key each.
        assert sql.params["zone_cd_1"] == ["TAJ", hostile]

    def test_a_search_term_binds_and_escapes(self):
        from app.icms.collection import search_clause

        sql = compiled(select(Zone.id).where(search_clause("100%_x", [Zone.name])))

        assert "100%" not in str(sql)
        # escape_like has made the wildcards literal in the bound pattern.
        assert any("100\\%\\_x" in str(v) for v in sql.params.values())

    def test_an_update_carries_its_where_guard(self):
        """`icms_zone` updates are keyed on zone_cd. An UPDATE with no WHERE is
        the defect that renames every zone at once."""
        from sqlalchemy import update

        sql = str(compiled(update(Zone).where(Zone.zone_cd == "TAJ").values(name="X")))

        assert "WHERE" in sql


class TestCaseGeometryOnPostgres:
    def test_a_location_is_written_through_st_makepoint(self):
        from ada_core.models_icms import Case

        from app.icms.geo import point_value

        value = point_value(FakeSession("postgresql"), 27.1751, 78.0421)
        sql = compiled(insert(Case).values(
            case_ref="CMP-2026-0001", zone_id=1, source="public", location=value))

        assert "ST_MakePoint" in str(sql)
        assert "ST_SetSRID" in str(sql)

    def test_the_coordinates_are_bound_and_in_lon_lat_order(self):
        """`ST_MakePoint(x, y)` is easting then northing, which is longitude
        then latitude — the opposite of the order every officer says out loud."""
        from ada_core.models_icms import Case

        from app.icms.geo import point_value

        value = point_value(FakeSession("postgresql"), 27.1751, 78.0421)
        sql = compiled(insert(Case).values(
            case_ref="CMP-2026-0001", zone_id=1, source="public", location=value))
        bound = [v for v in sql.params.values() if isinstance(v, float)]

        assert "78.0421" not in str(sql)
        assert bound == [78.0421, 27.1751]

    def test_sqlite_stores_a_point_as_geojson(self):
        import json

        from app.icms.geo import point_value

        stored = json.loads(point_value(FakeSession("sqlite"), 27.1751, 78.0421))

        assert stored == {"type": "Point", "coordinates": [78.0421, 27.1751]}

    def test_zone_resolution_is_unavailable_without_postgis(self):
        """SQLite has no spatial predicates, so the caller must fall back to an
        explicit zone_cd. Returning None rather than guessing is the honest
        failure; the legacy system did containment in JavaScript instead."""
        from app.icms.geo import zone_containing

        assert zone_containing(FakeSession("sqlite"), 27.1, 78.0) is None


class TestRegisterQueryIsBound:
    def test_the_search_term_never_reaches_the_statement(self):
        from ada_core.models_icms import Case

        from app.icms.collection import search_clause

        hostile = "x' OR '1'='1"
        sql = compiled(select(Case.id).where(
            search_clause(hostile, [Case.property_address, Case.complainant_name])))

        assert hostile not in str(sql)

    def test_a_status_filter_binds_its_values(self):
        from ada_core.models_icms import Case

        sql = compiled(select(Case.id).where(Case.status.in_(["raised", "assigned"])))

        assert "raised" not in str(sql)
        assert sql.params["status_1"] == ["raised", "assigned"]

    def test_the_date_bounds_are_anchored_in_indian_time(self):
        """A complaint filed at 05:00 IST on the first of a month is 23:30 UTC on
        the last of the previous one. A month filter anchored in UTC reports it
        in the wrong month and the annual return is what finds out."""
        from datetime import date

        from app.icms.cases import _day_bounds

        low, high = _day_bounds(date(2026, 9, 10), date(2026, 9, 10))

        assert low.utcoffset().total_seconds() == 5.5 * 3600
        assert (high - low).total_seconds() == 24 * 3600

    def test_an_open_date_range_leaves_the_bound_unset(self):
        from datetime import date

        from app.icms.cases import _day_bounds

        low, high = _day_bounds(date(2026, 9, 10), None)

        assert high is None and low is not None


class TestRevision0002OnPostgres:
    """The DDL and the statements revision 0002 makes possible, compiled against
    the PostgreSQL dialect. The suites run on SQLite, so this is the only place
    the real backend's rendering is checked without a server."""

    def test_the_case_table_declares_the_parcel_columns(self):
        from ada_core.models_icms import Case

        ddl = str(CreateTable(Case.__table__).compile(dialect=PG))

        assert "ulpin VARCHAR(14)" in ddl
        assert "khasra_no VARCHAR(24)" in ddl
        assert "village_lgd_code VARCHAR(12)" in ddl
        assert "district_lgd_code VARCHAR(12)" in ddl
        assert "priority VARCHAR(10)" in ddl
        assert "idempotency_key VARCHAR(36)" in ddl

    def test_the_priority_check_is_the_closed_vocabulary(self):
        from ada_core.models_icms import CASE_PRIORITIES, Case

        ddl = str(CreateTable(Case.__table__).compile(dialect=PG))

        assert "icms_case_priority_ck" in ddl
        for value in CASE_PRIORITIES:
            assert f"'{value}'" in ddl

    def test_the_ulpin_check_is_portable_across_both_backends(self):
        """`~` is a PostgreSQL operator and SQLite would refuse the CREATE
        TABLE. `length()` is understood by both, and the alphanumeric half of
        the rule lives in ada_core.validation.ULPIN instead."""
        from ada_core.models_icms import Case
        from sqlalchemy.dialects import sqlite

        for dialect in (PG, sqlite.dialect()):
            ddl = str(CreateTable(Case.__table__).compile(dialect=dialect))
            assert "length(ulpin) = 14" in ddl
            assert "~" not in ddl

    def test_the_retry_key_is_unique(self):
        """A named unique INDEX, not an inline UNIQUE constraint. The column
        arrives by ALTER in revision 0002, where an index is the only mechanism;
        declaring it the same way in the model is what stops `_refuse_on_drift`
        seeing a constraint in the metadata and an index in the catalogue."""
        from ada_core.models_icms import Case
        from sqlalchemy.schema import CreateIndex

        ddl = str(CreateTable(Case.__table__).compile(dialect=PG))
        indexes = {
            ix.name: str(CreateIndex(ix).compile(dialect=PG))
            for ix in Case.__table__.indexes
        }

        assert "UNIQUE (idempotency_key)" not in ddl
        assert "CREATE UNIQUE INDEX uq_icms_case_idempotency" in (
            indexes["uq_icms_case_idempotency"])

    def test_the_model_emits_exactly_what_the_revision_emits(self):
        """The two have to agree or the adoption path's drift check refuses to
        stamp. Compared as strings, because that is what the catalogue sees."""
        from ada_core.models_icms import Case
        from sqlalchemy.schema import CreateIndex

        revision = _revision_source()

        for name in ("ix_icms_case_type", "ix_icms_case_priority",
                     "ix_icms_case_parcel", "ix_icms_case_ulpin",
                     "uq_icms_case_idempotency"):
            index = next(ix for ix in Case.__table__.indexes if ix.name == name)
            emitted = str(CreateIndex(index).compile(dialect=PG)).strip()
            # The revision writes `IF NOT EXISTS`; the model cannot. Compare the
            # part after it.
            body = emitted.split(name, 1)[1].strip()
            assert body in revision.replace("\n        ", " "), name

    def test_the_counter_is_keyed_on_series_scope_and_year(self):
        from ada_core.models_icms import NoticeSequence

        ddl = str(CreateTable(NoticeSequence.__table__).compile(dialect=PG))

        assert "PRIMARY KEY (series, scope_cd, year)" in ddl

    def test_the_counter_defaults_read_existing_rows_correctly(self):
        """Every row already in the table is a CMP counter and authority-wide,
        because Batch 2 is the only code that has ever minted anything. The
        defaults say so without a data rewrite."""
        from ada_core.models_icms import NoticeSequence

        ddl = str(CreateTable(NoticeSequence.__table__).compile(dialect=PG))

        assert "DEFAULT 'CMP'" in ddl
        assert "DEFAULT '*'" in ddl

    def test_the_allocator_binds_the_series_and_scope(self):
        from ada_core.models_icms import NoticeSequence
        from sqlalchemy import update

        sql = compiled(
            update(NoticeSequence)
            .where(
                NoticeSequence.series == "NTC",
                NoticeSequence.scope_cd == "TAJ",
                NoticeSequence.year == 2026,
            )
            .values(last_seq=NoticeSequence.last_seq + 1)
            .returning(NoticeSequence.last_seq)
        )

        assert "'NTC'" not in str(sql)
        assert "RETURNING" in str(sql)
        # The increment is computed by the database, never read into Python and
        # written back — that is the whole concurrency property.
        assert "last_seq + " in str(sql)

    def test_the_priority_sort_is_an_urgency_expression(self):
        from app.icms.cases import _PRIORITY_ORDER

        sql = str(_PRIORITY_ORDER.compile(dialect=PG))

        assert "CASE" in sql and "WHEN" in sql


class TestTheYearColumnIsNotASerial:
    """`icms_notice_sequence.year` holds a calendar year, not a generated key.

    Revision 0001 declared it as the lone integer primary key, so SQLAlchemy
    promoted `sa.SmallInteger()` to SMALLSERIAL and PostgreSQL attached a
    sequence and a `DEFAULT nextval(...)`. Re-keying the primary key in 0002
    does not remove a column default, so 0002 has to disarm it explicitly.

    These tests are the guard on all three halves of that: what 0001 did, what
    the model says now, and that 0002 reconciles them.
    """

    def test_the_baseline_really_did_emit_a_serial(self):
        """Documents the defect rather than trusting the report of it. If this
        ever fails, somebody has edited 0001 after it shipped — which is the one
        thing a frozen baseline must not have done to it."""
        import sqlalchemy as sa

        metadata = sa.MetaData()
        as_0001_declared_it = sa.Table(
            "icms_notice_sequence", metadata,
            sa.Column("year", sa.SmallInteger(), nullable=False),
            sa.Column("last_seq", sa.Integer(), server_default=sa.text("0"),
                      nullable=False),
            sa.PrimaryKeyConstraint("year"),
        )

        ddl = str(CreateTable(as_0001_declared_it).compile(dialect=PG))

        assert "year SMALLSERIAL" in ddl

    def test_the_model_now_renders_a_plain_smallint(self):
        """With a composite primary key SQLAlchemy promotes nothing, so the
        model and a post-0002 database agree — which is what keeps
        `ada_core.migrate._refuse_on_drift` from refusing to stamp."""
        from ada_core.models_icms import NoticeSequence

        ddl = str(CreateTable(NoticeSequence.__table__).compile(dialect=PG))

        assert "year SMALLINT NOT NULL" in ddl
        assert "SMALLSERIAL" not in ddl
        assert "nextval" not in ddl

    def test_the_column_declares_no_default_at_all(self):
        from ada_core.models_icms import NoticeSequence

        year = NoticeSequence.__table__.c.year

        assert year.server_default is None
        assert year.default is None

    def test_the_revision_drops_the_default_before_the_sequence(self):
        """`DROP SEQUENCE` fails while the column default still depends on it,
        so the order is load-bearing rather than tidy."""
        revision = _revision_source()

        drop_default = revision.index("ALTER COLUMN year DROP DEFAULT")
        drop_sequence = revision.index("DROP SEQUENCE IF EXISTS")

        assert drop_default < drop_sequence

    def test_the_revision_looks_the_sequence_name_up_rather_than_assuming_it(self):
        """PostgreSQL derives `<table>_<column>_seq`, but a database built some
        other way may have no sequence on this column at all."""
        revision = _revision_source()

        assert "pg_get_serial_sequence('icms_notice_sequence', 'year')" in revision
        assert "IF owned_sequence IS NOT NULL THEN" in revision

        # Only the executable lines. The derived name is named in a comment on
        # purpose — a reader should know what it will be — but it must not be
        # what the statement depends on.
        code = "\n".join(
            line for line in revision.splitlines()
            if not line.lstrip().startswith("#")
        )
        assert "icms_notice_sequence_year_seq" not in code, (
            "the name must be looked up, not hardcoded")

    def test_the_downgrade_says_plainly_that_this_does_not_round_trip(self):
        """Restoring the SMALLSERIAL would restore the defect. The revision is
        allowed not to reverse it — it is not allowed to be quiet about that."""
        revision = _revision_source()
        downgrade = revision[revision.index("def downgrade()"):]

        assert "does not round-trip" in downgrade
        assert "nextval" not in downgrade.split('"""')[2], (
            "the downgrade body must not re-arm the sequence")


class TestTheInspectionQueriesAreBound:
    """Batch 3's half of the same claim: nothing in `app/icms/inspections.py`
    reaches SQL as text, and no UPDATE in it goes out without a WHERE."""

    def test_a_status_filter_binds_its_values(self):
        from ada_core.models_icms import Inspection

        hostile = "submitted') OR 1=1 --"
        sql = compiled(select(Inspection.id).where(
            Inspection.status.in_(["scheduled", hostile])))

        assert hostile not in str(sql)
        assert sql.params["status_1"] == ["scheduled", hostile]

    def test_the_register_search_term_never_reaches_the_statement(self):
        from ada_core.models_icms import Case, Inspection

        from app.icms.collection import search_clause

        hostile = "INS-2026-0001' OR '1'='1"
        sql = compiled(select(Inspection.id).where(
            search_clause(hostile, [Inspection.inspection_ref, Case.case_ref])))

        assert hostile not in str(sql)

    def test_a_check_in_writes_its_point_through_st_makepoint(self):
        from ada_core.models_icms import CheckIn

        from app.icms.geo import point_value

        value = point_value(FakeSession("postgresql"), 27.1751, 78.0421)
        sql = compiled(insert(CheckIn).values(
            inspection_id=1, user_id="u", location=value, accuracy_m=6.0,
            idempotency_key="k"))

        assert "ST_MakePoint" in str(sql)
        assert "78.0421" not in str(sql)
        # x then y: longitude then latitude, the opposite of how it is said aloud.
        assert [v for v in sql.params.values() if isinstance(v, float)][:2] == [
            78.0421, 27.1751]

    def test_the_inside_zone_test_is_a_bound_st_contains(self):
        """The check-in's `inside_zone`. On SQLite there is no spatial predicate
        and the column stays NULL, which is the honest answer rather than a guess."""
        from ada_core.models_icms import Zone
        from sqlalchemy import func

        from app.icms.geo import point_value

        point = point_value(FakeSession("postgresql"), 27.1751, 78.0421)
        sql = compiled(select(func.ST_Contains(Zone.geom, point)).where(Zone.id == 1))

        assert "ST_Contains" in str(sql)
        assert "78.0421" not in str(sql)

    def test_every_update_in_the_module_carries_a_where_guard(self):
        """An UPDATE with no WHERE is the defect that submits every inspection in
        the district at once. Asserted over the source, because the guard being
        present on the statements this suite happens to compile proves nothing
        about the one somebody adds next month."""
        from pathlib import Path

        source = (
            Path(__file__).resolve().parents[1] / "app/icms/inspections.py"
        ).read_text()

        fragments = source.split("update(")[1:]
        assert fragments, "no UPDATE found; this test is checking the wrong file"
        for fragment in fragments:
            assert ".where(" in fragment[:400], (
                "an UPDATE in app/icms/inspections.py has no WHERE clause near it")

    def test_the_submitted_date_bounds_are_anchored_in_indian_time(self):
        from datetime import date

        from app.icms.inspections import _day_bounds

        low, high = _day_bounds(date(2026, 9, 20), date(2026, 9, 20))

        assert low.utcoffset().total_seconds() == 5.5 * 3600
        assert (high - low).total_seconds() == 24 * 3600

    def test_the_sort_whitelist_is_the_one_the_contract_publishes(self):
        """The column name reaches ORDER BY, so the whitelist is the whole
        defence — and the portal builds its column headers from this list."""
        from app.icms.inspections import INSPECTION_SORTS

        assert INSPECTION_SORTS.keys == [
            "case_ref", "inspection_ref", "round_no", "scheduled_for", "started_at",
            "status", "submitted_at", "surveyor_user_id", "zone_cd",
        ]
        assert INSPECTION_SORTS.default == "-inspection_ref"

    def test_the_stored_evidence_path_cannot_escape_the_evidence_root(self):
        """`storage_path` is ours and relative, but the join that resolves it is
        one comparison away from serving any file the process can read."""
        from app.icms.inspections import _resolve_stored

        assert _resolve_stored("../../etc/passwd") is None
        assert _resolve_stored("/etc/passwd") is None
        assert _resolve_stored("") is None
        assert _resolve_stored("CMP-2026-0001/abc.jpg") is not None


class TestTheBoundingBoxOnBothBackends:
    """Batch 5's map reads. The PostGIS branch of `app/bbox.py` is never executed
    by these suites — SQLite has no spatial predicates — so it is compiled here,
    and both branches are checked for the property the legacy map read lacks:
    the caller's four numbers are parameters, not statement text."""

    from app import bbox as _bbox

    BOX = _bbox.parse("78.0,27.0,78.02,27.02")

    def test_a_geometry_column_is_filtered_with_st_intersects(self):
        from ada_core.models_icms import Case

        from app.bbox import intersects

        sql = str(compiled(select(Case.id).where(
            intersects(Case.location, self.BOX, dialect="postgresql"))))

        assert "ST_Intersects" in sql
        assert "ST_MakeEnvelope" in sql

    def test_a_geojson_column_is_read_through_st_geomfromgeojson(self):
        """`change_polygons.geometry` is JSONB, not a geometry column, so the
        polygon has to be parsed before PostGIS can be asked about it."""
        from ada_core.models import ChangePolygon

        from app.bbox import intersects

        sql = str(compiled(select(ChangePolygon.id).where(
            intersects(ChangePolygon.geometry, self.BOX, dialect="postgresql",
                       geojson=True))))

        assert "ST_GeomFromGeoJSON" in sql
        assert "ST_SetSRID" in sql, "a 4326 envelope will not meet an SRID 0 geometry"

    def test_the_extent_is_bound_and_never_interpolated(self):
        """The legacy map read is `WHERE zone_cd=${SqlString.escape(...)}` with no
        extent at all; the defect this replaces is the same defect either way."""
        from ada_core.models_icms import Case

        from app.bbox import intersects

        for dialect in ("postgresql", "sqlite"):
            sql = compiled(
                select(Case.id).where(intersects(Case.location, self.BOX, dialect=dialect)),
                PG if dialect == "postgresql" else None)
            bound = [v for v in sql.params.values() if isinstance(v, float)]

            assert "78.02" not in str(sql), dialect
            assert 78.02 in bound and 27.02 in bound, dialect

    def test_sqlite_walks_the_coordinates_rather_than_pretending_to_have_postgis(self):
        from ada_core.models_icms import Case

        from app.bbox import intersects

        sql = str(compiled(
            select(Case.id).where(intersects(Case.location, self.BOX, dialect="sqlite")),
            None))

        assert "json_tree" in sql
        assert "ST_" not in sql

    def test_an_extent_wider_than_the_cap_is_refused_before_any_sql_exists(self):
        import pytest

        from app.bbox import MAX_SPAN_DEGREES, parse

        assert MAX_SPAN_DEGREES <= 1.0, "a wider cap is a district scan with coordinates"
        with pytest.raises(ValueError):
            parse("70.0,20.0,80.0,30.0")

    def test_the_trend_bucket_binds_its_unit(self):
        """`date_trunc('month', ...)` with the unit interpolated would be one
        request value in the SQL text, which is the whole rule."""
        from ada_core.models_icms import Case

        from app.icms.dashboard import _bucket_column

        column = _bucket_column(FakeSession("postgresql"), Case.raised_at, "month")
        sql = compiled(select(column))

        assert "month" not in str(sql)
        assert "month" in sql.params.values()
        assert "Asia/Kolkata" in sql.params.values(), "buckets are IST days, not UTC ones"
