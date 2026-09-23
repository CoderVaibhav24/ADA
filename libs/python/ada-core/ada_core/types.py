"""Column types the two backends ADA runs on do not agree about.

PostgreSQL with PostGIS is what ADA deploys against. In-memory SQLite is what
the test suites create a schema on, so that they run anywhere without a server.
Every type here renders the real PostgreSQL type in production and something
SQLite accepts in a test, from one declaration — the same trick `models.py`
already plays with `Json = JSONB().with_variant(JSON(), "sqlite")`.

## Why not GeoAlchemy2

It was tried and removed. GeoAlchemy2 registers SpatiaLite `before_create` and
`after_create` listeners for the SQLite dialect, and those fire during
`create_all` whatever the column type has been varied to:

    sqlalchemy.exc.OperationalError: (sqlite3.OperationalError)
    no such function: RecoverGeometryColumn

Suppressing its listeners is possible and fragile. What it buys is a set of
`ST_*` wrappers, and SQLAlchemy already reaches every one of those through
`sqlalchemy.func.ST_Contains(...)` with no library at all. So the dependency
bought nothing this project uses and broke the thing it most needs, which is a
test suite that runs without PostgreSQL. `pyproject.toml` says this package is
deliberately thin; twenty lines here is the cheaper side of that trade.
"""

from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import UserDefinedType

__all__ = ["Geom", "Geometry", "StringArray"]


@compiles(BigInteger, "sqlite")
def _bigint_is_integer_on_sqlite(type_, compiler, **kw) -> str:
    """Render BIGINT as INTEGER on SQLite, so a BigInteger primary key works.

    SQLite gives a column the rowid alias — and therefore auto-increment — only
    when it is declared with the exact type name INTEGER. `BIGINT PRIMARY KEY`
    is a perfectly ordinary column that happens to be the primary key, so an
    INSERT that omits it fails with:

        NOT NULL constraint failed: icms_zone.id

    Every one of the seventeen `icms_*` tables has a BigInteger primary key, so
    without this no ICMS row can be written on the backend the suites run on.
    It went unnoticed until Batch 1 because nothing had written one: the schema
    tests read metadata, and the live migration tests insert against PostgreSQL.

    Nothing is given up. SQLite's INTEGER is a variable-width signed value of up
    to eight bytes, which is the whole range of BIGINT — the rename is exact
    rather than a narrowing. PostgreSQL DDL is untouched, so the Alembic
    baseline and the autogenerate drift check see no difference at all.
    """
    return "INTEGER"


class Geometry(UserDefinedType):
    """A PostGIS geometry column, declared rather than wrapped.

    Renders `geometry(<type>,<srid>)`, which is the typed form — PostGIS then
    refuses a polygon written into a point column, and the constraint lives in
    the database instead of in whichever code path happens to write.

    One known rough edge: reflecting an existing database emits

        SAWarning: Did not recognize type 'geometry' of column 'location'

    because this registers no reflection hook, so a reflected geometry column
    comes back as NullType. Nothing ADA does depends on reflection — the models
    are the description and Alembic compares against them — and the migration
    drift check reports zero differences with the warning present. If reflection
    is ever needed for real, the fix is to add 'geometry' to the PostgreSQL
    dialect's ischema_names rather than to reach for GeoAlchemy2 again.
    """

    cache_ok = True

    def __init__(self, geometry_type: str = "GEOMETRY", srid: int = 4326) -> None:
        self.geometry_type = geometry_type
        self.srid = srid

    def get_col_spec(self, **kw: object) -> str:
        return f"geometry({self.geometry_type},{self.srid})"


def Geom(geometry_type: str, srid: int = 4326):
    """A geometry column that degrades to TEXT on SQLite.

    SRID 4326 throughout: the imagery, the MapLibre styles, the KML boundaries
    and the handsets all speak WGS 84, and a second spatial reference in the
    same schema is a reprojection somebody will eventually forget.
    """
    return Geometry(geometry_type, srid).with_variant(Text(), "sqlite")

StringArray = ARRAY(Text).with_variant(JSON(), "sqlite")