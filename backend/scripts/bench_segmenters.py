"""Head-to-head benchmark: geobase U-Net (256 px) vs ChangeStar ViT-B (1024 px).

The seg-diff engine's accuracy is capped by how well the building segmenter
reads BOTH epochs. On the Agra satellite/drone pair the BEFORE/AFTER footprint
agreement collapsed to IoU 0.114 — below `seg_agreement_min_iou`, so the engine
stopped trusting the BEFORE segmentation entirely and fell back to judging
change from vegetation evidence alone. That is the real accuracy ceiling, not
the SAM refiner.

This script runs both segmenters over the same aligned pair and reports the
metrics that decide whether the swap is worth it:

  * building coverage per epoch — a segmenter hallucinating canopy as building
    shows up as implausibly high cover on the CIR epoch;
  * BEFORE/AFTER IoU — the `trust_before` gate. Most structures persist between
    two epochs, so a competent segmenter that reads both epochs consistently
    should score high here. This is the headline number;
  * agreement between the two MODELS on the same epoch, which separates "they
    disagree because one is wrong" from "they disagree everywhere".

Usage:
    python scripts/bench_segmenters.py [T1.tif] [T2.tif]
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from PIL import Image

from app.config import settings
from app.services import preprocess
from app.services.ml import backends, engine

T1 = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("../Test/satellite_final.tif")
T2 = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("../Test/drone_final.tif")
OUT = Path("data/masks/bench_segmenters")
OUT.mkdir(parents=True, exist_ok=True)


def iou(a: np.ndarray, b: np.ndarray) -> float:
    union = float((a | b).sum())
    return float((a & b).sum()) / union if union else 0.0


def run(backend, img, valid, label):
    """Tile one epoch through a specific backend, bypassing the module cache."""
    engine._seg_backend = backend
    t = time.time()
    prob = engine.segment_scene(img, valid)
    dt = time.time() - t
    print(f"      {label}: {dt:6.1f}s  cover={float((prob >= 0.5).mean()) * 100:5.2f}%")
    return prob, dt


print(f"[1/4] superimpose {T1.name} + {T2.name} ...")
pair = preprocess.superimpose(T1, T2)
print(f"      grid {pair.t1.shape}  res {pair.resolution_m:.3f} m/px  "
      f"shift {pair.shift_px}  valid {pair.valid.mean() * 100:.0f}%  "
      f"CIR-corrected {pair.cir_corrected}")
Image.fromarray(pair.t1).save(OUT / "00_t1.png")
Image.fromarray(pair.t2).save(OUT / "00_t2.png")

results = {}
for key, backend in [
    ("geobase", backends.BuildingSegBackend(settings.building_model_repo,
                                            settings.building_model_file)),
    ("changestar", backends.ChangeStarSegBackend(settings.changestar_model_repo,
                                                 settings.changestar_model_file)),
]:
    print(f"[2/4] {key}: {backend.name}")
    print(f"      tile={backend.tile_size} batch={backend.batch_size}")
    b1, dt1 = run(backend, pair.t1, pair.valid, "T1 (satellite/before)")
    b2, dt2 = run(backend, pair.t2, pair.valid, "T2 (drone/after)")
    results[key] = (b1, b2, dt1 + dt2)
    Image.fromarray((b1 * 255).astype(np.uint8)).save(OUT / f"01_{key}_b1.png")
    Image.fromarray((b2 * 255).astype(np.uint8)).save(OUT / f"02_{key}_b2.png")

print("\n[3/4] ==================== VERDICT ====================")
thr = settings.building_threshold
print(f"  {'model':<12} {'T1 cover':>9} {'T2 cover':>9} {'BEFORE/AFTER IoU':>17} {'trusted':>8} {'secs':>7}")
for key, (b1, b2, dt) in results.items():
    m1, m2 = b1 >= thr, (b2 >= thr) & pair.valid
    j = iou(m1, m2)
    print(f"  {key:<12} {m1.mean() * 100:8.2f}% {m2.mean() * 100:8.2f}% "
          f"{j:17.3f} {str(j >= settings.seg_agreement_min_iou):>8} {dt:6.1f}s")

gb1, gb2, _ = results["geobase"]
cb1, cb2, _ = results["changestar"]
print(f"\n  cross-model agreement on T1: IoU {iou(gb1 >= thr, cb1 >= thr):.3f}")
print(f"  cross-model agreement on T2: IoU {iou(gb2 >= thr, cb2 >= thr):.3f}")
print(f"  (seg_agreement_min_iou = {settings.seg_agreement_min_iou} — below this "
      f"the engine discards the BEFORE segmentation)")

print("\n[4/4] writing side-by-side overlays ...")
for key, (b1, b2, _) in results.items():
    for epoch, (img, b) in {"t1": (pair.t1, b1), "t2": (pair.t2, b2)}.items():
        ov = img.copy()
        m = b >= thr
        ov[m] = (0.45 * ov[m] + np.array([0, 0.55 * 255, 0])).astype(np.uint8)
        Image.fromarray(ov).save(OUT / f"03_{key}_{epoch}_overlay.png")
print(f"      wrote overlays to {OUT}")
print("DONE")
