"""In-process job runner (POC stand-in for Celery + Redis).

One worker thread executes ingests and analysis pipelines sequentially and
writes progress into the database, which the frontend polls.

The worker is a DAEMON thread fed by a queue, deliberately not a
ThreadPoolExecutor. The executor's threads are non-daemon and Python registers
an atexit hook that joins them on the way out, so a process asked to shut down
would not actually leave until the running job finished. Under `uvicorn
--reload` that produced the worst possible behaviour: every code edit logged
"Finished server process", left the old process alive still grinding through a
multi-hour ingest, and started a NEW process that immediately requeued the same
raster from strip 1. Two processes, same file, neither making progress.

A daemon thread is killed with the process, so a reload actually reloads.
"""

from __future__ import annotations

import logging
import queue
import re
import threading
import time
import traceback
from pathlib import Path

from ada_core.database import SessionLocal
from ada_core.datetimes import now_ist
from ada_core.models import AnalysisJob, ChangePolygon, Raster, RedZone
from ada_core.models_icms import Case as IcmsCase
from ada_core.storage import MissingImageryError, require_file
from ada_platform.logging import request_id_bound
from ada_platform.requestid import new_request_id
from sqlalchemy import or_, select

from . import notifier, preprocess, vectorize
from .config import settings
from .ml import engine as ml_engine
from .ml import gpu

log = logging.getLogger("ada.jobs")

_queue: queue.Queue = queue.Queue()
_worker: threading.Thread | None = None
_worker_lock = threading.Lock()
# Ids submitted and not yet finished, per kind, in submission order (value = pending count).
_in_flight: dict[str, dict[int, int]] = {"rasters": {}, "jobs": {}}
_in_flight_lock = threading.Lock()


# Binds the id work.py tagged onto the row (RequestScopedId); requeued ints get a fresh one.
def _pump() -> None:
    while True:
        fn, arg, kind = _queue.get()
        request_id = getattr(arg, "request_id", "") or new_request_id()
        if isinstance(arg, int):
            arg = int(arg)
        try:
            with request_id_bound(request_id):
                fn(arg)
        except Exception:                       # never let the worker die
            log.error("job runner caught an unhandled error:\n%s",
                      traceback.format_exc())
        finally:
            _track(kind, arg, -1)
            _queue.task_done()


def _track(kind: str | None, arg, delta: int) -> None:
    if kind is None or not isinstance(arg, int):
        return
    key = int(arg)
    with _in_flight_lock:
        ids = _in_flight[kind]
        count = ids.get(key, 0) + delta
        if count > 0:
            ids[key] = count
        else:
            ids.pop(key, None)


def in_flight() -> dict[str, list[int]]:
    """Raster and job ids queued or running here, so the sweeper can tell queued from stuck."""
    with _in_flight_lock:
        return {kind: list(ids) for kind, ids in _in_flight.items()}


def _submit(fn, arg, kind: str | None = None) -> None:
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_pump, name="ada-job", daemon=True)
            _worker.start()
    _track(kind, arg, +1)
    _queue.put((fn, arg, kind))


def _update(job_id: int, **fields) -> None:
    with SessionLocal() as db:
        db.query(AnalysisJob).filter(AnalysisJob.id == job_id).update(fields)
        db.commit()


# Writes only while the job is still in flight; False when another run already ended it.
def _update_in_flight(job_id: int, **fields) -> bool:
    with SessionLocal() as db:
        moved = (db.query(AnalysisJob)
                 .filter(AnalysisJob.id == job_id, AnalysisJob.status.in_(_IN_FLIGHT))
                 .update(fields, synchronize_session=False))
        db.commit()
    return moved == 1


def queue_depth() -> int:
    """How much work is waiting, for /health/ready.

    Approximate by construction — the item currently being executed has already
    been taken off the queue — and that is the right number anyway: it answers
    "is this worker falling behind", not "how many jobs exist".
    """
    return _queue.qsize()


def submit_analysis(job_id: int) -> None:
    _submit(_run_analysis_safe, job_id, "jobs")


def submit_ingest(raster_id: int) -> None:
    _submit(_run_ingest_safe, raster_id, "rasters")


# An allow-list, so `done` and `failed` (and any status added later) are never re-run.
_IN_FLIGHT = ("queued", "running", "processing")


