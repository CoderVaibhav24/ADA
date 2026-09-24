"""Raster lifecycle sweeper (docs/ADA-Upload-and-ML-Runtime-Design.md §3.3)."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import shutil
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from ada_core.datetimes import IST, now_ist
from ada_core.models import RASTER_TERMINAL_STATUSES, AnalysisJob, Raster
from sqlalchemy import delete, or_, update
from sqlalchemy.orm import Session

from .coldstore import ColdStore, ColdStoreError, archive_key
from .config import settings

log = logging.getLogger("ada.sweeper")

STUCK_RESUBMITS = 3
# Retries after entering failed_retryable; retry_count is reset to 0 on that entry.
RETRY_LIMIT = 3
# Without ada-ml's in_flight list a slow queue looks stuck, so only one blind resubmit is allowed.
BLIND_RESUBMITS = 1
RETRY_BACKOFF = timedelta(minutes=15)
COMPLETING_TTL = timedelta(hours=2)
ORPHAN_AGE = timedelta(hours=24)
# Fixed key so every ada-api process contends for the same Postgres advisory lock.
SWEEP_LOCK_KEY = 0x0ADA5EE9
_ORPHAN_NAME = re.compile(r"^(raster|job)_(\d+)[._]")

MlStatus = Callable[[], "dict[str, Any] | None"]


@dataclass
class SweepReport:
    at: datetime
    expired: int = 0
    reopened: int = 0
    purged: int = 0
    resubmitted: int = 0
    escalated: int = 0
    failed: int = 0
    raw_deleted: int = 0
    cold_moved: int = 0
    restores_requested: int = 0
    restored: int = 0
    orphans: int = 0
    errors: int = 0
    disk_free_pct: float = 100.0
    disk_low: bool = False
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        body = asdict(self)
        body["at"] = self.at.isoformat()
        return body


last_report: SweepReport | None = None
# Set on shutdown; every rule checks it between rows so a tick ends promptly.
stop_event = threading.Event()
# (progress, stage) last seen per processing raster, so a moving ingest is never called stuck.
_progress_seen: dict[int, tuple[float, str | None]] = {}


def disk_free_pct(usage=None) -> float:
    usage = usage or shutil.disk_usage(settings.uploads_dir)
    return 100.0 * usage.free / usage.total if usage.total else 100.0


def disk_low(usage=None) -> bool:
    return disk_free_pct(usage) < settings.disk_min_free_pct


# SQLite hands back naive datetimes; ada_core writes IST wall-clock, so naive means IST.
def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=IST) if value.tzinfo is None else value


def _older(value: datetime | None, now: datetime, age: timedelta) -> bool:
    value = _aware(value)
    return value is not None and now - value >= age


def _touched(raster: Raster) -> datetime | None:
    stamps = [_aware(v) for v in (raster.last_progress_at, raster.last_chunk_at,
                                  raster.uploaded_at) if v is not None]
    return max(stamps) if stamps else None


def _rows(rows: Iterable[Raster]) -> Iterator[Raster]:
    for row in rows:
        if stop_event.is_set():
            return
        yield row


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _archive_path(raster: Raster) -> Path:
    return (Path(raster.archive_path) if raster.archive_path
            else settings.uploads_dir / f"raster_{raster.id}.archive.tif")


# Imported late: the rasters router pulls in the upload router, which imports this module.
def _files():
    from .routers import rasters

    return rasters


def _referenced(db: Session, raster_id: int) -> bool:
    return db.query(AnalysisJob.id).filter(or_(
        AnalysisJob.raster_t1_id == raster_id,
        AnalysisJob.raster_t2_id == raster_id)).first() is not None


# Every sweeper write is conditional on the status it read, so a row that moved on is skipped.
def _cas(db: Session, raster_id: int, expected: str, **values) -> bool:
    done = db.execute(update(Raster).where(Raster.id == raster_id, Raster.status == expected)
                      .values(**values)).rowcount == 1
    db.commit()
    if not done:
        log.debug("raster %s left %s before the sweeper wrote to it", raster_id, expected)
    return done


def _cas_delete(db: Session, raster_id: int, expected: str) -> bool:
    done = db.execute(delete(Raster).where(Raster.id == raster_id, Raster.status == expected)
                      ).rowcount == 1
    db.commit()
    if not done:
        log.debug("raster %s left %s before the sweeper deleted it", raster_id, expected)
    return done


# A stale completing row is a crash between claim and rename: its chunks are intact, so reopen it.
def _expire_uploads(db: Session, now: datetime, report: SweepReport) -> None:
    ttl = timedelta(hours=settings.upload_session_ttl_hours)
    files = _files()
    rows = db.query(Raster).filter(Raster.status.in_(("uploading", "completing"))).all()
    for raster in _rows(rows):
        if raster.status == "completing":
            if (_older(raster.last_progress_at or raster.uploaded_at, now, COMPLETING_TTL)
                    and _cas(db, raster.id, "completing", status="uploading",
                             last_chunk_at=now)):
                report.reopened += 1
                log.warning("raster %s was stuck completing; reopened for complete", raster.id)
            continue
        if not _older(raster.last_chunk_at or raster.uploaded_at, now, ttl):
            continue
        paths, raster_id = files._raw_files(raster), raster.id
        if not _cas_delete(db, raster_id, "uploading"):
            continue
        files.unlink_all(paths, raster_id)
        report.expired += 1
        log.info("raster %s upload expired", raster_id)


def _purge_terminal(db: Session, now: datetime, report: SweepReport) -> None:
    keep = timedelta(days=settings.raster_failed_retention_days)
    files = _files()
    rows = db.query(Raster).filter(Raster.status.in_(RASTER_TERMINAL_STATUSES)).all()
    for raster in _rows(rows):
        touched = _touched(raster)
        if touched is None or now - touched < keep:
            continue
        if _referenced(db, raster.id):
            log.warning("raster %s is %s but an analysis references it; not purged",
                        raster.id, raster.status)
            continue
        paths, raster_id, status = files._raster_files(raster), raster.id, raster.status
        if not _cas_delete(db, raster_id, status):
            continue
        files.unlink_all(paths, raster_id)
        report.purged += 1
        log.info("raster %s (%s) purged after retention", raster_id, status)


# Marked before the call and reverted on refusal, so a fast worker's ready is never overwritten.
def _resubmit(raster: Raster, db: Session, now: datetime, submit: Callable[[int], None],
              report: SweepReport) -> bool:
    previous, count = raster.status, (raster.retry_count or 0) + 1
    if not _cas(db, raster.id, previous, status="processing", retry_count=count,
                last_progress_at=now, stage=f"Re-queued by the sweeper (attempt {count})"):
        return False
    try:
        submit(raster.id)
    except Exception as exc:
        _cas(db, raster.id, "processing", status=previous, retry_count=count - 1)
        report.errors += 1
        log.warning("resubmit of raster %s refused: %s", raster.id, exc)
        return False
    report.resubmitted += 1
    log.info("raster %s resubmitted to ingest (retry %s)", raster.id, count)
    return True


def _fail(raster: Raster, db: Session, now: datetime, reason: str, report: SweepReport) -> None:
    files = _files()
    if not _cas(db, raster.id, raster.status, status="failed", reject_reason=reason,
                error=reason, last_progress_at=now):
        return
    files.unlink_all(files._raw_files(raster), raster.id)
    report.failed += 1
    log.warning("raster %s failed: %s", raster.id, reason)


class _Ml:
    """ada-ml's /health/ready, fetched at most once per tick and only when a row needs it."""

    def __init__(self, status: MlStatus) -> None:
        self._status = status
        self._body: dict | None = None
        self._asked = False

    def body(self) -> dict | None:
        if not self._asked:
            self._asked = True
            try:
                self._body = self._status()
            except Exception:
                log.warning("ada-ml status check failed", exc_info=True)
                self._body = None
        return self._body

    # None when ada-ml does not report in_flight, which forbids escalation and deletion.
    def in_flight(self) -> set[int] | None:
        body = self.body() or {}
        rasters = (body.get("in_flight") or {}).get("rasters") \
            if isinstance(body.get("in_flight"), dict) else None
        if rasters is None:
            return None
        return {int(r) for r in rasters}


