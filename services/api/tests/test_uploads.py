"""Chunked, resumable upload: session, chunks, resume, complete, abort, restore, runtime."""

from __future__ import annotations

import hashlib
from collections import namedtuple
from pathlib import Path

import httpx
import pytest
from ada_core import models

from tests.fake_s3 import FakeS3
from tests.geotiffs import geotiff_bytes

CHUNK = 1024
Usage = namedtuple("Usage", "total used free")


@pytest.fixture(autouse=True)
def small_chunks(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_chunk_bytes", CHUNK)


@pytest.fixture
def ingests(monkeypatch):
    calls: list[int] = []
    from app.routers import uploads

    monkeypatch.setattr(uploads.ml_client, "submit_ingest", calls.append)
    return calls


@pytest.fixture
def geotiff(tmp_path) -> bytes:
    return geotiff_bytes(tmp_path)


def open_session(client, project, data: bytes, **extra):
    body = {"name": "T1", "size_bytes": len(data), "fingerprint": f"{len(data)}:abc",
            "has_tfw": False, "has_prj": False, **extra}
    return client.post(f"/api/projects/{project.id}/uploads", json=body)


def send(client, upload_id, n, data: bytes, *, digest=None, content_range=True):
    chunk = data[n * CHUNK:(n + 1) * CHUNK]
    headers = {"Content-Type": "application/octet-stream",
               "X-Chunk-SHA256": digest or hashlib.sha256(chunk).hexdigest()}
    if content_range:
        headers["Content-Range"] = f"bytes {n * CHUNK}-{n * CHUNK + len(chunk) - 1}/{len(data)}"
    return client.put(f"/api/uploads/{upload_id}/chunks/{n}", content=chunk, headers=headers)


def upload_all(client, upload_id, data: bytes, count: int):
    for n in range(count):
        assert send(client, upload_id, n, data).status_code == 204


def _part(upload_id) -> Path:
    from app.config import settings

    return settings.uploads_dir / f"raster_{upload_id}.part"


# ------------------------------------------------------------------ open
def test_open_creates_a_preallocated_session(client, project, geotiff, db):
    response = open_session(client, project, geotiff)
    assert response.status_code == 201
    body = response.json()
    assert body["chunk_size"] == CHUNK
    assert body["chunk_count"] == -(-len(geotiff) // CHUNK)
    assert body["received"] == [] and body["status"] == "uploading"
    assert _part(body["upload_id"]).stat().st_size == len(geotiff)
    row = db.get(models.Raster, body["upload_id"])
    assert row.status == "uploading" and row.received_chunks == ""


def test_open_over_the_size_limit_is_413(client, project, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_max_bytes", 10_000)
    assert open_session(client, project, b"x" * 10_001).status_code == 413


def test_open_without_disk_is_507(client, project, geotiff, monkeypatch):
    from app.routers import uploads

    monkeypatch.setattr(uploads.shutil, "disk_usage",
                        lambda _: Usage(10**12, 10**12 - 2 * len(geotiff), 2 * len(geotiff)))
    assert open_session(client, project, geotiff).status_code == 507


def test_open_under_the_disk_guard_is_507(client, project, geotiff, monkeypatch):
    from app.routers import uploads

    monkeypatch.setattr(uploads.shutil, "disk_usage", lambda _: Usage(1000, 900, 100 * 10**9))
    monkeypatch.setattr(uploads.sweeper, "disk_free_pct", lambda usage=None: 5.0)
    assert open_session(client, project, geotiff).status_code == 507


@pytest.mark.parametrize("status", ["uploading", "processing", "ready", "cold", "restoring"])
def test_a_duplicate_fingerprint_is_409_with_the_existing_id(client, project, geotiff, db,
                                                             status):
    row = models.Raster(project_id=project.id, name="first", original_path="",
                        status=status, fingerprint=f"{len(geotiff)}:abc")
    db.add(row)
    db.commit()
    response = open_session(client, project, geotiff)
    assert response.status_code == 409
    assert response.json()["existing_raster_id"] == row.id


def test_a_rejected_fingerprint_can_be_uploaded_again(client, project, geotiff, db):
    db.add(models.Raster(project_id=project.id, name="first", original_path="",
                         status="rejected", fingerprint=f"{len(geotiff)}:abc"))
    db.commit()
    assert open_session(client, project, geotiff).status_code == 201


def test_open_in_somebody_elses_project_is_404(client, foreign_project, geotiff):
    assert open_session(client, foreign_project, geotiff).status_code == 404


# ------------------------------------------------------------------ chunks
def test_a_chunk_lands_at_its_offset_and_sets_its_bit(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    assert send(client, upload_id, 2, geotiff).status_code == 204
    assert _part(upload_id).read_bytes()[2 * CHUNK:3 * CHUNK] == geotiff[2 * CHUNK:3 * CHUNK]
    assert client.get(f"/api/uploads/{upload_id}").json()["received"] == [2]


def test_a_repeated_chunk_is_an_idempotent_204(client, project, geotiff, db):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    assert send(client, upload_id, 0, geotiff).status_code == 204
    assert send(client, upload_id, 0, geotiff).status_code == 204
    assert client.get(f"/api/uploads/{upload_id}").json()["received"] == [0]


def test_a_bad_hash_is_400_and_sets_nothing(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    assert send(client, upload_id, 0, geotiff, digest="0" * 64).status_code == 400
    assert client.get(f"/api/uploads/{upload_id}").json()["received"] == []


def test_a_missing_chunk_hash_is_400(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    response = client.put(f"/api/uploads/{upload_id}/chunks/0", content=geotiff[:CHUNK],
                          headers={"Content-Type": "application/octet-stream"})
    assert response.status_code == 400
    assert response.json()["detail"] == "X-Chunk-SHA256 header required"


def test_a_chunk_index_out_of_range_is_416(client, project, geotiff):
    body = open_session(client, project, geotiff).json()
    response = client.put(f"/api/uploads/{body['upload_id']}/chunks/{body['chunk_count']}",
                          content=b"x", headers={"X-Chunk-SHA256": "0" * 64,
                                                 "Content-Type": "application/octet-stream"})
    assert response.status_code == 416


def test_a_content_range_that_disagrees_is_416(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    chunk = geotiff[:CHUNK]
    response = client.put(f"/api/uploads/{upload_id}/chunks/0", content=chunk, headers={
        "Content-Type": "application/octet-stream",
        "X-Chunk-SHA256": hashlib.sha256(chunk).hexdigest(),
        "Content-Range": f"bytes 1024-2047/{len(geotiff)}"})
    assert response.status_code == 416


def test_a_short_chunk_is_400(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    chunk = geotiff[:100]
    response = client.put(f"/api/uploads/{upload_id}/chunks/0", content=chunk, headers={
        "Content-Type": "application/octet-stream",
        "X-Chunk-SHA256": hashlib.sha256(chunk).hexdigest()})
    assert response.status_code == 400


def test_the_last_chunk_may_be_short(client, project, geotiff):
    body = open_session(client, project, geotiff).json()
    assert len(geotiff) % CHUNK
    assert send(client, body["upload_id"], body["chunk_count"] - 1, geotiff).status_code == 204


def test_a_chunk_after_completion_is_409(client, project, geotiff, ingests):
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    assert client.post(f"/api/uploads/{body['upload_id']}/complete").status_code == 200
    assert send(client, body["upload_id"], 0, geotiff).status_code == 409


def test_resume_lists_open_sessions_with_their_bitmap(client, project, geotiff):
    body = open_session(client, project, geotiff).json()
    for n in (0, 1, 4):
        send(client, body["upload_id"], n, geotiff)
    sessions = client.get(f"/api/projects/{project.id}/uploads").json()
    assert len(sessions) == 1
    session = sessions[0]
    assert session["received"] == [0, 1, 4]
    assert session["name"] == "T1" and session["fingerprint"] == f"{len(geotiff)}:abc"
    assert session["size_bytes"] == len(geotiff)


def test_somebody_elses_upload_is_404(client, db, foreign_project):
    row = models.Raster(project_id=foreign_project.id, name="x", original_path="",
                        status="uploading", chunk_size=CHUNK, chunk_count=1, size_bytes=10)
    db.add(row)
    db.commit()
    assert client.get(f"/api/uploads/{row.id}").status_code == 404
    assert client.delete(f"/api/uploads/{row.id}").status_code == 404


# ------------------------------------------------------------------ complete
def test_complete_with_every_chunk_queues_ingest(client, project, geotiff, ingests, db):
    body = open_session(client, project, geotiff).json()
    upload_id = body["upload_id"]
    upload_all(client, upload_id, geotiff, body["chunk_count"])
    digest = hashlib.sha256(geotiff).hexdigest()
    response = client.post(f"/api/uploads/{upload_id}/complete", json={"sha256": digest})
    assert response.status_code == 200
    out = response.json()
    assert out["status"] == "processing"
    assert out["received_count"] == body["chunk_count"] == out["chunk_count"]
    assert out["sha256"] == digest
    assert ingests == [upload_id]
    row = db.get(models.Raster, upload_id)
    assert Path(row.original_path).read_bytes() == geotiff
    assert row.original_path.endswith(f"raster_{upload_id}.tif")
    assert not _part(upload_id).exists()


def test_complete_is_idempotent(client, project, geotiff, ingests):
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    first = client.post(f"/api/uploads/{body['upload_id']}/complete")
    again = client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert first.status_code == again.status_code == 200
    assert ingests == [body["upload_id"]]


def test_complete_with_missing_chunks_is_409(client, project, geotiff, ingests):
    body = open_session(client, project, geotiff).json()
    send(client, body["upload_id"], 0, geotiff)
    response = client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert response.status_code == 409
    assert response.json()["missing"] == list(range(1, body["chunk_count"]))
    assert ingests == []


def test_complete_of_an_invalid_file_rejects_and_deletes(client, project, ingests, db):
    jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + bytes(range(256)) * 10
    body = open_session(client, project, jpeg).json()
    upload_id = body["upload_id"]
    upload_all(client, upload_id, jpeg, body["chunk_count"])
    response = client.post(f"/api/uploads/{upload_id}/complete")
    assert response.status_code == 422
    assert response.json() == {"detail": "not a TIFF file", "raster_id": upload_id}
    db.expire_all()
    row = db.get(models.Raster, upload_id)
    assert row.status == "rejected" and row.reject_reason == row.error == "not a TIFF file"
    assert not _part(upload_id).exists()
    assert ingests == []
    listed = client.get(f"/api/projects/{project.id}/rasters").json()
    assert listed[0]["reject_reason"] == "not a TIFF file"


def test_a_whole_file_hash_mismatch_is_rejected(client, project, geotiff, ingests):
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    response = client.post(f"/api/uploads/{body['upload_id']}/complete",
                           json={"sha256": "a" * 64})
    assert response.status_code == 422
    assert not _part(body["upload_id"]).exists()


def test_no_crs_is_rejected_unless_sidecars_or_epsg(client, project, tmp_path, ingests, db):
    data = geotiff_bytes(tmp_path, crs=None)
    body = open_session(client, project, data).json()
    upload_all(client, body["upload_id"], data, body["chunk_count"])
    response = client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert response.status_code == 422
    assert "coordinate reference system" in response.json()["detail"]


def test_an_epsg_given_at_open_is_stamped(client, project, tmp_path, ingests, db):
    import rasterio

    data = geotiff_bytes(tmp_path, crs=None)
    body = open_session(client, project, data, fingerprint="other", crs_epsg=32644).json()
    upload_all(client, body["upload_id"], data, body["chunk_count"])
    assert client.post(f"/api/uploads/{body['upload_id']}/complete").status_code == 200
    with rasterio.open(db.get(models.Raster, body["upload_id"]).original_path) as ds:
        assert ds.crs.to_epsg() == 32644


def test_sidecars_satisfy_the_crs_rule(client, project, tmp_path, ingests):
    data = geotiff_bytes(tmp_path, crs=None)
    body = open_session(client, project, data, has_tfw=True, has_prj=True).json()
    upload_id = body["upload_id"]
    upload_all(client, upload_id, data, body["chunk_count"])
    for kind, text in (("tfw", b"0.5\n0\n0\n-0.5\n500000\n3000000\n"), ("prj", b"PROJCS[]")):
        response = client.put(f"/api/uploads/{upload_id}/sidecars/{kind}", content=text,
                              headers={"Content-Type": "application/octet-stream"})
        assert response.status_code == 204
    assert client.put(f"/api/uploads/{upload_id}/sidecars/exe", content=b"x",
                      headers={"Content-Type": "application/octet-stream"}).status_code == 422
    assert client.post(f"/api/uploads/{upload_id}/complete").status_code == 200


def test_complete_while_ada_ml_is_down_still_succeeds(client, project, geotiff, monkeypatch,
                                                      db):
    from fastapi import HTTPException

    from app.routers import uploads

    def down(raster_id):
        raise HTTPException(503, "down")

    monkeypatch.setattr(uploads.ml_client, "submit_ingest", down)
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    response = client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert response.status_code == 200
    assert response.json()["status"] == "processing"
    assert "will retry" in response.json()["stage"]


# ------------------------------------------------------------------ abort
def test_abort_deletes_the_part_and_the_row(client, project, geotiff, db):
    body = open_session(client, project, geotiff).json()
    upload_id = body["upload_id"]
    send(client, upload_id, 0, geotiff)
    assert client.delete(f"/api/uploads/{upload_id}").status_code == 204
    assert not _part(upload_id).exists()
    db.expire_all()
    assert db.get(models.Raster, upload_id) is None


def test_abort_of_a_processing_raster_is_409(client, project, geotiff, ingests):
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert client.delete(f"/api/uploads/{body['upload_id']}").status_code == 409


# ------------------------------------------------------------------ delete + restore
@pytest.fixture
def fake_cold(monkeypatch):
    from app.coldstore import ColdStore
    from app.routers import rasters

    s3 = FakeS3()
    monkeypatch.setattr(rasters.ColdStore, "from_settings",
                        classmethod(lambda cls, _settings: ColdStore(s3, "ada-cold")))
    return s3


def test_delete_removes_part_archive_and_cold_object(client, db, project, fake_cold):
    from app.config import settings

    row = models.Raster(project_id=project.id, name="T1", original_path="", status="cold",
                        cold_key="rasters/1/raster_1/archive.tif@v9")
    db.add(row)
    db.commit()
    fake_cold.objects["rasters/1/raster_1/archive.tif"] = {
        "data": b"x", "checksum": None, "class": "STANDARD", "lock": None, "restore": None,
        "version": "v9"}
    files = [settings.uploads_dir / f"raster_{row.id}.part",
             settings.uploads_dir / f"raster_{row.id}.archive.tif",
             settings.uploads_dir / f"raster_{row.id}.archive.tif.ovr"]
    for path in files:
        path.write_bytes(b"x")
    assert client.delete(f"/api/rasters/{row.id}").status_code == 204
    assert [p for p in files if p.exists()] == []
    assert fake_cold.objects == {}
    assert fake_cold.deletes == [{"Key": "rasters/1/raster_1/archive.tif", "VersionId": "v9"}]


def test_delete_survives_an_unreachable_bucket(client, db, project, fake_cold):
    fake_cold.down = True
    row = models.Raster(project_id=project.id, name="T1", original_path="", status="cold",
                        cold_key="k")
    db.add(row)
    db.commit()
    assert client.delete(f"/api/rasters/{row.id}").status_code == 204


def test_restore_moves_a_cold_raster_to_restoring(client, db, project, fake_cold):
    row = models.Raster(project_id=project.id, name="T1", original_path="", status="cold",
                        cold_key="k")
    db.add(row)
    db.commit()
    fake_cold.objects["k"] = {"data": b"x", "checksum": None, "class": "STANDARD",
                              "lock": None, "restore": None}
    response = client.post(f"/api/rasters/{row.id}/restore")
    assert response.status_code == 202
    assert response.json() == {"status": "restoring", "eta_hours": 0.0}
    db.expire_all()
    assert db.get(models.Raster, row.id).status == "restoring"
    assert client.post(f"/api/rasters/{row.id}/restore").status_code == 202


def test_restore_of_a_ready_raster_is_409(client, ready_rasters, fake_cold):
    assert client.post(f"/api/rasters/{ready_rasters[0].id}/restore").status_code == 409


def test_restore_without_a_cold_store_is_503(client, db, project):
    row = models.Raster(project_id=project.id, name="T1", original_path="", status="cold",
                        cold_key="k")
    db.add(row)
    db.commit()
    assert client.post(f"/api/rasters/{row.id}/restore").status_code == 503


# ------------------------------------------------------------------ runtime + health
def test_ml_runtime_proxies_health_ready(client, monkeypatch):
    from app.clients import ml

    seen = {}

    def fake_get(url, *, headers, timeout):
        seen.update(url=url, timeout=timeout)
        return httpx.Response(200, json={"status": "ok", "tier": "cpu", "backend": "cpu"})

    monkeypatch.setattr(ml.httpx, "get", fake_get)
    response = client.get("/api/ml/runtime")
    assert response.status_code == 200
    assert response.json()["tier"] == "cpu"
    assert seen["url"].endswith("/health/ready") and seen["timeout"] == 3.0


@pytest.mark.parametrize("reply", [httpx.ConnectError("refused"), httpx.Response(503)])
def test_ml_runtime_is_503_when_ada_ml_is_down(client, monkeypatch, reply):
    from app.clients import ml

    def fake_get(url, *, headers, timeout):
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(ml.httpx, "get", fake_get)
    response = client.get("/api/ml/runtime")
    assert response.status_code == 503
    assert response.json()["detail"] == "model service unavailable"


def test_ml_runtime_needs_a_signed_in_user(anonymous_client):
    assert anonymous_client.get("/api/ml/runtime").status_code == 401


def test_health_ready_reports_disk_and_the_sweeper(client, monkeypatch):
    from app import sweeper

    monkeypatch.setattr(sweeper, "disk_free_pct", lambda usage=None: 3.0)
    body = client.get("/api/health/ready").json()
    assert body["disk"] == "low"
    assert "sweeper_last_run" in body


# ------------------------------------------------------------------ review fixes
def test_complete_while_another_request_is_completing_is_202(client, project, geotiff, db,
                                                             ingests):
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    row = db.get(models.Raster, body["upload_id"])
    row.status = "completing"
    db.commit()
    response = client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert response.status_code == 202
    assert response.json() == {"detail": "completing"}
    assert _part(body["upload_id"]).exists() and ingests == []


def test_a_repeated_complete_never_touches_the_ingest_input(client, project, geotiff, db,
                                                            ingests):
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    assert client.post(f"/api/uploads/{body['upload_id']}/complete").status_code == 200
    tif = Path(db.get(models.Raster, body["upload_id"]).original_path)
    again = client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert again.status_code == 200 and again.json()["status"] == "processing"
    assert tif.read_bytes() == geotiff and ingests == [body["upload_id"]]


def test_a_crash_during_validation_reopens_the_upload(client, project, geotiff, db,
                                                      monkeypatch):
    from app.routers import uploads

    def boom(*args, **kwargs):
        raise OSError("disk went away")

    monkeypatch.setattr(uploads, "validate_raster_file", boom)
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    with pytest.raises(OSError):
        client.post(f"/api/uploads/{body['upload_id']}/complete")
    db.expire_all()
    assert db.get(models.Raster, body["upload_id"]).status == "uploading"


def test_open_sessions_are_capped_per_user(client, project, geotiff, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_max_open_sessions", 2)
    for n in range(2):
        assert open_session(client, project, geotiff, fingerprint=f"f{n}").status_code == 201
    response = open_session(client, project, geotiff, fingerprint="f2")
    assert response.status_code == 429


def test_disk_check_counts_bytes_still_owed_to_open_uploads(client, project, db, monkeypatch):
    from app.routers import uploads

    db.add(models.Raster(project_id=project.id, name="big", original_path="",
                         status="uploading", size_bytes=10_000, chunk_size=CHUNK,
                         chunk_count=10, received_chunks="", fingerprint="big"))
    db.commit()
    monkeypatch.setattr(uploads.shutil, "disk_usage", lambda _: Usage(10**6, 0, 12_000))
    monkeypatch.setattr(uploads.sweeper, "disk_free_pct", lambda usage=None: 50.0)
    assert open_session(client, project, b"x" * 1000, fingerprint="small").status_code == 507
    monkeypatch.setattr(uploads.shutil, "disk_usage", lambda _: Usage(10**6, 0, 13_000))
    assert open_session(client, project, b"x" * 1000, fingerprint="small").status_code == 201


def test_a_repeated_chunk_with_different_bytes_is_409(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    assert send(client, upload_id, 0, geotiff).status_code == 204
    other = bytes(b ^ 0xFF for b in geotiff[:CHUNK]) + geotiff[CHUNK:]
    assert send(client, upload_id, 0, other).status_code == 409


def test_a_chunk_larger_than_the_cap_is_413(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    big = b"x" * (CHUNK + 1)
    response = client.put(f"/api/uploads/{upload_id}/chunks/0", content=big, headers={
        "Content-Type": "application/octet-stream",
        "X-Chunk-SHA256": hashlib.sha256(big).hexdigest()})
    assert response.status_code == 413


def test_a_chunk_for_a_vanished_part_is_409(client, project, geotiff):
    upload_id = open_session(client, project, geotiff).json()["upload_id"]
    _part(upload_id).unlink()
    assert send(client, upload_id, 0, geotiff).status_code == 409


def test_ml_runtime_returns_only_whitelisted_fields(client, monkeypatch):
    from app.clients import ml

    def fake_get(url, *, headers, timeout):
        return httpx.Response(200, json={"status": "ok", "tier": "cuda", "queue_depth": 2,
                                         "in_flight": {"rasters": [1]}, "disk_free_gb": 9})

    monkeypatch.setattr(ml.httpx, "get", fake_get)
    assert client.get("/api/ml/runtime").json() == {"tier": "cuda", "queue_depth": 2}


def test_starting_an_analysis_marks_both_rasters_used(client, project, ready_rasters, db,
                                                      monkeypatch):
    from app.routers import analysis

    monkeypatch.setattr(analysis.ml_client, "submit_analysis", lambda job_id: None)
    for raster in ready_rasters:
        raster.last_used_at = None
    db.commit()
    response = client.post(f"/api/projects/{project.id}/analyses", json={
        "raster_t1_id": ready_rasters[0].id, "raster_t2_id": ready_rasters[1].id,
        "mode": "diff"})
    assert response.status_code == 200
    db.expire_all()
    assert all(db.get(models.Raster, r.id).last_used_at is not None for r in ready_rasters)


def test_a_reopened_completing_upload_completes_on_re_post(client, project, geotiff, db,
                                                          ingests):
    body = open_session(client, project, geotiff).json()
    upload_all(client, body["upload_id"], geotiff, body["chunk_count"])
    row = db.get(models.Raster, body["upload_id"])
    row.status = "completing"
    db.commit()
    listed = client.get(f"/api/projects/{project.id}/uploads").json()
    assert [s["status"] for s in listed] == ["completing"]
    assert "reject_reason" in listed[0]
    assert client.post(f"/api/uploads/{body['upload_id']}/complete").status_code == 202
    row.status = "uploading"
    db.commit()
    response = client.post(f"/api/uploads/{body['upload_id']}/complete")
    assert response.status_code == 200 and response.json()["status"] == "processing"
    assert ingests == [body["upload_id"]]
