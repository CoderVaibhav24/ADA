"""extract_polygons with footprint regularisation off (legacy output) and on."""

from __future__ import annotations

import numpy as np
import pyproj
import pytest
from rasterio.transform import from_origin
from shapely.geometry import box, mapping, shape
from shapely.ops import transform as shp_transform

from app import vectorize
from app.config import settings

LEGACY_KEYS = {"label", "status", "area_m2", "confidence", "brightness_delta",
               "red_zone_overlap_pct"}
SHAPE_KEYS = {"raw_area_m2", "shape_method", "azimuth_deg", "snapped_to_parcel"}
# Pre-regularisation output of this fixture: (area_m2, confidence, exterior coord count).
LEGACY = [(901.2, 0.799, 8), (600.5, 0.9, 5), (193.7, 0.944, 5)]
TR = from_origin(500000.0, 3100000.0, 0.5, 0.5)
_GEOD = pyproj.Geod(ellps="WGS84")


def _scene():
    rng = np.random.default_rng(0)
    h, w = 200, 200
    prob = np.zeros((h, w), np.float32)
    prob[20:60, 30:90] = 0.9
    prob[100:170, 100:130] = 0.8
    prob[140:170, 130:180] = 0.8
    yy, xx = np.mgrid[:h, :w]
    u = (xx - 60) * np.cos(0.5) + (yy - 140) * np.sin(0.5)
    v = -(xx - 60) * np.sin(0.5) + (yy - 140) * np.cos(0.5)
    prob[(abs(u) < 20) & (abs(v) < 10)] = 0.95
    t1 = rng.integers(0, 255, (h, w, 3)).astype(np.float32)
    t2 = t1.copy()
    t2[prob > 0] += 30
    return prob, np.ones((h, w), bool), t1, t2, TR, "EPSG:32644", 0.5, []


def _run(monkeypatch, on: bool, keep_raw: bool = False, parcels=None):
    monkeypatch.setattr(settings, "regularize_footprints", on)
    monkeypatch.setattr(settings, "regularize_keep_raw", keep_raw)
    return vectorize.extract_polygons(*_scene(), parcels=parcels)


def test_flag_off_matches_legacy_output(monkeypatch):
    feats = _run(monkeypatch, False)
    got = [(f["properties"]["area_m2"], f["properties"]["confidence"],
            len(f["geometry"]["coordinates"][0])) for f in feats]
    assert got == LEGACY
    assert all(set(f["properties"]) == LEGACY_KEYS for f in feats)
    parcel = [box(500010, 3099980, 500050, 3099995)]
    assert _run(monkeypatch, False, parcels=parcel) == feats


def test_flag_on_writes_shape_properties(monkeypatch):
    off = _run(monkeypatch, False)
    feats = _run(monkeypatch, True, keep_raw=True)
    assert len(feats) == len(off)
    for f in feats:
        p = f["properties"]
        assert set(p) == LEGACY_KEYS | SHAPE_KEYS | {"raw_geometry"}
        assert p["shape_method"] in ("ortho", "mrr", "raw")
        area = abs(_GEOD.geometry_area_perimeter(shape(f["geometry"]))[0])
        assert p["area_m2"] == pytest.approx(round(area, 1))
        raw = abs(_GEOD.geometry_area_perimeter(shape(p["raw_geometry"]))[0])
        assert p["raw_area_m2"] == pytest.approx(round(raw, 1))
    assert sorted(f["properties"]["confidence"] for f in feats) == \
        sorted(f["properties"]["confidence"] for f in off)
    assert all(f["properties"]["shape_method"] == "ortho" for f in feats)


def test_flag_on_uses_parcels_in_scene_crs(monkeypatch):
    # First blob covers x 500015..500045, y 3099970..3099990; parcel overshoot by 0.25 m.
    parcel = box(500015.25, 3099969.0, 500046.0, 3099991.0)
    feats = _run(monkeypatch, True, parcels=[parcel])
    to_utm = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True).transform
    big = next(f for f in feats if abs(f["properties"]["raw_area_m2"] - 600) < 5)
    assert big["properties"]["snapped_to_parcel"] is True
    geom = shp_transform(to_utm, shape(big["geometry"]))
    assert geom.difference(parcel).area < 0.01
    assert "raw_geometry" not in big["properties"]


class _ShiftedRegularizer:
    """Stand-in that moves every footprint 60 m east so raw and reshaped never overlap."""

    def __init__(self, *_a, **_k):
        pass

    def __call__(self, poly):
        from shapely import affinity

        from app.regularize import RegularizedFootprint
        return RegularizedFootprint(affinity.translate(poly, 60.0, 0.0), "ortho", 0.0,
                                    float(poly.area), False)


def _zone(utm_geom):
    to_ll = pyproj.Transformer.from_crs("EPSG:32644", "EPSG:4326", always_xy=True).transform
    return mapping(shp_transform(to_ll, utm_geom))


def _run_zoned(monkeypatch, zone):
    monkeypatch.setattr(settings, "regularize_footprints", True)
    monkeypatch.setattr(settings, "regularize_keep_raw", False)
    monkeypatch.setattr(vectorize, "FootprintRegularizer", _ShiftedRegularizer)
    scene = list(_scene())
    scene[-1] = [zone]
    feats = vectorize.extract_polygons(*scene)
    return next(f for f in feats if abs(f["properties"]["raw_area_m2"] - 600) < 5)


def test_red_zone_status_follows_the_raw_outline(monkeypatch):
    # First blob (raw) covers x 500015..500045, y 3099970..3099990.
    big = _run_zoned(monkeypatch, _zone(box(500010, 3099965, 500050, 3099995)))
    assert big["properties"]["status"] == "illegal"
    assert big["properties"]["red_zone_overlap_pct"] == pytest.approx(100.0, abs=0.5)


def test_reshaped_outline_in_a_red_zone_does_not_make_it_illegal(monkeypatch):
    big = _run_zoned(monkeypatch, _zone(box(500073, 3099965, 500107, 3099995)))
    assert big["properties"]["status"] == "change"
    assert big["properties"]["red_zone_overlap_pct"] == 0.0


def test_regulariser_failure_keeps_the_raw_outline(monkeypatch):
    class Broken:
        def __init__(self, *_a, **_k):
            pass

        def __call__(self, poly):
            raise RuntimeError("boom")

    monkeypatch.setattr(vectorize, "FootprintRegularizer", Broken)
    feats = _run(monkeypatch, True)
    off = _run(monkeypatch, False)
    assert [f["properties"]["area_m2"] for f in feats] == \
        [f["properties"]["area_m2"] for f in off]
    assert all(f["properties"]["shape_method"] == "raw" for f in feats)
