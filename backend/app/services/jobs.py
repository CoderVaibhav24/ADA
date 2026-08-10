"""In-process job runner (POC stand-in for Celery + Redis).

One worker thread executes analysis pipelines sequentially and writes
progress into the analysis_jobs table, which the frontend polls.
"""

from __future__ import annotations

import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from ..database import SessionLocal
from ..models import AnalysisJob, Raster, RedZone
from . import preprocess, vectorize
from .ml import engine as ml_engine

log = logging.getLogger("ada.jobs")
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ada-job")


def _update(job_id: int, **fields) -> None:
    with SessionLocal() as db:
        db.query(AnalysisJob).filter(AnalysisJob.id == job_id).update(fields)
        db.commit()


def submit_analysis(job_id: int) -> None:
    _executor.submit(_run_analysis_safe, job_id)


def submit_ingest(raster_id: int) -> None:
    _executor.submit(_run_ingest_safe, raster_id)


def _run_ingest_safe(raster_id: int) -> None:
    with SessionLocal() as db:
        raster = db.get(Raster, raster_id)
    if raster is None:
        return
    try:
        cog_path = settings.cogs_dir / f"raster_{raster_id}.tif"
        meta = preprocess.ingest_raster(Path(raster.original_path), cog_path)
        with SessionLocal() as db:
            db.query(Raster).filter(Raster.id == raster_id).update({
                "cog_path": str(cog_path), "status": "ready", **meta,
            })
            db.commit()
    except Exception as exc:
        log.error("ingest %s failed:\n%s", raster_id, traceback.format_exc())
        with SessionLocal() as db:
            db.query(Raster).filter(Raster.id == raster_id).update(
                {"status": "failed", "error": str(exc)})
            db.commit()


def _run_analysis_safe(job_id: int) -> None:
    try:
        _run_analysis(job_id)
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
        mode = (job.mode or "ai").lower()
        zones = [z.geometry for z in
                 db.query(RedZone).filter(RedZone.project_id == job.project_id)]

    _update(job_id, status="running", progress=0.02,
            stage="Superimposing rasters (reproject + co-register + normalize)")
    pair = preprocess.superimpose(Path(r1.original_path), Path(r2.original_path))

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
                       f"Building footprints (per epoch): {seg_name}",
                       "Encroachment logic: vegetation-loss seed (NDVI / excess-green)"]
        _update(job_id, progress=0.25,
                stage=f"Segmenting building footprints — {seg_name}")

        # Segment each epoch separately, then diff the footprints.
        b1 = ml_engine.segment_scene(
            pair.t1, pair.valid,
            lambda f: _update(job_id, progress=0.25 + 0.22 * f))
        b2 = ml_engine.segment_scene(
            pair.t2, pair.valid,
            lambda f: _update(job_id, progress=0.47 + 0.22 * f))
        prob = ml_engine.building_change_prob(b1, b2, pair.valid,
                                              pair.t1, pair.t2,
                                              pair.veg1, pair.veg2,
                                              pair.resolution_m)
        if settings.sam_refine:
            _update(job_id, progress=0.70,
                    stage="Refining full building structures — SAM2")
            prob = ml_engine.refine_full_structures(prob, pair.t2, pair.valid)
            models_used.append(
                f"Full-structure refinement: SAM2 ({settings.sam_model_repo})")
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
        pair.resolution_m, zones,
    )

    from ..models import ChangePolygon  # local import to avoid cycles
    with SessionLocal() as db:
        db.query(ChangePolygon).filter(ChangePolygon.job_id == job_id).delete()
        for f in features:
            db.add(ChangePolygon(job_id=job_id, geometry=f["geometry"],
                                 properties=f["properties"]))
        db.commit()

    illegal = sum(1 for f in features if f["properties"]["status"] == "illegal")
    stats = {
        "polygons": len(features),
        "illegal": illegal,
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
