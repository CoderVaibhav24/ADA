"""Colour-index vegetation vs learned land-cover vegetation.

The index masks (NDVI on the CIR epoch, excess-green on the RGB epoch) disagree
so badly across the two sensors that their difference — `veg_loss`, the engine's
primary encroachment evidence — covered 8.5% of the whole scene. This measures
whether the LoveDA segmenter fixes that.

The headline metric is CONSISTENCY between epochs. Almost no real vegetation
vanishes between two epochs of the same neighbourhood, so a vegetation detector
that reads both epochs correctly should produce a small `veg_loss`. A large one
means the detector is really measuring the sensor, not the ground.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from PIL import Image

from app.services import preprocess
from app.services.ml import engine

T1 = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("../Test/satellite_final.tif")
T2 = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("../Test/drone_final.tif")
OUT = Path("data/masks/bench_vegetation")
OUT.mkdir(parents=True, exist_ok=True)

print(f"[1/3] superimpose {T1.name} + {T2.name} ...")
pair = preprocess.superimpose(T1, T2)
print(f"      grid {pair.t1.shape}  CIR-corrected {pair.cir_corrected}")

print("[2/3] learned land-cover (SegFormer-B5 / LoveDA) ...")
lc1 = engine.landcover_probs(pair.t1, pair.valid)
lc2 = engine.landcover_probs(pair.t2, pair.valid)
from app.services.ml.landcover import LABELS, VEGETATION_CLASSES

nv1 = engine.vegetation_mask.__wrapped__ if False else None
v1 = (lc1[list(VEGETATION_CLASSES)].sum(0) >= 0.5) & pair.valid
v2 = (lc2[list(VEGETATION_CLASSES)].sum(0) >= 0.5) & pair.valid

print("\n[3/3] ==================== VERDICT ====================")
print(f"  {'method':<22} {'T1 veg':>8} {'T2 veg':>8} {'veg_loss':>9} {'IoU(T1,T2)':>11}")


def row(label, a, b):
    inter, union = float((a & b).sum()), float((a | b).sum())
    print(f"  {label:<22} {a.mean() * 100:7.2f}% {b.mean() * 100:7.2f}% "
          f"{(a & ~b).mean() * 100:8.2f}% {(inter / union if union else 0):11.3f}")


row("colour index (old)", pair.veg1, pair.veg2)
row("learned LoveDA (new)", v1, v2)

print("\n  per-class cover on each epoch (learned):")
print(f"  {'class':<14} {'T1':>8} {'T2':>8}")
for i, name in LABELS.items():
    print(f"  {name:<14} {(lc1[i] >= 0.5).mean() * 100:7.2f}% {(lc2[i] >= 0.5).mean() * 100:7.2f}%")

box = (700, 900, 1400, 1600)


def ov(img, m, c):
    o = img.copy()
    o[m] = (0.4 * o[m] + np.array(c) * 0.6).astype(np.uint8)
    return Image.fromarray(o).crop(box).resize((340, 340))


sheet = Image.new("RGB", (340 * 3, 340 * 2))
for r, (img, old, new) in enumerate([(pair.t1, pair.veg1, v1), (pair.t2, pair.veg2, v2)]):
    sheet.paste(Image.fromarray(img).crop(box).resize((340, 340)), (0, 340 * r))
    sheet.paste(ov(img, old, [255, 0, 0]), (340, 340 * r))
    sheet.paste(ov(img, new, [0, 255, 0]), (680, 340 * r))
sheet.save(OUT / "veg_compare.png")
print(f"\n  wrote {OUT / 'veg_compare.png'}")
print("  rows: T1 / T2   cols: raw | colour-index (red) | learned (green)")
print("DONE")
