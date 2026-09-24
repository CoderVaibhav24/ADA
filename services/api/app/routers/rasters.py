import logging
import shutil
from datetime import datetime
from pathlib import Path

from ada_core.database import get_db
from ada_core.datetimes import now_ist
from ada_core.models import AnalysisJob, ChangePolygon, Raster
from ada_core.models_icms import Case as IcmsCase
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..clients import ml as ml_client
from ..coldstore import ColdStore, ColdStoreError
from ..config import settings
from ..deps import current_user_id, get_owned_project, require_imagery
from ..raster_validation import validate_raster_file
from ..schemas import RasterOut, RestoreOut, UploadRejected

log = logging.getLogger("ada.rasters")
router = APIRouter(tags=["rasters"], dependencies=[Depends(require_imagery)])


# --- Why every endpoint in this package is `def`, not `async def` -------------
#
# None of them await anything: they run blocking SQLAlchemy queries, blocking
# GDAL reads, and — here — a multi-gigabyte file copy. FastAPI runs an
# `async def` endpoint ON the event loop, so each of those held the entire
# server hostage for its duration. Declared `def`, FastAPI runs them in its
# worker threadpool instead and the loop stays free to answer everything else.
#
# The upload path is where this was most visible. Starlette has already spooled
# the request body to a temp file by the time the endpoint is called, so this
# copy is temp -> uploads: for one of ADA's 6 GB grid tiles, minutes of blocking
# disk I/O during which every other request queued behind it and the browser
# eventually gave up with a timeout.


def _save_upload(upload: UploadFile, dest: Path) -> None:
    with dest.open("wb") as out:
        shutil.copyfileobj(upload.file, out, length=8 << 20)


