"""ADA's own backends: loading, validation, normalisation, tiling, switching and thresholds.

Every test except the last runs on the CPU with a one-layer stand-in for the
UPerNet (`_build` is patched), written to a real safetensors file, so the load
path is the production one. The last test uses the converted weights when they
are present on this machine.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pytest
import torch
from ada_core import ROOT_DIR
from pydantic import ValidationError
from safetensors.torch import save_file

from app.config import Settings, settings
from app.ml import ada_backends, engine, landcover
from app.ml.ada_backends import (
    ADA_MEAN,
    ADA_STD,
    MODEL_FILE,
    AdaFootprintBackend,
    AdaLandCoverBackend,
)

LOVEDA = [landcover.LABELS[i] for i in range(7)]
_REAL_BUILD = ada_backends._build


class TinyNet(torch.nn.Module):
    """Per-pixel 1x1 conv with the same head key as smp's UPerNet."""

    def __init__(self, classes: int) -> None:
        super().__init__()
        self.segmentation_head = torch.nn.Sequential(torch.nn.Conv2d(3, classes, 1))

    def forward(self, x):
        return self.segmentation_head(x)


@pytest.fixture(autouse=True)
def tiny_build(monkeypatch):
    monkeypatch.setattr(ada_backends, "_build", lambda classes, *a, **k: TinyNet(classes))
    monkeypatch.setattr(settings, "ada_batch_size", None)


def write_weights(root: Path, classes: int, *, weight=None, bias=None,
                  config: dict | None = None) -> Path:
    """A model dir with TinyNet weights: weight (classes, 3), bias (classes,)."""
    root.mkdir(parents=True, exist_ok=True)
    net = TinyNet(classes)
    w = torch.zeros(classes, 3) if weight is None else torch.as_tensor(weight, dtype=torch.float32)
    b = torch.zeros(classes) if bias is None else torch.as_tensor(bias, dtype=torch.float32)
    with torch.no_grad():
        net.segmentation_head[0].weight.copy_(w.view(classes, 3, 1, 1))
        net.segmentation_head[0].bias.copy_(b)
    save_file({k: v.contiguous() for k, v in net.state_dict().items()}, str(root / MODEL_FILE))
    cfg = {"classes": classes, "crop": 384, "mean": list(ADA_MEAN), "std": list(ADA_STD),
           "source_run": root.name, "epoch": 3,
           "class_names": ["building"] if classes == 1 else LOVEDA}
    cfg.update(config or {})
    (root / "config.json").write_text(json.dumps(cfg), encoding="utf-8")
    return root


def red_logit(root: Path) -> Path:
    """Footprint weights whose logit is the normalised red channel."""
    return write_weights(root, 1, weight=[[1.0, 0.0, 0.0]])


def expected_red_prob(img: np.ndarray) -> np.ndarray:
    z = (img[..., 0].astype(np.float32) - ADA_MEAN[0]) / ADA_STD[0]
    return 1.0 / (1.0 + np.exp(-z))


def chips(n: int, size: int = 384, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, 256, (n, size, size, 3), dtype=np.uint8)


# ---------------------------------------------------------------- loading

def test_loads_from_safetensors_on_the_cpu(tmp_path):
    backend = AdaFootprintBackend(red_logit(tmp_path / "fp"))
    assert backend.tile_size == 384
    assert backend.device.type == "cpu"
    assert "fp" in backend.name and "epoch 3" in backend.name
    assert not any(p.requires_grad for p in backend.model.parameters())


def test_missing_weights_say_how_to_make_them(tmp_path):
    with pytest.raises(FileNotFoundError, match="convert_ada_checkpoint.py"):
        AdaFootprintBackend(tmp_path / "nowhere")


def test_a_land_cover_head_is_refused_as_a_footprint(tmp_path):
    root = write_weights(tmp_path / "lc", 7, config={"classes": 1})
    with pytest.raises(ValueError, match="7-class head, expected 1"):
        AdaFootprintBackend(root)


def test_a_footprint_head_is_refused_as_land_cover(tmp_path):
    root = write_weights(tmp_path / "fp", 1, config={"classes": 7, "class_names": LOVEDA})
    with pytest.raises(ValueError, match="1-class head, expected 7"):
        AdaLandCoverBackend(root)


def test_config_class_count_must_match(tmp_path):
    root = write_weights(tmp_path / "fp", 1, config={"classes": 2})
    with pytest.raises(ValueError, match="declares 2 classes"):
        AdaFootprintBackend(root)


