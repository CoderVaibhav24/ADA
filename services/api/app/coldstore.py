"""Cold tier for archive masters: any S3-compatible bucket (AWS, MinIO, Wasabi, others)."""

from __future__ import annotations

import base64
import hashlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

log = logging.getLogger("ada.api.coldstore")

PART_BYTES = 64 << 20
_READ_BYTES = 8 << 20
# Classes whose objects must be restored before they can be read.
_ARCHIVAL_CLASSES = frozenset({"GLACIER", "DEEP_ARCHIVE"})
RESTORE_DAYS = 7
# The bucket needs an AbortIncompleteMultipartUpload rule, or a killed upload is billed forever.
_VERSION_SEP = "@"

RestoreState = Literal["ready", "pending"]


class ColdStoreError(RuntimeError):
    """The bucket refused or could not be reached; the caller keeps every local file."""


@dataclass(frozen=True)
class PutResult:
    etag: str
    version_id: str | None
    ref: str


# rasters.cold_key holds "key@versionId" on a versioned bucket, so a delete removes that version.
def join_ref(key: str, version_id: str | None) -> str:
    return f"{key}{_VERSION_SEP}{version_id}" if version_id else key


def split_ref(ref: str) -> tuple[str, str | None]:
    key, sep, version = ref.partition(_VERSION_SEP)
    return key, (version if sep and version else None)


def _b64(digest: bytes) -> str:
    return base64.b64encode(digest).decode()


def _file_parts(path: Path, part_bytes: int):
    with path.open("rb") as handle:
        while chunk := handle.read(part_bytes):
            yield chunk


# The S3 composite checksum of a multipart object: sha256 over the part digests, suffixed "-N".
def composite_sha256(path: Path, part_bytes: int = PART_BYTES) -> str:
    digests = [hashlib.sha256(part).digest() for part in _file_parts(path, part_bytes)]
    return f"{_b64(hashlib.sha256(b''.join(digests)).digest())}-{len(digests)}"


# Built only from settings so a credential never appears in source or in a log line.
def make_client(settings: Any):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.cold_store_endpoint,
        region_name=settings.cold_store_region or None,
        aws_access_key_id=settings.cold_store_access_key or None,
        aws_secret_access_key=settings.cold_store_secret_key.get_secret_value() or None,
        config=Config(retries={"max_attempts": 5, "mode": "standard"},
                      connect_timeout=10, read_timeout=120,
                      request_checksum_calculation="when_required",
                      response_checksum_validation="when_required"),
    )


