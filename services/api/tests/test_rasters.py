"""Raster upload: the request that writes a file and then hands work over."""

from __future__ import annotations

import io

import pytest
from ada_core import models


@pytest.fixture
def ingests(monkeypatch):
    calls: list[int] = []
    from app.routers import rasters as rasters_router

    monkeypatch.setattr(rasters_router.ml_client, "submit_ingest", calls.append)
    return calls


def tif(content: bytes = b"II*\x00" + b"\x00" * 64) -> io.BytesIO:
    return io.BytesIO(content)


def upload(client, project, filename="scene.tif", name="T1", **extra):
    return client.post(
        f"/api/projects/{project.id}/rasters",
        data={"name": name, **extra},
        files={"file": (filename, tif(), "image/tiff")},
    )


def test_a_tif_is_stored_and_queued_for_ingest(client, project, ingests, db):
    response = upload(client, project)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "processing"
    row = db.get(models.Raster, body["id"])
    # The file is on disk and the row points at it before ada-ml is told.
    assert row.original_path
    assert ingests == [row.id]


def test_the_bytes_actually_land_on_disk(client, project, ingests, db):
    from pathlib import Path

    body = upload(client, project).json()
    stored = Path(db.get(models.Raster, body["id"]).original_path)
    assert stored.is_file()
    assert stored.read_bytes().startswith(b"II*\x00")


@pytest.mark.parametrize("filename", ["scene.png", "scene.jpg", "scene", "scene.tif.exe"])
def test_a_non_tif_is_refused(client, project, ingests, filename):
    """Refused at the door rather than at ingest: the pipeline's failure for a
    PNG is a rasterio error minutes later, in a job the officer has to go and
    find."""
    assert upload(client, project, filename=filename).status_code == 400
    assert ingests == []


@pytest.mark.parametrize("filename", ["scene.TIF", "scene.Tiff"])
def test_the_extension_check_is_case_insensitive(client, project, ingests, filename):
    assert upload(client, project, filename=filename).status_code == 200


def test_an_unparseable_capture_date_is_refused(client, project, ingests):
    assert upload(client, project, captured_at="last tuesday").status_code == 400
    assert ingests == []


def test_an_iso_capture_date_is_kept(client, project, ingests, db):
    body = upload(client, project, captured_at="2024-03-01T00:00:00").json()
    assert db.get(models.Raster, body["id"]).captured_at is not None


def test_uploading_into_somebody_elses_project_is_404(client, foreign_project, ingests):
    assert upload(client, foreign_project).status_code == 404
    assert ingests == []


def test_listing_shows_ingest_progress(client, project, ready_rasters):
    rows = client.get(f"/api/projects/{project.id}/rasters").json()
    assert len(rows) == 2
    assert {row["status"] for row in rows} == {"ready"}
    assert all("progress" in row for row in rows)