def requeue_stale() -> None:
    """Re-submit work that was in flight when the process last stopped.

    The worker is an in-process thread pool, so a restart — a deploy, a crash,
    Docker being restarted — silently loses whatever it was running while the
    row still says "processing". Nothing ever picked those up again, so a
    perfectly good upload could sit at PROCESSING forever and no amount of
    restarting would help. Ingest is idempotent and resumes from its strip
    checkpoint, so re-running it on startup is always safe.

    "Safe" is not the same as "wanted", which is why this is switchable. Under
    `uvicorn --reload` a restart happens on every keystroke that saves a file,
    and restarting a 1 Gpx ingest from strip 1 each time means it can never
    finish — the work is thrown away faster than it accumulates. Set
    REQUEUE_STALE_ON_STARTUP=false while developing; leave it on in Docker,
    where a restart is a real event and finishing the job is the point.
    """
    if not settings.requeue_stale_on_startup:
        with SessionLocal() as db:
            pending = (db.query(Raster).filter(Raster.status == "processing").count()
                       + db.query(AnalysisJob)
                       .filter(AnalysisJob.status.in_(_IN_FLIGHT)).count())
        if pending:
            log.warning("REQUEUE_STALE_ON_STARTUP is off — leaving %d "
                        "interrupted item(s) alone. Re-run them from the UI.",
                        pending)
        return

    with SessionLocal() as db:
        stale_rasters = [(r.id, r.stage) for r in db.query(Raster)
                         .filter(Raster.status == "processing").all()]
        stale_jobs = [j.id for j in db.query(AnalysisJob)
                      .filter(AnalysisJob.status.in_(_IN_FLIGHT)).all()]
    for raster_id, stage in stale_rasters:
        log.warning("requeueing ingest for raster %s (interrupted by restart at %s; "
                    "a strip checkpoint resumes where it stopped)", raster_id, stage)
        submit_ingest(raster_id)
    for job_id in stale_jobs:
        if _count_restart(job_id):
            log.warning("requeueing analysis job %s (interrupted by restart)", job_id)
            submit_analysis(job_id)
    requeue_retryable()


# A job that keeps dying mid-run (host OOM SIGKILL) must not crash-loop the worker forever.
def _count_restart(job_id: int) -> bool:
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        if job is None:
            return False
        stats = dict(job.stats or {})
        restarts = int(stats.get("restarts", 0)) + 1
        if restarts > max(0, settings.ml_oom_retries):
            job.status = "failed"
            job.error = (f"interrupted mid-run {restarts} times (process killed, "
                         f"e.g. host out of memory); not restarting again")
            job.finished_at = now_ist()
            db.commit()
            log.error("analysis job %s: %s", job_id, job.error)
            notifier.analysis_failed(job_id)
            return False
        stats["restarts"] = restarts
        job.stats = stats
        db.commit()
    return True


# Raised from the progress callback when the API deleted the row; it is how an ingest is cancelled.
class RasterDeletedError(Exception):
    pass


def _ingest_reporter(raster_id: int):
    """Write ingest progress to the raster row, throttled.

    The strip loop fires once per strip (146 of them on a 1 Gpx tile) and the
    COG copy once per rendered progress-bar frame, far more often than a UI
    polling every 3 s can use. So a write happens only on a 1% move or after a
    second of silence.

    A change of PHASE always gets through, but "phase" has to be judged with the
    counters stripped out. Every stage string here carries one — "strip 12/146",
    "Building COG (37%)" — so comparing the raw text makes every call look like
    a transition and the throttle does nothing. Comparing them with the digits
    removed is what distinguishes "next strip" from "now building overviews".

    That distinction is not cosmetic. The COG bar ends at 0.897 and the overview
    phase starts at 0.90, a move too small to trigger on its own — so without
    this the label would sit at "Building COG (99%)" for the whole overview
    pass, which is the longest silent stretch of an ingest and the one most
    likely to be read as a hang.
    """
    state = {"progress": -1.0, "phase": "", "at": 0.0}

    def report(fraction: float, stage: str) -> None:
        now = time.monotonic()
        phase = re.sub(r"\d+", "", stage)
        moved = fraction - state["progress"] >= 0.01
        if not (moved or phase != state["phase"] or now - state["at"] >= 1.0):
            return
        state.update(progress=fraction, phase=phase, at=now)
        moved = None
        try:
            with SessionLocal() as db:
                moved = db.query(Raster).filter(Raster.id == raster_id).update(
                    {"progress": round(min(max(fraction, 0.0), 1.0), 4),
                     "stage": stage, "last_progress_at": now_ist()})
                db.commit()
        except Exception:               # progress is cosmetic; never fail on it
            log.debug("could not record ingest progress for raster %s",
                      raster_id, exc_info=True)
        if moved == 0:
            raise RasterDeletedError(raster_id)

    return report


