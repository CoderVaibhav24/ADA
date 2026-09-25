"""Footprint regularisation: traced blobs come out as right-angled, parcel-aware outlines."""

from __future__ import annotations

import time

import numpy as np
import pytest
import rasterio.features
from pyproj import Transformer
from rasterio.transform import from_origin
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Polygon, box, shape
from shapely.ops import transform as shp_transform

from app.regularize import (
    FootprintRegularizer,
    ParcelIndex,
    RegularizeParams,
    _iou,
    _largest,
    regularize_footprint,
)

X0, Y0 = 500000.0, 3100000.0  # EPSG:32644 (central India)


# Rasterise `poly` at `res` metres, flip boundary pixels at random, trace the largest blob.
def _trace(poly, res=0.3, flip=0.15, seed=0):
    rng = np.random.default_rng(seed)
    minx, miny, maxx, maxy = poly.bounds
    tr = from_origin(minx - 3, maxy + 3, res, res)
    w = int((maxx - minx + 6) / res)
    h = int((maxy - miny + 6) / res)
    m = rasterio.features.rasterize([(poly, 1)], out_shape=(h, w), transform=tr, dtype="uint8")
    edge = (m != np.roll(m, 1, 0)) | (m != np.roll(m, 1, 1))
    m[edge & (rng.random(m.shape) < flip)] ^= 1
    blobs = [shape(g) for g, v in rasterio.features.shapes(m, mask=m == 1, transform=tr)]
    return max(blobs, key=lambda g: g.area)


def _angles(poly):
    xy = np.asarray(poly.exterior.coords)
    d = np.diff(xy, axis=0)
    return np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 180.0


def _right_angled(poly, tol=1.0):
    a = _angles(poly)
    turn = np.abs(((np.roll(a, -1) - a) + 90) % 180 - 90)
    return bool(np.all(np.abs(turn - 90) <= tol))


def _nverts(poly):
    return len(poly.exterior.coords) - 1


# Worst deviation of any edge from the nearest of `az` and `az + 90` degrees.
def _axis_err(poly, az):
    off = (_angles(poly) - az) % 90.0
    return float(np.max(np.minimum(off, 90.0 - off)))


def test_noisy_rectangle_becomes_four_right_angles():
    truth = box(X0, Y0, X0 + 12, Y0 + 8)
    out = regularize_footprint(_trace(truth), parcels=None)
    assert out.method == "ortho"
    assert _nverts(out.geometry) == 4
    assert _right_angled(out.geometry)
    assert abs(out.geometry.area / truth.area - 1) < 0.05


def test_noisy_l_shape_has_six_orthogonal_vertices():
    truth = Polygon([(X0, Y0), (X0 + 15, Y0), (X0 + 15, Y0 + 6), (X0 + 6, Y0 + 6),
                     (X0 + 6, Y0 + 14), (X0, Y0 + 14)])
    out = regularize_footprint(_trace(truth, seed=3), parcels=None)
    assert out.method == "ortho"
    assert _nverts(out.geometry) == 6
    assert _right_angled(out.geometry)
    assert abs(out.geometry.area / truth.area - 1) < 0.05


def test_rotated_rectangle_keeps_its_orientation():
    truth = affinity.rotate(box(X0, Y0, X0 + 16, Y0 + 9), 30, origin=(X0, Y0))
    out = regularize_footprint(_trace(truth, seed=5), parcels=None)
    assert out.method == "ortho"
    assert _nverts(out.geometry) == 4
    assert _axis_err(out.geometry, 30.0) <= 1.5
    assert abs(out.azimuth_deg - 30.0) <= 1.5


def test_parcel_azimuth_wins_over_the_blob_azimuth():
    parcel = affinity.rotate(box(X0 - 5, Y0 - 5, X0 + 25, Y0 + 20), 17, origin=(X0, Y0))
    blob = affinity.rotate(box(X0 + 2, Y0 + 2, X0 + 14, Y0 + 10), 22, origin=(X0, Y0))
    out = regularize_footprint(blob, parcels=[parcel])
    assert out.azimuth_deg == pytest.approx(17.0, abs=0.01)
    assert _axis_err(out.geometry, 17.0) < 1e-3
    assert _right_angled(out.geometry)


def test_small_overshoot_is_clipped_and_flagged():
    parcel = box(X0, Y0, X0 + 20, Y0 + 12)
    blob = box(X0 + 5, Y0 + 2, X0 + 20.3, Y0 + 10)
    out = regularize_footprint(blob, parcels=[parcel])
    assert out.snapped_to_parcel
    assert out.geometry.difference(parcel).area < 1e-6
    assert out.geometry.bounds[2] == pytest.approx(X0 + 20)


def test_large_overshoot_is_kept_as_encroachment():
    parcel = box(X0, Y0, X0 + 20, Y0 + 12)
    blob = box(X0 + 5, Y0 + 2, X0 + 23, Y0 + 10)
    out = regularize_footprint(blob, parcels=[parcel])
    assert not out.snapped_to_parcel
    assert out.geometry.bounds[2] == pytest.approx(X0 + 23)


