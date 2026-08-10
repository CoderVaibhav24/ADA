"""Build a realistic, validated before/after demo pair from ONE real image.

Takes a real drone/satellite orthophoto as the AFTER epoch, then digitally
removes a handful of real buildings (inpaint back to ground) to synthesize a
BEFORE epoch. Same sensor -> no cross-sensor gap -> change detection should
light up EXACTLY the removed buildings. Ground-truth footprints are printed so
detection can be scored. Both outputs keep the source geo-referencing.

Usage:
  python scripts/make_demo_pair.py C:/Vaibhav/ADA/data/uploads/raster_43.tif
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2
import numpy as np
import rasterio
from scipy import ndimage

from app.services.ml import engine

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "C:/Vaibhav/ADA/data/uploads/raster_43.tif")
N_PLANT = int(sys.argv[2]) if len(sys.argv) > 2 else 6
OUT_DIR = SRC.parent
AFTER = OUT_DIR / "demo_after.tif"
BEFORE = OUT_DIR / "demo_before.tif"

print(f"Reading {SRC.name} ...")
with rasterio.open(SRC) as src:
    profile = src.profile
    idx = [1, 2, 3] if src.count >= 3 else [1, 1, 1]
    raw = src.read(idx).transpose(1, 2, 0)
    if raw.dtype != np.uint8:                       # 16-bit drone -> stretch
        out = np.zeros(raw.shape, np.uint8)
        m = raw.sum(axis=2) > 0
        for c in range(3):
            band = raw[..., c].astype(np.float32)
            lo, hi = np.percentile(band[m], (2, 98)) if m.any() else (0, 1)
            out[..., c] = np.clip((band - lo) / max(hi - lo, 1), 0, 1) * 255
        raw = out
    rgb = np.ascontiguousarray(raw, dtype=np.uint8)  # (H,W,3) uint8
    transform, crs = src.transform, src.crs
H, W = rgb.shape[:2]
valid = rgb.sum(axis=2) > 0
print(f"  {W}x{H}  crs={crs}")

print("Segmenting buildings to choose realistic removal targets ...")
b = engine.segment_scene(rgb, valid)
lbl, n = ndimage.label(b >= 0.6)
sizes = ndimage.sum(np.ones_like(lbl), lbl, index=np.arange(1, n + 1))
# medium, well-formed footprints (200..2500 px ~ 50..625 m2 @0.5m), spread out
cand = [i + 1 for i, s in enumerate(sizes) if 200 <= s <= 2500]
coms = ndimage.center_of_mass(np.ones_like(lbl), lbl, index=cand)
picked, used = [], []
for cid, (cy, cx) in sorted(zip(cand, coms), key=lambda t: -sizes[t[0] - 1]):
    if all((cy - uy) ** 2 + (cx - ux) ** 2 > (0.12 * max(H, W)) ** 2
           for uy, ux in used):
        picked.append(cid); used.append((cy, cx))
    if len(picked) >= N_PLANT:
        break

remove = np.isin(lbl, picked)
remove = ndimage.binary_dilation(remove, iterations=2)   # cover roof edges
print(f"  removing {len(picked)} buildings to synthesize the BEFORE epoch")

print("Inpainting removed buildings back to ground ...")
mask = (remove & valid).astype(np.uint8) * 255
before = cv2.inpaint(rgb, mask, inpaintRadius=6, flags=cv2.INPAINT_TELEA)
before[~valid] = 0

prof = dict(profile); prof.update(count=3, dtype="uint8", nodata=0)
for path, arr in ((AFTER, rgb), (BEFORE, before)):
    with rasterio.open(path, "w", **prof) as dst:
        dst.write(arr.transpose(2, 0, 1))
    print("  wrote", path)

res = abs(transform.a) * (111_320 if crs.is_geographic else 1)
gt_area = float(remove.sum()) * res * res
print(f"\nGROUND TRUTH: {len(picked)} new buildings, ~{gt_area:.0f} m2 total")
print(f"Now run:\n  python scripts/test_segdiff.py {BEFORE} {AFTER}")