def _run_ingest_safe(raster_id: int) -> None:
    with SessionLocal() as db:
        raster = db.get(Raster, raster_id)
        if raster is None:
            return
        if raster.status not in _INGESTABLE:
            log.info("ingest: raster %s is %s; nothing to ingest", raster_id, raster.status)
            return
        original_path = raster.original_path
        db.query(Raster).filter(Raster.id == raster_id).update(
            {"status": "processing", "last_progress_at": now_ist()})
        db.commit()
    cog_path = settings.cogs_dir / f"raster_{raster_id}.tif"
    try:
        original = require_file(original_path, f"Source imagery for raster {raster_id}")
        result = preprocess.ingest_raster(original, cog_path,
                                          _ingest_reporter(raster_id))
        with SessionLocal() as db:
            moved = db.query(Raster).filter(Raster.id == raster_id).update({
                **result.row_fields(), "cog_path": str(cog_path), "status": "ready",
                "progress": 1.0, "stage": None, "error": None, "reject_reason": None,
                "tier": _device_tier(), "last_progress_at": now_ist(),
            })
            db.commit()
        if moved == 0:
            log.warning("ingest: raster %s was deleted while processing; "
                        "discarding its COG, archive and upload", raster_id)
            _unlink_quietly(cog_path, result.archive_path)
            _delete_upload(original)
            return
        # Only now, with the verified archive recorded, is the raw upload redundant.
        _delete_upload(original)
        log.info("ingest: raster %s is READY — %s, %.3f m/px, archive %s (%.1f MB)",
                 raster_id, result.crs, result.resolution_m, result.narrowed_dtype,
                 result.archive_bytes / 1e6)
    except RasterDeletedError:
        log.warning("ingest: raster %s was deleted while processing; stopped", raster_id)
        archive = preprocess.default_archive_path(Path(original_path or "raster.tif"))
        _unlink_quietly(cog_path, *preprocess.ingest_scratch_paths(cog_path, archive))
    except Exception as exc:
        _fail_raster(raster_id, exc)


# Rows the ingest may (re)run; anything else was settled, and re-running could fail a ready raster.
_INGESTABLE = ("processing", "failed_retryable")


_UPLOAD_SIDECARS = (".tfw", ".prj", ".ovr", ".aux.xml")


# The upload and its sidecars (same set as the api's _raster_files), matched case-insensitively.
def _delete_upload(original: Path) -> None:
    names = {f"{original.stem}{ext}".lower() for ext in _UPLOAD_SIDECARS}
    names |= {f"{original.name}{ext}".lower() for ext in (".ovr", ".aux.xml")}
    sidecars = ([p for p in original.parent.iterdir() if p.name.lower() in names]
                if original.parent.is_dir() else [])
    _unlink_quietly(original, *sidecars)


def _device_tier() -> str | None:
    try:
        return gpu.runtime_info().get("tier")
    except Exception:
        log.debug("runtime_info unavailable; tier left unset", exc_info=True)
        return None


# Leftovers of work whose row was deleted mid-run; a failure to unlink is only logged.
def _unlink_quietly(*paths: Path) -> None:
    for path in paths:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            log.warning("could not remove orphaned file %s", path, exc_info=True)


# Only a provably bad upload is final; ENOSPC, MemoryError, verification or a bug keep the raw file.
def _is_retryable(exc: BaseException) -> bool:
    return not isinstance(exc, (MissingImageryError, preprocess.IngestRejected))


def _fail_raster(raster_id: int, exc: Exception) -> None:
    retryable = _is_retryable(exc)
    if isinstance(exc, (MissingImageryError, preprocess.IngestRejected)):
        log.error("ingest %s rejected: %s", raster_id, exc)
    else:
        log.error("ingest %s failed (%s):\n%s", raster_id,
                  "retryable, upload kept" if retryable else "final",
                  traceback.format_exc())
    with SessionLocal() as db:
        # Progress stays as a clue; a retryable failure keeps "strip:n/total" as its checkpoint.
        raster = db.get(Raster, raster_id)
        if raster is None:
            return
        original = Path(raster.original_path) if raster.original_path else None
        fields = {"status": "failed_retryable" if retryable else "failed",
                  "error": str(exc), "reject_reason": str(exc)}
        if not retryable:
            fields["stage"] = None
        db.query(Raster).filter(Raster.id == raster_id).update(fields)
        db.commit()
    if not retryable and original is not None:
        cog_path = settings.cogs_dir / f"raster_{raster_id}.tif"
        _unlink_quietly(*preprocess.ingest_scratch_paths(
            cog_path, preprocess.default_archive_path(original)))
        _delete_upload(original)