def _retry_processing(db: Session, now: datetime, ml: _Ml, submit: Callable[[int], None],
                      report: SweepReport) -> None:
    stuck_after = timedelta(minutes=settings.raster_stuck_minutes)
    ml.body()
    processing = db.query(Raster).filter(Raster.status == "processing").all()
    live = {raster.id for raster in processing}
    for raster_id in [key for key in _progress_seen if key not in live]:
        _progress_seen.pop(raster_id, None)
    for raster in _rows(processing):
        seen = (float(raster.progress or 0.0), raster.stage)
        progress_at = raster.last_progress_at or raster.uploaded_at
        if _progress_seen.get(raster.id, seen) != seen:
            _cas(db, raster.id, "processing", last_progress_at=now)
            progress_at = now
        _progress_seen[raster.id] = seen
        if not _older(progress_at, now, stuck_after):
            continue
        if ml.body() is None:
            report.notes.append(f"raster {raster.id}: ada-ml not ready; left alone")
            continue
        in_flight = ml.in_flight()
        if in_flight is not None and raster.id in in_flight:
            continue
        count = raster.retry_count or 0
        if in_flight is None:
            if count < BLIND_RESUBMITS:
                _resubmit(raster, db, now, submit, report)
            continue
        if not raster.original_path or not Path(raster.original_path).is_file():
            _fail(raster, db, now, "the uploaded file is missing; upload it again", report)
            continue
        if raster.reject_reason is not None:
            if _cas(db, raster.id, "processing", status="failed_retryable",
                    last_progress_at=now):
                log.warning("raster %s stalled again on retry %s", raster.id, count)
            continue
        if count >= STUCK_RESUBMITS:
            if _cas(db, raster.id, "processing", status="failed_retryable",
                    last_progress_at=now, retry_count=0,
                    reject_reason=f"ingest made no progress after {count} resubmits"):
                report.escalated += 1
                log.warning("raster %s moved to failed_retryable", raster.id)
            continue
        _resubmit(raster, db, now, submit, report)

    db.expire_all()
    rows = db.query(Raster).filter(Raster.status == "failed_retryable").all()
    for raster in _rows(rows):
        count = raster.retry_count or 0
        due = _older(raster.last_progress_at or raster.uploaded_at, now,
                     RETRY_BACKOFF * (2 ** count))
        if count < RETRY_LIMIT and not due:
            continue
        if ml.body() is None:
            report.notes.append(f"raster {raster.id}: ada-ml not ready; retry deferred")
            continue
        in_flight = ml.in_flight()
        if in_flight is not None and raster.id in in_flight:
            continue
        if count >= RETRY_LIMIT:
            if in_flight is not None:
                _fail(raster, db, now,
                      raster.reject_reason or "ingest failed after every retry", report)
            continue
        if in_flight is None and count >= BLIND_RESUBMITS:
            continue
        _resubmit(raster, db, now, submit, report)


