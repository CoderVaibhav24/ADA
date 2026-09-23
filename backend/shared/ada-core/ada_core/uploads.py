"""The one place a file is judged before anything writes it to disk.

Framework-free on purpose: ada-api, ada-ml and the notify worker all import it,
so it returns a result and leaves raising to the caller.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import BinaryIO, Protocol

__all__ = [
    "CHUNK_BYTES",
    "HEAD_BYTES",
    "UploadResult",
    "UploadRules",
    "dimensions",
    "sniff",
    "validate_upload",
]

# Enough for a PNG IHDR, an ISO-BMFF ftyp box and a JPEG SOF sitting behind its EXIF block.
HEAD_BYTES = 8192
CHUNK_BYTES = 64 * 1024
# Only the trailer decides truncation, so the whole file never has to be held.
TAIL_BYTES = 1024

_ISOBMFF_BRANDS = {
    "heic": "image/heic", "heix": "image/heic", "heim": "image/heic",
    "heis": "image/heic", "hevc": "image/heic", "hevx": "image/heic",
    "mif1": "image/heic", "msf1": "image/heic",
    "qt  ": "video/quicktime",
    "isom": "video/mp4", "iso2": "video/mp4", "iso4": "video/mp4",
    "iso5": "video/mp4", "iso6": "video/mp4", "mp41": "video/mp4",
    "mp42": "video/mp4", "avc1": "video/mp4", "mmp4": "video/mp4",
    "dash": "video/mp4", "m4v ": "video/mp4",
}

_JPEG_SOF = frozenset(
    {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF})


class Sink(Protocol):
    def write(self, data: bytes, /) -> object: ...


@dataclass(frozen=True)
class UploadRules:
    """One icms_upload_policy row, detached from the ORM so a worker can hold one."""

    kind: str
    mime_types: tuple[str, ...] = ()
    extensions: tuple[str, ...] = ()
    max_bytes: int = 0
    max_pixels: int | None = None
    storage_backend: str = "local"

    # Normalises here rather than at every call site: an allowlist holding 'JPG' matches nothing.
    @classmethod
    def from_row(cls, row: object) -> UploadRules:
        return cls(
            kind=str(getattr(row, "kind", "")),
            mime_types=tuple(
                str(m).strip().lower() for m in (getattr(row, "mime_types", None) or ())),
            extensions=tuple(
                _normalise_extension(e) for e in (getattr(row, "extensions", None) or ())),
            max_bytes=int(getattr(row, "max_bytes", 0) or 0),
            max_pixels=(int(getattr(row, "max_pixels", 0) or 0) or None),
            storage_backend=str(getattr(row, "storage_backend", "") or "local"),
        )


@dataclass(frozen=True)
class UploadResult:
    ok: bool
    kind: str = ""
    status_code: int = 200
    code: str = ""
    message: str = ""
    field: str | None = None
    allowed: tuple[str, ...] = ()
    media_type: str = ""
    extension: str = ""
    byte_size: int = 0
    sha256: str = ""
    pixels: int | None = None


def _normalise_extension(value: str) -> str:
    text = str(value).strip().lower()
    return text if text.startswith(".") else f".{text}"


# Reads the file's own first bytes; the client's Content-Type and its filename are both forgeable.
def sniff(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return _ISOBMFF_BRANDS.get(head[8:12].decode("ascii", "replace").lower())
    return None


# Best effort: PNG states its size in the header, JPEG only if the SOF landed inside the head.
def dimensions(media_type: str, head: bytes) -> tuple[int, int] | None:
    if media_type == "image/png" and len(head) >= 24 and head[12:16] == b"IHDR":
        return (int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big"))
    if media_type == "image/jpeg":
        return _jpeg_dimensions(head)
    return None


def _jpeg_dimensions(head: bytes) -> tuple[int, int] | None:
    index, end = 2, len(head)
    while index + 9 < end:
        if head[index] != 0xFF:
            index += 1
            continue
        marker = head[index + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        segment = int.from_bytes(head[index + 2:index + 4], "big")
        if marker in _JPEG_SOF:
            return (int.from_bytes(head[index + 7:index + 9], "big"),
                    int.from_bytes(head[index + 5:index + 7], "big"))
        if segment < 2:
            return None
        index += 2 + segment
    return None


# A file cut off mid-transfer decodes as garbage on the handset, so the trailer is checked.
def _is_complete(media_type: str, head: bytes, tail: bytes, size: int) -> bool:
    if media_type == "image/jpeg":
        return tail.rstrip(b"\x00\r\n ").endswith(b"\xff\xd9")
    if media_type == "image/png":
        return b"IEND" in tail
    if media_type == "application/pdf":
        return b"%%EOF" in tail
    if media_type in ("video/mp4", "video/quicktime", "image/heic"):
        declared = int.from_bytes(head[0:4], "big")
        return declared <= 1 or declared <= size
    return True


def _read_head(stream: BinaryIO) -> bytes:
    chunks, remaining = [], HEAD_BYTES
    while remaining > 0:
        block = stream.read(remaining)
        if not block:
            break
        chunks.append(block)
        remaining -= len(block)
    return b"".join(chunks)


def _reject(rules: UploadRules, status: int, code: str, message: str,
            *, field: str | None = None, allowed: tuple[str, ...] = ()) -> UploadResult:
    return UploadResult(ok=False, kind=rules.kind, status_code=status, code=code,
                        message=message, field=field, allowed=allowed)


def validate_upload(
    stream: BinaryIO,
    rules: UploadRules,
    *,
    filename: str | None = None,
    declared_type: str | None = None,
    sink: Sink | None = None,
) -> UploadResult:
    """Judge a stream against one policy row, writing to `sink` only once the type
    is proven. Returns a result; it raises nothing and logs nothing."""
    if not rules.mime_types or rules.max_bytes <= 0:
        return _reject(rules, 503, "upload_policy_missing",
                       f"no upload policy is configured for {rules.kind!r}")

    extension = ""
    if filename:
        extension = _normalise_extension(PurePosixPath(filename.replace("\\", "/")).suffix)
        if extension in (".", "") or extension not in rules.extensions:
            return _reject(rules, 415, "extension_not_allowed",
                           f"{extension if extension != '.' else 'a file with no extension'} "
                           f"is not accepted for {rules.kind}",
                           field="filename", allowed=rules.extensions)

    declared = (declared_type or "").split(";")[0].strip().lower()
    if declared and declared not in rules.mime_types:
        return _reject(rules, 415, "unsupported_media_type",
                       f"{declared} is not accepted for {rules.kind}",
                       field="content_type", allowed=rules.mime_types)

    head = _read_head(stream)
    if not head:
        return _reject(rules, 422, "empty_file", "the uploaded file is empty")

    media_type = sniff(head)
    if media_type is None:
        return _reject(rules, 415, "unsupported_media_type",
                       "the file's contents are not a format this system accepts",
                       allowed=rules.mime_types)
    if media_type not in rules.mime_types:
        return _reject(rules, 415, "unsupported_media_type",
                       f"the file's contents are {media_type}, which is not accepted for "
                       f"{rules.kind}", allowed=rules.mime_types)
    # The whole point of sniffing: a .jpg carrying a PDF is a client that is lying or broken.
    if declared and declared != media_type:
        return _reject(rules, 415, "content_type_mismatch",
                       f"the file was declared {declared} but its contents are {media_type}",
                       field="content_type", allowed=rules.mime_types)

    size = dimensions(media_type, head)
    pixels = size[0] * size[1] if size else None
    if rules.max_pixels and pixels and pixels > rules.max_pixels:
        return _reject(rules, 413, "image_too_large",
                       f"the image is {size[0]}x{size[1]} pixels, above the "
                       f"{rules.max_pixels} pixel limit for {rules.kind}")

    digest = hashlib.sha256()
    total, tail, block = 0, b"", head
    while block:
        total += len(block)
        # Counted as it streams and stopped right here, so an oversize file is never buffered.
        if total > rules.max_bytes:
            return _reject(rules, 413, "payload_too_large",
                           f"the file is larger than the {rules.max_bytes} byte limit for "
                           f"{rules.kind}")
        digest.update(block)
        tail = (tail + block)[-TAIL_BYTES:]
        if sink is not None:
            sink.write(block)
        block = stream.read(CHUNK_BYTES)

    if not _is_complete(media_type, head, tail, total):
        return _reject(rules, 422, "corrupt_file",
                       f"the {media_type} file is truncated; it has no end marker")

    return UploadResult(
        ok=True, kind=rules.kind, media_type=media_type, extension=extension,
        byte_size=total, sha256=digest.hexdigest(), pixels=pixels,
    )
