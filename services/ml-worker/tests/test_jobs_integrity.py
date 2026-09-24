"""What a re-run may and may not do to a job's polygons (review D-03, D-04).

The pipeline is stubbed end to end: these tests are about which rows survive
and which commit they land in, not about change detection. Each stub stands in
for one stage `_run_analysis` calls, and returns the smallest value the next
stage reads.
"""

from __future__ import annotations

from types import SimpleNamespace

import ada_core.models_icms  # noqa: F401 - registers icms_case before create_all
import pytest
from ada_core import models
from ada_core.models_icms import Case, Zone

POINT = {"type": "Point", "coordinates": [78.0, 27.0]}


def feature(label: str, *, area: bool = True) -> dict:
    properties = {"status": "illegal", "change_type": "new_construction", "label": label}
    if area:
        properties["area_m2"] = 12.5
    return {"geometry": POINT, "properties": properties}


@pytest.fixture
def pipeline(monkeypatch, tmp_path):
    """Stub every stage; `features` is what vectorize hands back, `ran` what ran."""
    from app import jobs

    state = {"features": [feature("new-1"), feature("new-2")], "ran": []}
    pair = SimpleNamespace(
        t1=None, t2=None, valid=None, veg1=None, veg2=None, transform=None, crs=None,
        resolution_m=0.5, shift_px=(0.0, 0.0), cir_corrected=(False, False),
    )

    def superimpose(*_args, **_kwargs):
        state["ran"].append("superimpose")
        return pair

    monkeypatch.setattr(jobs.preprocess, "superimpose", superimpose)
    monkeypatch.setattr(jobs.preprocess, "write_mask_cog", lambda *a, **k: None)
    monkeypatch.setattr(jobs.preprocess, "write_rgb_geotiff", lambda *a, **k: None)
    monkeypatch.setattr(jobs.ml_engine, "classical_change_prob", lambda *a, **k: None)
    monkeypatch.setattr(jobs.ml_engine, "suppress_vegetation_changes", lambda *a, **k: None)
    monkeypatch.setattr(jobs.vectorize, "extract_polygons",
                        lambda *a, **k: state["features"])
    notified: list[int] = []
    monkeypatch.setattr(jobs.notifier, "analysis_finished", notified.append)
    monkeypatch.setattr(jobs.notifier, "analysis_failed", lambda _id: None)
    state["notified"] = notified

    for name in ("t1.tif", "t2.tif"):
        (tmp_path / name).write_bytes(b"not really a tiff")
    state["paths"] = (str(tmp_path / "t1.tif"), str(tmp_path / "t2.tif"))
    return state