def _drop_raw_when_archived(db: Session, report: SweepReport) -> None:
    files = _files()
    rows = db.query(Raster).filter(Raster.status == "ready",
                                   Raster.archive_sha256.is_not(None)).all()
    for raster in _rows(rows):
        archive = _archive_path(raster)
        raw = Path(raster.original_path) if raster.original_path else None
        if raw is None or raw == archive or not raw.is_file() or not archive.is_file():
            continue
        try:
            if _sha256(archive) != raster.archive_sha256:
                log.error("raster %s archive does not match its sha256; raw kept", raster.id)
                report.errors += 1
                continue
        except OSError as exc:
            log.error("raster %s archive unreadable (%s); raw kept", raster.id, exc)
            report.errors += 1
            continue
        raw_paths = [p for p in files._raw_files(raster) if p != archive]
        if files.unlink_all(raw_paths, raster.id):
            report.raw_deleted += 1
            log.info("raster %s raw upload deleted; archive verified", raster.id)


# The flip to cold re-reads the row under a lock: an analysis started mid-upload keeps it warm.
def _move_to_cold(db: Session, now: datetime, cold: ColdStore, report: SweepReport) -> None:
    idle = timedelta(days=settings.cold_after_days)
    rows = db.query(Raster).filter(Raster.status == "ready",
                                   Raster.archive_sha256.is_not(None)).all()
    for raster in _rows(rows):
        used_at = _aware(raster.last_used_at or raster.uploaded_at)
        if not _older(used_at, now, idle):
            continue
        archive = _archive_path(raster)
        raw = Path(raster.original_path) if raster.original_path else None
        if not archive.is_file() or (raw is not None and raw != archive and raw.is_file()):
            continue
        try:
            if _sha256(archive) != raster.archive_sha256:
                log.error("raster %s archive does not match its sha256; not moved to cold",
                          raster.id)
                report.errors += 1
                continue
        except OSError as exc:
            log.error("raster %s archive unreadable (%s); not moved to cold", raster.id, exc)
            report.errors += 1
            continue
        size = archive.stat().st_size
        ref = raster.cold_key
        try:
            if not (ref and cold.verify_object(ref, raster.archive_sha256, size, archive)):
                ref = cold.put_archive(archive, archive_key(raster.project_id, raster.id),
                                       raster.archive_sha256).ref
                if not cold.verify_object(ref, raster.archive_sha256, size, archive):
                    log.error("raster %s cold copy failed verification; local archive kept",
                              raster.id)
                    report.errors += 1
                    continue
        except ColdStoreError as exc:
            log.error("raster %s not moved to cold: %s", raster.id, exc)
            report.errors += 1
            continue
        current = (db.query(Raster).filter(Raster.id == raster.id)
                   .with_for_update().populate_existing().one_or_none())
        if (current is None or current.status != "ready"
                or _aware(current.last_used_at or current.uploaded_at) != used_at):
            db.rollback()
            log.info("raster %s was used during its cold upload; kept warm", raster.id)
            continue
        if not _cas(db, raster.id, "ready", cold_key=ref, cold_at=now, status="cold",
                    archive_bytes=current.archive_bytes or size):
            continue
        _files().unlink_all([archive], raster.id)
        report.cold_moved += 1
        log.info("raster %s moved to cold storage at %s", raster.id, ref)


