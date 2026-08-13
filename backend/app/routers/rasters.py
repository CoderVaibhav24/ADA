import logging
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import current_user_id, get_owned_project
from ..models import Raster
from ..schemas import RasterOut
from ..services import jobs

log = logging.getLogger("ada.rasters")
router = APIRouter(tags=["rasters"])


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


@router.post("/projects/{project_id}/rasters", response_model=RasterOut)
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
        except ValueError:
            raise HTTPException(400, "captured_at must be an ISO date")

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
            pass  # ingest will surface a clear error if georef is unusable

    raster.original_path = str(tif_path)
    db.commit()

    jobs.submit_ingest(raster.id)
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


@router.delete("/rasters/{raster_id}")
def delete_raster(
    raster_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = db.get(Raster, raster_id)
    if raster is None:
        raise HTTPException(404, "Raster not found")
    get_owned_project(raster.project_id, db, user_id)
    files = [p for p in (raster.original_path, raster.cog_path) if p]

    # Commit the row first, then unlink. ADA's originals run to 18 GB and
    # deleting one is not instant; doing it inside the transaction held a
    # connection — and the row's locks — for the whole of it, which is how a
    # single delete could stall every other request behind the pool.
    db.delete(raster)
    db.commit()
    db.close()

    for path in files:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError as exc:
            # The row is already gone, so the raster is deleted as far as the
            # user is concerned; a file still held open by a reader just leaves
            # bytes on disk. Worth a log, not worth a failed request.
            log.warning("could not remove %s for deleted raster %s: %s",
                        path, raster_id, exc)
    return {"ok": True}
