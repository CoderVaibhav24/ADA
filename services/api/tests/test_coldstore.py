"""The cold tier client: upload, verification, restore and delete against an in-memory S3."""

from __future__ import annotations

import hashlib

import pytest

from app.coldstore import (
    ColdStore,
    ColdStoreError,
    archive_key,
    composite_sha256,
    join_ref,
    split_ref,
)
from tests.fake_s3 import FakeS3


def _archive(tmp_path, size: int):
    path = tmp_path / "raster_1.archive.tif"
    path.write_bytes(bytes(range(256)) * (size // 256) + b"x" * (size % 256))
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


def store(client, **kwargs):
    return ColdStore(client, "ada-cold", part_bytes=1024, **kwargs)


def test_a_small_archive_is_one_put_with_its_checksum(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 900)
    result = store(s3).put_archive(path, "k", digest)
    assert result.etag and result.version_id == "v1" and result.ref == "k@v1"
    assert s3.calls == ["put_object"]
    assert store(s3).verify_object("k", digest, 900)


def test_a_large_archive_goes_multipart_and_verifies_by_composite(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 3000)
    cold = store(s3)
    cold.put_archive(path, "k", digest)
    assert s3.calls.count("upload_part") == 3
    s3.calls.clear()
    assert cold.verify_object("k", digest, 3000, path)
    assert "get_object" not in s3.calls
    assert s3.objects["k"]["checksum"] == composite_sha256(path, 1024)


def test_without_the_local_file_a_multipart_object_is_read_back(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 3000)
    cold = store(s3)
    cold.put_archive(path, "k", digest)
    s3.calls.clear()
    assert cold.verify_object("k", digest, 3000)
    assert "get_object" in s3.calls


def test_a_provider_without_checksums_is_verified_by_read_back(tmp_path):
    s3 = FakeS3(checksums=False)
    path, digest = _archive(tmp_path, 900)
    cold = store(s3)
    cold.put_archive(path, "k", digest)
    assert cold.verify_object("k", digest, 900)
    assert "get_object" in s3.calls


def test_a_corrupted_object_fails_verification(tmp_path):
    s3 = FakeS3(checksums=False, corrupt=True)
    path, digest = _archive(tmp_path, 3000)
    cold = store(s3)
    cold.put_archive(path, "k", digest)
    assert not cold.verify_object("k", digest, 3000, path)


def test_a_wrong_size_fails_verification(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 900)
    cold = store(s3)
    cold.put_archive(path, "k", digest)
    assert not cold.verify_object("k", digest, 901)


def test_object_lock_is_requested_when_configured(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 900)
    store(s3, lock_days=30).put_archive(path, "k", digest)
    assert s3.objects["k"]["lock"] == "COMPLIANCE"
    store(s3).put_archive(path, "k2", digest)
    assert s3.objects["k2"]["lock"] is None


def test_an_unreachable_bucket_raises_cold_store_error(tmp_path):
    path, digest = _archive(tmp_path, 900)
    with pytest.raises(ColdStoreError):
        store(FakeS3(down=True)).put_archive(path, "k", digest)


def test_standard_objects_need_no_restore(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 900)
    cold = store(s3)
    cold.put_archive(path, "k", digest)
    assert cold.restore_status("k") == "ready"
    cold.request_restore("k")
    assert s3.restore_requests == []


def test_archival_objects_go_through_restore(tmp_path):
    s3 = FakeS3(archival=True)
    path, digest = _archive(tmp_path, 900)
    cold = store(s3, storage_class="DEEP_ARCHIVE")
    cold.put_archive(path, "k", digest)
    assert cold.restore_status("k") is None
    cold.request_restore("k")
    assert cold.restore_status("k") == "pending"
    cold.request_restore("k")
    assert s3.restore_requests == ["k"]
    s3.finish_restore("k")
    assert cold.restore_status("k") == "ready"


def test_get_archive_returns_the_sha256_and_leaves_no_partial(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 3000)
    cold = store(s3)
    cold.put_archive(path, "k", digest)
    target = tmp_path / "restored" / "a.tif"
    assert cold.get_archive("k", target) == digest
    assert target.read_bytes() == path.read_bytes()
    assert not (target.parent / "a.tif.download").exists()


def test_delete_removes_the_exact_version_not_a_marker(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 900)
    cold = store(s3)
    ref = cold.put_archive(path, "k", digest).ref
    assert cold.delete_object(ref) is True
    assert s3.deletes == [{"Key": "k", "VersionId": "v1"}]
    assert "k" not in s3.objects and s3.delete_markers == []


def test_a_locked_version_is_logged_and_kept(tmp_path, caplog):
    s3 = FakeS3(locked=True)
    path, digest = _archive(tmp_path, 900)
    cold = store(s3, lock_days=30)
    ref = cold.put_archive(path, "k", digest).ref
    assert cold.delete_object(ref) is False
    assert "retained by Object Lock until 2027-01-01" in caplog.text
    assert "k" in s3.objects


def test_refs_round_trip():
    assert split_ref(join_ref("a/b.tif", "v3")) == ("a/b.tif", "v3")
    assert split_ref("a/b.tif") == ("a/b.tif", None)


def test_a_bad_download_never_replaces_the_existing_archive(tmp_path):
    s3 = FakeS3()
    path, digest = _archive(tmp_path, 900)
    cold = store(s3)
    ref = cold.put_archive(path, "k", digest).ref
    s3.objects["k"]["data"] = b"tampered"
    target = tmp_path / "keep.tif"
    target.write_bytes(b"existing archive")
    with pytest.raises(ColdStoreError):
        cold.get_archive(ref, target, digest)
    assert target.read_bytes() == b"existing archive"
    assert not (tmp_path / "keep.tif.download").exists()


def test_the_key_layout():
    assert archive_key(4, 17) == "rasters/4/raster_17/archive.tif"


def test_disabled_without_an_endpoint():
    from app.config import settings

    assert ColdStore.from_settings(settings) is None


def test_the_secret_never_reaches_a_log_line(monkeypatch, caplog):
    from pydantic import SecretStr

    from app.config import settings

    monkeypatch.setattr(settings, "cold_store_endpoint", "http://minio.test:9000")
    monkeypatch.setattr(settings, "cold_store_bucket", "ada-cold")
    monkeypatch.setattr(settings, "cold_store_access_key", "AKIAEXAMPLE")
    monkeypatch.setattr(settings, "cold_store_secret_key", SecretStr("very-secret-value"))
    cold = ColdStore.from_settings(settings)
    assert cold is not None and cold.bucket == "ada-cold"
    assert "very-secret-value" not in repr(settings.cold_store_secret_key)
    assert "very-secret-value" not in caplog.text
