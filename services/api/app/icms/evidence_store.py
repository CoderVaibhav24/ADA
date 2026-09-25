"""The evidence file store, shared by inspection evidence and case evidence."""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path

from ada_core.models_icms import Evidence
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..errors import ApiError
from .uploads import check_upload, rules_for

try:
    import pillow_heif
    from PIL import Image, ImageOps

    pillow_heif.register_heif_opener()
    _HEIF_READY = True
except ImportError:  # pragma: no cover - the dependency is pinned in uv.lock
    _HEIF_READY = False

__all__ = ["StoredEvidence", "discard_stored", "resolve_stored", "store", "stored_file"]

log = logging.getLogger("ada.api.icms.evidence")


@dataclass(frozen=True)
class StoredEvidence:
    path: Path
    filename: str
    content_type: str | None


# Validated as it streams and only then moved into place, so a rejected upload
# leaves a .part file to sweep rather than a file the register points at.
def store(db: Session, case_ref: str, kind: str, upload: UploadFile) -> tuple:
    folder = settings.icms_evidence_dir / case_ref
    folder.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(dir=folder, suffix=".part", delete=False)
    try:
        with handle as sink:
            result = check_upload(
                db, kind, upload.file,
                filename=upload.filename, declared_type=upload.content_type, sink=sink,
            )
    except BaseException:
        Path(handle.name).unlink(missing_ok=True)
        raise

    if result.media_type == "image/heic":
        try:
            result = _heic_to_jpeg(Path(handle.name), result, rules_for(db, kind).max_pixels)
        except BaseException:
            Path(handle.name).unlink(missing_ok=True)
            raise
        # The row names what is stored: a JPEG, not the handset's .heic.
        upload.filename = f"{Path(upload.filename or 'photo').stem}.jpg"

    # Content-addressed: the same bytes sent twice occupy one file and two rows.
    stored = folder / f"{result.sha256}{result.extension}"
    created = not stored.exists()
    os.replace(handle.name, stored)
    return result, f"{case_ref}/{stored.name}", created


# Rewrites an iPhone HEIC in place as an upright JPEG with its EXIF (GPS) and colour
# profile kept; 415 if undecodable.
def _heic_to_jpeg(part: Path, result, max_pixels: int | None):
    if not _HEIF_READY:
        raise ApiError(415, "unsupported_image_format",
                       "HEIC photographs cannot be read here; send a JPEG")
    try:
        with Image.open(part) as opened:
            width, height = opened.size
            if max_pixels and width * height > max_pixels:
                raise ApiError(413, "image_too_large",
                               f"the image is {width}x{height} pixels, above the "
                               f"{max_pixels} pixel limit")
            icc = opened.info.get("icc_profile")
            image = ImageOps.exif_transpose(opened).convert("RGB")
        exif = image.getexif()
        exif[0x0112] = 1
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(415, "unsupported_image_format",
                       "the HEIC photograph could not be decoded; send a JPEG") from exc
    handle = tempfile.NamedTemporaryFile(dir=part.parent, suffix=".part", delete=False)
    try:
        with handle as sink:
            image.save(sink, format="JPEG", quality=92, exif=exif.tobytes(),
                       **({"icc_profile": icc} if icc else {}))
        os.replace(handle.name, part)
    except BaseException:
        Path(handle.name).unlink(missing_ok=True)
        raise
    data = part.read_bytes()
    return replace(result, media_type="image/jpeg", extension=".jpg", byte_size=len(data),
                   sha256=hashlib.sha256(data).hexdigest(), pixels=image.width * image.height)


# Removes a file this request created and no committed row points at.
def discard_stored(db: Session, storage_path: str, created: bool) -> None:
    if not created:
        return
    try:
        referenced = db.execute(
            select(Evidence.id).where(Evidence.storage_path == storage_path).limit(1)
        ).first()
        if referenced is None:
            (settings.icms_evidence_dir / storage_path).unlink(missing_ok=True)
    except Exception:
        log.warning("could not discard unreferenced evidence file %s", storage_path,
                    exc_info=True)


# storage_path is ours and relative, but a stored path that escapes the root is
# worth one comparison rather than a trusted join.
def resolve_stored(storage_path: str | None) -> Path | None:
    if not storage_path:
        return None
    root = settings.icms_evidence_dir.resolve()
    candidate = (root / storage_path).resolve()
    return candidate if candidate.is_relative_to(root) else None


# The file behind a row the caller has already been allowed to read.
def stored_file(row, evidence_id: int) -> StoredEvidence:
    path = resolve_stored(row.storage_path)
    if path is None or not path.is_file():
        log.error("evidence %s is recorded at %r and is not on disk",
                  evidence_id, row.storage_path)
        raise ApiError(
            404, "evidence_content_missing",
            "the record exists but its file is not in the evidence store",
        )
    return StoredEvidence(
        path=path,
        filename=row.original_filename or f"{row.sha256 or evidence_id}{path.suffix}",
        content_type=row.content_type,
    )