def test_land_cover_class_order_must_be_loveda(tmp_path):
    shuffled = LOVEDA[1:] + LOVEDA[:1]
    root = write_weights(tmp_path / "lc", 7, config={"class_names": shuffled})
    with pytest.raises(ValueError, match="LoveDA order"):
        AdaLandCoverBackend(root)


def test_chips_of_the_wrong_size_are_refused(tmp_path):
    backend = AdaFootprintBackend(red_logit(tmp_path / "fp"))
    with pytest.raises(ValueError, match="384"):
        backend.segment(chips(1, size=256))


# ---------------------------------------------------------------- outputs

def test_flair_normalisation_is_applied(tmp_path):
    backend = AdaFootprintBackend(red_logit(tmp_path / "fp"))
    x = chips(2)
    np.testing.assert_allclose(backend.segment(x), expected_red_prob(x), atol=1e-5)


def test_segment_is_a_probability_per_pixel(tmp_path):
    backend = AdaFootprintBackend(write_weights(tmp_path / "fp", 1,
                                                weight=[[3.0, -2.0, 1.0]], bias=[0.5]))
    out = backend.segment(chips(3))
    assert out.shape == (3, 384, 384) and out.dtype == np.float32
    assert out.min() >= 0.0 and out.max() <= 1.0


def test_probs_sum_to_one_in_loveda_order(tmp_path):
    bias = [0.0] * 7
    bias[landcover.BARREN_CLASS] = 6.0
    backend = AdaLandCoverBackend(write_weights(tmp_path / "lc", 7, bias=bias))
    p = backend.probs(chips(2))
    assert p.shape == (2, 7, 384, 384) and p.dtype == np.float32
    np.testing.assert_allclose(p.sum(axis=1), 1.0, atol=1e-5)
    assert (p.argmax(axis=1) == landcover.BARREN_CLASS).all()


# ---------------------------------------------------------------- batch size

def test_batch_defaults_to_the_tier_and_env_overrides(tmp_path, monkeypatch):
    root = red_logit(tmp_path / "fp")
    assert ada_backends.TIER_BATCH == {"cuda": 4, "mps": 2, "cpu": 1}
    assert AdaFootprintBackend(root).batch_size == 1
    monkeypatch.setattr(settings, "ada_batch_size", 3)
    assert AdaFootprintBackend(root).batch_size == 3


def test_the_oom_ladder_can_lower_but_not_raise_the_batch(tmp_path, monkeypatch):
    from app.jobs import _cap_batch

    monkeypatch.setattr(settings, "ada_batch_size", 4)
    backend = AdaFootprintBackend(red_logit(tmp_path / "fp"))
    assert _cap_batch(backend, 8).batch_size == 4
    assert _cap_batch(backend, 2).batch_size == 2
    assert _cap_batch(backend, 8).batch_size == 4


# ---------------------------------------------------------------- engine tiling

def test_a_non_square_scene_is_tiled_on_both_axes(tmp_path, monkeypatch):
    """500x900 is neither a multiple of 384 nor square; every pixel must be scored."""
    backend = AdaFootprintBackend(red_logit(tmp_path / "fp"))
    seen: list[tuple] = []
    real = backend.segment

    def recording(x):
        seen.append(x.shape)
        return real(x)

    monkeypatch.setattr(backend, "segment", recording)
    monkeypatch.setattr(engine, "_seg_backend", backend)
    img = np.random.default_rng(1).integers(0, 256, (500, 900, 3), dtype=np.uint8)
    out = engine.segment_scene(img, np.ones((500, 900), bool))
    assert out.shape == (500, 900)
    assert seen and all(shape[1:] == (384, 384, 3) for shape in seen)
    np.testing.assert_allclose(out, expected_red_prob(img), atol=1e-4)


def test_a_scene_smaller_than_a_tile_is_padded(tmp_path, monkeypatch):
    backend = AdaFootprintBackend(red_logit(tmp_path / "fp"))
    monkeypatch.setattr(engine, "_seg_backend", backend)
    img = np.random.default_rng(2).integers(0, 256, (200, 300, 3), dtype=np.uint8)
    valid = np.ones((200, 300), bool)
    valid[:10] = False
    out = engine.segment_scene(img, valid)
    assert out.shape == (200, 300)
    assert (out[:10] == 0).all()
    np.testing.assert_allclose(out[10:], expected_red_prob(img)[10:], atol=1e-4)


