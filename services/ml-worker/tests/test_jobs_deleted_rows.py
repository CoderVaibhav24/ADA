"""The API may delete a raster or a run while the worker is still on it."""

from __future__ import annotations

import pytest
from ada_core import models


def _gone(db, row) -> None:
    db.delete(row)
    db.commit()


@pytest.fixture
def original(tmp_path, db, raster):
    path = tmp_path / "t1.tif"
    path.write_bytes(b"II*\x00")
    raster.original_path = str(path)
    db.commit()
    return path


def test_an_ingest_whose_row_is_deleted_mid_run_stops_quietly(db, raster, original,
                                                              monkeypatch):
    from app import jobs

    carried_on: list[bool] = []

    def ingest(_src, cog_path, report):
        cog_path.parent.mkdir(parents=True, exist_ok=True)
        cog_path.with_suffix(".tmp.tif").write_bytes(b"staging")
        _gone(db, raster)
        report(0.5, "Converting to 8-bit — strip 1/2")
        carried_on.append(True)

    monkeypatch.setattr(jobs.preprocess, "ingest_raster", ingest)
    raster_id = raster.id
    jobs._run_ingest_safe(raster_id)

    assert carried_on == []
    assert db.get(models.Raster, raster_id) is None
    assert not (jobs.settings.cogs_dir / f"raster_{raster_id}.tmp.tif").exists()


def test_an_ingest_that_finishes_after_its_row_is_deleted_leaves_no_cog(
        db, raster, original, monkeypatch):
    from app import jobs

    archive = original.with_name("t1.archive.tif")

    def ingest(_src, cog_path, _report):
        cog_path.parent.mkdir(parents=True, exist_ok=True)
        cog_path.write_bytes(b"cog")
        archive.write_bytes(b"archive")
        _gone(db, raster)
        return jobs.preprocess.IngestResult(
            cog_path=cog_path, archive_path=archive, raw_sha256="0" * 64,
            archive_sha256="1" * 64, archive_bytes=7, crop_window=(0, 0, 1, 1),
            extent_km=(0.1, 0.1), m_per_px=0.1, narrowed_dtype="uint8",
            crs="EPSG:32644", bounds_4326=[0, 0, 1, 1], resolution_m=0.1)

    monkeypatch.setattr(jobs.preprocess, "ingest_raster", ingest)
    raster_id = raster.id
    jobs._run_ingest_safe(raster_id)

    assert not (jobs.settings.cogs_dir / f"raster_{raster_id}.tif").exists()
    assert not archive.exists()
    assert not original.exists()     # no row, so the upload is an orphan


def test_update_in_flight_ignores_a_deleted_job(db, job):
    from app import jobs

    job_id = job.id
    _gone(db, job)
    assert jobs._update_in_flight(job_id, status="failed", error="x") is False


def test_a_run_whose_job_was_deleted_discards_its_outputs(db, job):
    from app import jobs

    job_id = job.id
    jobs.settings.masks_dir.mkdir(parents=True, exist_ok=True)
    outputs = [jobs.settings.masks_dir / f"job_{job_id}_{part}.tif"
               for part in ("mask", "t1", "t2")]
    for path in outputs:
        path.write_bytes(b"x")
    _gone(db, job)

    assert jobs._persist_result(job_id, [], {"status": "done"}) is False
    assert not any(path.exists() for path in outputs)
    assert db.query(models.ChangePolygon).count() == 0
