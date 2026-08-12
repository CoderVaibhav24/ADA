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
from .ml import imageops as ml_imageops

_GEOD = pyproj.Geod(ellps="WGS84")


# Officer-facing wording for the geometric change types.
_TYPE_LABELS = {
    "new_construction": "New construction",
    "extension": "Extension / increase in built area",
    "demolition": "Structure removed",
    "unchanged": "Modified structure",
}


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
    instances: list | None = None,
    id_map: np.ndarray | None = None,
) -> list[dict]:
    """Returns GeoJSON Features (EPSG:4326) with classification properties.

    `instances` + `id_map` are optional: when the seg-diff engine supplies them,
    each polygon is traced back to the structure it came from so it can carry
    that structure's change type and feature vector. The features are what
    scripts/train_instance_classifier.py later learns from, so they have to
    survive onto the row an officer eventually reviews.
    """
    by_id = {i.idx: i for i in (instances or [])}
    mask = ((prob >= settings.change_threshold) & valid).astype(np.uint8)
    if not mask.any():
        return []

    min_px = max(1, math.ceil(settings.min_change_area_m2 / (resolution_m ** 2)))
    mask = rasterio.features.sieve(mask, size=min_px)
    # Close the ragged pixel boundary so one structure vectorizes as one solid
    # outline rather than a lace of holes and hairline spurs.
    mask = ml_imageops.binary_closing(mask.astype(bool), 2)
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

        # Per-polygon confidence + brightness delta, read from the polygon's own
        # WINDOW rather than the whole scene.
        #
        # Rasterizing each polygon at `out_shape=prob.shape` allocates a
        # full-scene array per polygon, and every read that follows
        # (prob[region], the brightness delta, the id lookup) then scans the
        # whole grid too. With a few thousand detections on a 4899x4545 grid
        # that is the same O(instances x scene) blow-up that stalled the
        # instance stage — it just surfaces later, at "Vectorizing".
        #
        # A polygon only covers its own bounding box, so rasterize into that
        # box with a shifted transform and slice the rasters to match. Same
        # pixels, same statistics, bounded work.
        minx, miny, maxx, maxy = poly.bounds
        c0, r0 = ~transform * (minx, maxy)
        c1, r1 = ~transform * (maxx, miny)
        col0 = max(0, int(math.floor(min(c0, c1))) - 1)
        row0 = max(0, int(math.floor(min(r0, r1))) - 1)
        col1 = min(prob.shape[1], int(math.ceil(max(c0, c1))) + 1)
        row1 = min(prob.shape[0], int(math.ceil(max(r0, r1))) + 1)
        if col1 <= col0 or row1 <= row0:
            continue
        win = (slice(row0, row1), slice(col0, col1))
        win_transform = transform * Affine.translation(col0, row0)
        region = rasterio.features.rasterize(
            [(poly, 1)], out_shape=(row1 - row0, col1 - col0),
            transform=win_transform, fill=0, dtype="uint8").astype(bool)
        if not region.any():
            continue
        confidence = float(prob[win][region].mean())
        label, delta = _change_type(g1[win], g2[win], region)

        # Trace this polygon back to the structure it came from. Modal id, not
        # any-overlap: SAM refinement can spill a few pixels of one detection
        # into a neighbour, and the majority owner is the right attribution.
        source = None
        if id_map is not None:
            ids = id_map[win][region]
            ids = ids[ids > 0]
            if ids.size:
                source = by_id.get(int(np.bincount(ids).argmax()))

        poly_4326 = shp_transform(to_4326, poly)
        area_m2, _ = _GEOD.geometry_area_perimeter(poly_4326)
        area_m2 = abs(area_m2)
        if area_m2 < settings.min_change_area_m2:
            continue

        # The structural change type (new build / extension / demolition) comes
        # from T1<->T2 instance geometry and is far more actionable than the
        # brightness-derived label, so it wins when it is available.
        change_type = source.change_type if source else None
        if change_type:
            label = _TYPE_LABELS.get(change_type, label)

        status = "change"
        zone_overlap_pct = 0.0
        if red_union is not None and poly_4326.intersects(red_union):
            status = "illegal"
            inter = poly_4326.intersection(red_union)
            zone_area, _ = _GEOD.geometry_area_perimeter(inter)
            zone_overlap_pct = round(abs(zone_area) / max(area_m2, 1e-9) * 100, 1)
            label = f"ILLEGAL encroachment — {label.lower()} in red zone"

        props = {
            "label": label,
            "status": status,
            "area_m2": round(area_m2, 1),
            "confidence": round(confidence, 3),
            "brightness_delta": round(delta, 1),
            "red_zone_overlap_pct": zone_overlap_pct,
        }
        if source is not None:
            props["change_type"] = change_type
            # Training data for the instance classifier — this is the row an
            # officer will confirm or reject, and these are the inputs that
            # produced it.
            props["features"] = {k: round(float(v), 5)
                                 for k, v in source.features.items()}
        features.append({
            "type": "Feature",
            "geometry": mapping(poly_4326),
            "properties": props,
        })

    features.sort(key=lambda f: f["properties"]["area_m2"], reverse=True)
    return features