def test_land_cover_on_a_non_square_scene(tmp_path, monkeypatch):
    backend = AdaLandCoverBackend(write_weights(
        tmp_path / "lc", 7, weight=np.random.default_rng(3).normal(size=(7, 3))))
    monkeypatch.setattr(landcover, "_backend", backend)
    img = np.random.default_rng(4).integers(0, 256, (500, 900, 3), dtype=np.uint8)
    probs = engine.landcover_probs(img, np.ones((500, 900), bool))
    assert probs.shape == (7, 500, 900)
    np.testing.assert_allclose(probs.astype(np.float32).sum(axis=0), 1.0, atol=5e-3)


# ---------------------------------------------------------------- land-cover maths

def one_hot(cls_map: np.ndarray) -> np.ndarray:
    return np.eye(7, dtype=np.float32)[cls_map].transpose(2, 0, 1)


def test_barren_reads_the_barren_class():
    probs = np.zeros((7, 2, 2), np.float32)
    probs[landcover.BARREN_CLASS] = 0.3
    np.testing.assert_allclose(landcover.barren(probs), 0.3)


def test_cleared_ground_is_vegetation_lost_to_exposed_surface():
    forest, agri, background, building = 5, 6, 0, 1
    # forest->background cleared; agriculture->building not; background stays; forest stays
    p1 = one_hot(np.array([[forest, agri], [background, forest]]))
    p2 = one_hot(np.array([[background, building], [background, forest]]))
    np.testing.assert_allclose(landcover.cleared_ground(p1, p2), [[1, 0], [0, 0]])


def test_cleared_ground_keeps_the_barren_class_where_it_fires():
    p1 = one_hot(np.array([[0]]))
    p2 = np.zeros((7, 1, 1), np.float32)
    p2[landcover.BARREN_CLASS] = 0.9
    p2[1] = 0.1
    assert landcover.cleared_ground(p1, p2)[0, 0] == pytest.approx(0.9)


def test_cleared_ground_mixes_probabilities():
    p1 = np.zeros((7, 1, 1), np.float32)
    p1[5], p1[0] = 0.8, 0.2                    # 0.8 vegetated
    p2 = np.zeros((7, 1, 1), np.float32)
    p2[0], p2[1], p2[4] = 0.5, 0.3, 0.2       # exposed = 1 - 0.3 = 0.7
    assert landcover.cleared_ground(p1, p2)[0, 0] == pytest.approx(max(0.2, 0.8 * 0.7))


# ---------------------------------------------------------------- configuration

def make(**overrides) -> Settings:
    return Settings(database_url="postgresql+psycopg2://u:p@h/db", **overrides)


def test_the_ada_backends_are_the_defaults():
    fields = Settings.model_fields
    assert fields["building_backend"].default == "ada"
    assert fields["landcover_backend"].default == "ada"
    assert fields["bare_ground_threshold"].default == 0.752
    assert fields["new_instance_min_frac_ada"].default == 0.513
    assert fields["ada_footprint_local"].default == "ada-footprint-v1"
    assert fields["ada_landcover_local"].default == "ada-landcover7-v3"
    assert fields["ada_batch_size"].default is None


@pytest.mark.parametrize("field", ["building_backend", "landcover_backend"])
def test_an_unknown_backend_refuses_to_start(field):
    with pytest.raises(ValidationError, match="is not one of"):
        make(**{field: "segformer"})


def test_backend_names_are_normalised():
    s = make(building_backend=" ADA ", landcover_backend="Ada")
    assert (s.building_backend, s.landcover_backend) == ("ada", "ada")


@pytest.mark.parametrize("raw,expected", [("", None), ("  ", None), ("3", 3)])
def test_ada_batch_size_blank_means_tier_default(raw, expected):
    assert make(ada_batch_size=raw).ada_batch_size == expected


def test_ada_batch_size_must_be_positive():
    with pytest.raises(ValidationError, match="ADA_BATCH_SIZE"):
        make(ada_batch_size=0)


def test_effective_new_instance_min_frac_follows_the_backend():
    assert make(building_backend="changestar").effective_new_instance_min_frac() == 0.6
    assert make(building_backend="ada").effective_new_instance_min_frac() == 0.513
    assert make(building_backend="geobase").effective_new_instance_min_frac() == 0.6