class ColdStore:
    def __init__(
        self,
        client: Any,
        bucket: str,
        *,
        storage_class: str = "STANDARD",
        lock_days: int = 0,
        part_bytes: int = PART_BYTES,
    ) -> None:
        self.client = client
        self.bucket = bucket
        self.storage_class = storage_class
        self.lock_days = lock_days
        self.part_bytes = part_bytes

    @classmethod
    def from_settings(cls, settings: Any) -> ColdStore | None:
        if not settings.cold_store_enabled:
            return None
        return cls(make_client(settings), settings.cold_store_bucket,
                   storage_class=settings.cold_store_storage_class,
                   lock_days=settings.cold_object_lock_days)

    @property
    def archival(self) -> bool:
        return self.storage_class in _ARCHIVAL_CLASSES

    def _addr(self, ref: str) -> dict:
        key, version = split_ref(ref)
        addr = {"Bucket": self.bucket, "Key": key}
        if version:
            addr["VersionId"] = version
        return addr

    def _put_args(self, sha256: str) -> dict:
        args: dict = {"StorageClass": self.storage_class, "Metadata": {"sha256": sha256}}
        if self.lock_days > 0:
            args["ObjectLockMode"] = "COMPLIANCE"
            args["ObjectLockRetainUntilDate"] = datetime.now(UTC) + timedelta(days=self.lock_days)
        return args

    # One PUT carries the whole-file SHA-256, so the bucket itself refuses a corrupted body.
    def put_archive(self, local_path: Path, key: str, sha256: str) -> PutResult:
        local_path = Path(local_path)
        try:
            if local_path.stat().st_size <= self.part_bytes:
                with local_path.open("rb") as body:
                    response = self.client.put_object(
                        Bucket=self.bucket, Key=key, Body=body,
                        ChecksumSHA256=_b64(bytes.fromhex(sha256)), **self._put_args(sha256))
            else:
                response = self._put_multipart(local_path, key, sha256)
        except Exception as exc:
            raise ColdStoreError(f"upload of {key} failed: {type(exc).__name__}: {exc}") from exc
        version = response.get("VersionId")
        return PutResult(response.get("ETag", ""), version, join_ref(key, version))

    def _put_multipart(self, local_path: Path, key: str, sha256: str) -> dict:
        upload = self.client.create_multipart_upload(
            Bucket=self.bucket, Key=key, ChecksumAlgorithm="SHA256", **self._put_args(sha256))
        upload_id = upload["UploadId"]
        parts: list[dict] = []
        try:
            for number, chunk in enumerate(_file_parts(local_path, self.part_bytes), start=1):
                checksum = _b64(hashlib.sha256(chunk).digest())
                response = self.client.upload_part(
                    Bucket=self.bucket, Key=key, UploadId=upload_id, PartNumber=number,
                    Body=chunk, ChecksumAlgorithm="SHA256", ChecksumSHA256=checksum)
                parts.append({"PartNumber": number, "ETag": response["ETag"],
                              "ChecksumSHA256": checksum})
            return self.client.complete_multipart_upload(
                Bucket=self.bucket, Key=key, UploadId=upload_id,
                MultipartUpload={"Parts": parts})
        except Exception:
            try:
                self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=upload_id)
            except Exception:
                log.warning("could not abort multipart upload of %s", key, exc_info=True)
            raise

    # Multipart objects carry only a composite checksum; without local_path this downloads it all.
    def verify_object(self, ref: str, sha256: str, size: int,
                      local_path: Path | None = None) -> bool:
        try:
            head = self.client.head_object(**self._addr(ref), ChecksumMode="ENABLED")
        except Exception as exc:
            raise ColdStoreError(f"head of {ref} failed: {type(exc).__name__}: {exc}") from exc
        if int(head.get("ContentLength", -1)) != int(size):
            log.error("cold object %s is %s bytes, expected %s", ref,
                      head.get("ContentLength"), size)
            return False
        checksum = head.get("ChecksumSHA256")
        if checksum and "-" not in checksum:
            return checksum == _b64(bytes.fromhex(sha256))
        if checksum and local_path is not None and Path(local_path).is_file():
            return checksum == composite_sha256(Path(local_path), self.part_bytes)
        return self._read_back_sha256(ref) == sha256

    def _read_back_sha256(self, ref: str) -> str:
        try:
            body = self.client.get_object(**self._addr(ref))["Body"]
            digest = hashlib.sha256()
            for chunk in iter(lambda: body.read(_READ_BYTES), b""):
                digest.update(chunk)
            return digest.hexdigest()
        except Exception as exc:
            raise ColdStoreError(f"read-back of {ref} failed: {type(exc).__name__}: {exc}") from exc

    # None: an archival object with no restore requested yet.
    def restore_status(self, ref: str) -> RestoreState | None:
        try:
            head = self.client.head_object(**self._addr(ref))
        except Exception as exc:
            raise ColdStoreError(f"head of {ref} failed: {type(exc).__name__}: {exc}") from exc
        if head.get("StorageClass") not in _ARCHIVAL_CLASSES:
            return "ready"
        restore = head.get("Restore")
        if not restore:
            return None
        return "pending" if 'ongoing-request="true"' in restore else "ready"

    def request_restore(self, ref: str) -> None:
        if self.restore_status(ref) is not None:
            return
        try:
            self.client.restore_object(
                **self._addr(ref),
                RestoreRequest={"Days": RESTORE_DAYS,
                                "GlacierJobParameters": {"Tier": "Standard"}})
        except Exception as exc:
            if "RestoreAlreadyInProgress" in str(exc):
                return
            raise ColdStoreError(f"restore of {ref} failed: {type(exc).__name__}: {exc}") from exc

    # Verified before the rename, so a bad download never replaces or removes an existing archive.
    def get_archive(self, ref: str, local_path: Path, expected_sha256: str | None = None) -> str:
        local_path = Path(local_path)
        partial = local_path.with_name(f"{local_path.name}.download")
        local_path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        try:
            body = self.client.get_object(**self._addr(ref))["Body"]
            with partial.open("wb") as out:
                for chunk in iter(lambda: body.read(_READ_BYTES), b""):
                    digest.update(chunk)
                    out.write(chunk)
        except Exception as exc:
            partial.unlink(missing_ok=True)
            raise ColdStoreError(f"download of {ref} failed: {type(exc).__name__}: {exc}") from exc
        if expected_sha256 and digest.hexdigest() != expected_sha256:
            partial.unlink(missing_ok=True)
            raise ColdStoreError(f"download of {ref} does not match its sha256")
        partial.replace(local_path)
        return digest.hexdigest()

    # False when Object Lock retains the version; the caller logs and carries on.
    def delete_object(self, ref: str) -> bool:
        try:
            self.client.delete_object(**self._addr(ref))
        except Exception as exc:
            if "AccessDenied" not in str(exc):
                raise ColdStoreError(
                    f"delete of {ref} failed: {type(exc).__name__}: {exc}") from exc
            log.warning("cold object %s retained by Object Lock until %s", ref,
                        self._retained_until(ref))
            return False
        return True

    def _retained_until(self, ref: str) -> str:
        try:
            head = self.client.head_object(**self._addr(ref))
        except Exception:
            return "an unknown date"
        return str(head.get("ObjectLockRetainUntilDate") or "an unknown date")


def archive_key(project_id: int, raster_id: int) -> str:
    return f"rasters/{project_id}/raster_{raster_id}/archive.tif"
