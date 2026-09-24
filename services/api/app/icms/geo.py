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
    "parcel_at",
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


def _smallest_containing(db: Session, columns: tuple, geom: ColumnElement,
                         active: ColumnElement, latitude: float, longitude: float):
    if _dialect(db) == "postgresql":
        point = point_value(db, latitude, longitude)
        return db.execute(
            select(*columns).where(active.is_(True), func.ST_Contains(geom, point))
            .order_by(func.ST_Area(geom)).limit(1)
        ).first()

    # SQLite holds GeoJSON text and has no spatial functions: the test path, done in shapely.
    from shapely.geometry import Point, shape

    point = Point(float(longitude), float(latitude))
    hits = []
    for row in db.execute(select(*columns, geom).where(active.is_(True), geom.isnot(None))):
        polygon = shape(parse_geojson(row[-1]) or {"type": "GeometryCollection",
                                                    "geometries": []})
        if polygon.contains(point):
            hits.append((polygon.area, tuple(row[:-1])))
    return min(hits, key=lambda hit: hit[0])[1] if hits else None


def parcel_at(db: Session, latitude: float, longitude: float) -> dict:
    """Parcel, village and zone covering a point; owner_name is never read here."""
    from ada_core.models_icms import Parcel, Village, Zone

    found = {"zone_cd": None, "zone_name": None, "village_lgd": None, "village_name": None,
             "khasra_no": None, "ulpin": None, "sector": None, "plot_no": None,
             "ward": None, "source": "none"}
    parcel = _smallest_containing(
        db, (Parcel.village_lgd, Parcel.khasra_no, Parcel.ulpin, Parcel.sector,
             Parcel.sector_name, Parcel.plot_no),
        Parcel.geom, Parcel.active, latitude, longitude)
    sector = None
    if parcel is not None:
        lgd, khasra, ulpin, sector, sector_name, plot = parcel
        found.update(village_lgd=lgd, khasra_no=khasra, ulpin=ulpin,
                     sector=sector_name or sector, plot_no=plot)
        if lgd is not None:
            found["village_name"] = db.execute(
                select(Village.name).where(Village.village_lgd == lgd)).scalar_one_or_none()
    else:
        village = _smallest_containing(db, (Village.village_lgd, Village.name), Village.geom,
                                       Village.active, latitude, longitude)
        if village is not None:
            found.update(village_lgd=village[0], village_name=village[1])
    # A scheme plot's own sector zone wins over whichever zone the point falls in.
    zone = db.execute(
        select(Zone.zone_cd, Zone.name).where(Zone.zone_cd == sector, Zone.active.is_(True))
    ).first() if sector else None
    if zone is None:
        zone = _smallest_containing(db, (Zone.zone_cd, Zone.name), Zone.geom, Zone.active,
                                    latitude, longitude)
    if zone is not None:
        found.update(zone_cd=zone[0], zone_name=zone[1])
    if any(found[k] for k in ("zone_cd", "village_lgd", "khasra_no", "plot_no")):
        found["source"] = "kml"
    return found
