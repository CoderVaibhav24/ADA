"""The OOM degrade ladder in _run_analysis (doc §4.3, failure matrix X-15)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from ada_core import models

CUDA_TIER = dict(name="cuda", fp16=True, grid_cap_px=6144, batch=8, sam_refine_default=True)


def oom():
    return RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")


@pytest.fixture
def released(monkeypatch):
    from app import jobs

    calls: list[int] = []
    monkeypatch.setattr(jobs.ml_engine, "release_gpu_models", lambda: calls.append(1))
    return calls


def ladder(**overrides):
    from app import jobs
    from app.ml import gpu

    return jobs._Ladder(gpu.Tier(**{**CUDA_TIER, **overrides}))


class TestOneStage:
    def test_oom_twice_then_success_halves_the_batch_twice(self, released):
        from app import jobs

        state = ladder()
        seen: list[int] = []

        def stage(batch):
            seen.append(batch)
            if len(seen) <= 2:
                raise oom()
            return "ok"

        assert jobs._stage(state, "segmentation T1", stage) == "ok"
        assert seen == [8, 4, 2]
        assert state.batch == 2
        assert len(state.steps) == 2 and all("batch halved" in s for s in state.steps)
        assert len(released) == 2, "GPU memory released between attempts"

    def test_other_errors_are_not_swallowed(self, released):
        from app import jobs

        def stage(_batch):
            raise ValueError("a real bug")

        with pytest.raises(ValueError):
            jobs._stage(ladder(), "segmentation T1", stage)
        assert released == []

    def test_at_batch_one_the_grid_shrinks(self, released):
        from app import jobs

        state = ladder(batch=1)
        state.grid_px = 6144
        with pytest.raises(jobs._ShrinkGrid):
            jobs._stage(state, "land cover T1", lambda _b: (_ for _ in ()).throw(oom()))
        assert state.grid_cap == 4096
        assert "4096 px" in state.steps[-1]

    def test_at_the_smallest_grid_the_stage_runs_on_the_cpu(self, released):
        from app import jobs
        from app.ml import gpu

        state = ladder(batch=1, grid_cap_px=3072)
        backends: list[str] = []

        def stage(batch):
            backends.append(gpu.backend())
            if len(backends) == 1:
                raise RuntimeError("MPS backend out of memory")
            return batch

        assert jobs._stage(state, "SAM refinement", stage) == 1
        assert backends[-1] == "cpu"
        assert "CPU tier" in state.steps[-1]


@pytest.fixture
def pipeline(monkeypatch, tmp_path, released):
    """Seg-diff pipeline stubbed; `fail` decides which segment calls raise OOM."""
    from app import jobs
    from app.ml import gpu

    tier = gpu.Tier(**CUDA_TIER)
    monkeypatch.setattr(gpu, "select_tier", lambda: tier)
    monkeypatch.setattr(gpu, "runtime_info", lambda: {
        "backend": "CUDA", "device_name": "NVIDIA RTX A4000", "tier": "cuda", "fp16": True,
        "ort_provider": "CUDAExecutionProvider", "gpu_budget_gb": 4.0})
    monkeypatch.setattr(jobs.settings, "model_mode", "segdiff")
    monkeypatch.setattr(jobs.settings, "vegetation_mode", "index")
    monkeypatch.setattr(jobs.settings, "sam_refine", False)

    state = {"segment_calls": [], "fail": lambda n: False, "notified": [], "failed": []}
    pair = SimpleNamespace(
        t1=SimpleNamespace(shape=(6144, 5613, 3)), t2=None, valid=None, veg1=None,
        veg2=None, transform=None, crs=None, resolution_m=0.4, shift_px=(0.0, 0.0),
        cir_corrected=(False, False), grid_m_per_px=0.4, grid_extent_km=(2.22, 2.43),
        source_tier="archive")

    class FakeSeg:
        name = "fake-seg"
        batch_size = 8

    seg = FakeSeg()

    def segment_scene(*_args, **_kwargs):
        state["segment_calls"].append(seg.batch_size)
        if state["fail"](len(state["segment_calls"])):
            raise oom()
        return "footprints"

    monkeypatch.setattr(jobs.preprocess, "superimpose", lambda *a, **k: pair)
    monkeypatch.setattr(jobs.preprocess, "write_mask_cog", lambda *a, **k: None)
    monkeypatch.setattr(jobs.preprocess, "write_rgb_geotiff", lambda *a, **k: None)
    monkeypatch.setattr(jobs.ml_engine, "get_seg_backend", lambda: seg)
    monkeypatch.setattr(jobs.ml_engine, "segment_scene", segment_scene)
    monkeypatch.setattr(jobs.ml_engine, "release_seg_backend", lambda: None)
    monkeypatch.setattr(jobs.ml_engine, "release_landcover", lambda: None)
    monkeypatch.setattr(jobs.ml_engine, "analyse_instances", lambda *a, **k: (
        None, None, {"decider": "rules", "candidates": 0, "kept": 0}, None))
    monkeypatch.setattr(jobs.vectorize, "extract_polygons", lambda *a, **k: [])
    monkeypatch.setattr(jobs.notifier, "analysis_finished", state["notified"].append)
    monkeypatch.setattr(jobs.notifier, "analysis_failed", state["failed"].append)

    for name in ("t1.tif", "t2.tif"):
        (tmp_path / name).write_bytes(b"not really a tiff")
    state["paths"] = (str(tmp_path / "t1.tif"), str(tmp_path / "t2.tif"))
    return state


@pytest.fixture
def analysis(db, project, pipeline):
    t1 = models.Raster(project_id=project.id, name="T1", original_path=pipeline["paths"][0])
    t2 = models.Raster(project_id=project.id, name="T2", original_path=pipeline["paths"][1])
    db.add_all([t1, t2])
    db.commit()
    job = models.AnalysisJob(project_id=project.id, raster_t1_id=t1.id,
                             raster_t2_id=t2.id, mode="ai", status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def reload(db, row):
    db.expire_all()
    return db.get(type(row), row.id)


class TestAWholeAnalysis:
    def test_oom_twice_is_recorded_and_the_job_finishes(self, db, analysis, pipeline):
        from app import jobs

        pipeline["fail"] = lambda n: n <= 2
        jobs._run_analysis_safe(analysis.id)

        job = reload(db, analysis)
        assert job.status == "done", job.error
        assert pipeline["segment_calls"][:3] == [8, 4, 2]
        stats = job.stats
        assert stats["models_used"][0] == "Device: CUDA (NVIDIA RTX A4000, fp16, tier cuda)"
        assert stats["models_used"][1] == (
            "Grid: 6144 px over 2.22 x 2.43 km (0.40 m/px), source archive")
        assert sum("batch halved" in line for line in stats["models_used"]) == 2
        assert len(stats["degrade_steps"]) == 2
        assert (stats["device_tier"], stats["fp16"], stats["grid_m_per_px"]) == ("cuda", True, 0.4)
        assert stats["grid_extent_km"] == [2.22, 2.43]
        tiers = {r.tier for r in db.query(models.Raster).all()}
        assert tiers == {"cuda"}

    def test_the_grid_line_is_omitted_without_grid_fields(self, db, analysis, pipeline,
                                                          monkeypatch):
        from app import jobs

        bare = SimpleNamespace(t1=None, t2=None, valid=None, veg1=None, veg2=None,
                               transform=None, crs=None, resolution_m=0.5,
                               shift_px=(0.0, 0.0), cir_corrected=(False, False))
        monkeypatch.setattr(jobs.preprocess, "superimpose", lambda *a, **k: bare)
        jobs._run_analysis_safe(analysis.id)
        stats = reload(db, analysis).stats
        assert not any(line.startswith("Grid:") for line in stats["models_used"])
        assert stats["grid_m_per_px"] is None

    def test_oom_everywhere_is_retryable_three_times_then_final(
            self, db, analysis, pipeline, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "ml_oom_retries", 3)
        pipeline["fail"] = lambda n: True
        requeued: list[int] = []
        monkeypatch.setattr(jobs, "submit_analysis", requeued.append)

        jobs._run_analysis_safe(analysis.id)
        job = reload(db, analysis)
        assert job.status == "failed"
        assert job.error.startswith("retryable: run 1/4:")
        steps = job.stats["degrade_steps"]
        assert any("batch halved" in s for s in steps)
        assert any("4096 px" in s for s in steps) and any("3072 px" in s for s in steps)
        assert any("CPU tier" in s for s in steps)
        assert pipeline["failed"] == [], "no failure notice while a retry is pending"

        rounds = 0
        while jobs.requeue_retryable():
            rounds += 1
            assert reload(db, analysis).status == "queued"
            jobs._run_analysis_safe(analysis.id)
            assert rounds <= 5, "requeue must stop"

        job = reload(db, analysis)
        assert rounds == 3
        assert requeued == [analysis.id] * 3
        assert job.status == "failed"
        assert not job.error.startswith("retryable:")
        assert "4 run(s)" in job.error
        assert pipeline["failed"] == [analysis.id]

    def test_requeue_stale_also_picks_up_retryable_jobs(self, db, analysis, monkeypatch):
        from app import jobs

        monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", True)
        requeued: list[int] = []
        monkeypatch.setattr(jobs, "submit_analysis", requeued.append)
        monkeypatch.setattr(jobs, "submit_ingest", lambda _id: None)
        analysis.status = "failed"
        analysis.error = "retryable: run 1/4: out of memory"
        db.commit()
        jobs.requeue_stale()
        assert requeued == [analysis.id]


def test_in_flight_lists_queued_and_running_ids(engine):
    import threading

    from app import jobs

    gate = threading.Event()
    jobs._submit(lambda _id: gate.wait(5), 7, "jobs")
    jobs._submit(lambda _id: None, 3, "rasters")
    assert jobs.in_flight() == {"rasters": [3], "jobs": [7]}
    gate.set()
    jobs._queue.join()
    assert jobs.in_flight() == {"rasters": [], "jobs": []}


def test_a_job_killed_mid_run_is_restarted_only_ml_oom_retries_times(
        db, project, monkeypatch):
    from app import jobs

    monkeypatch.setattr(jobs.settings, "requeue_stale_on_startup", True)
    monkeypatch.setattr(jobs.settings, "ml_oom_retries", 3)
    submitted: list[int] = []
    failed: list[int] = []
    monkeypatch.setattr(jobs, "submit_analysis", submitted.append)
    monkeypatch.setattr(jobs, "submit_ingest", lambda _id: None)
    monkeypatch.setattr(jobs.notifier, "analysis_failed", failed.append)
    job = models.AnalysisJob(project_id=project.id, raster_t1_id=1, raster_t2_id=2,
                             status="running")
    db.add(job)
    db.commit()

    for _ in range(4):
        jobs.requeue_stale()

    job = reload(db, job)
    assert submitted == [job.id] * 3
    assert job.status == "failed" and "interrupted mid-run 4 times" in job.error
    assert not job.error.startswith("retryable:")
    assert failed == [job.id]
