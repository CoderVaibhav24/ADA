"""Change mask -> classified GeoJSON polygons.

Thresholds the probability map, drops speckle smaller than
MIN_CHANGE_AREA_M2, vectorizes the remaining regions, and classifies
each polygon:
  - inside a user-defined red zone  -> "illegal" (encroachment)
  - otherwise a heuristic change type from the T1->T2 brightness delta.
"""

from __future__ import annotations

import math

import numpy as np
import pyproj
import rasterio.features
from rasterio.transform import Affine
from scipy import ndimage
from shapely.geometry import Polygon as ShapelyPolygon, mapping, shape
from shapely.ops import transform as shp_transform, unary_union

from ..config import settings

_GEOD = pyproj.Geod(ellps="WGS84")


def _change_type(t1: np.ndarray, t2: np.ndarray, region: np.ndarray) -> tuple[str, float]:
    """Heuristic label from the brightness delta inside the region."""
    if not region.any():
        return "Surface change", 0.0
    delta = float(t2[region].mean() - t1[region].mean())
    if delta > 12:
        return "New construction", delta
    if delta < -12:
        return "Demolition / cleared land", delta
    return "Surface change", delta


def extract_polygons(
    prob: np.ndarray,
    valid: np.ndarray,
    t1: np.ndarray,
    t2: np.ndarray,
    transform: Affine,
    crs,
    resolution_m: float,
    red_zone_geoms: list[dict],
) -> list[dict]:
    """Returns GeoJSON Features (EPSG:4326) with classification properties."""
    mask = ((prob >= settings.change_threshold) & valid).astype(np.uint8)
    if not mask.any():
        return []

    min_px = max(1, math.ceil(settings.min_change_area_m2 / (resolution_m ** 2)))
    mask = rasterio.features.sieve(mask, size=min_px)
    # Close the ragged pixel boundary so one structure vectorizes as one solid
    # outline rather than a lace of holes and hairline spurs.
    mask = ndimage.binary_closing(mask.astype(bool), iterations=2)
    mask = ndimage.binary_fill_holes(mask).astype(np.uint8)

    to_4326 = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
    red_union = (
        unary_union([shape(g) for g in red_zone_geoms]) if red_zone_geoms else None
    )
    g1 = t1.mean(axis=2)
    g2 = t2.mean(axis=2)

    features: list[dict] = []
    for geom_dict, value in rasterio.features.shapes(mask, mask=mask == 1,
                                                     transform=transform):
        poly = shape(geom_dict)
        # Drop interior rings: a flagged structure is reported as one solid
        # outline, not a ring around a courtyard the segmenter happened to miss.
        if poly.geom_type == "Polygon" and poly.interiors:
            poly = ShapelyPolygon(poly.exterior)
        # Simplify at ~1.5 px so the outline follows the building edge without
        # the single-pixel staircase that makes a roof look like a saw blade.
        poly = poly.simplify(abs(transform.a) * 1.5, preserve_topology=True)
        if poly.is_empty or not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            continue

        # per-polygon confidence + brightness delta from the raster window
        region = rasterio.features.rasterize(
            [(poly, 1)], out_shape=prob.shape, transform=transform,
            fill=0, dtype="uint8").astype(bool)
        confidence = float(prob[region].mean()) if region.any() else 0.0
        label, delta = _change_type(g1, g2, region)

        poly_4326 = shp_transform(to_4326, poly)
        area_m2, _ = _GEOD.geometry_area_perimeter(poly_4326)
        area_m2 = abs(area_m2)
        if area_m2 < settings.min_change_area_m2:
            continue

        status = "change"
        zone_overlap_pct = 0.0
        if red_union is not None and poly_4326.intersects(red_union):
            status = "illegal"
            inter = poly_4326.intersection(red_union)
            zone_area, _ = _GEOD.geometry_area_perimeter(inter)
            zone_overlap_pct = round(abs(zone_area) / max(area_m2, 1e-9) * 100, 1)
            label = f"ILLEGAL encroachment — {label.lower()} in red zone"

        features.append({
            "type": "Feature",
            "geometry": mapping(poly_4326),
            "properties": {
                "label": label,
                "status": status,
                "area_m2": round(area_m2, 1),
                "confidence": round(confidence, 3),
                "brightness_delta": round(delta, 1),
                "red_zone_overlap_pct": zone_overlap_pct,
            },
        })

    features.sort(key=lambda f: f["properties"]["area_m2"], reverse=True)
    return features