def test_instance_rules_see_the_ada_cut(monkeypatch):
    monkeypatch.setattr(settings, "building_backend", "changestar")
    assert engine._instance_settings() is settings
    monkeypatch.setattr(settings, "building_backend", "ada")
    view = engine._instance_settings()
    assert view.new_instance_min_frac == settings.new_instance_min_frac_ada
    assert settings.new_instance_min_frac == Settings.model_fields[
        "new_instance_min_frac"].default


def test_building_backend_ada_selects_the_ada_footprint(tmp_path, monkeypatch):
    from app.ml.backends import load_seg_backend

    monkeypatch.setattr(settings, "building_backend", "ada")
    monkeypatch.setattr(settings, "ada_footprint_local", str(red_logit(tmp_path / "fp")))
    assert isinstance(load_seg_backend("unused", "unused"), AdaFootprintBackend)


def test_landcover_backend_ada_selects_the_ada_land_cover(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "landcover_backend", "ada")
    monkeypatch.setattr(settings, "ada_landcover_local",
                        str(write_weights(tmp_path / "lc", 7)))
    monkeypatch.setattr(landcover, "_backend", None)
    assert isinstance(landcover.get_backend(), AdaLandCoverBackend)


def test_health_ready_reports_the_backends(engine, db, monkeypatch):
    from fastapi.testclient import TestClient

    from app import jobs
    from app.main import app

    monkeypatch.setattr(jobs, "requeue_stale", lambda: None)
    monkeypatch.setattr(settings, "building_backend", "ada")
    monkeypatch.setattr(settings, "landcover_backend", "loveda")
    with TestClient(app) as client:
        body = client.get("/health/ready").json()
    assert body["building_backend"] == "ada"
    assert body["landcover_backend"] == "loveda"


def test_health_ready_degrades_when_ada_weights_are_missing(engine, db, tmp_path,
                                                           monkeypatch):
    from fastapi.testclient import TestClient

    from app import jobs
    from app.main import app

    monkeypatch.setattr(jobs, "requeue_stale", lambda: None)
    monkeypatch.setattr(settings, "building_backend", "ada")
    monkeypatch.setattr(settings, "landcover_backend", "ada")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    write_weights(tmp_path / "weights" / settings.ada_landcover_local, 7)
    with TestClient(app) as client:
        response = client.get("/health/ready")
    body = response.json()
    assert response.status_code == 200
    assert body["status"] == "degraded"
    assert body["weights_missing"] == [settings.ada_footprint_local]
    assert "convert_ada_checkpoint.py" in body["detail"]


# ---------------------------------------------------------------- fetch_weights

@pytest.fixture
def fetch_weights(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts" / "fetch_weights.py"
    if not path.is_file():
        pytest.skip("scripts/fetch_weights.py not present in this checkout")
    spec = importlib.util.spec_from_file_location("fetch_weights_under_test", path)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "WEIGHTS", tmp_path)
    monkeypatch.setattr(module, "MODELS",
                        [m for m in module.MODELS if m["kind"] == "local_only"])
    monkeypatch.setattr(settings, "data_dir", tmp_path.parent)
    return module


def test_absent_local_only_models_fail_check_only_when_selected(fetch_weights, monkeypatch):
    monkeypatch.setattr(settings, "building_backend", "changestar")
    monkeypatch.setattr(settings, "landcover_backend", "loveda")
    assert fetch_weights.check() == 0
    monkeypatch.setattr(settings, "building_backend", "ada")
    assert fetch_weights.check() == fetch_weights.LOCAL_ONLY_MISSING


def test_local_only_models_register_and_verify(fetch_weights, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "building_backend", "ada")
    monkeypatch.setattr(settings, "landcover_backend", "ada")
    red_logit(tmp_path / settings.ada_footprint_local)
    write_weights(tmp_path / settings.ada_landcover_local, 7)
    assert fetch_weights.register_local_only() == 0
    entries = {e["key"]: e for e in
               json.loads((tmp_path / "manifest.json").read_text())["models"]}
    assert entries["ada_footprint"]["local_only"] is True
    assert "ADA-owned weights" in entries["ada_landcover"]["license"]
    assert len(entries["ada_footprint"]["sha256"]) == 64
    assert fetch_weights.check() == 0
    (tmp_path / settings.ada_footprint_local / MODEL_FILE).write_bytes(b"tampered")
    assert fetch_weights.check() == fetch_weights.LOCAL_ONLY_MISSING


