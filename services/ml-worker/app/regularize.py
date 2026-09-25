"""Raster-traced change blobs -> surveyed-looking orthogonal building footprints."""

from __future__ import annotations

import logging
import math
from collections.abc import Iterable
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import shapely
from pyproj import CRS, Transformer
from shapely import affinity
from shapely.geometry import MultiPolygon, Point, Polygon
from shapely.validation import make_valid

__all__ = ["FootprintRegularizer", "ParcelIndex", "RegularizeParams", "RegularizedFootprint",
           "regularize_footprint"]

log = logging.getLogger(__name__)

MIN_HOLE_M2 = 4.0
AREA_RATIO = (0.8, 1.25)


@dataclass(frozen=True)
class RegularizeParams:
    simplify_m: float = 0.5
    min_edge_m: float = 1.0
    parcel_snap_m: float = 0.5
    parcel_align_deg: float = 10.0
    min_iou: float = 0.75

    # Current values of the REGULARIZE_* settings.
    @classmethod
    def from_settings(cls) -> RegularizeParams:
        from .config import settings
        return cls(simplify_m=settings.regularize_simplify_m,
                   min_edge_m=settings.regularize_min_edge_m,
                   parcel_snap_m=settings.regularize_parcel_snap_m,
                   parcel_align_deg=settings.regularize_parcel_align_deg,
                   min_iou=settings.regularize_min_iou)


@dataclass(frozen=True)
class RegularizedFootprint:
    geometry: Polygon | MultiPolygon
    method: str            # "ortho" | "mrr" | "raw"
    azimuth_deg: float     # dominant axis, degrees counter-clockwise from grid east, [0, 180)
    raw_area_m2: float
    snapped_to_parcel: bool


# Minimum rotated rectangle without GEOS's divide-by-zero warning on axis-aligned input.
def _mrr(geom):
    with np.errstate(divide="ignore", invalid="ignore"):
        return geom.minimum_rotated_rectangle


# Direction of the longest edge of a polygon's minimum rotated rectangle.
def mrr_azimuth(geom) -> float:
    rect = _mrr(geom)
    if rect.geom_type != "Polygon":
        return 0.0
    xy = np.asarray(rect.exterior.coords)
    d = np.diff(xy, axis=0)
    i = int(np.argmax(np.hypot(d[:, 0], d[:, 1])))
    return math.degrees(math.atan2(d[i, 1], d[i, 0])) % 180.0


class ParcelIndex:
    """STRtree over parcel polygons (metric CRS) with cached dominant azimuths."""

    def __init__(self, geoms: Iterable):
        self.geoms = [p for p in (_polygonal(g) for g in geoms) if p is not None]
        self.tree = shapely.STRtree(self.geoms)
        self._azimuth: dict[int, float] = {}

    @classmethod
    def coerce(cls, parcels) -> ParcelIndex | None:
        if parcels is None or isinstance(parcels, ParcelIndex):
            return parcels
        if isinstance(parcels, shapely.STRtree):
            parcels = list(parcels.geometries)
        idx = cls(parcels)
        return idx if idx.geoms else None

    # Smallest parcel containing the point, or None.
    def containing(self, pt: Point) -> int | None:
        hits = self.tree.query(pt, predicate="within")
        if len(hits) == 0:
            return None
        return int(min(hits, key=lambda i: self.geoms[i].area))

    def azimuth(self, i: int) -> float:
        if i not in self._azimuth:
            self._azimuth[i] = mrr_azimuth(self.geoms[i])
        return self._azimuth[i]


# Polygonal part of a repaired geometry, or None when nothing areal is left.
def _polygonal(geom):
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [p for g in getattr(geom, "geoms", [])
             for p in (g.geoms if g.geom_type == "MultiPolygon" else [g])
             if p.geom_type == "Polygon" and not p.is_empty]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def _iou(a, b) -> float:
    union = a.union(b).area
    return a.intersection(b).area / union if union > 0 else 0.0


