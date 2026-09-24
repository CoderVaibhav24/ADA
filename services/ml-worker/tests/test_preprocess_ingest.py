"""Ingest: cropped, narrowed, verified archive + display COG, and what jobs does with them."""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pytest
import rasterio
from ada_core import models
from rasterio.windows import Window

from tests.rasters import make_tile


def _ingest(tmp_path, name="raster_1.tif", **tile):
    from app import preprocess

    raw = tmp_path / name
    tile.setdefault("stray", False)
    make_tile(raw, **tile)
    result = preprocess.ingest_raster(raw, tmp_path / "cogs" / name)
    return raw, result


def _assert_pixel_exact(raw, result):
    col, row, width, height = result.crop_window
    window = Window(col, row, width, height)
    with rasterio.open(raw) as src, rasterio.open(result.archive_path) as arc:
        source = src.read(window=window)
        source_valid = src.dataset_mask(window=window) > 0
        archived = arc.read()
        assert np.array_equal(arc.dataset_mask() > 0, source_valid)
        assert np.array_equal(archived[:, source_valid], source[:, source_valid])
        # Nothing valid was cropped away.
        assert int(source_valid.sum()) == int((src.dataset_mask() > 0).sum())


class TestArchive:
    def test_is_cropped_zstd_predictor_2_tiled_with_overviews(self, tmp_path):
        raw, result = _ingest(tmp_path)
        assert result.archive_path == tmp_path / "raster_1.archive.tif"
        col, row, width, height = result.crop_window
        assert col > 400 and row > 400 and width < 1300 and height < 1300
        with rasterio.open(result.archive_path) as arc:
            assert (arc.width, arc.height) == (width, height)
            assert arc.compression.name.lower() == "zstd"
            assert arc.tags(ns="IMAGE_STRUCTURE")["PREDICTOR"] == "2"
            assert arc.block_shapes[0] == (512, 512)
            assert arc.overviews(1)
            with rasterio.open(raw) as src:
                assert arc.crs == src.crs
                assert arc.transform == src.window_transform(Window(col, row, width, height))
        assert result.extent_km == pytest.approx((width * 0.5 / 1000, height * 0.5 / 1000),
                                                 abs=1e-3)
        assert result.m_per_px == pytest.approx(0.5)

    def test_8_bit_data_is_narrowed_to_uint8_losslessly(self, tmp_path):
        raw, result = _ingest(tmp_path, max_dn=255)
        assert result.narrowed_dtype == "uint8"
        with rasterio.open(result.archive_path) as arc:
            assert arc.dtypes[0] == "uint8"
            assert arc.nodata is None          # 65535 does not fit; an internal mask carries it
        _assert_pixel_exact(raw, result)

    def test_12_bit_data_stays_uint16_with_its_nodata(self, tmp_path):
        raw, result = _ingest(tmp_path, max_dn=300)
        assert result.narrowed_dtype == "uint16"
        with rasterio.open(result.archive_path) as arc:
            assert arc.dtypes[0] == "uint16" and arc.nodata == 65535
        _assert_pixel_exact(raw, result)

    def test_a_strip_above_the_sampled_range_rewrites_as_uint16(self, tmp_path, monkeypatch):
        from app import preprocess

        real = preprocess._sample_rgb

        def optimistic(*args, **kwargs):
            sample, valid, _ = real(*args, **kwargs)
            return sample, valid, (0.0, 200.0)

        monkeypatch.setattr(preprocess, "_sample_rgb", optimistic)
        raw, result = _ingest(tmp_path, max_dn=300)
        assert result.narrowed_dtype == "uint16"
        _assert_pixel_exact(raw, result)

    def test_a_stray_valid_pixel_stays_inside_the_crop(self, tmp_path):
        raw, result = _ingest(tmp_path, stray=True)
        assert result.crop_window[0] <= 8 and result.crop_window[1] <= 8
        _assert_pixel_exact(raw, result)

    def test_a_float_source_with_nan_nodata_verifies(self, tmp_path):
        """H2: `block == nan` is never true, so NaN nodata needs its own test."""
        raw, result = _ingest(tmp_path, dtype="float32", nodata=float("nan"))
        with rasterio.open(result.archive_path) as arc:
            assert arc.dtypes[0] == "float32" and np.isnan(arc.nodata)
        _assert_pixel_exact(raw, result)

    def test_a_patch_smaller_than_a_decimation_cell_stays_in_the_crop(self, tmp_path):
        """A 2x2 patch between nearest-decimation sample points used to be cropped away."""
        from app import preprocess

        extra = np.zeros((4096, 4096), dtype=bool)
        extra[3903:3905, 3903:3905] = True
        raw = tmp_path / "raster_1.tif"
        make_tile(raw, size=4096, radius=500, stray=False, extra_valid=extra)
        with rasterio.open(raw) as src:
            _, crop = preprocess._data_bounds(src, src.crs, trim=False)
        assert crop.row_off + crop.height > 3904 and crop.col_off + crop.width > 3904

    def test_valid_pixels_just_outside_the_crop_fail_retryably(self, tmp_path, monkeypatch):
        from rasterio.windows import Window as W

        from app import preprocess

        raw = tmp_path / "raster_1.tif"
        make_tile(raw, stray=False)

        def too_tight(src, crs, trim=True):
            return (0, 0, 0, 0), W(500, 500, 1000, 1000)      # the diamond spans 425..1623

        monkeypatch.setattr(preprocess, "_data_bounds", too_tight)
        with pytest.raises(preprocess.IngestVerificationError, match="outside the crop"):
            preprocess.ingest_raster(raw, tmp_path / "cogs" / "raster_1.tif")
        assert raw.exists()

    def test_a_pixel_with_nan_in_one_band_is_invalid(self, tmp_path):
        from app import preprocess

        raw = tmp_path / "raster_1.tif"
        make_tile(raw, size=256, radius=100, stray=False, dtype="float32", nodata=float("nan"))
        with rasterio.open(raw) as src:
            block = src.read()
            block[1, 128, 128] = np.nan
            assert not preprocess._valid_mask(src, block)[128, 128]
            assert preprocess._valid_mask(src, block)[128, 129]

    def test_rotated_transforms_use_all_four_corners(self):
        from types import SimpleNamespace

        from rasterio.crs import CRS
        from rasterio.transform import Affine

        from app import preprocess

        t = Affine.translation(500000, 3000000) * Affine.rotation(30) * Affine.scale(0.5, -0.5)
        src = SimpleNamespace(transform=t, crs=CRS.from_epsg(32644))
        window = Window(0, 0, 1000, 2000)
        assert preprocess._window_extent_km(src, window) == pytest.approx((0.5, 1.0))
        w, s_, e, n = preprocess._window_bounds(t, window)
        corners = [t * c for c in ((0, 0), (1000, 0), (0, 2000), (1000, 2000))]
        assert w == min(x for x, _ in corners) and n == max(y for _, y in corners)
        assert e - w > 500                        # wider than the unrotated 500 m

    def test_verification_samples_only_data_tiles_and_the_outermost_ones(self):
        """M4: all-nodata tiles prove nothing; the footprint's extremes must be checked."""
        from app import preprocess

        tiles = [[x, y] for y in range(10) for x in range(10) if abs(x - 4.5) + abs(y - 4.5) < 5]
        picked = preprocess._pick_tiles(tiles, 16)
        assert len(picked) == 16 and set(picked) <= {tuple(t) for t in tiles}
        for key in (lambda t: t[0] + t[1], lambda t: t[0] - t[1]):
            assert min(map(key, tiles)) in {key(t) for t in picked}
            assert max(map(key, tiles)) in {key(t) for t in picked}
        assert preprocess._pick_tiles(tiles[:3], 16) == sorted(map(tuple, tiles[:3]))
        with pytest.raises(preprocess.IngestVerificationError):
            preprocess._pick_tiles([], 16)

    def test_sha256_is_of_the_raw_upload_and_of_the_archive(self, tmp_path):
        raw, result = _ingest(tmp_path)
        assert result.raw_sha256 == hashlib.sha256(raw.read_bytes()).hexdigest()
        assert result.archive_sha256 == hashlib.sha256(
            result.archive_path.read_bytes()).hexdigest()
        assert result.archive_bytes == result.archive_path.stat().st_size

    def test_display_cog_is_zstd_and_cropped(self, tmp_path):
        _, result = _ingest(tmp_path)
        with rasterio.open(result.cog_path) as cog:
            assert cog.compression.name.lower() == "zstd"
            assert cog.tags(ns="IMAGE_STRUCTURE")["PREDICTOR"] == "2"
            assert (cog.width, cog.height) == result.crop_window[2:]
            assert cog.dtypes[0] == "uint8" and cog.overviews(1)
        leftovers = [p.name for p in (tmp_path / "cogs").iterdir() if ".tmp" in p.name]
        assert leftovers == []

    def test_a_raster_without_crs_is_rejected(self, tmp_path):
        from app import preprocess

        raw = tmp_path / "raster_1.tif"
        make_tile(raw, size=256, radius=100, crs=None)
        with pytest.raises(preprocess.IngestRejected, match="no CRS"):
            preprocess.ingest_raster(raw, tmp_path / "cogs" / "raster_1.tif")

    def test_a_corrupted_archive_fails_verification_and_is_removed(self, tmp_path, monkeypatch):
        from app import preprocess

        real = preprocess._write_strip

        def corrupting(archive_tmp, display_tmp, window, block, mask, display):
            block = block.copy()
            block[0] ^= 1
            real(archive_tmp, display_tmp, window, block, mask, display)

        monkeypatch.setattr(preprocess, "_write_strip", corrupting)
        raw = tmp_path / "raster_1.tif"
        make_tile(raw)
        with pytest.raises(preprocess.IngestVerificationError):
            preprocess.ingest_raster(raw, tmp_path / "cogs" / "raster_1.tif")
        assert not (tmp_path / "raster_1.archive.tif").exists()
        assert not (tmp_path / "raster_1.archive.tmp.tif").exists()
        assert raw.exists()


