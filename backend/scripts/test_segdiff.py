"""Standalone smoke test for the building seg-diff engine.

Runs superimpose -> segment both epochs -> diff on two uploaded rasters and
writes PNG visualizations to data/masks/segdiff_debug/ so we can eyeball
whether the segmenter actually finds buildings on the Agra imagery.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from PIL import Image

from app.services import preprocess
from app.services.ml import engine

T1 = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/uploads/raster_42.tif")
T2 = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/uploads/raster_43.tif")
OUT = Path("data/masks/segdiff_debug")
OUT.mkdir(parents=True, exist_ok=True)


def save(name, arr):
    Image.fromarray(arr).save(OUT / name)
    print("  wrote", OUT / name)


print(f"[1/4] superimpose {T1.name} + {T2.name} ...")
pair = preprocess.superimpose(T1, T2)
print(f"      grid {pair.t1.shape}  res {pair.resolution_m:.3f} m  "
      f"shift {pair.shift_px}  valid {pair.valid.mean()*100:.0f}%")
save("00_t1.png", pair.t1)
save("00_t2.png", pair.t2)

print("[2/4] segment T1 (before) ...")
b1 = engine.segment_scene(pair.t1, pair.valid)
print("[3/4] segment T2 (after) ...")
b2 = engine.segment_scene(pair.t2, pair.valid)
print(f"      building cover  T1={ (b1>=0.5).mean()*100:.1f}%   "
      f"T2={ (b2>=0.5).mean()*100:.1f}%")
save("01_b1_footprints.png", (b1 * 255).astype(np.uint8))
save("02_b2_footprints.png", (b2 * 255).astype(np.uint8))

from app.config import settings
print(f"[4/4] diff -> new construction "
      f"(hybrid gate = {settings.change_gate_mode}) ...")
gate = engine._change_gate(pair.t1, pair.t2, pair.valid)
save("04_change_gate.png", (gate * 255).astype(np.uint8))
if pair.veg1 is not None:
    save("05_veg1.png", (pair.veg1 * 255).astype(np.uint8))
prob = engine.building_change_prob(b1, b2, pair.valid, pair.t1, pair.t2,
                                   pair.veg1, pair.veg2)
if settings.sam_refine:
    print("      refining full structures with SAM2 ...")
    prob = engine.refine_full_structures(prob, pair.t2, pair.valid)
new_px = (prob > 0).sum()
print(f"      new-building pixels: {new_px}  "
      f"(~{new_px * pair.resolution_m**2:.0f} m2)")

# Overlay new-construction in red on the T2 image
overlay = pair.t2.copy()
new = prob > 0
overlay[new] = (0.35 * overlay[new] + np.array([0.65 * 255, 0, 0])).astype(np.uint8)
save("03_new_construction_overlay.png", overlay)
print("DONE")