def _label(raster: Raster) -> str:
    return f"Source imagery for raster {raster.id} ('{raster.name}')"


def _existing_cog(raster: Raster) -> Path | None:
    """The ingested COG if it is still on disk, else None (warp the archive or original)."""
    if not raster.cog_path:
        return None
    path = Path(raster.cog_path)
    if path.is_file():
        return path
    log.warning("COG for raster %s is missing (%s); warping the archive or original "
                "instead — slower, but the analysis still runs",
                raster.id, path)
    return None


# Fails before any model loads when no file this raster could be warped from is on disk.
def _epoch_source(raster: Raster) -> preprocess.EpochSource:
    source = preprocess.EpochSource(
        original=Path(raster.original_path) if raster.original_path else None,
        cog=_existing_cog(raster),
        archive=Path(raster.archive_path) if raster.archive_path else None,
        cold=raster.status in ("cold", "restoring"), raster_id=raster.id)
    if not any(p is not None and p.is_file()
               for p in (source.original, source.cog, source.archive)):
        if source.cold:
            raise preprocess.ColdRasterError(raster.id)
        require_file(raster.original_path, _label(raster))
    return source


# --- runtime tiers, ETA and the OOM degrade ladder (doc §4.3) ----------------

_RETRY_RUN = re.compile(r"^retryable: run (\d+)/(\d+):")


def eta_s_per_mpx(tier) -> float:
    """Seconds per working-grid megapixel on `tier` (a Tier or its name)."""
    name = getattr(tier, "name", tier)
    return {"cuda": settings.ml_eta_s_per_mpx_cuda,
            "metal": settings.ml_eta_s_per_mpx_metal}.get(
                name, settings.ml_eta_s_per_mpx_cpu)


def estimate_seconds(tier, grid_px: int) -> float:
    """Rough wall-clock for one analysis on a grid_px x grid_px working grid."""
    return round(eta_s_per_mpx(tier) * (max(0, grid_px) ** 2) / 1e6, 1)


# Only these are worth a smaller batch, grid or device; anything else is a real bug.
def _is_oom(exc: BaseException) -> bool:
    if isinstance(exc, MemoryError) or type(exc).__name__ == "OutOfMemoryError":
        return True
    text = str(exc).lower()
    if isinstance(exc, RuntimeError) and "out of memory" in text:
        return True
    if (type(exc).__module__ or "").startswith("onnxruntime"):
        return any(k in text for k in ("memory", "allocat", "cuda", "cudnn",
                                       "coreml", "provider"))
    return False


class _LadderSignal(Exception):
    pass


class _ShrinkGrid(_LadderSignal):
    pass


class _LadderExhausted(_LadderSignal):
    def __init__(self, stage: str, exc: BaseException, steps: list[str], tier: str):
        super().__init__(f"{stage}: {_short(exc)}")
        self.stage, self.steps, self.tier = stage, steps, tier


def _short(exc: BaseException) -> str:
    text = " ".join(str(exc).split()) or type(exc).__name__
    return text[:200]


class _Ladder:
    """Per-job degrade state: current batch, grid cap, and what was given up."""

    def __init__(self, tier: gpu.Tier):
        self.tier = tier
        self.batch = tier.batch
        self.grid_cap = tier.grid_cap_px
        self.grid_px: int | None = None
        self.steps: list[str] = []

    def note(self, line: str) -> None:
        log.warning("degrade ladder: %s", line)
        self.steps.append(line)

    def next_grid(self) -> int | None:
        ceiling = min(self.grid_cap, self.grid_px or self.grid_cap)
        smaller = [g for g in gpu.GRID_STEPS if g < ceiling]
        return smaller[0] if smaller else None


# Drops every cached model and the allocator cache so the next attempt starts empty.
def _release_gpu() -> None:
    try:
        ml_engine.release_gpu_models()
    except Exception:
        log.debug("release_gpu_models failed", exc_info=True)
    gpu.free()


