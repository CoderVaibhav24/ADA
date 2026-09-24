"""Runtime tier selection, startup refusal, and what /health/ready reports (doc §4.1, §4.2)."""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def gpu(monkeypatch):
    """gpu with a clean cache and every probe answering "no" until a test says otherwise."""
    from app.ml import gpu as module

    module.reset()
    monkeypatch.setattr(module.settings, "ml_device", "auto")
    monkeypatch.setattr(module.settings, "require_gpu", False)
    monkeypatch.setattr(module, "_cuda_usable", lambda _torch: False)
    monkeypatch.setattr(module, "_mps_usable", lambda _torch: False)
    monkeypatch.setattr(module, "_coreml_available", lambda: False)
    monkeypatch.setattr(module, "_metal_grid_cap", lambda: 5120)
    monkeypatch.setattr(module, "_device_name", lambda kind: f"test-{kind}")
    yield module
    module.reset()


class TestAutoWalksTheLadder:
    def test_cuda_first(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu, "_cuda_usable", lambda _torch: True)
        monkeypatch.setattr(gpu, "_mps_usable", lambda _torch: True)
        tier = gpu.select_tier()
        assert (tier.name, tier.fp16, tier.grid_cap_px, tier.batch) == ("cuda", True, 6144, 8)
        assert tier.sam_refine_default is True

    def test_metal_needs_mps_and_coreml(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu, "_mps_usable", lambda _torch: True)
        monkeypatch.setattr(gpu, "_coreml_available", lambda: True)
        tier = gpu.select_tier()
        assert (tier.name, tier.fp16, tier.grid_cap_px, tier.batch) == ("metal", True, 5120, 4)
        assert gpu.backend() == "mps", "torch keeps its own device string"

    def test_mps_without_coreml_is_the_cpu_tier(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu, "_mps_usable", lambda _torch: True)
        assert gpu.select_tier().name == "cpu"

    def test_neither_is_the_capped_cpu_tier(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu.settings, "ml_cpu_grid_cap_px", 3072)
        monkeypatch.setattr(gpu.settings, "ml_cpu_sam_refine", False)
        tier = gpu.select_tier()
        assert (tier.name, tier.fp16, tier.grid_cap_px, tier.batch) == ("cpu", False, 3072, 1)
        assert tier.sam_refine_default is False


class TestAPinnedDeviceRefusesToStart:
    @pytest.mark.parametrize("pin", ["cuda", "mps", "metal"])
    def test_failed_probe_raises(self, gpu, monkeypatch, pin):
        monkeypatch.setattr(gpu.settings, "ml_device", pin)
        with pytest.raises(RuntimeError, match="pinned"):
            gpu.select_tier()

    def test_startup_check_raises_too(self, gpu, monkeypatch):
        from app import main

        monkeypatch.setattr(gpu.settings, "ml_device", "cuda")
        with pytest.raises(RuntimeError):
            main._require_runtime()

    def test_metal_alias_pins_mps(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu.settings, "ml_device", "metal")
        monkeypatch.setattr(gpu, "_mps_usable", lambda _torch: True)
        monkeypatch.setattr(gpu, "_coreml_available", lambda: True)
        assert gpu.select_tier().name == "metal"

    def test_unknown_value_raises(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu.settings, "ml_device", "mlx")
        with pytest.raises(RuntimeError, match="ML_DEVICE"):
            gpu.select_tier()

    def test_require_gpu_with_pinned_cpu_is_refused(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu.settings, "ml_device", "cpu")
        monkeypatch.setattr(gpu.settings, "require_gpu", True)
        with pytest.raises(RuntimeError, match="contradicts"):
            gpu.select_tier()

    def test_pinned_cpu_starts(self, gpu, monkeypatch):
        monkeypatch.setattr(gpu.settings, "ml_device", "cpu")
        assert gpu.select_tier().name == "cpu"

    def test_require_gpu_is_a_deprecated_alias(self, gpu, monkeypatch, caplog):
        monkeypatch.setattr(gpu.settings, "require_gpu", True)
        with caplog.at_level(logging.WARNING, logger="ada.ml"), \
                pytest.raises(RuntimeError, match="REQUIRE_GPU"):
            gpu.select_tier()
        assert "deprecated" in caplog.text


def test_runtime_info_names_metal_not_mps(gpu, monkeypatch):
    monkeypatch.setattr(gpu, "_mps_usable", lambda _torch: True)
    monkeypatch.setattr(gpu, "_coreml_available", lambda: True)
    info = gpu.runtime_info()
    assert info == {"backend": "Metal", "device_name": "test-mps", "tier": "metal",
                    "fp16": True, "ort_provider": "CoreMLExecutionProvider",
                    "gpu_budget_gb": gpu.settings.gpu_memory_limit_gb}


def test_cpu_override_is_scoped(gpu, monkeypatch):
    monkeypatch.setattr(gpu, "_cuda_usable", lambda _torch: True)
    assert gpu.backend() == "cuda"
    with gpu.cpu_override():
        assert gpu.backend() == "cpu"
    assert gpu.backend() == "cuda"


def test_estimate_seconds_is_monotonic():
    from app import jobs

    for tier in ("cuda", "metal", "cpu"):
        sizes = [jobs.estimate_seconds(tier, px) for px in (1024, 3072, 4096, 6144)]
        assert sizes == sorted(sizes) and sizes[0] > 0
    assert (jobs.estimate_seconds("cuda", 3072) < jobs.estimate_seconds("metal", 3072)
            < jobs.estimate_seconds("cpu", 3072))


def test_health_ready_reports_the_runtime(engine, db, monkeypatch):
    from app import jobs
    from app.main import app

    monkeypatch.setattr(jobs, "requeue_stale", lambda: None)
    with TestClient(app) as client:
        body = client.get("/health/ready").json()
    assert body["status"] == "ok"
    assert body["in_flight"] == {"rasters": [], "jobs": []}
    assert {"queue_depth", "backend", "device_name", "tier", "fp16", "ort_provider",
            "gpu_budget_gb", "disk_free_gb", "grid_cap_px", "eta_s_per_mpx",
            "eta_s_at_grid_cap"} <= set(body)
    assert (body["backend"], body["tier"], body["fp16"]) == ("CPU", "cpu", False)
    assert body["ort_provider"] == "CPUExecutionProvider"
    assert body["gpu_budget_gb"] is None
    assert body["disk_free_gb"] > 0
    assert body["eta_s_at_grid_cap"] == jobs.estimate_seconds("cpu", body["grid_cap_px"])
