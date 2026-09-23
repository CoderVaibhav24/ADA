from __future__ import annotations

import json
from typing import Any

from sqlalchemy import Text, func, literal, select
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

__all__ = [
    "as_geojson_column",
    "geojson_value",
    "parse_geojson",
    "point_value",
    "to_multipolygon",
    "zone_containing",
]


def _dialect(db: Session) -> str:
    bind = db.get_bind()
    dialect: Dialect = bind.dialect
    return dialect.name


def to_multipolygon(geometry: dict) -> dict:
    if geometry.get("type") == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [geometry["coordinates"]]}
    return {"type": "MultiPolygon", "coordinates": geometry["coordinates"]}


def geojson_value(db: Session, geometry: dict | None) -> Any:
    if geometry is None:
        return None
    payload = json.dumps(to_multipolygon(geometry), separators=(",", ":"))
    if _dialect(db) == "postgresql":
        return func.ST_SetSRID(func.ST_GeomFromGeoJSON(literal(payload)), 4326)
    return payload


def as_geojson_column(db: Session, column: ColumnElement) -> ColumnElement:
    if _dialect(db) == "postgresql":
        return func.ST_AsGeoJSON(column, 7).cast(Text)
    return column


def parse_geojson(value: Any) -> dict | None:
    if value in (None, ""):
        return None
    if isinstance(value, (bytes, bytearray)):
        value = value.decode()
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, dict) else None


def point_value(db: Session, latitude: float, longitude: float) -> Any:
    if _dialect(db) == "postgresql":
        return func.ST_SetSRID(
            func.ST_MakePoint(literal(float(longitude)), literal(float(latitude))), 4326
        )
    return json.dumps(
        {"type": "Point", "coordinates": [float(longitude), float(latitude)]},
        separators=(",", ":"),
    )


def zone_containing(db: Session, latitude: float, longitude: float) -> int | None:
    if _dialect(db) != "postgresql":
        return None

    from ada_core.models_icms import Zone

    point = point_value(db, latitude, longitude)
    return db.execute(
        select(Zone.id)
        .where(func.ST_Contains(Zone.geom, point), Zone.active.is_(True))
        .order_by(Zone.id)
        .limit(1)
    ).scalar_one_or_none()
