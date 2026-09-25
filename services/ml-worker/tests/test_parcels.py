"""The per-parcel change stage (app/parcels.py) and its place in the analysis."""

from __future__ import annotations

import json
from types import SimpleNamespace

import numpy as np
import pytest
from ada_core import models
from ada_core.models_icms import Parcel
from pyproj import Transformer
from rasterio.transform import from_origin
from shapely.geometry import box, mapping
from shapely.ops import transform as shp_transform

ORIGIN = (500000.0, 3000000.0)   # UTM 44N
RES = 0.5
SIZE = 400                       # 200 m a side
CRS = "EPSG:32644"
_TO_WGS = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)


def px_box(row0: int, col0: int, row1: int, col1: int):
    """A UTM rectangle covering pixel rows [row0, row1) and cols [col0, col1)."""
    x0, y0 = ORIGIN
    return box(x0 + col0 * RES, y0 - row1 * RES, x0 + col1 * RES, y0 - row0 * RES)


def to_wgs(geom):
    return shp_transform(lambda x, y, z=None: _TO_WGS.transform(x, y), geom)


def record(pid: int, rect, sanctioned: float | None, key: str | None = None):
    from app.parcels import ParcelRecord

    return ParcelRecord(id=pid, parcel_key=key or f"SECTOR-9#{pid}",
                        sanctioned_area_sqm=sanctioned, geometry=to_wgs(rect))


def scene():
    valid = np.ones((SIZE, SIZE), bool)
    return (SimpleNamespace(valid=valid, transform=from_origin(*ORIGIN, RES, RES), crs=CRS,
                            resolution_m=RES),
            np.zeros((SIZE, SIZE), np.float32), np.zeros((SIZE, SIZE), np.float32))


@pytest.fixture
def three_parcels():
    """A vacant plot built on, a built plot left alone, and one the imagery misses."""
    pair, seg1, seg2 = scene()
    # A: 40 x 40 m, empty in T1, 30 x 30 m roof in T2 (900 m2, sanctioned 1000).
    seg2[30:90, 30:90] = 0.9
    # B: 40 x 40 m, the same 20 x 20 m roof in both (400 m2 against 300 sanctioned).
    seg1[150:190, 150:190] = 0.8
    seg2[150:190, 150:190] = 0.8
    # C: 40 x 40 m, three quarters of it outside the valid footprint.
    pair.valid[260:340, 260:320] = False
    parcels = [
        record(1, px_box(20, 20, 100, 100), 1000.0),
        record(2, px_box(130, 130, 210, 210), 300.0),
        record(3, px_box(260, 260, 340, 340), None),
    ]
    return pair, seg1, seg2, parcels


def by_id(rows):
    return {r["parcel_id"]: r for r in rows}


def measured(fixture):
    """measure() over a (pair, seg1, seg2, parcels) fixture tuple."""
    from app.parcels import measure

    pair, seg1, seg2, parcels = fixture
    return measure(parcels, pair, seg1, seg2)