def _restore(db: Session, now: datetime, cold: ColdStore, report: SweepReport) -> None:
    rows = db.query(Raster).filter(Raster.status == "restoring").all()
    for raster in _rows(rows):
        if not raster.cold_key:
            continue
        archive = _archive_path(raster)
        try:
            state = cold.restore_status(raster.cold_key)
            if state is None:
                cold.request_restore(raster.cold_key)
                report.restores_requested += 1
                continue
            if state == "pending":
                continue
            cold.get_archive(raster.cold_key, archive, raster.archive_sha256)
        except ColdStoreError as exc:
            log.error("raster %s restore not advanced: %s", raster.id, exc)
            report.errors += 1
            continue
        if not _cas(db, raster.id, "restoring", archive_path=str(archive), status="ready",
                    last_used_at=now, restore_requested_at=None, restore_eta_hours=None):
            continue
        report.restored += 1
        log.info("raster %s restored from cold storage", raster.id)


def _sweep_orphans(db: Session, now: datetime, report: SweepReport) -> None:
    raster_ids = {row[0] for row in db.query(Raster.id).all()}
    job_ids = {row[0] for row in db.query(AnalysisJob.id).all()}
    cutoff = now.timestamp() - ORPHAN_AGE.total_seconds()
    for directory in (settings.uploads_dir, settings.cogs_dir, settings.masks_dir):
        if not directory.is_dir():
            continue
        for path in directory.iterdir():
            if stop_event.is_set():
                return
            match = _ORPHAN_NAME.match(path.name)
            if match is None or not path.is_file():
                continue
            owner = int(match.group(2))
            if owner in (raster_ids if match.group(1) == "raster" else job_ids):
                continue
            try:
                if path.stat().st_mtime > cutoff:
                    continue
                path.unlink()
            except OSError as exc:
                log.warning("could not remove orphan %s: %s", path, exc)
                report.errors += 1
                continue
            report.orphans += 1
            log.info("orphan %s deleted", path)