def test_degenerate_sliver_whose_rectangle_doubles_it_stays_raw():
    sliver = Polygon([(X0, Y0), (X0 + 10, Y0 + 0.4), (X0 + 20, Y0)])
    out = regularize_footprint(sliver, parcels=None)
    assert out.method == "raw"
    assert out.geometry.equals(sliver)


def test_near_rectangle_that_will_not_orthogonalise_falls_back_to_mrr():
    octagon = Polygon([(X0 + 4, Y0), (X0 + 16, Y0), (X0 + 20, Y0 + 4), (X0 + 20, Y0 + 8),
                       (X0 + 16, Y0 + 12), (X0 + 4, Y0 + 12), (X0, Y0 + 8), (X0, Y0 + 4)])
    out = regularize_footprint(octagon, parcels=None,
                               params=RegularizeParams(min_edge_m=0.0, min_iou=0.99))
    assert out.method == "mrr"
    assert out.geometry.area <= 1.25 * octagon.area


def test_building_off_the_parcel_axis_keeps_its_own_axis():
    parcel = box(X0 - 20, Y0 - 20, X0 + 40, Y0 + 30)
    bldg = affinity.rotate(box(X0, Y0, X0 + 20, Y0 + 10), 30, origin=(X0 + 10, Y0 + 5))
    out = regularize_footprint(bldg, parcels=[parcel])
    assert out.method == "ortho"
    assert out.azimuth_deg == pytest.approx(30.0, abs=0.5)
    assert abs(out.geometry.area / bldg.area - 1) < 0.05


def test_building_close_to_the_parcel_axis_adopts_it():
    parcel = box(X0 - 20, Y0 - 20, X0 + 40, Y0 + 30)
    bldg = affinity.rotate(box(X0, Y0, X0 + 20, Y0 + 10), 6, origin=(X0 + 10, Y0 + 5))
    out = regularize_footprint(bldg, parcels=[parcel])
    assert out.method == "ortho"
    assert out.azimuth_deg == pytest.approx(0.0, abs=0.01)
    assert _axis_err(out.geometry, 0.0) < 1e-3


def test_two_part_blob_stays_two_parts():
    mp = MultiPolygon([affinity.rotate(box(X0, Y0, X0 + 12, Y0 + 8), 20),
                       box(X0 + 40, Y0 + 40, X0 + 50, Y0 + 46)])
    out = regularize_footprint(mp, parcels=None)
    assert out.method == "ortho"
    assert out.geometry.geom_type == "MultiPolygon"
    assert len(out.geometry.geoms) == 2
    assert out.geometry.area == pytest.approx(mp.area, rel=0.05)


def test_sliver_whose_rectangle_is_three_times_its_area_stays_raw():
    t = np.radians(np.linspace(0, 70, 40))
    arc = Polygon(np.vstack([np.c_[X0 + 20 * np.cos(t), Y0 + 20 * np.sin(t)],
                             np.c_[X0 + 18.5 * np.cos(t), Y0 + 18.5 * np.sin(t)][::-1]]))
    assert 2.5 < arc.minimum_rotated_rectangle.area / arc.area < 3.5
    out = regularize_footprint(arc, parcels=None)
    assert out.method == "raw"
    assert out.geometry.equals(arc)


def test_ortho_shape_that_does_not_overlap_the_outline_falls_back():
    zig = Polygon([(X0, Y0), (X0 + 12, Y0), (X0 + 18, Y0 + 8), (X0 + 30, Y0 + 8),
                   (X0 + 30, Y0 + 14), (X0 + 14, Y0 + 14), (X0 + 8, Y0 + 6), (X0, Y0 + 6)])
    loose = regularize_footprint(zig, parcels=None, params=RegularizeParams(min_iou=0.0))
    assert loose.method == "ortho"
    assert 0.8 <= loose.geometry.area / zig.area <= 1.25
    assert _iou(loose.geometry, zig) < 0.75
    assert regularize_footprint(zig, parcels=None).method != "ortho"


def test_hole_that_leaves_the_shell_is_dropped():
    ell = [(X0, Y0), (X0 + 30, Y0), (X0 + 30, Y0 + 10), (X0 + 10, Y0 + 10), (X0 + 10, Y0 + 30),
           (X0, Y0 + 30)]
    hole = [(X0 + 28, Y0 + 5), (X0 + 9.5, Y0 + 9.5), (X0 + 5, Y0 + 28), (X0 + 4.5, Y0 + 28),
            (X0 + 9, Y0 + 9), (X0 + 28, Y0 + 4.5)]
    out = regularize_footprint(Polygon(ell, [hole]), parcels=None)
    assert out.geometry.is_valid
    shell = Polygon(out.geometry.exterior)
    assert all(Polygon(r).within(shell) for r in out.geometry.interiors)