class TestMeasure:
    def test_three_parcels_get_the_expected_classes(self, three_parcels):
        rows, summary = measured(three_parcels)
        a, b, c = (by_id(rows)[i] for i in (1, 2, 3))

        assert (a["verdict_t1"], a["verdict_t2"], a["change_class"]) == (
            "vacant", "within_tolerance", "new_build")
        assert a["built_sqm_t1"] == 0.0 and a["built_sqm_t2"] == pytest.approx(900.0, rel=2e-3)
        assert a["delta_sqm"] == pytest.approx(900.0, rel=2e-3)

        assert (b["verdict_t1"], b["verdict_t2"], b["change_class"]) == (
            "over_tolerance", "over_tolerance", "unchanged")
        assert b["delta_sqm"] == 0.0

        assert (c["verdict_t1"], c["verdict_t2"], c["change_class"]) == (
            "insufficient_imagery", "insufficient_imagery", "unassessable")
        assert c["delta_sqm"] is None and c["delta_sqm_corrected"] is None
        assert c["imagery_frac_t1"] == pytest.approx(0.25, abs=0.01)

        assert summary.parcels_total == 3 and summary.assessable == 2
        assert summary.counts_by_class == {"new_build": 1, "unchanged": 1, "unassessable": 1}
        assert summary.counts_by_verdict_t2["insufficient_imagery"] == 1

    def test_parcel_area_is_geodesic_square_metres(self, three_parcels):
        rows, _ = measured(three_parcels)
        assert by_id(rows)[1]["parcel_area_sqm"] == pytest.approx(1600.0, rel=0.01)
        assert by_id(rows)[1]["tolerance_frac"] == 0.20

    def test_small_blocks_count_the_same_as_one_block(self, three_parcels, monkeypatch):
        from app import parcels as mod

        whole, _ = measured(three_parcels)
        monkeypatch.setattr(mod.settings, "parcel_block_px", 64)
        blocked, _ = measured(three_parcels)
        assert whole == blocked

    def test_a_parcel_half_off_the_grid_is_not_scored(self):
        from app.parcels import measure

        pair, seg1, seg2 = scene()
        rows, _ = measure([record(1, px_box(-40, 100, 40, 180), 500.0)], pair, seg1, seg2)
        assert rows[0]["imagery_frac_t1"] == pytest.approx(0.5, abs=0.02)
        assert rows[0]["verdict_t1"] == "insufficient_imagery"

    def test_a_parcel_that_never_meets_the_grid_is_dropped(self):
        from app.parcels import measure

        pair, seg1, seg2 = scene()
        rows, summary = measure([record(1, px_box(500, 500, 540, 540), 500.0)],
                                pair, seg1, seg2)
        assert rows == [] and summary.parcels_total == 0

    def test_the_building_threshold_is_the_existing_setting(self, three_parcels,
                                                            monkeypatch):
        from app import parcels as mod

        monkeypatch.setattr(mod.settings, "building_threshold", 0.95)
        rows, _ = measured(three_parcels)
        assert by_id(rows)[1]["built_sqm_t2"] == 0.0

    def test_per_epoch_validity_is_used_when_the_pair_has_it(self, three_parcels):
        pair = three_parcels[0]
        pair.valid1 = pair.valid.copy()
        pair.valid2 = pair.valid.copy()
        pair.valid1[0:200, 0:200] = False
        rows, _ = measured(three_parcels)
        a = by_id(rows)[1]
        assert a["verdict_t1"] == "insufficient_imagery"
        assert a["verdict_t2"] == "within_tolerance"
        assert a["change_class"] == "unassessable"


def grid_over(geom, crs: str, px: int = 200, margin: int = 10):
    """A pair whose pixel edges sit on geom's bounding box, fully valid, fully built."""
    from rasterio.transform import Affine

    minx, miny, maxx, maxy = geom.bounds
    rx, ry = (maxx - minx) / px, (maxy - miny) / px
    size = px + 2 * margin
    transform = Affine(rx, 0.0, minx - margin * rx, 0.0, -ry, maxy + margin * ry)
    res_m = ry * 111320 if crs == "EPSG:4326" else rx
    pair = SimpleNamespace(valid=np.ones((size, size), bool), transform=transform, crs=crs,
                           resolution_m=res_m)
    return pair, np.ones((size, size), np.float32), np.ones((size, size), np.float32)