# Each rule runs in its own session so one bad row cannot stop the rest of the tick.
def sweep_once(
    db_factory: Callable[[], Session],
    now: datetime,
    ml_status: MlStatus,
    cold: ColdStore | None,
    submit: Callable[[int], None] | None = None,
) -> SweepReport:
    if submit is None:
        from .clients import ml as ml_client

        submit = ml_client.submit_ingest
    now = _aware(now)
    report = SweepReport(at=now)
    ml = _Ml(ml_status)
    rules: list[tuple[str, Callable[[Session], None]]] = [
        ("expire", lambda db: _expire_uploads(db, now, report)),
        ("purge", lambda db: _purge_terminal(db, now, report)),
        ("retry", lambda db: _retry_processing(db, now, ml, submit, report)),
        ("raw", lambda db: _drop_raw_when_archived(db, report)),
        ("orphans", lambda db: _sweep_orphans(db, now, report)),
    ]
    if cold is not None:
        rules += [("cold", lambda db: _move_to_cold(db, now, cold, report)),
                  ("restore", lambda db: _restore(db, now, cold, report))]
    for name, rule in rules:
        if stop_event.is_set():
            break
        db = db_factory()
        try:
            rule(db)
        except Exception:
            db.rollback()
            report.errors += 1
            log.exception("sweeper rule %s failed", name)
        finally:
            db.close()

    try:
        report.disk_free_pct = round(disk_free_pct(), 1)
        report.disk_low = report.disk_free_pct < settings.disk_min_free_pct
    except OSError:
        log.exception("could not read free disk")
    if report.disk_low:
        log.error("disk low: %.1f%% free under %s (minimum %.1f%%); new uploads refused",
                  report.disk_free_pct, settings.uploads_dir, settings.disk_min_free_pct)
    global last_report
    last_report = report
    return report


def _ml_status() -> dict | None:
    from .clients import ml as ml_client

    try:
        return ml_client.runtime()
    except ml_client.MLUnavailable as exc:
        log.info("ada-ml not ready: %s", exc)
        return None


# The commit ends the implicit transaction; the session-level lock survives it.
def _acquire_lock(key: int = SWEEP_LOCK_KEY) -> tuple[bool, Callable[[], None]]:
    from ada_core.database import get_engine
    from sqlalchemy import text

    engine = get_engine()
    if engine.dialect.name != "postgresql":
        return True, lambda: None
    conn = engine.connect()
    try:
        acquired = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"),
                                     {"k": key}).scalar())
        conn.commit()
    except Exception:
        conn.close()
        raise
    if not acquired:
        conn.close()
        return False, lambda: None

    def release() -> None:
        try:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
            conn.commit()
        finally:
            conn.close()

    return True, release


def _tick() -> SweepReport | None:
    acquired, release = _acquire_lock()
    if not acquired:
        log.debug("sweep skipped: another ada-api process holds the sweeper lock")
        return None
    try:
        return _locked_tick()
    finally:
        release()


def _locked_tick() -> SweepReport:
    from ada_core.database import SessionLocal

    started = time.monotonic()
    try:
        cold = ColdStore.from_settings(settings)
    except Exception:
        log.exception("cold store client could not be built; cold rules skipped")
        cold = None
    report = sweep_once(SessionLocal, now_ist(), _ml_status, cold)
    log.info(
        "sweep: expired=%d reopened=%d purged=%d resubmitted=%d escalated=%d failed=%d "
        "raw_deleted=%d cold=%d restored=%d orphans=%d errors=%d disk_free=%.1f%% in %.1fs",
        report.expired, report.reopened, report.purged, report.resubmitted, report.escalated,
        report.failed, report.raw_deleted, report.cold_moved, report.restored, report.orphans,
        report.errors, report.disk_free_pct, time.monotonic() - started)
    return report


# Awaiting each tick before sleeping is what keeps two ticks from ever overlapping.
async def run_forever() -> None:
    stop_event.clear()
    try:
        while not stop_event.is_set():
            try:
                await asyncio.to_thread(_tick)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("sweeper tick failed")
            await asyncio.sleep(settings.sweeper_interval_seconds)
    finally:
        stop_event.set()