def _stage(ladder: _Ladder, name: str, fn, *, batched: bool = True):
    """Run fn(batch), walking batch -> grid -> CPU on OOM or a provider error."""
    on_cpu = False
    while True:
        try:
            if not on_cpu:
                return fn(ladder.batch)
            with gpu.cpu_override():
                try:
                    return fn(1)
                finally:
                    _release_gpu()
        except _LadderSignal:
            raise
        except Exception as exc:
            if not _is_oom(exc):
                raise
            _release_gpu()
            reason = _short(exc)
            if on_cpu:
                raise _LadderExhausted(name, exc, ladder.steps, ladder.tier.name) from exc
            if batched and ladder.batch > 1:
                ladder.batch //= 2
                ladder.note(f"Degrade: {name} out of memory ({reason}); batch halved "
                            f"to {ladder.batch}, stage retried")
                continue
            smaller = ladder.next_grid()
            if smaller:
                ladder.grid_cap = smaller
                ladder.note(f"Degrade: {name} out of memory ({reason}); working grid "
                            f"shrunk to {smaller} px, restarted from superimpose")
                raise _ShrinkGrid(name) from exc
            if ladder.tier.name != "cpu":
                on_cpu = True
                ladder.note(f"Degrade: {name} out of memory ({reason}); stage run on "
                            f"the CPU tier (fp32, batch 1)")
                continue
            raise _LadderExhausted(name, exc, ladder.steps, ladder.tier.name) from exc


# Backends carry a class-level batch_size; the instance copy is reset from it every stage.
def _cap_batch(backend, batch: int):
    default = getattr(type(backend), "batch_size", None)
    if isinstance(default, int):
        backend.batch_size = max(1, min(default, batch))
    return backend


def _retryable_error(job_id: int, exc: _LadderExhausted) -> str:
    """Error text for an exhausted ladder; "retryable:" while re-runs remain."""
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        previous = (job.error or "") if job is not None else ""
    match = _RETRY_RUN.match(previous)
    run = int(match.group(1)) + 1 if match else 1
    total = max(0, settings.ml_oom_retries) + 1
    if run < total and exc.tier != "cpu":
        return f"retryable: run {run}/{total}: out of memory on every degrade step at {exc}"
    return f"out of memory on every degrade step after {run} run(s) at {exc}"


def requeue_retryable() -> list[int]:
    """Re-queue analyses the degrade ladder gave up on; each carries its run count in `error`."""
    with SessionLocal() as db:
        rows = (db.query(AnalysisJob.id, AnalysisJob.error)
                .filter(AnalysisJob.status == "failed",
                        AnalysisJob.error.like("retryable:%")).all())
    picked: list[int] = []
    for job_id, error in rows:
        with SessionLocal() as db:
            moved = (db.query(AnalysisJob)
                     .filter(AnalysisJob.id == job_id, AnalysisJob.status == "failed",
                             AnalysisJob.error == error)
                     .update({"status": "queued", "progress": 0.0, "finished_at": None,
                              "stage": "Retrying after running out of memory"},
                             synchronize_session=False))
            db.commit()
        if moved == 1:
            log.warning("requeueing analysis job %s (%s)", job_id, error.split(":", 2)[1].strip())
            submit_analysis(job_id)
            picked.append(job_id)
    return picked


def _run_analysis_safe(job_id: int) -> None:
    """Run one analysis, record how it ended, and tell the officer.

    The notification is sent AFTER the row is written, never before and never
    instead. Ordering it that way means the link in the message always resolves
    to a job whose status matches what the message says — and `notifier` cannot
    raise, so a notification that fails leaves a finished analysis finished.
    """
    try:
        finished = _run_analysis(job_id)
    except MissingImageryError as exc:
        # Expected whenever a row outlives its file — the imagery was written
        # by another deployment, or deleted. One line, not a stack trace.
        log.error("job %s aborted: %s", job_id, exc)
        if _update_in_flight(job_id, status="failed", error=str(exc),
                             finished_at=now_ist()):
            notifier.analysis_failed(job_id)
    except _LadderExhausted as exc:
        error = _retryable_error(job_id, exc)
        log.error("job %s: %s", job_id, error)
        steps = [*exc.steps, f"Degrade: gave up at {exc.stage}"]
        if (_update_in_flight(job_id, status="failed", error=error,
                              stats={"device_tier": exc.tier, "degrade_steps": steps,
                                     "models_used": steps},
                              finished_at=now_ist())
                and not error.startswith("retryable:")):
            notifier.analysis_failed(job_id)
    except Exception as exc:
        log.error("job %s failed:\n%s", job_id, traceback.format_exc())
        if _update_in_flight(job_id, status="failed", error=str(exc),
                             finished_at=now_ist()):
            notifier.analysis_failed(job_id)
    else:
        if finished:
            notifier.analysis_finished(job_id)


# Both rasters: last_used_at keeps them out of the cold tier; tier records where they last ran.
def _touch_rasters(ids: tuple[int, int], **fields) -> None:
    fields = {k: v for k, v in fields.items() if hasattr(Raster, k)}
    if not fields:
        return
    with SessionLocal() as db:
        db.query(Raster).filter(Raster.id.in_(ids)).update(fields, synchronize_session=False)
        db.commit()