def test_invalid_parcel_is_repaired_to_its_polygonal_parts():
    bowtie = Polygon([(X0 - 20, Y0 - 20), (X0 + 40, Y0 + 30), (X0 + 40, Y0 - 20),
                      (X0 - 20, Y0 + 30)])
    idx = ParcelIndex([bowtie, LineString([(X0, Y0), (X0 + 1, Y0)])])
    assert len(idx.geoms) == 1
    assert idx.geoms[0].is_valid
    assert idx.geoms[0].geom_type in ("Polygon", "MultiPolygon")


def test_snap_reach_counts_the_middle_of_a_long_overshoot_edge():
    # Parcel edge bows inward by 1 m mid-span; the overshoot vertices sit 0.2 m out.
    parcel = Polygon([(X0, Y0), (X0 + 20, Y0), (X0 + 20, Y0 + 20), (X0 + 10, Y0 + 19),
                      (X0, Y0 + 20)])
    blob = box(X0 + 2, Y0 + 2, X0 + 18, Y0 + 19.9)
    out = regularize_footprint(blob, parcels=[parcel])
    assert not out.snapped_to_parcel


def test_a_failure_inside_the_regulariser_keeps_the_raw_outline(monkeypatch):
    from app import regularize

    def explode(*_a, **_k):
        raise ValueError("boom")

    monkeypatch.setattr(regularize, "_regularize_metric", explode)
    blob = box(X0, Y0, X0 + 10, Y0 + 8)
    assert regularize_footprint(blob).method == "raw"
    assert FootprintRegularizer("EPSG:32644")(blob).method == "raw"


def test_geographic_input_matches_utm():
    truth = affinity.rotate(box(X0, Y0, X0 + 14, Y0 + 9), 12, origin=(X0, Y0))
    traced = _trace(truth, seed=7)
    utm = regularize_footprint(traced, parcels=None)
    to_ll = Transformer.from_crs("EPSG:32644", "EPSG:4326", always_xy=True)
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True)
    ll = shp_transform(to_ll.transform, traced)
    geo = regularize_footprint(ll, parcels=None, crs="EPSG:4326")
    back = shp_transform(to_utm.transform, geo.geometry)
    assert geo.method == utm.method == "ortho"
    assert back.symmetric_difference(utm.geometry).area / utm.geometry.area < 0.01
    assert geo.raw_area_m2 == pytest.approx(traced.area, rel=0.01)


def test_multipolygon_keeps_largest_part():
    mp = MultiPolygon([box(0, 0, 10, 10), box(20, 0, 22, 2)])
    assert _largest(mp).area == 100


def test_parcel_clip_that_would_split_the_footprint_is_skipped():
    # Parcel with a thin notch cutting most of the way through the footprint.
    parcel = box(X0, Y0, X0 + 30, Y0 + 20).difference(box(X0 + 10, Y0 + 2.2, X0 + 10.1, Y0 + 30))
    blob = box(X0 + 2, Y0 + 2.5, X0 + 25, Y0 + 12)
    out = regularize_footprint(blob, parcels=[parcel])
    assert not out.snapped_to_parcel
    assert out.geometry.geom_type == "Polygon"
    assert out.geometry.area == pytest.approx(blob.area, rel=1e-6)


def test_small_holes_dropped_large_holes_orthogonal():
    shell = [(X0, Y0), (X0 + 30, Y0), (X0 + 30, Y0 + 20), (X0, Y0 + 20)]
    small = [(X0 + 2, Y0 + 2), (X0 + 3.5, Y0 + 2), (X0 + 3.5, Y0 + 3.5), (X0 + 2, Y0 + 3.5)]
    big = [(X0 + 10, Y0 + 5), (X0 + 20, Y0 + 5.2), (X0 + 20, Y0 + 12), (X0 + 10, Y0 + 12)]
    out = regularize_footprint(Polygon(shell, [small, big]), parcels=None)
    assert len(out.geometry.interiors) == 1
    hole = Polygon(out.geometry.interiors[0])
    assert _right_angled(hole)


def test_regularizer_throughput():
    rng = np.random.default_rng(1)
    parcels = [box(X0 + i * 40, Y0 + j * 40, X0 + i * 40 + 30, Y0 + j * 40 + 30)
               for i in range(50) for j in range(40)]
    blobs = []
    for p in parcels:
        cx, cy = p.centroid.x, p.centroid.y
        base = affinity.rotate(box(cx - 8, cy - 5, cx + 8, cy + 5), float(rng.uniform(0, 5)),
                               origin="centroid")
        blobs.append(base.buffer(0.4, quad_segs=2).simplify(0.05))
    reg = FootprintRegularizer("EPSG:32644", parcels, RegularizeParams())
    t = time.perf_counter()
    out = [reg(b) for b in blobs]
    elapsed = time.perf_counter() - t
    assert len(out) == 2000
    assert sum(o.method == "ortho" for o in out) > 1900
    assert elapsed < 20