@router.post(
    "/projects/{project_id}/rasters",
    response_model=RasterOut,
    deprecated=True,
    description=("Deprecated: single-request upload, kept for one release. Use the chunked "
                 "POST /projects/{project_id}/uploads flow instead."),
    responses={422: {"model": UploadRejected, "description": "The file failed validation"}},
)
def upload_raster(
    project_id: int,
    name: str = Form(...),
    captured_at: str | None = Form(None),
    crs_epsg: int | None = Form(None),
    file: UploadFile = File(...),
    tfw: UploadFile | None = File(None),
    prj: UploadFile | None = File(None),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    if not (file.filename or "").lower().endswith((".tif", ".tiff")):
        raise HTTPException(400, "Upload a .tif/.tiff file")

    captured = None
    if captured_at:
        try:
            captured = datetime.fromisoformat(captured_at)
        except ValueError as exc:
            raise HTTPException(400, "captured_at must be an ISO date") from exc

    raster = Raster(project_id=project_id, name=name, captured_at=captured,
                    original_path="", status="processing")
    db.add(raster)
    db.commit()
    db.refresh(raster)

    stem = settings.uploads_dir / f"raster_{raster.id}"
    tif_path = stem.with_suffix(".tif")
    _save_upload(file, tif_path)
    if tfw is not None:
        _save_upload(tfw, stem.with_suffix(".tfw"))
    if prj is not None:
        _save_upload(prj, stem.with_suffix(".prj"))

    if crs_epsg:
        import rasterio
        from rasterio.crs import CRS
        try:
            with rasterio.open(tif_path, "r+") as ds:
                if ds.crs is None:
                    ds.crs = CRS.from_epsg(crs_epsg)
        except Exception:
            # Not fatal: the override is a convenience for imagery whose CRS is
            # missing, and ingest reports an unusable georeference with a
            # message that names the file. Logged rather than passed silently,
            # because "my EPSG override did nothing" is otherwise unanswerable.
            log.warning("could not stamp EPSG:%s onto %s", crs_epsg, tif_path,
                        exc_info=True)

    raster.original_path = str(tif_path)
    raster.size_bytes = tif_path.stat().st_size
    reason = validate_raster_file(tif_path, has_tfw=tfw is not None, has_prj=prj is not None,
                                  crs_epsg=crs_epsg)
    if reason is not None:
        reject_raster(raster, reason)
        db.commit()
        return JSONResponse(status_code=422,
                            content={"detail": reason, "raster_id": raster.id})
    raster.last_progress_at = now_ist()
    db.commit()

    ml_client.submit_ingest(raster.id)
    db.refresh(raster)
    return raster


@router.get("/projects/{project_id}/rasters", response_model=list[RasterOut])
def list_rasters(
    project_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    return (db.query(Raster).filter(Raster.project_id == project_id)
            .order_by(Raster.uploaded_at).all())


# Staging and sidecar names ingest and GDAL leave beside a raster file.
def _with_sidecars(path: Path) -> list[Path]:
    return [path, Path(f"{path}.ovr"), Path(f"{path}.aux.xml"),
            path.with_suffix(".ovr"), path.with_suffix(".aux.xml")]


# The raw upload in every shape it passes through: .part, .tif, world and projection files.
def _raw_files(raster: Raster) -> list[Path]:
    stem = settings.uploads_dir / f"raster_{raster.id}"
    originals = [stem.with_suffix(".part"), stem.with_suffix(".tif")]
    if raster.original_path:
        originals.insert(0, Path(raster.original_path))
    files: list[Path] = []
    for original in dict.fromkeys(originals):
        files += _with_sidecars(original)
        files += [original.with_suffix(".tfw"), original.with_suffix(".prj")]
    return list(dict.fromkeys(files))


# The tier-1 archive master ml-worker writes beside the upload.
def _archive_files(raster: Raster) -> list[Path]:
    archives = [settings.uploads_dir / f"raster_{raster.id}.archive.tif"]
    if raster.archive_path:
        archives.insert(0, Path(raster.archive_path))
    files = [p for archive in dict.fromkeys(archives) for p in _with_sidecars(archive)]
    files += [Path(f"{archive}.download") for archive in archives]
    return list(dict.fromkeys(files))


# Every file one raster owns: upload + world/projection files, archive, COG, the .tmp.tif stage.
def _raster_files(raster: Raster) -> list[Path]:
    files = _raw_files(raster) + _archive_files(raster)
    cog = (Path(raster.cog_path) if raster.cog_path
           else settings.cogs_dir / f"raster_{raster.id}.tif")
    files += _with_sidecars(cog)
    files += _with_sidecars(cog.with_suffix(".tmp.tif"))
    return list(dict.fromkeys(files))


def unlink_all(paths: list[Path], raster_id: int) -> int:
    removed = 0
    for path in dict.fromkeys(paths):
        try:
            if path.is_file():
                path.unlink()
                removed += 1
        except OSError as exc:
            log.warning("could not remove %s for raster %s: %s", path, raster_id, exc)
    return removed


# A rejected upload keeps its row (for the reason) but never its bytes.
def reject_raster(raster: Raster, reason: str) -> None:
    raster.status = "rejected"
    raster.reject_reason = reason
    raster.error = reason
    raster.last_progress_at = now_ist()
    unlink_all(_raw_files(raster), raster.id)
    log.info("raster %s rejected: %s", raster.id, reason)


# The mask plus the aligned t1/t2 epochs jobs.py writes per run.
def _job_files(job: AnalysisJob) -> list[Path]:
    paths = [settings.masks_dir / f"job_{job.id}_{part}.tif" for part in ("mask", "t1", "t2")]
    if job.mask_cog_path:
        paths.append(Path(job.mask_cog_path))
    return [p for path in paths for p in _with_sidecars(path)]


# Rows go in one transaction, children first, so SQLite (no FK enforcement) and Postgres agree.
@router.delete("/rasters/{raster_id}", status_code=204)
def delete_raster(
    raster_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = db.get(Raster, raster_id)
    if raster is None:
        raise HTTPException(404, "Raster not found")
    get_owned_project(raster.project_id, db, user_id)

    jobs = (db.query(AnalysisJob)
            .filter(or_(AnalysisJob.raster_t1_id == raster_id,
                        AnalysisJob.raster_t2_id == raster_id)).all())
    job_ids = [job.id for job in jobs]
    files = _raster_files(raster) + [p for job in jobs for p in _job_files(job)]
    cold_key = raster.cold_key

    if job_ids:
        polygon_ids = select(ChangePolygon.id).where(ChangePolygon.job_id.in_(job_ids))
        db.query(IcmsCase).filter(IcmsCase.detection_id.in_(polygon_ids)).update(
            {"detection_id": None}, synchronize_session=False)
        db.query(ChangePolygon).filter(ChangePolygon.job_id.in_(job_ids)).delete(
            synchronize_session=False)
        db.query(AnalysisJob).filter(AnalysisJob.id.in_(job_ids)).delete(
            synchronize_session=False)
    # A processing raster is deleted too; the worker's row updates then match nothing.
    db.delete(raster)
    db.commit()
    db.close()

    unlink_all(files, raster_id)
    if cold_key:
        _delete_cold_object(cold_key, raster_id)
    log.info("raster %s deleted with %d dependent analysis run(s)", raster_id, len(job_ids))
    return Response(status_code=204)


# Best-effort: under Object Lock the bucket refuses until retention ends; the row is gone anyway.
def _delete_cold_object(key: str, raster_id: int) -> None:
    try:
        store = ColdStore.from_settings(settings)
        if store is None:
            log.warning("raster %s had cold object %s but no cold store is configured",
                        raster_id, key)
            return
        store.delete_object(key)
    except Exception as exc:
        log.warning("could not delete cold object %s for raster %s: %s", key, raster_id, exc)


@router.post("/rasters/{raster_id}/restore", response_model=RestoreOut, status_code=202,
             responses={409: {"description": "The raster is not in the cold tier"},
                        503: {"description": "The cold store is not configured or unreachable"}})
def restore_raster(
    raster_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = db.get(Raster, raster_id)
    if raster is None:
        raise HTTPException(404, "Raster not found")
    get_owned_project(raster.project_id, db, user_id)
    if raster.status == "restoring":
        return RestoreOut(status="restoring", eta_hours=raster.restore_eta_hours or 0.0)
    if raster.status != "cold" or not raster.cold_key:
        raise HTTPException(409, f"Only an archived raster can be restored (status is "
                                 f"{raster.status})")
    store = ColdStore.from_settings(settings)
    if store is None:
        raise HTTPException(503, "The archive store is not configured")
    try:
        store.request_restore(raster.cold_key)
    except ColdStoreError as exc:
        log.error("restore request for raster %s failed: %s", raster_id, exc)
        raise HTTPException(503, "The archive store is not reachable; try again later") from exc
    eta = settings.cold_restore_eta_hours if store.archival else 0.0
    raster.status = "restoring"
    raster.restore_requested_at = now_ist()
    raster.restore_eta_hours = eta
    db.commit()
    log.info("raster %s restore requested from %s", raster_id, raster.cold_key)
    return RestoreOut(status="restoring", eta_hours=eta)