class _Killed(RuntimeError):
    pass


def _kill_after(monkeypatch, strips: int) -> list[int]:
    """Make the strip writer die after `strips` strips; returns the call log."""
    from app import preprocess

    real, calls = getattr(preprocess._write_strip, "real", preprocess._write_strip), []

    def writer(*args):
        if len(calls) >= strips:
            raise _Killed("killed mid-ingest")
        calls.append(int(args[2].row_off))
        real(*args)

    writer.real = real
    monkeypatch.setattr(preprocess, "_write_strip", writer)
    return calls


class TestCheckpoint:
    def test_an_interrupted_ingest_resumes_from_the_next_strip(self, tmp_path, monkeypatch):
        from app import preprocess

        monkeypatch.setattr(preprocess, "INGEST_BLOCK_BYTES", 1)     # 512-row strips
        raw = tmp_path / "raster_1.tif"
        make_tile(raw, max_dn=255, stray=False)
        cog = tmp_path / "cogs" / "raster_1.tif"

        _kill_after(monkeypatch, 1)
        with pytest.raises(_Killed):
            preprocess.ingest_raster(raw, cog)
        checkpoint = json.loads(cog.with_suffix(".tmp.json").read_text())
        assert checkpoint["done"] == 1 and checkpoint["strips"] == 3
        assert cog.with_suffix(".tmp.tif").exists()
        assert (tmp_path / "raster_1.archive.tmp.tif").exists()

        calls = _kill_after(monkeypatch, 99)
        result = preprocess.ingest_raster(raw, cog)
        assert calls == [512, 1024]                   # strips 2 and 3 only (crop-relative)
        _assert_pixel_exact(raw, result)
        assert not cog.with_suffix(".tmp.json").exists()

    def test_a_checkpoint_for_another_crop_starts_over(self, tmp_path, monkeypatch):
        from app import preprocess

        monkeypatch.setattr(preprocess, "INGEST_BLOCK_BYTES", 1)
        raw = tmp_path / "raster_1.tif"
        make_tile(raw, stray=False)
        cog = tmp_path / "cogs" / "raster_1.tif"
        _kill_after(monkeypatch, 1)
        with pytest.raises(_Killed):
            preprocess.ingest_raster(raw, cog)
        sidecar = cog.with_suffix(".tmp.json")
        state = json.loads(sidecar.read_text())
        state["crop"][0] += 1
        sidecar.write_text(json.dumps(state))

        calls = _kill_after(monkeypatch, 99)
        preprocess.ingest_raster(raw, cog)
        assert calls == [0, 512, 1024]