@pytest.fixture
def analysis(db, project, pipeline):
    """A diff-mode job over two rasters whose originals exist on disk."""
    t1 = models.Raster(project_id=project.id, name="T1", original_path=pipeline["paths"][0])
    t2 = models.Raster(project_id=project.id, name="T2", original_path=pipeline["paths"][1])
    db.add_all([t1, t2])
    db.commit()
    job = models.AnalysisJob(project_id=project.id, raster_t1_id=t1.id,
                             raster_t2_id=t2.id, mode="diff", status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def polygons(db, job_id: int) -> dict[str, str]:
    db.expire_all()
    rows = db.query(models.ChangePolygon).filter(models.ChangePolygon.job_id == job_id)
    return {row.properties["label"]: row.review_status for row in rows}


def seed(db, job_id: int) -> dict[str, int]:
    """Three prior polygons: one reviewed, one a case was raised from, one untouched."""
    rows = {
        "reviewed": models.ChangePolygon(job_id=job_id, geometry=POINT,
                                         properties={"label": "reviewed"},
                                         review_status="confirmed"),
        "raised": models.ChangePolygon(job_id=job_id, geometry=POINT,
                                       properties={"label": "raised"}),
        "untouched": models.ChangePolygon(job_id=job_id, geometry=POINT,
                                          properties={"label": "untouched"}),
    }
    db.add_all(rows.values())
    db.commit()
    zone = Zone(zone_cd="TAJ", name="Taj Ganj")
    db.add(zone)
    db.commit()
    db.add(Case(case_ref="CMP-2026-0001", zone_id=zone.id, source="detection",
                status="raised", stage_no=1, created_by="officer",
                detection_id=rows["raised"].id))
    db.commit()
    return {label: row.id for label, row in rows.items()}


class TestAFinishedJobIsFinal:
    def test_a_done_job_is_not_re_run(self, db, analysis, pipeline):
        from app import jobs

        seed(db, analysis.id)
        analysis.status = "done"
        db.commit()

        jobs._run_analysis_safe(analysis.id)

        assert pipeline["ran"] == [], "the pipeline never started"
        assert pipeline["notified"] == [], "nothing new to tell the officer"
        assert set(polygons(db, analysis.id)) == {"reviewed", "raised", "untouched"}

    def test_a_run_finishing_after_another_does_not_overwrite_it(self, db, analysis):
        from app import jobs

        seed(db, analysis.id)
        analysis.status = "done"
        db.commit()

        wrote = jobs._persist_result(analysis.id, [feature("late")], {"status": "done"})

        assert wrote is False
        assert "late" not in polygons(db, analysis.id)


class TestARacingRunCannotUnfinishAJob:
    """A second run that passed the done-check must not flip `done` back (review F3)."""

    def _finish_elsewhere_during_the_check(self, monkeypatch, job_id):
        from ada_core.database import SessionLocal

        from app import jobs

        real = jobs._epoch_source

        def epoch_source(raster):
            with SessionLocal() as other:
                other.query(models.AnalysisJob).filter(
                    models.AnalysisJob.id == job_id).update({"status": "done"})
                other.commit()
            return real(raster)

        monkeypatch.setattr(jobs, "_epoch_source", epoch_source)

    def test_the_run_stops_and_the_job_stays_done(self, db, analysis, pipeline, monkeypatch):
        from app import jobs

        seed(db, analysis.id)
        self._finish_elsewhere_during_the_check(monkeypatch, analysis.id)

        assert jobs._run_analysis(analysis.id) is False

        db.refresh(analysis)
        assert analysis.status == "done"
        assert pipeline["ran"] == []
        assert set(polygons(db, analysis.id)) == {"reviewed", "raised", "untouched"}

    def test_a_failure_after_another_run_finished_does_not_mark_it_failed(
        self, db, analysis, pipeline, monkeypatch
    ):
        from ada_core.database import SessionLocal

        from app import jobs

        def superimpose(*_a, **_k):
            with SessionLocal() as other:
                other.query(models.AnalysisJob).filter(
                    models.AnalysisJob.id == analysis.id).update({"status": "done"})
                other.commit()
            raise RuntimeError("boom")

        monkeypatch.setattr(jobs.preprocess, "superimpose", superimpose)

        jobs._run_analysis_safe(analysis.id)

        db.refresh(analysis)
        assert analysis.status == "done"
        assert analysis.error is None


class TestAReRunKeepsWhatOfficersTouched:
    def test_reviewed_and_raised_polygons_survive_a_re_run(self, db, analysis, pipeline):
        from app import jobs

        seed(db, analysis.id)

        jobs._run_analysis_safe(analysis.id)

        after = polygons(db, analysis.id)
        assert after == {"reviewed": "confirmed", "raised": "pending",
                         "new-1": "pending", "new-2": "pending"}
        db.refresh(analysis)
        assert analysis.status == "done"
        assert pipeline["notified"] == [analysis.id]

    def test_the_case_still_points_at_its_detection(self, db, analysis, pipeline):
        from app import jobs

        ids = seed(db, analysis.id)

        jobs._run_analysis_safe(analysis.id)

        db.expire_all()
        assert db.query(Case.detection_id).scalar() == ids["raised"]


class TestPolygonsAndDoneAreOneCommit:
    def test_a_failure_before_done_leaves_the_previous_polygons(
        self, db, analysis, pipeline
    ):
        """Previously the polygons were committed and only then the stats were
        computed and `done` written, so a failure in between left a job with new
        polygons and an old status."""
        from app import jobs

        seed(db, analysis.id)
        pipeline["features"] = [feature("broken", area=False)]

        with pytest.raises(KeyError):
            jobs._run_analysis(analysis.id)

        assert set(polygons(db, analysis.id)) == {"reviewed", "raised", "untouched"}
        db.refresh(analysis)
        assert analysis.status != "done"

    def test_done_and_the_stats_arrive_with_the_polygons(self, db, analysis, pipeline):
        from app import jobs

        assert jobs._run_analysis(analysis.id) is True

        db.refresh(analysis)
        assert analysis.status == "done"
        assert analysis.stats["polygons"] == 2
        assert set(polygons(db, analysis.id)) == {"new-1", "new-2"}


def test_requeue_covers_processing_jobs_too(engine, db, project, monkeypatch):
    from app import jobs

    calls: list[int] = []
    monkeypatch.setattr(jobs, "submit_analysis", calls.append)
    monkeypatch.setattr(jobs, "submit_ingest", lambda _id: None)
    monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", True)
    rows = [models.AnalysisJob(project_id=project.id, raster_t1_id=1, raster_t2_id=2,
                               status=status)
            for status in ("processing", "done", "failed")]
    db.add_all(rows)
    db.commit()

    jobs.requeue_stale()

    assert calls == [rows[0].id]
