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
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from ..database import SessionLocal
from ..models import AnalysisJob, Raster, RedZone
from . import preprocess, vectorize
from .ml import engine as ml_engine
from .storage import MissingImageryError, require_file

log = logging.getLogger("ada.jobs")

_queue: queue.Queue = queue.Queue()
_worker: threading.Thread | None = None
_worker_lock = threading.Lock()


def _pump() -> None:
    while True:
        fn, arg = _queue.get()
        try:
            fn(arg)
        except Exception:                       # never let the worker die
            log.error("job runner caught an unhandled error:\n%s",
                      traceback.format_exc())
        finally:
            _queue.task_done()


def _submit(fn, arg) -> None:
    global _worker
    with _worker_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_pump, name="ada-job", daemon=True)
            _worker.start()
    _queue.put((fn, arg))


def _update(job_id: int, **fields) -> None:
    with SessionLocal() as db:
        db.query(AnalysisJob).filter(AnalysisJob.id == job_id).update(fields)
        db.commit()


def submit_analysis(job_id: int) -> None:
    _submit(_run_analysis_safe, job_id)


def submit_ingest(raster_id: int) -> None:
    _submit(_run_ingest_safe, raster_id)


def requeue_stale() -> None:
    """Re-submit work that was in flight when the process last stopped.

    The worker is an in-process thread pool, so a restart — a deploy, a crash,
    Docker being restarted — silently loses whatever it was running while the
    row still says "processing". Nothing ever picked those up again, so a
    perfectly good upload could sit at PROCESSING forever and no amount of
    restarting would help. Ingest is idempotent (it rewrites the COG from the
    original upload), so re-running it on startup is always safe.

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
                       .filter(AnalysisJob.status.in_(("queued", "running"))).count())
        if pending:
            log.warning("REQUEUE_STALE_ON_STARTUP is off — leaving %d "
                        "interrupted item(s) alone. Re-run them from the UI.",
                        pending)
        return

    with SessionLocal() as db:
        stale_rasters = [r.id for r in db.query(Raster)
                         .filter(Raster.status == "processing").all()]
        stale_jobs = [j.id for j in db.query(AnalysisJob)
                      .filter(AnalysisJob.status.in_(("queued", "running"))).all()]
    for raster_id in stale_rasters:
        log.warning("requeueing ingest for raster %s (interrupted by restart)",
                    raster_id)
        submit_ingest(raster_id)
    for job_id in stale_jobs:
        log.warning("requeueing analysis job %s (interrupted by restart)", job_id)
        submit_analysis(job_id)


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
        try:
            with SessionLocal() as db:
                db.query(Raster).filter(Raster.id == raster_id).update(
                    {"progress": round(min(max(fraction, 0.0), 1.0), 4),
                     "stage": stage})
                db.commit()
        except Exception:               # progress is cosmetic; never fail on it
            log.debug("could not record ingest progress for raster %s",
                      raster_id, exc_info=True)

    return report


def _run_ingest_safe(raster_id: int) -> None:
    with SessionLocal() as db:
        raster = db.get(Raster, raster_id)
    if raster is None:
        return
    try:
        original = require_file(raster.original_path,
                                f"Source imagery for raster {raster_id}")
        cog_path = settings.cogs_dir / f"raster_{raster_id}.tif"
        meta = preprocess.ingest_raster(original, cog_path,
                                        _ingest_reporter(raster_id))
        with SessionLocal() as db:
            db.query(Raster).filter(Raster.id == raster_id).update({
                "cog_path": str(cog_path), "status": "ready",
                "progress": 1.0, "stage": None, **meta,
            })
            db.commit()
        log.info("ingest: raster %s is READY — %s, %.3f m/px",
                 raster_id, meta.get("crs"), meta.get("resolution_m", 0.0))
    except Exception as exc:
        _fail_raster(raster_id, exc)


def _fail_raster(raster_id: int, exc: Exception) -> None:
    # A missing upload is a state problem, not a bug: report it in one line
    # rather than burying the message under a rasterio stack trace.
    if isinstance(exc, MissingImageryError):
        log.error("ingest %s aborted: %s", raster_id, exc)
    else:
        log.error("ingest %s failed:\n%s", raster_id, traceback.format_exc())
    with SessionLocal() as db:
        # `progress` is left where it stopped — how far it got before failing is
        # a useful clue — but the stage label is cleared, since it now describes
        # work that is not happening.
        db.query(Raster).filter(Raster.id == raster_id).update(
            {"status": "failed", "error": str(exc), "stage": None})
        db.commit()


def _label(raster: Raster) -> str:
    return f"Source imagery for raster {raster.id} ('{raster.name}')"


def _existing_cog(raster: Raster) -> Path | None:
    """The ingested COG if it is still on disk, else None (warp the original)."""
    if not raster.cog_path:
        return None
    path = Path(raster.cog_path)
    if path.is_file():
        return path
    log.warning("COG for raster %s is missing (%s); warping the original "
                "instead — slower, but the analysis still runs",
                raster.id, path)
    return None


def _run_analysis_safe(job_id: int) -> None:
    try:
        _run_analysis(job_id)
    except MissingImageryError as exc:
        # Expected whenever a row outlives its file — the imagery was written
        # by another deployment, or deleted. One line, not a stack trace.
        log.error("job %s aborted: %s", job_id, exc)
        _update(job_id, status="failed", error=str(exc),
                finished_at=datetime.now(timezone.utc))
    except Exception as exc:
        log.error("job %s failed:\n%s", job_id, traceback.format_exc())
        _update(job_id, status="failed", error=str(exc),
                finished_at=datetime.now(timezone.utc))


def _run_analysis(job_id: int) -> None:
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        if job is None:
            return
        r1 = db.get(Raster, job.raster_t1_id)
        r2 = db.get(Raster, job.raster_t2_id)
        if r1 is None or r2 is None:
            raise MissingImageryError(
                "This analysis references a raster that no longer exists.")
        # Check both inputs up front, before a single model is loaded. The
        # originals are required; a missing COG only costs speed, since
        # superimpose falls back to warping the original.
        src1 = require_file(r1.original_path, _label(r1))
        src2 = require_file(r2.original_path, _label(r2))
        cog1 = _existing_cog(r1)
        cog2 = _existing_cog(r2)
        mode = (job.mode or "ai").lower()
        zones = [z.geometry for z in
                 db.query(RedZone).filter(RedZone.project_id == job.project_id)]

    _update(job_id, status="running", progress=0.02,
            stage="Superimposing rasters (reproject + co-register + normalize)")
    pair = preprocess.superimpose(src1, src2, cog1, cog2)
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
        prob = ml_engine.classical_change_prob(pair.t1, pair.t2, pair.valid)
        prob = ml_engine.suppress_vegetation_changes(prob, pair.veg1, pair.veg2)
    elif settings.model_mode == "segdiff":
        seg_name = ml_engine.get_seg_backend().name
        backend_name = seg_name
        models_used = ["Co-registration: FFT phase correlation (classical)",
                       f"Building footprints (per epoch): {seg_name}"]
        _update(job_id, progress=0.20,
                stage=f"Segmenting building footprints — {seg_name}")

        # Segment each epoch separately, then diff the footprints.
        b1 = ml_engine.segment_scene(
            pair.t1, pair.valid,
            lambda f: _update(job_id, progress=0.20 + 0.18 * f))
        b2 = ml_engine.segment_scene(
            pair.t2, pair.valid,
            lambda f: _update(job_id, progress=0.38 + 0.18 * f))

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
                lc1 = ml_engine.landcover_probs(
                    pair.t1, pair.valid,
                    lambda f: _update(job_id, progress=0.56 + 0.05 * f))
                lc2 = ml_engine.landcover_probs(
                    pair.t2, pair.valid,
                    lambda f: _update(job_id, progress=0.61 + 0.05 * f))
                from .ml.landcover import VEGETATION_CLASSES
                thr = settings.vegetation_threshold
                veg1 = (lc1[list(VEGETATION_CLASSES)].sum(0) >= thr) & pair.valid
                veg2 = (lc2[list(VEGETATION_CLASSES)].sum(0) >= thr) & pair.valid
                models_used.append(
                    f"Land cover / vegetation: {settings.landcover_model_repo}")
            except Exception:
                log.warning("land-cover model unavailable, falling back to the "
                            "NDVI / excess-green indices", exc_info=True)
                models_used.append("Vegetation: NDVI / excess-green (index fallback)")
        else:
            models_used.append("Vegetation: NDVI / excess-green index")

        if settings.release_models_between_stages:
            ml_engine.release_landcover()

        _update(job_id, progress=0.66, stage="Analysing building instances")
        prob, instances, instance_diag, instance_ids = ml_engine.analyse_instances(
            b1, b2, pair.valid, pair.t1, pair.t2, veg1, veg2, lc1, lc2,
            pair.resolution_m)
        models_used.append(
            f"Instance decision: {instance_diag['decider']} "
            f"({instance_diag['candidates']} candidates -> "
            f"{instance_diag['kept']} reported)")

        if settings.sam_refine:
            sam_repo = (settings.sam3_model_repo if settings.sam_backend == "sam3"
                        else settings.sam_model_repo)
            _update(job_id, progress=0.70,
                    stage=f"Refining full building structures — {settings.sam_backend.upper()}")
            prob = ml_engine.refine_full_structures(prob, pair.t2, pair.valid)
            models_used.append(
                f"Full-structure refinement: {settings.sam_backend.upper()} ({sam_repo})")
    else:
        backend_name = ml_engine.get_backend().name
        models_used = ["Co-registration: FFT phase correlation (classical)",
                       f"Bi-temporal change detection: {backend_name}",
                       "Vegetation suppression: NDVI / excess-green index"]
        _update(job_id, progress=0.25, stage=f"Grid inference — {backend_name}")

        def on_progress(frac: float) -> None:
            _update(job_id, progress=0.25 + 0.45 * frac)

        prob = ml_engine.predict_change_map(pair.t1, pair.t2, pair.valid, on_progress)
        prob = ml_engine.suppress_vegetation_changes(prob, pair.veg1, pair.veg2)

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

    from ..models import ChangePolygon  # local import to avoid cycles
    with SessionLocal() as db:
        db.query(ChangePolygon).filter(ChangePolygon.job_id == job_id).delete()
        for f in features:
            db.add(ChangePolygon(job_id=job_id, geometry=f["geometry"],
                                 properties=f["properties"]))
        db.commit()

    illegal = sum(1 for f in features if f["properties"]["status"] == "illegal")
    by_type: dict[str, int] = {}
    for f in features:
        t = f["properties"].get("change_type")
        if t:
            by_type[t] = by_type.get(t, 0) + 1
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
        "models_used": models_used,
        "working_resolution_m": round(pair.resolution_m, 3),
        "coregistration_shift_px": [round(v, 2) for v in pair.shift_px],
        "false_color_corrected": {"t1": pair.cir_corrected[0],
                                  "t2": pair.cir_corrected[1]},
    }
    _update(job_id, status="done", progress=1.0, stage="Complete",
            mask_cog_path=str(mask_path), stats=stats,
            finished_at=datetime.now(timezone.utc))