@pytest.fixture
def uploaded(engine, db, project, tmp_path, monkeypatch):
    """A processing raster row whose raw upload and .tfw sit in tmp_path."""
    from app import jobs

    monkeypatch.setattr(jobs.gpu, "runtime_info", lambda: {"tier": "cpu"})
    row = models.Raster(project_id=project.id, name="T1", original_path="", status="processing")
    db.add(row)
    db.commit()
    for stale in jobs.settings.cogs_dir.glob(f"raster_{row.id}.*"):
        stale.unlink()
    raw = tmp_path / f"raster_{row.id}.tif"
    make_tile(raw, max_dn=255, stray=False)
    raw.with_suffix(".tfw").write_text("0.5\n0\n0\n-0.5\n500000.25\n2999999.75\n")
    row.original_path = str(raw)
    db.commit()
    return row, raw


def _row(db, raster_id):
    db.expire_all()
    return db.get(models.Raster, raster_id)


class TestJobs:
    def test_raw_upload_is_deleted_only_after_the_row_is_ready(self, db, uploaded, monkeypatch):
        from ada_core.database import SessionLocal

        from app import jobs

        row, raw = uploaded
        seen: list[str] = []
        real = jobs._delete_upload

        def delete(original):
            with SessionLocal() as other:
                seen.append(other.get(models.Raster, row.id).status)
            assert original.exists()
            real(original)

        monkeypatch.setattr(jobs, "_delete_upload", delete)
        jobs._run_ingest_safe(row.id)

        assert seen == ["ready"]
        after = _row(db, row.id)
        assert after.status == "ready" and after.tier == "cpu"
        assert after.archive_path.endswith(f"raster_{row.id}.archive.tif")
        assert after.archive_sha256 and after.archive_bytes > 0
        assert after.sha256 and len(after.sha256) == 64
        assert not raw.exists() and not raw.with_suffix(".tfw").exists()

    def test_a_failed_verification_keeps_the_raw_and_is_retryable(self, db, uploaded,
                                                                   monkeypatch):
        from app import jobs

        def fail(*_a, **_k):
            raise jobs.preprocess.IngestVerificationError("archive verification failed: x")

        monkeypatch.setattr(jobs.preprocess, "_verify_archive", fail)
        row, raw = uploaded
        jobs._run_ingest_safe(row.id)

        after = _row(db, row.id)
        assert after.status == "failed_retryable"
        assert "verification" in after.reject_reason and after.error == after.reject_reason
        assert raw.exists()
        assert not (raw.parent / f"raster_{row.id}.archive.tif").exists()

    def test_out_of_memory_is_retryable_and_keeps_the_raw(self, db, uploaded, monkeypatch):
        from app import jobs

        def oom(*_a, **_k):
            raise MemoryError("cannot allocate")

        monkeypatch.setattr(jobs.preprocess, "ingest_raster", oom)
        row, raw = uploaded
        jobs._run_ingest_safe(row.id)
        assert _row(db, row.id).status == "failed_retryable"
        assert raw.exists()

    def test_a_decode_error_mid_pass_is_retryable(self, db, uploaded, monkeypatch):
        """M3: only no-CRS or an unopenable file is final; a read error mid-pass is not."""
        from rasterio.errors import RasterioIOError

        from app import jobs

        def broken(*_a, **_k):
            raise RasterioIOError("TIFFReadEncodedTile failed")

        monkeypatch.setattr(jobs.preprocess, "_write_strip", broken)
        row, raw = uploaded
        row.retry_count = 2
        db.commit()
        jobs._run_ingest_safe(row.id)
        after = _row(db, row.id)
        assert after.status == "failed_retryable"
        assert after.retry_count == 2            # the api sweeper owns the count
        assert raw.exists()

    def test_progress_timestamps_are_ist(self, db, uploaded):
        """SQLite stores naive values and the sweeper reads them as IST."""
        from ada_core.datetimes import now_ist

        from app import jobs

        row, _ = uploaded
        jobs._run_ingest_safe(row.id)
        stamp = _row(db, row.id).last_progress_at.replace(tzinfo=None)
        assert abs((now_ist().replace(tzinfo=None) - stamp).total_seconds()) < 120

    def test_the_upload_sidecars_go_with_it_in_any_case(self, uploaded):
        from app import jobs

        _, raw = uploaded
        for name in (f"{raw.stem}.PRJ", f"{raw.name}.aux.xml", f"{raw.stem}.ovr"):
            (raw.parent / name).write_text("x")
        keep = raw.parent / f"{raw.stem}.archive.tif"
        keep.write_text("archive")
        jobs._delete_upload(raw)
        left = sorted(p.name for p in raw.parent.iterdir() if p.name.startswith(raw.stem))
        assert left == [keep.name]

    def test_an_unusable_upload_fails_for_good_and_is_deleted(self, db, uploaded, monkeypatch):
        from app import jobs

        def reject(*_a, **_k):
            raise jobs.preprocess.IngestRejected("Raster has no CRS.")

        monkeypatch.setattr(jobs.preprocess, "ingest_raster", reject)
        row, raw = uploaded
        jobs._run_ingest_safe(row.id)
        after = _row(db, row.id)
        assert after.status == "failed" and after.reject_reason == "Raster has no CRS."
        assert not raw.exists() and not raw.with_suffix(".tfw").exists()

    def test_an_interrupted_ingest_is_resumed_by_the_retry(self, db, uploaded, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.preprocess, "INGEST_BLOCK_BYTES", 1)
        row, raw = uploaded
        _kill_after(monkeypatch, 1)
        jobs._run_ingest_safe(row.id)
        after = _row(db, row.id)
        assert after.status == "failed_retryable"
        assert after.stage == "strip:1/3"
        assert raw.exists()

        calls = _kill_after(monkeypatch, 99)
        jobs._run_ingest_safe(row.id)
        assert len(calls) == 2
        assert _row(db, row.id).status == "ready"
        assert not raw.exists()

    def test_a_ready_raster_is_not_re_ingested(self, db, uploaded, monkeypatch):
        from app import jobs

        row, raw = uploaded
        row.status = "ready"
        db.commit()
        monkeypatch.setattr(jobs.preprocess, "ingest_raster",
                            lambda *a, **k: pytest.fail("re-ingested a ready raster"))
        jobs._run_ingest_safe(row.id)
        assert raw.exists()