def _run_analysis(job_id: int) -> bool:
    """True when this run wrote the result; False when there was nothing to do."""
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        if job is None:
            return False
        if job.status == "done":
            # A re-submit of a finished job would replace polygons officers have
            # reviewed or raised cases against. Finished is final.
            log.info("analysis job %s is already done; not re-running it", job_id)
            return False
        r1 = db.get(Raster, job.raster_t1_id)
        r2 = db.get(Raster, job.raster_t2_id)
        if r1 is None or r2 is None:
            raise MissingImageryError(
                "This analysis references a raster that no longer exists.")
        # Fail before any model loads; after ingest the raw is gone and archive or COG is read.
        src1, src2 = _epoch_source(r1), _epoch_source(r2)
        cog1, cog2 = src1.cog, src2.cog
        mode = (job.mode or "ai").lower()
        raster_ids = (r1.id, r2.id)
        # The project's drawn red zones plus the authority-wide ones imported from KML.
        zones = [z.geometry for z in db.query(RedZone).filter(
            or_(RedZone.project_id == job.project_id, RedZone.project_id.is_(None)),
            RedZone.active.is_(True))]

    if not _update_in_flight(
            job_id, status="running", progress=0.02,
            stage="Superimposing rasters (reproject + co-register + normalize)"):
        log.info("analysis job %s is no longer in flight; not running it", job_id)
        return False
    _touch_rasters(raster_ids, last_used_at=now_ist())

    tier = gpu.select_tier()
    ladder = _Ladder(tier)
    while True:
        try:
            result = _analyse(job_id, mode, ladder, (src1, src2, cog1, cog2))
            break
        except _ShrinkGrid:
            _update(job_id, progress=0.02,
                    stage=f"Out of memory — retrying on a {ladder.grid_cap} px grid")
    pair, prob, instances, instance_ids, instance_diag, backend_name, models_used = result

    _update(job_id, progress=0.72, stage="Writing change-mask COG")
    mask_path = settings.masks_dir / f"job_{job_id}_mask.tif"
    preprocess.write_mask_cog(prob, pair.valid, pair.transform, pair.crs, mask_path)

    # Persist aligned epochs for the per-polygon before/after hover previews
    preprocess.write_rgb_geotiff(pair.t1, pair.transform, pair.crs,
                                 settings.masks_dir / f"job_{job_id}_t1.tif")
    preprocess.write_rgb_geotiff(pair.t2, pair.transform, pair.crs,
                                 settings.masks_dir / f"job_{job_id}_t2.tif")

    _update(job_id, progress=0.82, stage="Vectorizing + classifying changes")
    features = vectorize.extract_polygons(
        prob, pair.valid, pair.t1, pair.t2, pair.transform, pair.crs,
        pair.resolution_m, zones, instances, instance_ids,
    )

    illegal = sum(1 for f in features if f["properties"]["status"] == "illegal")
    by_type: dict[str, int] = {}
    for f in features:
        t = f["properties"].get("change_type")
        if t:
            by_type[t] = by_type.get(t, 0) + 1
    runtime = _runtime_stats(tier, pair, ladder)
    stats = {
        "polygons": len(features),
        "illegal": illegal,
        "by_change_type": by_type,
        "instance_decider": instance_diag.get("decider"),
        "seg_trust_iou": (round(instance_diag["seg_trust"], 3)
                          if "seg_trust" in instance_diag else None),
        "changed_area_m2": round(sum(f["properties"]["area_m2"] for f in features), 1),
        "mode": mode,
        "model": backend_name,
        "models_used": [*runtime.pop("lines"), *models_used, *ladder.steps],
        "working_resolution_m": round(pair.resolution_m, 3),
        "coregistration_shift_px": [round(v, 2) for v in pair.shift_px],
        "false_color_corrected": {"t1": pair.cir_corrected[0],
                                  "t2": pair.cir_corrected[1]},
        **runtime,
    }
    written = _persist_result(job_id, features, {
        "status": "done", "progress": 1.0, "stage": "Complete", "error": None,
        "mask_cog_path": str(mask_path), "stats": stats,
        "finished_at": now_ist(),
    })
    if written:
        _touch_rasters(raster_ids, tier=tier.name)
    return written


def _grid_side(pair) -> int | None:
    shape = getattr(getattr(pair, "t1", None), "shape", None)
    return int(max(shape[:2])) if shape else None


