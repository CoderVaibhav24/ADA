"""The raster lifecycle sweeper, driven one tick at a time with a fake clock."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from datetime import timedelta

import pytest
from ada_core import models
from ada_core.database import SessionLocal
from ada_core.datetimes import now_ist

from app import sweeper
from app.coldstore import ColdStore, split_ref
from tests.fake_s3 import FakeS3

NOW = now_ist()


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "data_dir", tmp_path)
    for directory in (settings.uploads_dir, settings.cogs_dir, settings.masks_dir):
        directory.mkdir(parents=True, exist_ok=True)
    sweeper._progress_seen.clear()
    sweeper.stop_event.clear()
    yield settings
    sweeper.stop_event.clear()


@pytest.fixture
def submitted():
    return []


IDLE_ML = {"status": "ok", "in_flight": {"rasters": [], "jobs": []}}


def sweep(submitted, *, now=NOW, ml_ready=True, ml=None, cold=None):
    body = ml if ml is not None else (IDLE_ML if ml_ready else None)
    return sweeper.sweep_once(SessionLocal, now, lambda: body, cold, submit=submitted.append)


def _file(path, data=b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def _raster(db, project, **fields):
    fields.setdefault("original_path", "")
    row = models.Raster(project_id=project.id, name="T", **fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _reload(db, row):
    db.expire_all()
    return db.get(models.Raster, row.id)


# ------------------------------------------------------------------ uploads
def test_an_idle_upload_expires_with_its_part(db, project, isolated_data, submitted):
    uploads = isolated_data.uploads_dir
    stale = _raster(db, project, status="uploading", chunk_size=1, chunk_count=1,
                    last_chunk_at=NOW - timedelta(hours=25))
    fresh = _raster(db, project, status="uploading", chunk_size=1, chunk_count=1,
                    last_chunk_at=NOW - timedelta(hours=2))
    stale_part = _file(uploads / f"raster_{stale.id}.part")
    stale_tfw = _file(uploads / f"raster_{stale.id}.tfw")
    fresh_part = _file(uploads / f"raster_{fresh.id}.part")
    stale_id = stale.id

    report = sweep(submitted)
    assert report.expired == 1
    db.expire_all()
    assert db.get(models.Raster, stale_id) is None
    assert not stale_part.exists() and not stale_tfw.exists()
    assert fresh_part.exists() and _reload(db, fresh).status == "uploading"


def test_rejected_and_failed_rows_are_purged_after_retention(db, project, submitted):
    long_ago = NOW - timedelta(days=9)
    old = _raster(db, project, status="rejected", uploaded_at=long_ago,
                  last_progress_at=NOW - timedelta(days=8))
    old_failed = _raster(db, project, status="failed", uploaded_at=long_ago,
                         last_progress_at=NOW - timedelta(days=8))
    young = _raster(db, project, status="rejected", last_progress_at=NOW - timedelta(days=2))
    ids = (old.id, old_failed.id)
    assert sweep(submitted).purged == 2
    db.expire_all()
    assert all(db.get(models.Raster, i) is None for i in ids)
    assert db.get(models.Raster, young.id) is not None


# ------------------------------------------------------------------ processing
def _stuck(db, project, isolated_data, **fields):
    row = _raster(db, project, status="processing",
                  last_progress_at=NOW - timedelta(minutes=31), **fields)
    row.original_path = str(_file(isolated_data.uploads_dir / f"raster_{row.id}.tif"))
    db.commit()
    return row


def test_a_stuck_ingest_is_resubmitted(db, project, isolated_data, submitted):
    row = _stuck(db, project, isolated_data)
    report = sweep(submitted)
    assert report.resubmitted == 1 and submitted == [row.id]
    assert _reload(db, row).retry_count == 1


def test_nothing_is_resubmitted_while_ada_ml_is_down(db, project, isolated_data, submitted):
    row = _stuck(db, project, isolated_data)
    assert sweep(submitted, ml_ready=False).resubmitted == 0
    assert submitted == [] and _reload(db, row).retry_count == 0


def test_a_recent_ingest_is_left_alone(db, project, isolated_data, submitted):
    _raster(db, project, status="processing", last_progress_at=NOW - timedelta(minutes=5))
    assert sweep(submitted).resubmitted == 0


def test_an_ingest_whose_progress_moves_is_never_stuck(db, project, isolated_data, submitted):
    row = _stuck(db, project, isolated_data)
    row.last_progress_at = NOW - timedelta(minutes=20)
    db.commit()
    sweep(submitted)
    row = _reload(db, row)
    row.progress = 0.5
    db.commit()
    assert sweep(submitted, now=NOW + timedelta(minutes=15)).resubmitted == 0
    assert submitted == []


def test_three_resubmits_then_failed_retryable_then_failed(db, project, isolated_data,
                                                           submitted):
    row = _stuck(db, project, isolated_data, retry_count=3)
    assert sweep(submitted).escalated == 1
    row = _reload(db, row)
    assert row.status == "failed_retryable" and row.retry_count == 0 and submitted == []

    clock = NOW
    for attempt in range(1, sweeper.RETRY_LIMIT + 1):
        clock += sweeper.RETRY_BACKOFF * 2 ** (attempt - 1) + timedelta(minutes=1)
        assert sweep(submitted, now=clock).resubmitted == 1
        row = _reload(db, row)
        assert row.status == "processing" and row.retry_count == attempt
        raw = row.original_path
        clock += timedelta(minutes=31)
        report = sweep(submitted, now=clock)
        if attempt < sweeper.RETRY_LIMIT:
            assert _reload(db, row).status == "failed_retryable"

    assert report.failed == 1
    row = _reload(db, row)
    assert row.status == "failed" and row.error
    assert not os.path.exists(raw)
    assert len(submitted) == sweeper.RETRY_LIMIT


def test_a_worker_set_failed_retryable_gets_three_retries(db, project, isolated_data,
                                                          submitted):
    row = _stuck(db, project, isolated_data, reject_reason="retryable: out of memory")
    row.status = "failed_retryable"
    db.commit()
    for _ in range(sweeper.RETRY_LIMIT):
        row = _reload(db, row)
        row.status, row.last_progress_at = "failed_retryable", NOW - timedelta(days=1)
        db.commit()
        assert sweep(submitted).resubmitted == 1
    row = _reload(db, row)
    row.status = "failed_retryable"
    db.commit()
    assert sweep(submitted).failed == 1
    assert len(submitted) == 3


def test_a_held_lock_skips_the_tick(monkeypatch):
    ran = []
    monkeypatch.setattr(sweeper, "_acquire_lock", lambda: (False, lambda: None))
    monkeypatch.setattr(sweeper, "_locked_tick", lambda: ran.append(1))
    assert sweeper._tick() is None
    assert ran == []


def test_an_acquired_lock_runs_and_releases(monkeypatch):
    released = []
    monkeypatch.setattr(sweeper, "_acquire_lock", lambda: (True, lambda: released.append(1)))
    monkeypatch.setattr(sweeper, "_locked_tick", lambda: "report")
    assert sweeper._tick() == "report"
    assert released == [1]


def test_sqlite_takes_no_advisory_lock(engine):
    acquired, release = sweeper._acquire_lock()
    assert acquired
    release()


def test_failed_retryable_waits_out_its_backoff(db, project, isolated_data, submitted):
    row = _stuck(db, project, isolated_data, retry_count=1)
    row.status = "failed_retryable"
    row.last_progress_at = NOW - timedelta(minutes=20)
    db.commit()
    assert sweep(submitted).resubmitted == 0
    assert sweep(submitted, now=NOW + timedelta(minutes=11)).resubmitted == 1


def test_a_stuck_ingest_whose_upload_is_gone_fails(db, project, submitted):
    row = _raster(db, project, status="processing", original_path="/nope/raster.tif",
                  last_progress_at=NOW - timedelta(hours=1))
    assert sweep(submitted).failed == 1
    assert _reload(db, row).status == "failed"


# ------------------------------------------------------------------ ready
def _archived(db, project, isolated_data, *, good=True, **fields):
    uploads = isolated_data.uploads_dir
    row = _raster(db, project, status="ready", **fields)
    archive = _file(uploads / f"raster_{row.id}.archive.tif", b"archive-bytes" * 100)
    raw = _file(uploads / f"raster_{row.id}.tif", b"raw-bytes")
    cog = _file(isolated_data.cogs_dir / f"raster_{row.id}.tif", b"cog")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    row.archive_path, row.original_path, row.cog_path = str(archive), str(raw), str(cog)
    row.archive_sha256 = digest if good else "0" * 64
    row.archive_bytes = archive.stat().st_size
    db.commit()
    return row, archive, raw, cog


def test_ready_with_a_verified_archive_drops_the_raw(db, project, isolated_data, submitted):
    row, archive, raw, cog = _archived(db, project, isolated_data)
    tfw = _file(raw.with_suffix(".tfw"))
    assert sweep(submitted).raw_deleted == 1
    assert not raw.exists() and not tfw.exists()
    assert archive.exists() and cog.exists()


def test_an_archive_that_fails_its_hash_keeps_the_raw(db, project, isolated_data, submitted):
    _row, archive, raw, _cog = _archived(db, project, isolated_data, good=False)
    report = sweep(submitted)
    assert report.raw_deleted == 0 and report.errors == 1
    assert raw.exists() and archive.exists()


# ------------------------------------------------------------------ orphans
def _age(path, hours):
    stamp = (NOW - timedelta(hours=hours)).timestamp()
    os.utime(path, (stamp, stamp))
    return path


def test_orphans_older_than_a_day_are_deleted(db, project, isolated_data, submitted):
    settings = isolated_data
    owned = _raster(db, project, status="ready")
    job = models.AnalysisJob(project_id=project.id, raster_t1_id=owned.id,
                             raster_t2_id=owned.id, status="done")
    db.add(job)
    db.commit()
    orphan = _age(_file(settings.uploads_dir / "raster_9999.tif"), 25)
    orphan_cog = _age(_file(settings.cogs_dir / "raster_9999.tif.ovr"), 25)
    orphan_mask = _age(_file(settings.masks_dir / "job_8888_mask.tif"), 25)
    young = _age(_file(settings.uploads_dir / "raster_9998.part"), 2)
    kept = [_age(_file(settings.uploads_dir / f"raster_{owned.id}.tif"), 500),
            _age(_file(settings.masks_dir / f"job_{job.id}_mask.tif"), 500),
            _age(_file(settings.uploads_dir / "icms-evidence" / "raster_1.tif"), 500),
            _age(_file(settings.uploads_dir / "notes.txt"), 500)]

    assert sweep(submitted).orphans == 3
    assert not orphan.exists() and not orphan_cog.exists() and not orphan_mask.exists()
    assert young.exists()
    assert all(p.exists() for p in kept)


# ------------------------------------------------------------------ cold tier
def _cold_store(**kwargs):
    s3 = FakeS3(**{k: v for k, v in kwargs.items() if k != "storage_class"})
    return s3, ColdStore(s3, "ada-cold", part_bytes=512,
                         storage_class=kwargs.get("storage_class", "STANDARD"))


def _idle_archive(db, project, isolated_data, days=181):
    row, archive, raw, cog = _archived(db, project, isolated_data,
                                       last_used_at=NOW - timedelta(days=days))
    raw.unlink()
    return row, archive, cog


def test_an_idle_ready_raster_moves_to_cold(db, project, isolated_data, submitted):
    s3, cold = _cold_store()
    row, archive, cog = _idle_archive(db, project, isolated_data)
    assert sweep(submitted, cold=cold).cold_moved == 1
    row = _reload(db, row)
    assert row.status == "cold"
    key, version = split_ref(row.cold_key)
    assert key == f"rasters/{project.id}/raster_{row.id}/archive.tif" and version
    assert row.cold_at is not None
    assert key in s3.objects
    assert not archive.exists() and cog.exists()


def test_nothing_moves_without_a_cold_store(db, project, isolated_data, submitted):
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    assert sweep(submitted).cold_moved == 0
    assert _reload(db, row).status == "ready" and archive.exists()


def test_a_recently_used_raster_stays_warm(db, project, isolated_data, submitted):
    _s3, cold = _cold_store()
    row, archive, _cog = _idle_archive(db, project, isolated_data, days=179)
    assert sweep(submitted, cold=cold).cold_moved == 0
    assert archive.exists()


def test_a_cold_copy_that_fails_verification_keeps_the_archive(db, project, isolated_data,
                                                               submitted):
    _s3, cold = _cold_store(checksums=False, corrupt=True)
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    report = sweep(submitted, cold=cold)
    assert report.cold_moved == 0 and report.errors == 1
    assert _reload(db, row).status == "ready" and archive.exists()


def test_an_unreachable_bucket_never_deletes(db, project, isolated_data, submitted):
    _s3, cold = _cold_store(down=True)
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    report = sweep(submitted, cold=cold)
    assert report.cold_moved == 0 and report.errors == 1
    assert _reload(db, row).status == "ready" and archive.exists()


def test_a_standard_class_restore_downloads_and_verifies(db, project, isolated_data,
                                                         submitted):
    s3, cold = _cold_store()
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    sweep(submitted, cold=cold)
    row = _reload(db, row)
    row.status = "restoring"
    db.commit()
    assert sweep(submitted, cold=cold).restored == 1
    row = _reload(db, row)
    assert row.status == "ready" and archive.exists()
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == row.archive_sha256


def test_an_archival_restore_waits_for_the_bucket(db, project, isolated_data, submitted):
    s3, cold = _cold_store(archival=True, storage_class="DEEP_ARCHIVE")
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    sweep(submitted, cold=cold)
    row = _reload(db, row)
    row.status = "restoring"
    db.commit()
    assert sweep(submitted, cold=cold).restores_requested == 1
    assert sweep(submitted, cold=cold).restored == 0
    s3.finish_restore(split_ref(row.cold_key)[0])
    assert sweep(submitted, cold=cold).restored == 1
    assert _reload(db, row).status == "ready" and archive.exists()


def test_a_restore_that_fails_its_hash_stays_restoring(db, project, isolated_data, submitted):
    s3, cold = _cold_store()
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    sweep(submitted, cold=cold)
    row = _reload(db, row)
    row.status = "restoring"
    db.commit()
    s3.objects[split_ref(row.cold_key)[0]]["data"] = b"tampered"
    report = sweep(submitted, cold=cold)
    assert report.restored == 0 and report.errors == 1
    assert _reload(db, row).status == "restoring" and not archive.exists()


# ------------------------------------------------------------------ disk + loop
def test_the_disk_guard_logs_an_error(db, submitted, monkeypatch, caplog):
    monkeypatch.setattr(sweeper, "disk_free_pct", lambda usage=None: 4.0)
    with caplog.at_level(logging.ERROR, logger="ada.sweeper"):
        report = sweep(submitted)
    assert report.disk_low
    assert "disk low" in caplog.text
    assert sweeper.last_report is report


def test_run_forever_ticks_and_cancels(monkeypatch):
    from app.config import settings

    ticks = []
    monkeypatch.setattr(sweeper, "_tick", lambda: ticks.append(1))
    monkeypatch.setattr(settings, "sweeper_interval_seconds", 0.01)

    async def drive():
        task = asyncio.create_task(sweeper.run_forever())
        await asyncio.sleep(0.1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(drive())
    assert len(ticks) >= 2


# ------------------------------------------------------------------ review fixes
def test_a_raster_in_ada_mls_queue_is_never_stuck(db, project, isolated_data, submitted):
    row = _stuck(db, project, isolated_data, retry_count=3)
    busy = {"status": "ok", "in_flight": {"rasters": [row.id], "jobs": []}}
    report = sweep(submitted, ml=busy, now=NOW + timedelta(hours=6))
    assert report.resubmitted == report.escalated == report.failed == 0
    assert _reload(db, row).status == "processing"


def test_without_in_flight_only_one_blind_resubmit_and_never_fail(db, project, isolated_data,
                                                                   submitted):
    row = _stuck(db, project, isolated_data)
    blind = {"status": "ok"}
    assert sweep(submitted, ml=blind).resubmitted == 1
    later = NOW + timedelta(hours=2)
    report = sweep(submitted, ml=blind, now=later)
    assert report.resubmitted == report.escalated == report.failed == 0
    row = _reload(db, row)
    row.status, row.retry_count = "failed_retryable", sweeper.RETRY_LIMIT
    db.commit()
    assert sweep(submitted, ml=blind, now=later).failed == 0
    row = _reload(db, row)
    assert row.status == "failed_retryable" and os.path.exists(row.original_path)


def test_a_refused_resubmit_does_not_count(db, project, isolated_data):
    row = _stuck(db, project, isolated_data)

    def refuse(raster_id):
        raise RuntimeError("503")

    report = sweeper.sweep_once(SessionLocal, NOW, lambda: IDLE_ML, None, submit=refuse)
    assert report.resubmitted == 0 and report.errors == 1
    row = _reload(db, row)
    assert row.retry_count == 0 and row.status == "processing"


def test_a_stale_completing_row_is_reopened_not_deleted(db, project, isolated_data,
                                                        submitted):
    row = _raster(db, project, status="completing", chunk_size=1, chunk_count=1,
                  last_progress_at=NOW - timedelta(hours=3))
    young = _raster(db, project, status="completing", chunk_size=1, chunk_count=1,
                    last_progress_at=NOW - timedelta(minutes=30))
    part = _file(isolated_data.uploads_dir / f"raster_{row.id}.part")
    report = sweep(submitted)
    assert report.reopened == 1 and report.expired == 0
    row = _reload(db, row)
    assert row.status == "uploading" and part.exists()
    assert _aware_eq(row.last_chunk_at, NOW)
    assert _reload(db, young).status == "completing"


def _aware_eq(value, expected):
    return sweeper._aware(value) == expected


def test_in_flight_is_read_before_the_rows(db, project, isolated_data, submitted):
    row = _stuck(db, project, isolated_data, retry_count=3, reject_reason="x")
    row.status = "failed_retryable"
    db.commit()
    raw = row.original_path

    def finishes_while_asked():
        with SessionLocal() as other:
            other.get(models.Raster, row.id).status = "ready"
            other.commit()
        return IDLE_ML

    report = sweeper.sweep_once(SessionLocal, NOW, finishes_while_asked, None,
                                submit=submitted.append)
    assert report.failed == report.resubmitted == 0
    assert _reload(db, row).status == "ready" and os.path.exists(raw)


def test_a_stale_row_is_never_failed_over_ready(db, project, isolated_data):
    row = _stuck(db, project, isolated_data)
    stale = SessionLocal()
    snapshot = stale.get(models.Raster, row.id)
    with SessionLocal() as other:
        other.get(models.Raster, row.id).status = "ready"
        other.commit()
    report = sweeper.SweepReport(at=NOW)
    sweeper._fail(snapshot, stale, NOW, "late", report)
    stale.close()
    assert report.failed == 0
    row = _reload(db, row)
    assert row.status == "ready" and os.path.exists(row.original_path)


def test_a_stale_row_is_never_resubmitted_over_ready(db, project, isolated_data, submitted):
    row = _stuck(db, project, isolated_data)
    stale = SessionLocal()
    snapshot = stale.get(models.Raster, row.id)
    with SessionLocal() as other:
        other.get(models.Raster, row.id).status = "ready"
        other.commit()
    report = sweeper.SweepReport(at=NOW)
    assert sweeper._resubmit(snapshot, stale, NOW, submitted.append, report) is False
    stale.close()
    assert submitted == [] and _reload(db, row).status == "ready"


def test_a_cold_move_rechecks_the_archive_hash_first(db, project, isolated_data, submitted):
    s3, cold = _cold_store()
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    archive.write_bytes(b"bit rot")
    report = sweep(submitted, cold=cold)
    assert report.cold_moved == 0 and report.errors == 1
    assert s3.calls == [] and archive.exists()


def test_a_raster_used_during_its_cold_upload_stays_warm(db, project, isolated_data,
                                                        submitted):
    s3, cold = _cold_store()
    row, archive, _cog = _idle_archive(db, project, isolated_data)
    row_id = row.id
    real_put = cold.put_archive

    def put_while_used(*args, **kwargs):
        result = real_put(*args, **kwargs)
        with SessionLocal() as other:
            other.get(models.Raster, row_id).last_used_at = NOW
            other.commit()
        return result

    cold.put_archive = put_while_used
    assert sweep(submitted, cold=cold).cold_moved == 0
    row = _reload(db, row)
    assert row.status == "ready" and row.cold_key is None and archive.exists()


def test_the_advisory_lock_transaction_is_committed_at_once(monkeypatch):
    from types import SimpleNamespace

    import ada_core.database as database

    calls = []

    class Conn:
        def execute(self, statement, params=None):
            calls.append(str(statement))
            return SimpleNamespace(scalar=lambda: True)

        def commit(self):
            calls.append("commit")

        def close(self):
            calls.append("close")

    engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), connect=Conn)
    monkeypatch.setattr(database, "get_engine", lambda: engine)
    acquired, release = sweeper._acquire_lock()
    assert acquired
    assert calls == ["SELECT pg_try_advisory_lock(:k)", "commit"]
    release()
    assert calls[-3:] == ["SELECT pg_advisory_unlock(:k)", "commit", "close"]


def test_a_set_stop_event_ends_the_tick_early(db, project, isolated_data, submitted):
    row = _raster(db, project, status="uploading", chunk_size=1, chunk_count=1,
                  last_chunk_at=NOW - timedelta(hours=30))
    sweeper.stop_event.set()
    try:
        assert sweep(submitted).expired == 0
    finally:
        sweeper.stop_event.clear()
    assert _reload(db, row) is not None
