"""A bounding box a request cannot widen into a table scan.

`ada_core.validation.BBox` already refuses a reversed or oversized extent. What
this adds is the cap the map reads share and one predicate that filters a
geometry column by that box on both backends the platform runs on: PostGIS holds
`icms_case.location` as `geometry(Point,4326)` and `change_polygons.geometry` as
JSONB, while SQLite holds both as GeoJSON text.

The SQLite branch tests whether any vertex falls inside the box, which is an
approximation of intersection — see `docs/icms/batch-3-contract.md`, the Batch 5
amendment, for why that is the right trade for a backend no deployment uses.
"""

from __future__ import annotations

from ada_core.validation import BBox
from sqlalchemy import Text, cast, func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

__all__ = ["MAX_SPAN_DEGREES", "dialect_of", "intersects", "parse"]

# About 110 km a side. Agra district is roughly a degree across, so this is the
# widest honest map read and a long way short of "select the state".
MAX_SPAN_DEGREES = 1.0


def parse(value: str, *, max_span_degrees: float = MAX_SPAN_DEGREES) -> BBox:
    """`west,south,east,north` in EPSG:4326; ValueError if reversed or too wide."""
    return BBox.parse(value, max_span_degrees=max_span_degrees)


def dialect_of(db: Session) -> str:
    return db.get_bind().dialect.name


# Every bound is a parameter: nothing a caller sends is rendered as SQL text.
def intersects(
    column: ColumnElement, box: BBox, *, dialect: str, geojson: bool = False
) -> ColumnElement:
    """True where the column's geometry falls inside the box, on either backend."""
    if dialect == "postgresql":
        envelope = func.ST_MakeEnvelope(box.west, box.south, box.east, box.north, 4326)
        geometry = (
            func.ST_SetSRID(func.ST_GeomFromGeoJSON(cast(column, Text)), 4326)
            if geojson
            else column
        )
        return func.ST_Intersects(geometry, envelope)
    return _any_vertex_inside(column, box)


# One json_tree walk covers Point, Polygon and MultiPolygon: the coordinate pair
# is the only two-element array in any of them.
def _any_vertex_inside(column: ColumnElement, box: BBox) -> ColumnElement:
    node = func.json_tree(column, "$.coordinates").table_valued(
        "value", "type", joins_implicitly=True
    )
    return (
        select(1)
        .select_from(node)
        .where(
            node.c.type == "array",
            func.json_array_length(node.c.value) == 2,
            func.json_extract(node.c.value, "$[0]").between(box.west, box.east),
            func.json_extract(node.c.value, "$[1]").between(box.south, box.north),
        )
        .exists()
    )