def test_a_missing_ada_model_names_the_converter_and_its_source(fetch_weights, monkeypatch,
                                                                capsys):
    monkeypatch.setattr(settings, "building_backend", "ada")
    monkeypatch.setattr(settings, "landcover_backend", "ada")
    assert fetch_weights.check() == fetch_weights.LOCAL_ONLY_MISSING
    out = capsys.readouterr().out
    assert "convert_ada_checkpoint.py" in out
    assert "/Volumes/Extreme SSD/ADA-Train/runs/footprint_v1/best.pt" in out
    assert "/Volumes/Extreme SSD/ADA-Train/runs/landcover7_v3/best.pt" in out


def test_a_downloadable_model_missing_still_asks_for_a_fetch(fetch_weights, monkeypatch):
    hf = {"key": "hf_thing", "kind": "hf_files", "local": "hf-thing", "repo": "x/y",
          "revision": "main", "files": [], "license": "MIT", "role": "test"}
    monkeypatch.setattr(fetch_weights, "MODELS", [*fetch_weights.MODELS, hf])
    monkeypatch.setattr(settings, "building_backend", "ada")
    assert fetch_weights.check() == 1


def test_a_full_fetch_keeps_absent_local_only_entries(fetch_weights, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "building_backend", "ada")
    red_logit(tmp_path / settings.ada_footprint_local)
    write_weights(tmp_path / settings.ada_landcover_local, 7)
    fetch_weights.register_local_only()
    before = json.loads((tmp_path / "manifest.json").read_text())["models"]
    for name in (settings.ada_footprint_local, settings.ada_landcover_local):
        (tmp_path / name / MODEL_FILE).unlink()
    monkeypatch.setattr(sys, "argv", ["fetch_weights.py"])
    assert fetch_weights.main() == 0
    after = json.loads((tmp_path / "manifest.json").read_text())["models"]
    assert after == before


def test_register_local_only_keeps_an_absent_models_entry(fetch_weights, tmp_path):
    red_logit(tmp_path / settings.ada_footprint_local)
    write_weights(tmp_path / settings.ada_landcover_local, 7)
    fetch_weights.register_local_only()
    (tmp_path / settings.ada_landcover_local / MODEL_FILE).unlink()
    fetch_weights.register_local_only()
    keys = [e["key"] for e in json.loads((tmp_path / "manifest.json").read_text())["models"]]
    assert keys == ["ada_footprint", "ada_landcover"]


def test_merge_prefers_fresh_entries_and_drops_absent_downloads(fetch_weights, monkeypatch):
    hf = {"key": "hf_thing", "kind": "hf_files"}
    monkeypatch.setattr(fetch_weights, "MODELS", [*fetch_weights.MODELS, hf])
    previous = {k: {"key": k, "v": "old"} for k in ("ada_footprint", "ada_landcover",
                                                    "hf_thing")}
    fresh = {"ada_footprint": {"key": "ada_footprint", "v": "new"}, "ada_landcover": None,
             "hf_thing": None}
    assert fetch_weights.merge_entries(fresh, previous) == [
        {"key": "ada_footprint", "v": "new"}, {"key": "ada_landcover", "v": "old"}]


# ---------------------------------------------------------------- real weights

REAL = ROOT_DIR / "data" / "weights"
HAVE_REAL = all((REAL / name / MODEL_FILE).is_file()
                for name in ("ada-footprint-v1", "ada-landcover7-v3"))


@pytest.mark.skipif(not HAVE_REAL, reason="converted ADA weights not in data/weights")
def test_real_weights_run_one_tile_on_this_device(monkeypatch):
    from app.ml import gpu

    monkeypatch.setattr(ada_backends, "_build", _REAL_BUILD)
    monkeypatch.setattr(settings, "ml_device", "auto")
    gpu.reset()
    try:
        x = chips(1, seed=5)
        seg = AdaFootprintBackend(REAL / "ada-footprint-v1").segment(x)
        assert seg.shape == (1, 384, 384) and 0.0 <= seg.min() <= seg.max() <= 1.0
        probs = AdaLandCoverBackend(REAL / "ada-landcover7-v3").probs(x)
        assert probs.shape == (1, 7, 384, 384)
        np.testing.assert_allclose(probs.sum(axis=1), 1.0, atol=1e-3)
    finally:
        gpu.free()
        gpu.reset()