# Axis-aligned staircase ring from a ring already rotated into its dominant frame.
def _orthogonal_ring(xy: np.ndarray, min_edge_m: float) -> np.ndarray | None:
    if len(xy) < 4:
        return None
    pts = xy[:-1] if np.allclose(xy[0], xy[-1]) else xy
    nxt = np.roll(pts, -1, axis=0)
    d = nxt - pts
    length = np.hypot(d[:, 0], d[:, 1])
    keep = length > 1e-9
    pts, nxt, d, length = pts[keep], nxt[keep], d[keep], length[keep]
    if len(pts) < 3:
        return None
    cls = (np.abs(d[:, 1]) > np.abs(d[:, 0])).astype(int)  # 0 along-axis (horizontal), 1 cross
    mid = (pts + nxt) / 2.0
    # Start at a class change so no run wraps around the list end.
    change = np.nonzero(cls != np.roll(cls, 1))[0]
    if len(change) == 0:
        return None
    order = np.roll(np.arange(len(cls)), -int(change[0]))
    # Run = [class, length-weighted coordinate sum, length, net displacement along the axis].
    runs: list[list[float]] = []
    for i in order:
        c = int(cls[i])
        coord = mid[i, 1] if c == 0 else mid[i, 0]
        step = d[i, 0] if c == 0 else d[i, 1]
        if runs and runs[-1][0] == c:
            runs[-1][1] += coord * length[i]
            runs[-1][2] += length[i]
            runs[-1][3] += step
        else:
            runs.append([c, coord * length[i], float(length[i]), float(step)])
    # Drop the run with the smallest net span below min_edge_m and fuse its neighbours.
    while len(runs) > 4:
        j = min(range(len(runs)), key=lambda k: abs(runs[k][3]))
        if abs(runs[j][3]) >= min_edge_m:
            break
        n = len(runs)
        a, b = (j - 1) % n, (j + 1) % n
        runs[a] = [runs[a][0], runs[a][1] + runs[b][1], runs[a][2] + runs[b][2],
                   runs[a][3] + runs[b][3]]
        for k in sorted({j, b}, reverse=True):
            del runs[k]
    if len(runs) < 4 or len(runs) % 2:
        return None
    vals = [r[1] / r[2] for r in runs]
    out = []
    for k, r in enumerate(runs):
        nv = vals[(k + 1) % len(runs)]
        out.append((nv, vals[k]) if r[0] == 0 else (vals[k], nv))
    out.append(out[0])
    return np.asarray(out)


# Orthogonalised polygon in the rotated frame, or None when the result is unusable.
def _orthogonalise(rot: Polygon, raw_area: float, params: RegularizeParams) -> Polygon | None:
    simple = rot.simplify(params.simplify_m, preserve_topology=True)
    if simple.is_empty or simple.geom_type != "Polygon":
        return None
    ring = _orthogonal_ring(np.asarray(simple.exterior.coords), params.min_edge_m)
    if ring is None:
        return None
    shell = Polygon(ring).simplify(0)
    if (shell.is_empty or shell.geom_type != "Polygon" or not shell.is_valid
            or len(shell.exterior.coords) - 1 < 4):
        return None
    holes = []
    for interior in simple.interiors:
        hole = Polygon(interior)
        if hole.area < MIN_HOLE_M2:
            continue
        hr = _orthogonal_ring(np.asarray(hole.exterior.coords), params.min_edge_m)
        hp = Polygon(hr).simplify(0) if hr is not None else None
        if hp is None or not hp.is_valid or hp.is_empty or hp.geom_type != "Polygon":
            hp = hole.envelope
        if hp.geom_type == "Polygon" and hp.within(shell):
            holes.append(hp.exterior.coords)
    out = Polygon(shell.exterior.coords, holes) if holes else shell
    if holes and not out.is_valid:
        out = shell
    if not AREA_RATIO[0] * raw_area <= out.area <= AREA_RATIO[1] * raw_area:
        return None
    if _iou(out, simple) < params.min_iou:
        return None
    return out