class TestAreaScale:
    """built_sqm is metres on the ground whatever the pair's CRS (Lucknow latitude)."""

    LON0, LAT0 = 80.95, 26.9

    @pytest.fixture
    def parcel(self):
        from app.parcels import ParcelRecord

        rect = box(self.LON0, self.LAT0, self.LON0 + 0.00035, self.LAT0 + 0.00026)
        return ParcelRecord(id=1, parcel_key="L#1", sanctioned_area_sqm=1000.0,
                            geometry=rect)

    @pytest.mark.parametrize("crs", ["EPSG:4326", "EPSG:3857", "EPSG:32644"])
    def test_a_fully_built_parcel_measures_its_geodesic_area(self, parcel, crs):
        from app.parcels import _to_crs, measure

        pair, seg1, seg2 = grid_over(_to_crs([parcel.geometry], crs)[0], crs)
        rows, _ = measure([parcel], pair, seg1, seg2)
        row = rows[0]
        assert 990 < row["parcel_area_sqm"] < 1010
        assert row["built_sqm_t1"] == pytest.approx(row["parcel_area_sqm"], rel=5e-3)
        assert row["imagery_frac_t1"] == pytest.approx(1.0, abs=5e-3)

    def test_all_three_crs_agree(self, parcel):
        from app.parcels import _to_crs, measure

        built = []
        for crs in ("EPSG:4326", "EPSG:3857", "EPSG:32644"):
            pair, seg1, seg2 = grid_over(_to_crs([parcel.geometry], crs)[0], crs)
            built.append(measure([parcel], pair, seg1, seg2)[0][0]["built_sqm_t1"])
        assert max(built) / min(built) < 1.005

    def test_square_degree_pixels_are_not_resolution_squared(self, parcel):
        from app.parcels import measure

        d = 5e-6                                  # parcel is 70 x 52 of these pixels
        pair = SimpleNamespace(valid=np.ones((72, 90), bool), crs="EPSG:4326",
                               transform=from_origin(self.LON0 - 10 * d,
                                                     self.LAT0 + 0.00026 + 10 * d, d, d),
                               resolution_m=d * 111320)
        seg = np.ones((72, 90), np.float32)
        row = measure([parcel], pair, seg, seg)[0][0]
        assert row["built_sqm_t1"] == pytest.approx(row["parcel_area_sqm"], rel=5e-3)
        old = 70 * 52 * pair.resolution_m ** 2
        assert old / row["built_sqm_t1"] > 1.10


class TestOverlap:
    def test_two_identical_parcels_both_get_every_pixel(self):
        from app.parcels import measure

        pair, seg1, seg2 = scene()
        seg1[0:200, 0:200] = 1.0
        seg2[0:200, 0:200] = 1.0
        seg1[250:270, 250:290] = 1.0
        seg2[250:270, 250:290] = 1.0
        parcels = [record(1, px_box(0, 0, 200, 200), 10000.0),
                   record(2, px_box(0, 0, 200, 200), 10000.0),
                   record(3, px_box(250, 250, 290, 290), 400.0)]
        rows = by_id(measure(parcels, pair, seg1, seg2)[0])
        for pid in (1, 2):
            assert rows[pid]["built_sqm_t1"] == pytest.approx(10000.0, rel=2e-3)
            assert rows[pid]["built_sqm_t2"] == pytest.approx(10000.0, rel=2e-3)
            assert rows[pid]["imagery_frac_t1"] == 1.0
            assert rows[pid]["imagery_frac_t2"] == 1.0
        assert rows[3]["built_sqm_t1"] == pytest.approx(200.0, rel=2e-3)

    def test_partly_overlapping_parcels_share_the_overlap(self, monkeypatch):
        from app import parcels as mod

        pair, seg1, seg2 = scene()
        seg1[:] = 1.0
        seg2[:] = 1.0
        parcels = [record(1, px_box(0, 0, 100, 100), 2500.0),
                   record(2, px_box(50, 50, 150, 150), 2500.0)]
        monkeypatch.setattr(mod.settings, "parcel_block_px", 64)
        rows = by_id(mod.measure(parcels, pair, seg1, seg2)[0])
        assert rows[1]["built_sqm_t1"] == pytest.approx(2500.0, rel=2e-3)
        assert rows[2]["built_sqm_t1"] == pytest.approx(2500.0, rel=2e-3)

    def test_touching_parcels_stay_on_the_fast_path(self):
        from app.parcels import _overlapping, _to_crs

        geoms = _to_crs([record(1, px_box(0, 0, 40, 40), None).geometry,
                         record(2, px_box(0, 40, 40, 80), None).geometry], CRS)
        import shapely

        assert _overlapping(shapely.STRtree(geoms), geoms) == set()


