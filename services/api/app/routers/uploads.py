"""Chunked, resumable raster upload (docs/ADA-Upload-and-ML-Runtime-Design.md §3.1)."""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import shutil
from pathlib import Path
from typing import Literal

from ada_core.database import get_db
from ada_core.datetimes import now_ist
from ada_core.models import Project, Raster
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import update
from sqlalchemy.orm import Session

from .. import sweeper, uploads_bitmap
from ..clients import ml as ml_client
from ..config import settings
from ..deps import current_user_id, get_owned_project, require_imagery
from ..raster_validation import validate_raster_file
from ..schemas import (
    RasterOut,
    UploadComplete,
    UploadCreate,
    UploadDuplicate,
    UploadRejected,
    UploadSessionOut,
)
from .rasters import _raw_files, reject_raster, unlink_all

log = logging.getLogger("ada.uploads")
router = APIRouter(tags=["uploads"], dependencies=[Depends(require_imagery)])

# A fingerprint in one of these already is, or will become, a usable raster.
_LIVE_STATUSES = ("uploading", "completing", "processing", "failed_retryable", "ready",
                  "cold", "restoring")
_OPEN_STATUSES = ("uploading", "completing")
_DISK_FACTOR = 2.5
_SIDECAR_MAX_BYTES = 64 << 10
_CONTENT_RANGE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")
_EPSG = re.compile(r"^EPSG:(\d+)$")
_BINARY_BODY = {"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}}
_CHUNK_HEADERS = [{"name": "X-Chunk-SHA256", "in": "header", "required": True,
                   "schema": {"type": "string"}, "description": "hex SHA-256 of the body"}]


# Async so a declared length over the cap is refused before a byte is buffered.
async def _read_capped(request: Request, cap: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > cap:
        raise HTTPException(413, f"The body is larger than {cap} bytes")
    body = bytearray()
    async for piece in request.stream():
        body += piece
        if len(body) > cap:
            raise HTTPException(413, f"The body is larger than {cap} bytes")
    return bytes(body)


async def chunk_body(request: Request) -> bytes:
    return await _read_capped(request, settings.upload_chunk_bytes)


async def sidecar_body(request: Request) -> bytes:
    return await _read_capped(request, _SIDECAR_MAX_BYTES)


def _session_out(raster: Raster) -> UploadSessionOut:
    return UploadSessionOut(
        upload_id=raster.id,
        name=raster.name,
        fingerprint=raster.fingerprint,
        size_bytes=raster.size_bytes or 0,
        chunk_size=raster.chunk_size or 0,
        chunk_count=raster.chunk_count or 0,
        received=uploads_bitmap.received(raster.received_chunks, raster.chunk_count or 0),
        status=raster.status,
        reject_reason=raster.reject_reason,
    )


# Chunks already written occupy disk; the rest of the file is still to come.
def _remaining_bytes(raster: Raster) -> int:
    received = uploads_bitmap.count(raster.received_chunks) * (raster.chunk_size or 0)
    return max(0, (raster.size_bytes or 0) - received)


def _part_path(raster: Raster) -> Path:
    return settings.uploads_dir / f"raster_{raster.id}.part"


def _owned_upload(upload_id: int, db: Session, user_id: str) -> Raster:
    raster = db.get(Raster, upload_id)
    if raster is None or raster.chunk_size is None:
        raise HTTPException(404, "Upload not found")
    get_owned_project(raster.project_id, db, user_id)
    return raster


def _require_uploading(raster: Raster) -> None:
    if raster.status != "uploading":
        raise HTTPException(409, f"The upload is no longer open (status is {raster.status})")


@router.post(
    "/projects/{project_id}/uploads",
    response_model=UploadSessionOut,
    status_code=201,
    responses={
        409: {"model": UploadDuplicate, "description": "The same file is already in the project"},
        413: {"description": "Larger than UPLOAD_MAX_BYTES"},
        429: {"description": "Too many open uploads for this user"},
        507: {"description": "Not enough free disk for the upload and its ingest"},
    },
)
def open_upload(
    project_id: int,
    body: UploadCreate,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    if body.size_bytes > settings.upload_max_bytes:
        raise HTTPException(413, f"The file is larger than the {settings.upload_max_bytes} "
                                 "byte limit")

    existing = (db.query(Raster)
                .filter(Raster.project_id == project_id,
                        Raster.fingerprint == body.fingerprint,
                        Raster.status.in_(_LIVE_STATUSES))
                .order_by(Raster.id).first())
    if existing is not None:
        return JSONResponse(status_code=409, content={
            "detail": f"This file is already in the project as '{existing.name}'",
            "existing_raster_id": existing.id,
        })

    mine = (db.query(Raster.id).join(Project, Project.id == Raster.project_id)
            .filter(Project.user_id == user_id, Raster.status.in_(_OPEN_STATUSES)).count())
    if mine >= settings.upload_max_open_sessions:
        raise HTTPException(429, f"You already have {mine} uploads open; finish or cancel one "
                                 "first")

    usage = shutil.disk_usage(settings.uploads_dir)
    open_rows = db.query(Raster).filter(Raster.status.in_(_OPEN_STATUSES)).all()
    reserved = sum(_remaining_bytes(row) for row in open_rows)
    if sweeper.disk_low(usage) or usage.free - reserved < _DISK_FACTOR * body.size_bytes:
        log.error("upload refused for lack of disk: %d bytes free, %d reserved by open uploads, "
                  "%d requested", usage.free, reserved, body.size_bytes)
        raise HTTPException(507, "The server does not have enough free disk for this upload")

    chunk_size = settings.upload_chunk_bytes
    now = now_ist()
    raster = Raster(
        project_id=project_id, name=body.name, captured_at=body.captured_at,
        original_path="", status="uploading", size_bytes=body.size_bytes,
        fingerprint=body.fingerprint, chunk_size=chunk_size,
        chunk_count=math.ceil(body.size_bytes / chunk_size), received_chunks="",
        crs=f"EPSG:{body.crs_epsg}" if body.crs_epsg else None,
        last_chunk_at=now, last_used_at=now,
    )
    db.add(raster)
    db.commit()
    db.refresh(raster)

    part = _part_path(raster)
    try:
        # Sparse on most filesystems: the reservation is the row's size_bytes, not disk blocks.
        with part.open("wb") as handle:
            handle.truncate(body.size_bytes)
    except OSError as exc:
        part.unlink(missing_ok=True)
        db.delete(raster)
        db.commit()
        log.error("could not preallocate %s: %s", part, exc)
        raise HTTPException(507, "The server could not reserve disk for this upload") from exc
    raster.original_path = str(part)
    db.commit()
    log.info("upload %s opened: %d bytes in %d chunks", raster.id, body.size_bytes,
             raster.chunk_count)
    return _session_out(raster)


@router.get("/projects/{project_id}/uploads", response_model=list[UploadSessionOut])
def list_open_uploads(
    project_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    rows = (db.query(Raster)
            .filter(Raster.project_id == project_id, Raster.status.in_(_OPEN_STATUSES))
            .order_by(Raster.id).all())
    return [_session_out(row) for row in rows]


@router.get("/uploads/{upload_id}", response_model=UploadSessionOut)
def get_upload(
    upload_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return _session_out(_owned_upload(upload_id, db, user_id))


def _read_at(path: Path, offset: int, length: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        return handle.read(length)


# The row lock is held across the write so an abort or complete cannot interleave with it.
@router.put(
    "/uploads/{upload_id}/chunks/{n}",
    status_code=204,
    openapi_extra={**_BINARY_BODY, "parameters": _CHUNK_HEADERS},
    responses={400: {"description": "Bad hash, header or chunk length"},
               409: {"description": "The upload is closed, or this chunk differs from the "
                                    "one already received"},
               413: {"description": "Body larger than one chunk"},
               416: {"description": "Chunk index or Content-Range out of range"}},
)
def put_chunk(
    upload_id: int,
    n: int,
    request: Request,
    data: bytes = Depends(chunk_body),
    content_range: str | None = Header(None, alias="Content-Range"),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    claimed = (request.headers.get("X-Chunk-SHA256") or "").strip().lower()
    if not claimed:
        raise HTTPException(400, "X-Chunk-SHA256 header required")
    raster = _owned_upload(upload_id, db, user_id)
    _require_uploading(raster)
    chunk_size, chunk_count, size = raster.chunk_size, raster.chunk_count, raster.size_bytes
    if n < 0 or n >= chunk_count:
        raise HTTPException(416, f"Chunk {n} is outside 0..{chunk_count - 1}")
    start = n * chunk_size
    expected_len = min(chunk_size, size - start)
    if content_range is not None:
        match = _CONTENT_RANGE.match(content_range.strip())
        if match is None:
            raise HTTPException(400, "Content-Range must be 'bytes a-b/size'")
        first, last, total = (int(g) for g in match.groups())
        if (first, last, total) != (start, start + expected_len - 1, size):
            raise HTTPException(416, f"Content-Range does not match chunk {n} of this upload")
    if len(data) != expected_len:
        raise HTTPException(400, f"Chunk {n} must be {expected_len} bytes, got {len(data)}")
    if hashlib.sha256(data).hexdigest() != claimed:
        raise HTTPException(400, f"Chunk {n} failed its SHA-256 check; send it again")

    locked = (db.query(Raster).filter(Raster.id == upload_id)
              .with_for_update().populate_existing().one_or_none())
    if locked is None or locked.status != "uploading":
        db.rollback()
        raise HTTPException(409, "The upload is no longer open")
    part = Path(locked.original_path)
    try:
        if uploads_bitmap.get_bit(locked.received_chunks, n):
            same = hashlib.sha256(_read_at(part, start, expected_len)).hexdigest() == claimed
            db.rollback()
            if not same:
                raise HTTPException(409, f"Chunk {n} was already received with different bytes")
            return Response(status_code=204)
        with part.open("r+b") as handle:
            handle.seek(start)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except FileNotFoundError as exc:
        db.rollback()
        raise HTTPException(409, "The upload file is gone; the session was closed") from exc
    except OSError as exc:
        db.rollback()
        log.error("could not write chunk %d of upload %s: %s", n, upload_id, exc)
        raise HTTPException(507, "The server could not store this chunk") from exc
    locked.received_chunks = uploads_bitmap.set_bit(locked.received_chunks, n)
    locked.last_chunk_at = now_ist()
    db.commit()
    return Response(status_code=204)


@router.put("/uploads/{upload_id}/sidecars/{kind}", status_code=204,
            openapi_extra=_BINARY_BODY,
            responses={409: {"description": "The upload is no longer open"},
                       413: {"description": "Larger than 64 KiB"}})
def put_sidecar(
    upload_id: int,
    kind: Literal["tfw", "prj"],
    data: bytes = Depends(sidecar_body),
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = _owned_upload(upload_id, db, user_id)
    _require_uploading(raster)
    (settings.uploads_dir / f"raster_{raster.id}.{kind}").write_bytes(data)
    return Response(status_code=204)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _stamp_crs(path: Path, epsg: int, raster_id: int) -> None:
    import rasterio
    from rasterio.crs import CRS

    try:
        with rasterio.open(path, "r+") as ds:
            if ds.crs is None:
                ds.crs = CRS.from_epsg(epsg)
    except Exception:
        log.warning("could not stamp EPSG:%s onto raster %s", epsg, raster_id, exc_info=True)


def _reject(raster: Raster, reason: str, db: Session) -> JSONResponse:
    reject_raster(raster, reason)
    db.commit()
    return JSONResponse(status_code=422, content={"detail": reason, "raster_id": raster.id})


def _settled(raster: Raster):
    if raster.status in ("processing", "ready", "cold", "restoring", "failed_retryable"):
        return raster
    if raster.status == "completing":
        return JSONResponse(status_code=202, content={"detail": "completing"})
    if raster.status == "rejected":
        return JSONResponse(status_code=422, content={
            "detail": raster.reject_reason or "rejected", "raster_id": raster.id})
    raise HTTPException(409, f"The upload is no longer open (status is {raster.status})")


def _reopen(db: Session, upload_id: int) -> None:
    db.rollback()
    db.execute(update(Raster).where(Raster.id == upload_id, Raster.status == "completing")
               .values(status="uploading"))
    db.commit()


# The uploading -> completing compare-and-set is what lets exactly one of two retries validate.
@router.post(
    "/uploads/{upload_id}/complete",
    response_model=RasterOut,
    responses={202: {"description": "Another request is completing this upload; poll "
                                    "GET /uploads/{upload_id} until status leaves 'completing'"},
               409: {"description": "Chunks are missing or the upload is closed"},
               422: {"model": UploadRejected, "description": "The file failed validation"}},
)
def complete_upload(
    upload_id: int,
    body: UploadComplete | None = None,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = _owned_upload(upload_id, db, user_id)
    if raster.status != "uploading":
        return _settled(raster)
    gaps = uploads_bitmap.missing(raster.received_chunks, raster.chunk_count)
    if gaps:
        return JSONResponse(status_code=409, content={
            "detail": f"{len(gaps)} chunk(s) have not been received", "missing": gaps[:1000]})

    won = db.execute(update(Raster)
                     .where(Raster.id == upload_id, Raster.status == "uploading")
                     .values(status="completing", last_progress_at=now_ist())).rowcount
    db.commit()
    db.refresh(raster)
    if won != 1:
        return _settled(raster)

    part = Path(raster.original_path)
    stem = settings.uploads_dir / f"raster_{raster.id}"
    epsg_match = _EPSG.match(raster.crs or "")
    epsg = int(epsg_match.group(1)) if epsg_match else None
    tif = stem.with_suffix(".tif")
    try:
        reason = None
        if body is not None and body.sha256:
            actual = _file_sha256(part)
            if actual != body.sha256.lower():
                reason = ("the assembled file does not match the SHA-256 the browser sent; "
                          "upload it again")
            else:
                raster.sha256 = actual
        if reason is None:
            reason = validate_raster_file(part, has_tfw=stem.with_suffix(".tfw").is_file(),
                                          has_prj=stem.with_suffix(".prj").is_file(),
                                          crs_epsg=epsg)
        if reason is not None:
            return _reject(raster, reason, db)
        part.replace(tif)
    except Exception:
        _reopen(db, upload_id)
        raise
    if epsg:
        _stamp_crs(tif, epsg, raster.id)
    raster.original_path = str(tif)
    raster.status = "processing"
    raster.progress = 0.0
    raster.stage = "Queued for ingest"
    raster.last_progress_at = now_ist()
    db.commit()
    log.info("upload %s complete; queued for ingest", raster.id)

    try:
        ml_client.submit_ingest(raster.id)
    except HTTPException:
        raster.stage = "Queued: model service unavailable, will retry"
        db.commit()
    db.refresh(raster)
    return raster


@router.delete("/uploads/{upload_id}", status_code=204,
               responses={409: {"description": "Not an open or rejected upload"}})
def abort_upload(
    upload_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = _owned_upload(upload_id, db, user_id)
    if raster.status not in ("uploading", "rejected"):
        raise HTTPException(409, "Only an open upload can be aborted; delete the raster instead")
    files = _raw_files(raster)
    raster_id = raster.id
    db.delete(raster)
    db.commit()
    unlink_all(files, raster_id)
    log.info("upload %s aborted", raster_id)
    return Response(status_code=204)
