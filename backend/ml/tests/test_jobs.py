"""The in-process queue, and the sweep that covers for its lack of durability."""

from __future__ import annotations

import pytest
from ada_core import models


@pytest.fixture
def submitted(monkeypatch):
    """Intercept submissions so nothing actually runs the pipeline."""
    from app import jobs

    calls: list[tuple[str, int]] = []
    monkeypatch.setattr(jobs, "submit_ingest", lambda i: calls.append(("ingest", i)))
    monkeypatch.setattr(jobs, "submit_analysis", lambda i: calls.append(("analysis", i)))
    return calls


def test_queue_depth_starts_empty(engine):
    from app import jobs

    assert jobs.queue_depth() == 0


class TestRequeueStale:
    """A restart loses the in-process queue while the row still says it is
    running. Nothing else ever picks those up, so a good upload could sit at
    PROCESSING forever and no amount of restarting would help.
    """

    def test_interrupted_work_is_resubmitted(self, engine, db, project, submitted, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", True)
        stranded_raster = models.Raster(project_id=project.id, name="mid-ingest",
                                        original_path="/x.tif", status="processing")
        running = models.AnalysisJob(project_id=project.id, raster_t1_id=1,
                                     raster_t2_id=2, status="running")
        queued = models.AnalysisJob(project_id=project.id, raster_t1_id=1,
                                    raster_t2_id=2, status="queued")
        db.add_all([stranded_raster, running, queued])
        db.commit()

        jobs.requeue_stale()

        assert ("ingest", stranded_raster.id) in submitted
        assert ("analysis", running.id) in submitted
        assert ("analysis", queued.id) in submitted

    def test_finished_work_is_left_alone(self, engine, db, project, submitted, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", True)
        db.add_all([
            models.Raster(project_id=project.id, name="done", original_path="/x.tif",
                          status="ready"),
            models.Raster(project_id=project.id, name="broken", original_path="/x.tif",
                          status="failed"),
            models.AnalysisJob(project_id=project.id, raster_t1_id=1, raster_t2_id=2,
                               status="done"),
            models.AnalysisJob(project_id=project.id, raster_t1_id=1, raster_t2_id=2,
                               status="failed"),
        ])
        db.commit()
        jobs.requeue_stale()
        assert submitted == []

    def test_it_can_be_switched_off(self, engine, db, project, submitted, monkeypatch):
        """Under `uvicorn --reload` a restart happens on every file save, and
        restarting a 1 Gpx ingest from strip 1 each time means it can never
        finish — the work is thrown away faster than it accumulates."""
        from app import jobs

        monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", False)
        db.add(models.Raster(project_id=project.id, name="mid", original_path="/x.tif",
                             status="processing"))
        db.commit()
        jobs.requeue_stale()
        assert submitted == []

    def test_switching_it_off_still_says_what_was_left(self, engine, db, project, submitted,
                                                       monkeypatch, caplog):
        """Silence here means an officer waits on a row nothing will ever pick
        up, with nothing in the log to explain it."""
        import logging

        from app import jobs

        monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", False)
        db.add(models.Raster(project_id=project.id, name="mid", original_path="/x.tif",
                             status="processing"))
        db.commit()
        with caplog.at_level(logging.WARNING, logger="ada.jobs"):
            jobs.requeue_stale()
        assert "interrupted" in caplog.text.lower()

    def test_an_empty_database_is_quiet(self, engine, submitted, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", True)
        jobs.requeue_stale()
        assert submitted == []


def test_the_worker_thread_is_a_daemon(engine, monkeypatch):
    """A ThreadPoolExecutor's threads are non-daemon and Python joins them at
    exit, so a process asked to shut down would not leave until the running job
    finished — which under --reload left two processes grinding the same
    raster. A daemon thread is killed with the process."""
    from app import jobs

    done = []
    jobs._submit(done.append, 1)
    assert jobs._worker is not None
    assert jobs._worker.daemon is True
    jobs._queue.join()
    assert done == [1]


def test_a_failing_job_does_not_kill_the_worker(engine, caplog):
    """One bad analysis must not stop every later one. The pump catches
    everything, because the alternative is a queue that silently stops."""
    import logging

    from app import jobs

    def explode(_):
        raise RuntimeError("pipeline blew up")

    survivors = []
    with caplog.at_level(logging.ERROR, logger="ada.jobs"):
        jobs._submit(explode, 1)
        jobs._submit(survivors.append, 2)
        jobs._queue.join()

    assert survivors == [2]
    assert "pipeline blew up" in caplog.text