class TestBias:
    @pytest.fixture
    def grid_of_plots(self):
        """Six 20 x 20 m plots: five grow 20 m2 between epochs (bias), one grows 100 m2."""
        pair, seg1, seg2 = scene()
        parcels = []
        for k in range(6):
            r, c = 10 + (k // 3) * 60, 10 + (k % 3) * 60
            parcels.append(record(k + 1, px_box(r, c, r + 40, c + 40), 400.0))
            seg1[r:r + 20, c:c + 20] = 1.0                 # 100 m2 in T1
            extra = 20 if k == 5 else 4                    # 100 or 20 m2 more in T2
            seg2[r:r + 20 + extra, c:c + 20] = 1.0
        return pair, seg1, seg2, parcels

    def test_the_median_offset_is_removed_before_classifying(self, grid_of_plots,
                                                             monkeypatch):
        from app import parcels as mod

        monkeypatch.setattr(mod.settings, "parcel_bias_min_parcels", 5)
        rows, summary = measured(grid_of_plots)
        assert summary.bias_offset_sqm == pytest.approx(20.0, rel=2e-3)
        rows = by_id(rows)
        assert rows[1]["delta_sqm"] == pytest.approx(20.0, rel=2e-3)
        assert rows[1]["delta_sqm_corrected"] == pytest.approx(0.0, abs=0.05)
        assert rows[1]["change_class"] == "unchanged"
        assert rows[6]["delta_sqm_corrected"] == pytest.approx(80.0, rel=2e-3)
        assert rows[6]["change_class"] == "extension"

    def test_too_few_parcels_leave_the_delta_uncorrected(self, grid_of_plots):
        rows, summary = measured(grid_of_plots)
        assert summary.bias_offset_sqm is None
        assert by_id(rows)[1]["delta_sqm_corrected"] == by_id(rows)[1]["delta_sqm"]
        # 20 m2 on a 400 m2 plot is under the 40 m2 (10%) floor.
        assert by_id(rows)[1]["change_class"] == "unchanged"

    def test_the_histogram_has_twenty_bins_over_the_raw_deltas(self, grid_of_plots):
        _, summary = measured(grid_of_plots)
        hist = summary.histogram
        assert len(hist["counts"]) == 20 and len(hist["bin_edges"]) == 21
        assert sum(hist["counts"]) == 6
        assert hist["bin_edges"][0] == pytest.approx(20.0, rel=2e-3)
        assert hist["bin_edges"][-1] == pytest.approx(100.0, rel=2e-3)


class TestRules:
    @pytest.mark.parametrize("imagery,built_frac,built,sanctioned,expected", [
        (0.79, 0.5, 100.0, 100.0, "insufficient_imagery"),
        (0.9, 0.5, 100.0, None, "not_assessable"),
        (0.9, 0.5, 100.0, 0.0, "not_assessable"),
        (0.9, 0.04, 5.0, 100.0, "vacant"),
        (0.9, 0.5, 120.0, 100.0, "within_tolerance"),
        (0.9, 0.5, 120.1, 100.0, "over_tolerance"),
    ])
    def test_verdict(self, imagery, built_frac, built, sanctioned, expected):
        from app.parcels import verdict

        assert verdict(imagery, built_frac, built, sanctioned, 0.20) == expected

    @pytest.mark.parametrize("corrected,area,t1_frac,expected", [
        (None, 400.0, 0.0, "unassessable"),
        (9.9, 50.0, 0.0, "unchanged"),          # under the 10 m2 floor
        (39.0, 400.0, 0.0, "unchanged"),        # under 10% of 400 m2
        (41.0, 400.0, 0.01, "new_build"),
        (41.0, 400.0, 0.3, "extension"),
        (-41.0, 400.0, 0.3, "demolition"),
    ])
    def test_change_class(self, corrected, area, t1_frac, expected):
        from app.parcels import change_class

        assert change_class({"delta_sqm_corrected": corrected, "parcel_area_sqm": area,
                             "built_frac_t1": t1_frac}) == expected

    def test_parcel_key_follows_the_boundary_import_rule(self):
        from app.parcels import parcel_key

        assert parcel_key("123456", "45/2", "SECTOR-9", "7") == "123456/45/2"
        assert parcel_key(None, None, "SECTOR-9", "7") == "SECTOR-9#7"
        assert parcel_key(None, "45", None, None) is None


# ------------------------------------------------------------------ database

def add_parcel(db, rect, **fields):
    row = Parcel(geom=json.dumps(mapping(to_wgs(rect))), **fields)
    db.add(row)
    db.commit()
    return row


class TestTheStage:
    def test_rows_land_and_a_re_run_replaces_them(self, db, job, three_parcels):
        from ada_core.database import SessionLocal

        from app.parcels import run_parcel_stage

        pair, seg1, seg2, _ = three_parcels
        a = add_parcel(db, px_box(20, 20, 100, 100), sector="SECTOR-9", plot_no="1",
                       sanctioned_area_sqm=1000, owner_name="Invented Owner")
        add_parcel(db, px_box(130, 130, 210, 210), sector="SECTOR-9", plot_no="2",
                   sanctioned_area_sqm=300)
        add_parcel(db, px_box(20, 300, 60, 340), sector="SECTOR-9", plot_no="3",
                   active=False)
        add_parcel(db, box(ORIGIN[0] + 5000, ORIGIN[1], ORIGIN[0] + 5040, ORIGIN[1] + 40),
                   sector="SECTOR-9", plot_no="far")

        summary = run_parcel_stage(SessionLocal, job.id, pair, seg1, seg2)
        assert summary.parcels_total == 2, "inactive and far-away parcels are not read"
        rows = db.query(models.AnalysisParcelResult).order_by(
            models.AnalysisParcelResult.parcel_id).all()
        assert [r.parcel_key for r in rows] == ["SECTOR-9#1", "SECTOR-9#2"]
        assert rows[0].parcel_id == a.id and rows[0].change_class == "new_build"
        assert rows[0].created_at is not None

        seg2[:] = seg1
        run_parcel_stage(SessionLocal, job.id, pair, seg1, seg2)
        db.expire_all()
        rows = db.query(models.AnalysisParcelResult).all()
        assert len(rows) == 2
        assert {r.change_class for r in rows} == {"unchanged"}

    def test_injected_parcels_skip_the_query(self, db, job, three_parcels):
        from ada_core.database import SessionLocal

        from app.parcels import run_parcel_stage

        pair, seg1, seg2, parcels = three_parcels
        for p in parcels:
            db.add(Parcel(id=p.id, sector="SECTOR-9", plot_no=str(p.id),
                          geom=json.dumps(mapping(p.geometry))))
        db.commit()
        summary = run_parcel_stage(SessionLocal, job.id, pair, seg1, seg2,
                                   parcels=parcels[:1])
        assert summary.parcels_total == 1
        assert db.query(models.AnalysisParcelResult).count() == 1

    def test_no_parcel_under_the_scene_is_a_skip_note(self, db, job, three_parcels):
        from ada_core.database import SessionLocal

        from app.parcels import run_parcel_stage

        pair, seg1, seg2, _ = three_parcels
        summary = run_parcel_stage(SessionLocal, job.id, pair, seg1, seg2)
        assert summary.as_stats() == {"skipped": "no cadastral parcel intersects the scene"}

    def test_the_summary_is_json_ready(self, three_parcels):
        _, summary = measured(three_parcels)
        stats = summary.as_stats()
        assert json.loads(json.dumps(stats)) == stats
        assert set(stats) == {"parcels_total", "assessable", "bias_offset_sqm", "histogram",
                              "counts_by_class", "counts_by_verdict_t1",
                              "counts_by_verdict_t2"}


# ------------------------------------------------------------------ jobs.py

@pytest.fixture
def pipeline(monkeypatch, tmp_path, three_parcels):
    """Seg-diff stubbed around the real three-parcel scene."""
    from app import jobs
    from app.ml import gpu

    tier = gpu.Tier(name="cpu", fp16=False, grid_cap_px=2048, batch=1,
                    sam_refine_default=False)
    monkeypatch.setattr(gpu, "select_tier", lambda: tier)
    monkeypatch.setattr(gpu, "runtime_info", lambda: {
        "backend": "CPU", "device_name": "test", "tier": "cpu", "fp16": False})
    monkeypatch.setattr(jobs.settings, "model_mode", "segdiff")
    monkeypatch.setattr(jobs.settings, "vegetation_mode", "index")
    monkeypatch.setattr(jobs.settings, "sam_refine", False)

    base, seg1, seg2, _ = three_parcels
    pair = SimpleNamespace(**vars(base), t1=np.zeros((SIZE, SIZE, 3), np.uint8),
                           t2=np.zeros((SIZE, SIZE, 3), np.uint8), veg1=None, veg2=None,
                           shift_px=(0.0, 0.0), cir_corrected=(False, False))
    maps = iter([seg1, seg2] * 4)

    class FakeSeg:
        name = "fake-seg"
        batch_size = 1

    monkeypatch.setattr(jobs.preprocess, "superimpose", lambda *a, **k: pair)
    monkeypatch.setattr(jobs.preprocess, "write_mask_cog", lambda *a, **k: None)
    monkeypatch.setattr(jobs.preprocess, "write_rgb_geotiff", lambda *a, **k: None)
    monkeypatch.setattr(jobs.ml_engine, "get_seg_backend", lambda: FakeSeg())
    monkeypatch.setattr(jobs.ml_engine, "segment_scene", lambda *a, **k: next(maps))
    monkeypatch.setattr(jobs.ml_engine, "release_seg_backend", lambda: None)
    monkeypatch.setattr(jobs.ml_engine, "release_landcover", lambda: None)
    monkeypatch.setattr(jobs.ml_engine, "analyse_instances", lambda *a, **k: (
        None, None, {"decider": "rules", "candidates": 0, "kept": 0}, None))
    monkeypatch.setattr(jobs.ml_engine, "classical_change_prob", lambda *a, **k: None)
    monkeypatch.setattr(jobs.ml_engine, "suppress_vegetation_changes", lambda *a, **k: None)
    monkeypatch.setattr(jobs.vectorize, "extract_polygons", lambda *a, **k: [])
    monkeypatch.setattr(jobs.notifier, "analysis_finished", lambda _id: None)
    monkeypatch.setattr(jobs.notifier, "analysis_failed", lambda _id: None)
    for name in ("t1.tif", "t2.tif"):
        (tmp_path / name).write_bytes(b"not really a tiff")
    return {"paths": (str(tmp_path / "t1.tif"), str(tmp_path / "t2.tif"))}


def make_job(db, project, pipeline, mode: str):
    t1 = models.Raster(project_id=project.id, name="T1", original_path=pipeline["paths"][0])
    t2 = models.Raster(project_id=project.id, name="T2", original_path=pipeline["paths"][1])
    db.add_all([t1, t2])
    db.commit()
    job = models.AnalysisJob(project_id=project.id, raster_t1_id=t1.id,
                             raster_t2_id=t2.id, mode=mode, status="queued")
    db.add(job)
    db.commit()
    return job


def finished(db, job):
    db.expire_all()
    row = db.get(models.AnalysisJob, job.id)
    assert row.status == "done", row.error
    return row


class TestInTheAnalysis:
    def test_segdiff_measures_parcels_into_the_stats(self, db, project, pipeline):
        from app import jobs

        add_parcel(db, px_box(20, 20, 100, 100), sector="SECTOR-9", plot_no="1",
                   sanctioned_area_sqm=1000)
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        stats = finished(db, job).stats["parcels"]
        assert stats["parcels_total"] == 1
        assert stats["counts_by_class"] == {"new_build": 1}
        assert db.query(models.AnalysisParcelResult).count() == 1

    def test_regularisation_reuses_the_stage_parcels(self, db, project, pipeline,
                                                     monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "regularize_footprints", True)
        seen: dict = {}

        def no_second_query(*_a, **_k):
            raise AssertionError("cadastre queried twice")

        def extract(*_a, parcels=None, **_k):
            seen["parcels"] = parcels
            return []

        monkeypatch.setattr(jobs.parcels, "scene_parcels_in_crs", no_second_query)
        monkeypatch.setattr(jobs.vectorize, "extract_polygons", extract)
        rect = px_box(20, 20, 100, 100)
        add_parcel(db, rect, sector="SECTOR-9", plot_no="1", sanctioned_area_sqm=1000)
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        finished(db, job)
        assert len(seen["parcels"]) == 1
        assert seen["parcels"][0].symmetric_difference(rect).area < 1e-3 * rect.area

    def test_regularisation_queries_the_cadastre_when_the_stage_did_not_run(
            self, db, project, pipeline, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "regularize_footprints", True)
        monkeypatch.setattr(jobs.settings, "parcel_stage_enabled", False)
        calls: list[int] = []
        real = jobs.parcels.scene_parcels_in_crs

        def counted(*a, **k):
            calls.append(1)
            return real(*a, **k)

        monkeypatch.setattr(jobs.parcels, "scene_parcels_in_crs", counted)
        add_parcel(db, px_box(20, 20, 100, 100), sector="SECTOR-9", plot_no="1")
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        finished(db, job)
        assert calls == [1]

    def test_classical_mode_skips_the_stage(self, db, project, pipeline):
        from app import jobs

        add_parcel(db, px_box(20, 20, 100, 100), sector="SECTOR-9", plot_no="1")
        job = make_job(db, project, pipeline, "diff")
        jobs._run_analysis_safe(job.id)
        assert finished(db, job).stats["parcels"] == {"skipped": "classical mode"}
        assert db.query(models.AnalysisParcelResult).count() == 0

    def test_a_classical_re_run_leaves_no_rows_from_the_last_run(self, db, project,
                                                                  pipeline):
        from app import jobs

        add_parcel(db, px_box(20, 20, 100, 100), sector="SECTOR-9", plot_no="1",
                   sanctioned_area_sqm=1000)
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        finished(db, job)
        assert db.query(models.AnalysisParcelResult).count() == 1

        row = db.get(models.AnalysisJob, job.id)
        row.mode, row.status = "diff", "queued"
        db.commit()
        jobs._run_analysis_safe(job.id)
        assert finished(db, job).stats["parcels"] == {"skipped": "classical mode"}
        assert db.query(models.AnalysisParcelResult).count() == 0

    def test_a_failed_re_run_leaves_no_rows_from_the_last_run(self, db, project, pipeline,
                                                              monkeypatch):
        from app import jobs

        add_parcel(db, px_box(20, 20, 100, 100), sector="SECTOR-9", plot_no="1",
                   sanctioned_area_sqm=1000)
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        finished(db, job)

        def explode(*_a, **_k):
            raise ValueError("broken")

        monkeypatch.setattr(jobs.parcels, "run_parcel_stage", explode)
        row = db.get(models.AnalysisJob, job.id)
        row.status = "queued"
        db.commit()
        jobs._run_analysis_safe(job.id)
        assert finished(db, job).stats["parcels"] == {"error": "broken"}
        assert db.query(models.AnalysisParcelResult).count() == 0

    def test_it_can_be_switched_off(self, db, project, pipeline, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "parcel_stage_enabled", False)
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        assert "skipped" in finished(db, job).stats["parcels"]

    def test_a_parcel_failure_does_not_fail_the_analysis(self, db, project, pipeline,
                                                         monkeypatch):
        from app import jobs

        def explode(*_a, **_k):
            raise ValueError("cadastre geometry is broken")

        monkeypatch.setattr(jobs.parcels, "run_parcel_stage", explode)
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        assert finished(db, job).stats["parcels"] == {"error": "cadastre geometry is broken"}

    @pytest.fixture
    def once_oom(self, monkeypatch):
        from app import jobs
        from app.parcels import run_parcel_stage

        calls: list[int] = []

        def run(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise MemoryError()
            return run_parcel_stage(*args, **kwargs)

        monkeypatch.setattr(jobs.parcels, "run_parcel_stage", run)
        monkeypatch.setattr(jobs.ml_engine, "release_gpu_models", lambda: None)
        return calls

    def test_out_of_memory_on_a_gpu_tier_reruns_the_stage_on_the_cpu(
            self, db, project, pipeline, once_oom, monkeypatch):
        from app import jobs
        from app.ml import gpu

        tier = gpu.Tier(name="cuda", fp16=True, grid_cap_px=6144, batch=8,
                        sam_refine_default=False)
        monkeypatch.setattr(gpu, "select_tier", lambda: tier)
        add_parcel(db, px_box(20, 20, 100, 100), sector="SECTOR-9", plot_no="1",
                   sanctioned_area_sqm=1000)
        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        row = finished(db, job)
        assert len(once_oom) == 2
        assert row.stats["parcels"]["parcels_total"] == 1
        assert any("parcels out of memory" in s for s in row.stats["degrade_steps"])

    def test_out_of_memory_on_the_cpu_tier_is_recorded_not_fatal(
            self, db, project, pipeline, once_oom):
        from app import jobs

        job = make_job(db, project, pipeline, "ai")
        jobs._run_analysis_safe(job.id)
        assert finished(db, job).stats["parcels"] == {"error": "parcels: MemoryError"}


def test_the_land_cover_line_names_the_active_backend(db, project, pipeline, monkeypatch):
    from app import jobs
    from app.ml import landcover

    class FakeLandCover:
        name = "ADA land cover (landcover7_v3, cpu)"
        batch_size = 1

    monkeypatch.setattr(jobs.settings, "vegetation_mode", "learned")
    monkeypatch.setattr(jobs.settings, "landcover_backend", "ada")
    calls: list[int] = []

    def get_backend():
        calls.append(1)
        return FakeLandCover()

    monkeypatch.setattr(landcover, "get_backend", get_backend)
    monkeypatch.setattr(jobs.ml_engine, "landcover_probs",
                        lambda *a, **k: np.zeros((7, SIZE, SIZE), np.float32))
    job = make_job(db, project, pipeline, "ai")
    jobs._run_analysis_safe(job.id)
    used = finished(db, job).stats["models_used"]
    assert "Land cover / vegetation: ADA land cover (landcover7_v3, cpu)" in used
    assert len(calls) == 2, "the name is read inside the stage, never by reloading"


@pytest.mark.parametrize("building,landcover_backend,tier_name,tier_batch,expected", [
    ("ada", "ada", "cuda", 8, 4),
    ("ada", "loveda", "metal", 4, 2),
    ("changestar", "ada", "cuda", 8, 4),
    ("changestar", "loveda", "cuda", 8, 8),
    ("ada", "ada", "cpu", 1, 1),
])
def test_the_ladder_starts_at_the_ada_batch_ceiling(monkeypatch, building, landcover_backend,
                                                    tier_name, tier_batch, expected):
    from app import jobs
    from app.ml import gpu

    monkeypatch.setattr(jobs.settings, "building_backend", building)
    monkeypatch.setattr(jobs.settings, "landcover_backend", landcover_backend)
    monkeypatch.setattr(jobs.settings, "ada_batch_size", None)
    tier = gpu.Tier(name=tier_name, fp16=tier_name != "cpu", grid_cap_px=2048,
                    batch=tier_batch, sam_refine_default=False)
    assert jobs._Ladder(tier).batch == expected