def _largest(geom) -> Polygon | None:
    if geom.geom_type == "Polygon":
        return None if geom.is_empty else geom
    parts = [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon" and not g.is_empty]
    if not parts and hasattr(geom, "geoms"):
        parts = [p for g in geom.geoms if isinstance(g, MultiPolygon) for p in g.geoms]
    return max(parts, key=lambda g: g.area) if parts else None


# Clip to the parcel when the overshoot is under snap_m; larger overshoot is kept as encroachment.
def _snap(geom: Polygon, parcel, snap_m: float) -> tuple[Polygon, bool]:
    over = geom.difference(parcel)
    if over.is_empty or over.area < 1e-6:
        return geom, False
    dense = shapely.segmentize(over, max(snap_m / 4.0, 0.05))
    xy = shapely.get_coordinates(dense)
    reach = float(shapely.distance(parcel.boundary, shapely.points(xy)).max())
    if reach >= snap_m:
        return geom, False
    clipped = _largest(make_valid(geom.intersection(parcel)))
    if clipped is None or clipped.area < geom.area - over.area - 1e-6:
        return geom, False
    return clipped, True


def _regularize_metric(poly, parcels: ParcelIndex | None,
                       params: RegularizeParams) -> RegularizedFootprint:
    if poly.geom_type == "MultiPolygon":
        return _regularize_parts(poly, parcels, params)
    raw_area = float(poly.area)
    parcel_i = None
    if parcels is not None:
        parcel_i = parcels.containing(poly.representative_point())
    own_az = mrr_azimuth(poly)
    az = own_az
    if parcel_i is not None:
        parcel_az = parcels.azimuth(parcel_i)
        d = (parcel_az - own_az) % 90.0
        if min(d, 90.0 - d) <= params.parcel_align_deg:
            az = parcel_az
    origin = poly.centroid
    ortho = _orthogonalise(affinity.rotate(poly, -az, origin=origin), raw_area, params)
    if ortho is not None:
        geom, method = affinity.rotate(ortho, az, origin=origin), "ortho"
    else:
        geom, method, az = _mrr(poly), "mrr", own_az
        if geom.geom_type != "Polygon" or geom.area > AREA_RATIO[1] * raw_area:
            return RegularizedFootprint(poly, "raw", round(own_az, 2), raw_area, False)
    snapped = False
    if parcel_i is not None:
        geom, snapped = _snap(geom, parcels.geoms[parcel_i], params.parcel_snap_m)
    geom = _largest(make_valid(geom))
    if geom is None:
        return RegularizedFootprint(poly, "raw", round(own_az, 2), raw_area, False)
    return RegularizedFootprint(geom, method, round(az % 180.0, 2), raw_area, snapped)


# Each part on its own; one raw part returns the whole input raw.
def _regularize_parts(multi: MultiPolygon, parcels: ParcelIndex | None,
                      params: RegularizeParams) -> RegularizedFootprint:
    raw_area = float(multi.area)
    outs = [_regularize_metric(p, parcels, params) for p in multi.geoms if not p.is_empty]
    biggest = max(multi.geoms, key=lambda g: g.area)
    if not outs or any(o.method == "raw" for o in outs):
        return RegularizedFootprint(multi, "raw", round(mrr_azimuth(biggest), 2), raw_area,
                                    False)
    geom = _polygonal(MultiPolygon([o.geometry for o in outs]))
    if geom is None or not geom.is_valid:
        return RegularizedFootprint(multi, "raw", round(mrr_azimuth(biggest), 2), raw_area,
                                    False)
    lead = max(outs, key=lambda o: o.raw_area_m2)
    method = "ortho" if all(o.method == "ortho" for o in outs) else "mrr"
    return RegularizedFootprint(geom, method, lead.azimuth_deg, raw_area,
                                any(o.snapped_to_parcel for o in outs))


def _utm_epsg(lon: float, lat: float) -> int:
    zone = min(60, max(1, int(math.floor((lon + 180.0) / 6.0)) + 1))
    return (32600 if lat >= 0 else 32700) + zone


@lru_cache(maxsize=32)
def _transformers(crs_wkt: str, epsg: int) -> tuple[Transformer, Transformer]:
    src, dst = CRS.from_wkt(crs_wkt), CRS.from_epsg(epsg)
    return (Transformer.from_crs(src, dst, always_xy=True),
            Transformer.from_crs(dst, src, always_xy=True))


def _apply(tr: Transformer, geom):
    def fn(xy: np.ndarray) -> np.ndarray:
        x, y = tr.transform(xy[:, 0], xy[:, 1])
        return np.column_stack([x, y])
    return shapely.transform(geom, fn)


class FootprintRegularizer:
    """Regularises many polygons in one CRS; transformers and the parcel tree are built once."""

    def __init__(self, crs, parcels: Iterable | None = None,
                 params: RegularizeParams | None = None, *,
                 ref_lonlat: tuple[float, float] | None = None):
        self.params = params or RegularizeParams()
        crs = CRS.from_user_input(crs)
        self._fwd = self._inv = None
        geoms = list(parcels.geometries) if isinstance(parcels, shapely.STRtree) else (
            list(parcels) if parcels is not None else [])
        if crs.is_geographic:
            if ref_lonlat is None:
                sample = geoms[0] if geoms else None
                ref_lonlat = (sample.centroid.x, sample.centroid.y) if sample else None
            self._crs_wkt = crs.to_wkt()
            if ref_lonlat is not None:
                self._set_zone(*ref_lonlat)
        geoms = [_apply(self._fwd, g) for g in geoms] if self._fwd else geoms
        self.parcels = ParcelIndex.coerce(geoms) if geoms else None
        self._geographic = crs.is_geographic

    def _set_zone(self, lon: float, lat: float) -> None:
        self._fwd, self._inv = _transformers(self._crs_wkt, _utm_epsg(lon, lat))

    def __call__(self, poly: Polygon) -> RegularizedFootprint:
        if self._geographic and self._fwd is None:
            c = poly.centroid
            self._set_zone(c.x, c.y)
        metric = _apply(self._fwd, poly) if self._fwd else poly
        try:
            out = _regularize_metric(metric, self.parcels, self.params)
        except Exception:
            log.debug("regularize: kept the raw outline", exc_info=True)
            return RegularizedFootprint(poly, "raw", 0.0, float(metric.area), False)
        if self._inv is None:
            return out
        return RegularizedFootprint(_apply(self._inv, out.geometry), out.method,
                                    out.azimuth_deg, out.raw_area_m2, out.snapped_to_parcel)


def regularize_footprint(poly: Polygon, *, parcels=None, params: RegularizeParams | None = None,
                         crs=None) -> RegularizedFootprint:
    """One footprint; `poly` and `parcels` share `crs` (metric when None)."""
    params = params or RegularizeParams()
    if crs is None or not CRS.from_user_input(crs).is_geographic:
        try:
            return _regularize_metric(poly, ParcelIndex.coerce(parcels), params)
        except Exception:
            log.debug("regularize: kept the raw outline", exc_info=True)
            return RegularizedFootprint(poly, "raw", 0.0, float(poly.area), False)
    c = poly.centroid
    return FootprintRegularizer(crs, parcels, params, ref_lonlat=(c.x, c.y))(poly)
