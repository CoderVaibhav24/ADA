"""Raster upload: the request that writes a file and then hands work over."""

from __future__ import annotations

import io
import tempfile
from pathlib import Path

import pytest
from ada_core import models

from tests.geotiffs import geotiff_bytes


@pytest.fixture
def ingests(monkeypatch):
    calls: list[int] = []
    from app.routers import rasters as rasters_router

    monkeypatch.setattr(rasters_router.ml_client, "submit_ingest", calls.append)
    return calls


_GEOTIFF = geotiff_bytes(Path(tempfile.mkdtemp(prefix="ada-rasters-")))


def tif(content: bytes = _GEOTIFF) -> io.BytesIO:
    return io.BytesIO(content)


def upload(client, project, filename="scene.tif", name="T1", content=_GEOTIFF, **extra):
    return client.post(
        f"/api/projects/{project.id}/rasters",
        data={"name": name, **extra},
        files={"file": (filename, tif(content), "image/tiff")},
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


def test_the_single_shot_route_rejects_a_renamed_jpeg(client, project, ingests, db):
    from app.config import settings

    response = upload(client, project, content=b"\xff\xd8\xff\xe0" + b"\x00" * 256)
    assert response.status_code == 422
    body = response.json()
    assert body["detail"] == "not a TIFF file"
    row = db.get(models.Raster, body["raster_id"])
    assert row.status == "rejected"
    assert not (settings.uploads_dir / f"raster_{row.id}.tif").exists()
    assert ingests == []


def test_the_single_shot_route_is_marked_deprecated(client):
    spec = client.get("/api/openapi.json").json()
    assert spec["paths"]["/api/projects/{project_id}/rasters"]["post"]["deprecated"] is True


def test_listing_shows_ingest_progress(client, project, ready_rasters):
    rows = client.get(f"/api/projects/{project.id}/rasters").json()
    assert len(rows) == 2
    assert {row["status"] for row in rows} == {"ready"}
    assert all("progress" in row for row in rows)


# ------------------------------------------------------------------ delete
def _on_disk(path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    return str(path)


@pytest.fixture
def stored_raster(db, project):
    """A ready raster whose upload, sidecars, COG, overviews and ingest stage are all on disk."""
    from app.config import settings

    row = models.Raster(project_id=project.id, name="T1", original_path="", status="ready")
    db.add(row)
    db.commit()
    stem = settings.uploads_dir / f"raster_{row.id}"
    cog = settings.cogs_dir / f"raster_{row.id}.tif"
    row.original_path = _on_disk(stem.with_suffix(".tif"))
    row.cog_path = _on_disk(cog)
    extras = [stem.with_suffix(".tfw"), stem.with_suffix(".prj"),
              cog.with_suffix(".tmp.tif"), cog.parent / f"{cog.name}.ovr",
              cog.parent / f"{cog.name}.aux.xml"]
    for path in extras:
        _on_disk(path)
    db.commit()
    db.refresh(row)
    return row, [stem.with_suffix(".tif"), cog, *extras]


def test_delete_removes_every_file_including_the_ingest_stage(client, db, stored_raster):
    row, files = stored_raster
    response = client.delete(f"/api/rasters/{row.id}")
    assert response.status_code == 204
    assert response.content == b""
    assert [str(p) for p in files if p.exists()] == []
    db.expire_all()
    assert db.get(models.Raster, row.id) is None


def test_delete_cascades_to_every_run_built_on_the_raster(client, db, project,
                                                          stored_raster, ready_rasters):
    from ada_core.models_icms import Case, Zone

    from app.config import settings

    row, _ = stored_raster
    other = ready_rasters[0]
    as_t1 = models.AnalysisJob(project_id=project.id, raster_t1_id=row.id,
                               raster_t2_id=other.id, status="done")
    as_t2 = models.AnalysisJob(project_id=project.id, raster_t1_id=other.id,
                               raster_t2_id=row.id, status="running")
    unrelated = models.AnalysisJob(project_id=project.id, raster_t1_id=other.id,
                                   raster_t2_id=ready_rasters[1].id, status="done")
    db.add_all([as_t1, as_t2, unrelated])
    db.commit()
    polygon = models.ChangePolygon(job_id=as_t1.id, geometry={"type": "Point",
                                   "coordinates": [78.0, 27.0]}, properties={})
    kept = models.ChangePolygon(job_id=unrelated.id, geometry={"type": "Point",
                                "coordinates": [78.0, 27.0]}, properties={})
    db.add_all([polygon, kept])
    db.commit()
    zone = Zone(zone_cd="TAJ", name="Taj Ganj")
    db.add(zone)
    db.commit()
    case = Case(case_ref="CMP-2026-0001", zone_id=zone.id, source="detection",
                status="raised", stage_no=1, created_by="officer", detection_id=polygon.id)
    db.add(case)
    db.commit()
    outputs = [settings.masks_dir / f"job_{job.id}_{part}.tif"
               for job in (as_t1, as_t2) for part in ("mask", "t1", "t2")]
    for path in outputs:
        _on_disk(path)
    unrelated_mask = settings.masks_dir / f"job_{unrelated.id}_mask.tif"
    _on_disk(unrelated_mask)
    as_t1_id, as_t2_id, polygon_id, case_id = as_t1.id, as_t2.id, polygon.id, case.id

    assert client.delete(f"/api/rasters/{row.id}").status_code == 204

    db.expire_all()
    assert db.get(models.AnalysisJob, as_t1_id) is None
    assert db.get(models.AnalysisJob, as_t2_id) is None
    assert db.get(models.ChangePolygon, polygon_id) is None
    assert db.get(models.AnalysisJob, unrelated.id) is not None
    assert db.get(models.ChangePolygon, kept.id) is not None
    # The case survives; only its link to the removed detection is cleared.
    assert db.get(Case, case_id).detection_id is None
    assert [str(p) for p in outputs if p.exists()] == []
    assert unrelated_mask.exists()


def test_a_raster_still_processing_can_be_deleted(client, db, project):
    from app.config import settings

    row = models.Raster(project_id=project.id, name="T1", original_path="",
                        status="processing", progress=0.4,
                        stage="Converting to 8-bit — strip 20/48")
    db.add(row)
    db.commit()
    row.original_path = _on_disk(settings.uploads_dir / f"raster_{row.id}.tif")
    db.commit()
    # No cog_path yet: the stage file is found from the name jobs.py will give the COG.
    staging = settings.cogs_dir / f"raster_{row.id}.tmp.tif"
    _on_disk(staging)
    raster_id = row.id

    assert client.delete(f"/api/rasters/{raster_id}").status_code == 204
    db.expire_all()
    assert db.get(models.Raster, raster_id) is None
    assert not staging.exists()


def test_deleting_somebody_elses_raster_is_404(client, db, foreign_project):
    row = models.Raster(project_id=foreign_project.id, name="T1", original_path="/x.tif")
    db.add(row)
    db.commit()
    assert client.delete(f"/api/rasters/{row.id}").status_code == 404
    db.expire_all()
    assert db.get(models.Raster, row.id) is not None
