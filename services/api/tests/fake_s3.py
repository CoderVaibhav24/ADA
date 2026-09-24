"""An in-memory stand-in for the boto3 S3 client calls app/coldstore.py makes."""

from __future__ import annotations

import base64
import hashlib
import io


class FakeS3Error(Exception):
    pass


def _b64(digest: bytes) -> str:
    return base64.b64encode(digest).decode()


class FakeS3:
    def __init__(self, *, checksums: bool = True, archival: bool = False,
                 corrupt: bool = False, down: bool = False, versioned: bool = True,
                 locked: bool = False) -> None:
        self.objects: dict[str, dict] = {}
        self.uploads: dict[str, dict] = {}
        self.calls: list[str] = []
        self.checksums = checksums
        self.archival = archival
        self.corrupt = corrupt
        self.down = down
        self.restore_requests: list[str] = []
        self.versioned = versioned
        self.locked = locked
        self.delete_markers: list[str] = []
        self.deletes: list[dict] = []
        self._versions = 0

    def _call(self, name: str) -> None:
        self.calls.append(name)
        if self.down:
            raise FakeS3Error("could not connect to the endpoint URL")

    def _store(self, key: str, data: bytes, checksum: str | None, args: dict) -> dict:
        if self.corrupt:
            data = data[:-1] + bytes([data[-1] ^ 0xFF])
        self._versions += 1
        version = f"v{self._versions}" if self.versioned else None
        self.objects[key] = {"data": data, "checksum": checksum if self.checksums else None,
                             "class": args.get("StorageClass", "STANDARD"),
                             "lock": args.get("ObjectLockMode"), "restore": None,
                             "version": version}
        return {"VersionId": version} if version else {}

    def put_object(self, *, Bucket, Key, Body, ChecksumSHA256=None, **args):
        self._call("put_object")
        data = Body.read()
        if ChecksumSHA256 and ChecksumSHA256 != _b64(hashlib.sha256(data).digest()):
            raise FakeS3Error("BadDigest")
        extra = self._store(Key, data, ChecksumSHA256, args)
        return {"ETag": f'"{hashlib.md5(data, usedforsecurity=False).hexdigest()}"', **extra}

    def create_multipart_upload(self, *, Bucket, Key, ChecksumAlgorithm=None, **args):
        self._call("create_multipart_upload")
        upload_id = f"up-{len(self.uploads) + 1}"
        self.uploads[upload_id] = {"key": Key, "parts": {}, "args": args}
        return {"UploadId": upload_id}

    def upload_part(self, *, Bucket, Key, UploadId, PartNumber, Body, ChecksumSHA256=None,
                    **_):
        self._call("upload_part")
        self.uploads[UploadId]["parts"][PartNumber] = Body
        return {"ETag": f'"part-{PartNumber}"'}

    def complete_multipart_upload(self, *, Bucket, Key, UploadId, MultipartUpload):
        self._call("complete_multipart_upload")
        upload = self.uploads.pop(UploadId)
        numbers = [p["PartNumber"] for p in MultipartUpload["Parts"]]
        parts = [upload["parts"][n] for n in numbers]
        digests = b"".join(hashlib.sha256(p).digest() for p in parts)
        checksum = f"{_b64(hashlib.sha256(digests).digest())}-{len(parts)}"
        extra = self._store(Key, b"".join(parts), checksum, upload["args"])
        return {"ETag": f'"multi-{len(parts)}"', **extra}

    def abort_multipart_upload(self, *, Bucket, Key, UploadId):
        self.calls.append("abort_multipart_upload")
        self.uploads.pop(UploadId, None)

    def head_object(self, *, Bucket, Key, ChecksumMode=None, VersionId=None):
        self._call("head_object")
        if Key not in self.objects:
            raise FakeS3Error("404 Not Found")
        obj = self.objects[Key]
        head = {"ContentLength": len(obj["data"]), "ETag": '"x"'}
        if obj["checksum"]:
            head["ChecksumSHA256"] = obj["checksum"]
        storage_class = "DEEP_ARCHIVE" if self.archival else obj["class"]
        if storage_class != "STANDARD":
            head["StorageClass"] = storage_class
        if obj["restore"]:
            head["Restore"] = obj["restore"]
        if obj["lock"]:
            head["ObjectLockRetainUntilDate"] = "2027-01-01T00:00:00Z"
        return head

    def get_object(self, *, Bucket, Key, VersionId=None):
        self._call("get_object")
        return {"Body": io.BytesIO(self.objects[Key]["data"])}

    def restore_object(self, *, Bucket, Key, RestoreRequest, VersionId=None):
        self._call("restore_object")
        self.restore_requests.append(Key)
        self.objects[Key]["restore"] = 'ongoing-request="true"'

    def finish_restore(self, key: str) -> None:
        self.objects[key]["restore"] = 'ongoing-request="false", expiry-date="Fri, 01 Jan 2027"'

    def delete_object(self, *, Bucket, Key, VersionId=None):
        self._call("delete_object")
        self.deletes.append({"Key": Key, "VersionId": VersionId})
        if self.locked and VersionId:
            raise FakeS3Error("An error occurred (AccessDenied) when calling DeleteObject")
        if self.versioned and not VersionId:
            self.delete_markers.append(Key)
            return
        self.objects.pop(Key, None)