def _runtime_stats(tier: gpu.Tier, pair, ladder: _Ladder) -> dict:
    """Device and Grid lines for models_used plus the matching stats keys (doc §4.2)."""
    info = gpu.runtime_info()
    lines = [f"Device: {info['backend']} ({info['device_name']}, "
             f"{'fp16' if tier.fp16 else 'fp32'}, tier {tier.name})"]
    m_per_px = getattr(pair, "grid_m_per_px", None)
    extent = getattr(pair, "grid_extent_km", None)
    source = getattr(pair, "source_tier", None)
    side = _grid_side(pair)
    if m_per_px is not None and extent:
        size = f"{side} px over " if side else ""
        tail = f", source {source}" if source else ""
        lines.append(f"Grid: {size}{extent[0]:.2f} x {extent[1]:.2f} km "
                     f"({m_per_px:.2f} m/px){tail}")
    return {
        "lines": lines,
        "device_tier": tier.name,
        "fp16": tier.fp16,
        "grid_px": side,
        "grid_m_per_px": round(float(m_per_px), 3) if m_per_px is not None else None,
        "grid_extent_km": [round(float(v), 3) for v in extent] if extent else None,
        "degrade_steps": list(ladder.steps),
    }


def _analyse(job_id: int, mode: str, ladder: _Ladder, sources: tuple):
    """Superimpose and infer at the ladder's current grid; raises _ShrinkGrid to restart."""
    src1, src2, cog1, cog2 = sources
    pair = _stage(ladder, "superimpose",
                  lambda _b: preprocess.superimpose(src1, src2, cog1, cog2,
                                                    max_dim=ladder.grid_cap),
                  batched=False)
    ladder.grid_px = _grid_side(pair)
    # Only the seg-diff path produces per-structure instances; the classical and
    # CD paths emit a bare probability raster and leave these None.
    instances = instance_ids = None
    instance_diag: dict = {}

    if mode == "diff":
        # --- Diff Mode -------------------------------------------------------
        # No neural inference at all: a classical colour + structure difference
        # on the aligned, histogram-matched pair, with vegetation-only changes
        # suppressed. Seconds instead of minutes — this is the officer's quick
        # triage pass, not the evidence-grade output.
        backend_name = "diff_mode (classical colour + structure difference)"
        models_used = ["Co-registration: FFT phase correlation (classical)",
                       "Change signal: colour |ΔRGB| + colour-invariant edge diff",
                       "Vegetation suppression: NDVI / excess-green index"]
        _update(job_id, progress=0.35,
                stage="Diff Mode — classical colour + structure difference")
        prob = _stage(ladder, "classical difference",
                      lambda _b: ml_engine.classical_change_prob(pair.t1, pair.t2, pair.valid),
                      batched=False)
        prob = ml_engine.suppress_vegetation_changes(prob, pair.veg1, pair.veg2)
    elif settings.model_mode == "segdiff":
        seg_name = ml_engine.get_seg_backend().name
        backend_name = seg_name
        models_used = ["Co-registration: FFT phase correlation (classical)",
                       f"Building footprints (per epoch): {seg_name}"]
        _update(job_id, progress=0.20,
                stage=f"Segmenting building footprints — {seg_name}")

        def segment(img, start):
            def run(batch):
                _cap_batch(ml_engine.get_seg_backend(), batch)
                return ml_engine.segment_scene(
                    img, pair.valid, lambda f: _update(job_id, progress=start + 0.18 * f))
            return run

        # Segment each epoch separately, then diff the footprints.
        b1 = _stage(ladder, "segmentation T1", segment(pair.t1, 0.20))
        b2 = _stage(ladder, "segmentation T2", segment(pair.t2, 0.38))

        # The segmenter is done with; free its VRAM before the next model
        # allocates. All three networks resident at once fills a 6 GB card.
        if settings.release_models_between_stages:
            ml_engine.release_seg_backend()

        # Land cover gives vegetation without a colour rule, and supplies the
        # built/open context the instance classifier trains on.
        lc1 = lc2 = None
        veg1, veg2 = pair.veg1, pair.veg2
        if settings.vegetation_mode == "learned":
            try:
                _update(job_id, progress=0.56, stage="Land cover — SegFormer/LoveDA")

                def landcover(img, start):
                    def run(batch):
                        from .ml.landcover import get_backend as landcover_backend
                        _cap_batch(landcover_backend(), batch)
                        return ml_engine.landcover_probs(
                            img, pair.valid,
                            lambda f: _update(job_id, progress=start + 0.05 * f))
                    return run

                lc1 = _stage(ladder, "land cover T1", landcover(pair.t1, 0.56))
                lc2 = _stage(ladder, "land cover T2", landcover(pair.t2, 0.61))
                from .ml.landcover import VEGETATION_CLASSES
                thr = settings.vegetation_threshold
                veg1 = (lc1[list(VEGETATION_CLASSES)].sum(0) >= thr) & pair.valid
                veg2 = (lc2[list(VEGETATION_CLASSES)].sum(0) >= thr) & pair.valid
                models_used.append(
                    f"Land cover / vegetation: {settings.landcover_model_repo}")
            except _LadderSignal:
                raise
            except Exception:
                log.warning("land-cover model unavailable, falling back to the "
                            "NDVI / excess-green indices", exc_info=True)
                models_used.append("Vegetation: NDVI / excess-green (index fallback)")
        else:
            models_used.append("Vegetation: NDVI / excess-green index")

        if settings.release_models_between_stages:
            ml_engine.release_landcover()

        _update(job_id, progress=0.66, stage="Analysing building instances")
        prob, instances, instance_diag, instance_ids = _stage(
            ladder, "instance analysis",
            lambda _b: ml_engine.analyse_instances(
                b1, b2, pair.valid, pair.t1, pair.t2, veg1, veg2, lc1, lc2,
                pair.resolution_m),
            batched=False)
        models_used.append(
            f"Instance decision: {instance_diag['decider']} "
            f"({instance_diag['candidates']} candidates -> "
            f"{instance_diag['kept']} reported)")

        if settings.sam_refine and ladder.tier.sam_refine_default:
            sam_repo = (settings.sam3_model_repo if settings.sam_backend == "sam3"
                        else settings.sam_model_repo)
            _update(job_id, progress=0.70,
                    stage=f"Refining full building structures — {settings.sam_backend.upper()}")
            prob = _stage(ladder, "SAM refinement",
                          lambda _b: ml_engine.refine_full_structures(prob, pair.t2, pair.valid),
                          batched=False)
            models_used.append(
                f"Full-structure refinement: {settings.sam_backend.upper()} ({sam_repo})")
        elif settings.sam_refine:
            models_used.append("Full-structure refinement: skipped on the CPU tier "
                               "(ML_CPU_SAM_REFINE=false)")
    else:
        backend_name = ml_engine.get_backend().name
        models_used = ["Co-registration: FFT phase correlation (classical)",
                       f"Bi-temporal change detection: {backend_name}",
                       "Vegetation suppression: NDVI / excess-green index"]
        _update(job_id, progress=0.25, stage=f"Grid inference — {backend_name}")

        def on_progress(frac: float) -> None:
            _update(job_id, progress=0.25 + 0.45 * frac)

        def change_map(batch):
            previous = ml_engine._BATCH
            ml_engine._BATCH = max(1, min(previous, batch))
            try:
                return ml_engine.predict_change_map(pair.t1, pair.t2, pair.valid, on_progress)
            finally:
                ml_engine._BATCH = previous

        prob = _stage(ladder, "change inference", change_map)
        prob = ml_engine.suppress_vegetation_changes(prob, pair.veg1, pair.veg2)

    return pair, prob, instances, instance_ids, instance_diag, backend_name, models_used