class TestSuperimposeSources:
    @pytest.fixture
    def pair(self, tmp_path):
        from app import preprocess

        out = []
        for i in (1, 2):
            raw = tmp_path / f"raster_{i}.tif"
            make_tile(raw, size=768, radius=300, stray=False, seed=i)
            out.append(preprocess.ingest_raster(raw, tmp_path / "cogs" / raw.name))
        return out

    def test_index_mode_reads_the_archive(self, pair, monkeypatch):
        from app import preprocess
        from app.config import settings

        monkeypatch.setattr(settings, "vegetation_mode", "index")
        a, b = (preprocess.EpochSource(archive=r.archive_path, cog=r.cog_path, raster_id=i)
                for i, r in enumerate(pair, start=1))
        aligned = preprocess.superimpose(a, b)
        assert aligned.source_tier == "archive"
        assert aligned.grid_m_per_px == pytest.approx(0.5, rel=0.05)
        km = aligned.t1.shape[1] * aligned.grid_m_per_px / 1000
        assert aligned.grid_extent_km[0] == pytest.approx(km, rel=0.05)
        w, s, e, n = aligned.grid_bounds_4326
        assert w < e and s < n

    def test_a_cold_raster_uses_its_cog_in_learned_mode(self, pair, monkeypatch):
        from app import preprocess
        from app.config import settings

        monkeypatch.setattr(settings, "vegetation_mode", "learned")
        a = preprocess.EpochSource(archive=pair[0].archive_path, cog=pair[0].cog_path)
        pair[1].archive_path.unlink()
        b = preprocess.EpochSource(archive=pair[1].archive_path, cog=pair[1].cog_path,
                                   cold=True, raster_id=2)
        assert preprocess.superimpose(a, b).source_tier == "cog"

    def test_index_mode_on_a_cold_raster_names_the_restore_endpoint(self, pair, monkeypatch):
        from app import preprocess
        from app.config import settings

        monkeypatch.setattr(settings, "vegetation_mode", "index")
        pair[1].archive_path.unlink()
        a = preprocess.EpochSource(archive=pair[0].archive_path, cog=pair[0].cog_path)
        b = preprocess.EpochSource(archive=pair[1].archive_path, cog=pair[1].cog_path,
                                   cold=True, raster_id=2)
        with pytest.raises(preprocess.ColdRasterError,
                           match=r"raster 2 is archived; restore it via POST /rasters/2/restore"):
            preprocess.superimpose(a, b)

    def test_a_cold_raster_without_any_file_fails_before_models_load(self, db, project):
        from app import jobs

        row = models.Raster(project_id=project.id, name="old", original_path="/gone.tif",
                            status="cold", archive_path="/gone.archive.tif")
        db.add(row)
        db.commit()
        with pytest.raises(jobs.preprocess.ColdRasterError):
            jobs._epoch_source(row)