# A polygon an officer has adjudicated, or a case was raised from, outlives any re-run.
def _replaceable(job_id: int):
    referenced = select(IcmsCase.detection_id).where(IcmsCase.detection_id.is_not(None))
    return (
        ChangePolygon.job_id == job_id,
        or_(ChangePolygon.review_status == "pending", ChangePolygon.review_status.is_(None)),
        ChangePolygon.id.not_in(referenced),
    )


def _persist_result(job_id: int, features: list[dict], finished: dict) -> bool:
    """The polygons and `status='done'` in one commit; False if the job was already done."""
    with SessionLocal() as db:
        # Compare-and-set first: a job another run finished meanwhile is left alone.
        moved = (db.query(AnalysisJob)
                 .filter(AnalysisJob.id == job_id, AnalysisJob.status != "done")
                 .update(finished, synchronize_session=False))
        if moved != 1:
            db.rollback()
            if db.get(AnalysisJob, job_id) is None:
                log.warning("analysis job %s was deleted while running; "
                            "discarding its outputs", job_id)
                _unlink_quietly(*(settings.masks_dir / f"job_{job_id}_{part}.tif"
                                  for part in ("mask", "t1", "t2")))
                return False
            log.warning("analysis job %s finished elsewhere; discarding this run", job_id)
            return False
        db.query(ChangePolygon).filter(*_replaceable(job_id)).delete(
            synchronize_session=False)
        db.add_all(ChangePolygon(job_id=job_id, geometry=f["geometry"],
                                 properties=f["properties"]) for f in features)
        db.commit()
    return True
