"""Measure the pipeline's current output, and prove the COG change costs nothing.

Two questions, one run:

1. WHAT IS THE PIPELINE PRODUCING NOW? There is no ground-truth annotation for
   Agra, so "accuracy" cannot be a single percentage without inventing one.
   What CAN be measured, and is what actually decides whether the output is
   trustworthy, is reported below:
     * seg_trust IoU — BEFORE/AFTER footprint agreement. Most buildings persist
       between two epochs, so a segmenter reading both epochs correctly scores
       high. This was 0.112 with the old U-Net (below the 0.35 gate, so the
       BEFORE epoch was discarded entirely) and 0.554 with ChangeStar.
     * candidates -> reported, with the rejection reasons.
     * change types, and the confidence distribution.

2. DID READING THE COG INSTEAD OF THE ORIGINAL CHANGE THE ANSWER? Run the whole
   pipeline both ways and compare detections directly. This is a genuine A/B:
   same models, same thresholds, only the source file differs. If detection IoU
   is ~1.0 and the counts match, the speedup is free.

Usage (needs COGs; it will build them if missing):
    python scripts/bench_accuracy.py [T1.tif] [T2.tif]
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from app.config import settings
from app.services import preprocess
from app.services.ml import engine
from app.services.ml.landcover import VEGETATION_CLASSES

T1 = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("../Test/satellite_final.tif")
T2 = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("../Test/drone_final.tif")
OUT = Path("data/masks/bench_accuracy")
OUT.mkdir(parents=True, exist_ok=True)


def ensure_cog(src: Path) -> Path:
    cog = OUT / f"cog_{src.stem}.tif"
    if not cog.is_file():
        print(f"  building COG for {src.name} ...", flush=True)
        preprocess.ingest_raster(src, cog)
    return cog


def run(label: str, cog1, cog2) -> dict:
    t0 = time.time()
    pair = preprocess.superimpose(T1, T2, cog1, cog2)
    t_super = time.time() - t0

    b1 = engine.segment_scene(pair.t1, pair.valid)
    b2 = engine.segment_scene(pair.t2, pair.valid)
    if settings.release_models_between_stages:
        engine.release_seg_backend()

    veg1, veg2 = pair.veg1, pair.veg2
    lc1 = lc2 = None
    if settings.vegetation_mode == "learned":
        lc1 = engine.landcover_probs(pair.t1, pair.valid)
        lc2 = engine.landcover_probs(pair.t2, pair.valid)
        thr = settings.vegetation_threshold
        veg1 = (lc1[list(VEGETATION_CLASSES)].sum(0) >= thr) & pair.valid
        veg2 = (lc2[list(VEGETATION_CLASSES)].sum(0) >= thr) & pair.valid
        if settings.release_models_between_stages:
            engine.release_landcover()

    prob, insts, diag, _ids = engine.analyse_instances(
        b1, b2, pair.valid, pair.t1, pair.t2, veg1, veg2, lc1, lc2,
        pair.resolution_m)
    total = time.time() - t0

    print(f"\n--- {label}")
    print(f"    superimpose      : {t_super:7.1f}s   grid {pair.t1.shape[:2]} "
          f"@ {pair.resolution_m:.3f} m/px, shift {pair.shift_px}")
    print(f"    total pipeline   : {total:7.1f}s")
    print(f"    seg_trust IoU    : {diag['seg_trust']:.3f}   "
          f"(gate {settings.seg_agreement_min_iou} -> BEFORE epoch "
          f"{'TRUSTED' if diag['seg_trust'] >= settings.seg_agreement_min_iou else 'DISCARDED'})")
    print(f"    candidates       : {diag['candidates']}")
    print(f"    reported         : {diag['kept']}  {diag['by_type']}")
    print(f"    decider          : {diag['decider']}")
    area = float((prob > 0).sum()) * pair.resolution_m ** 2
    print(f"    flagged area     : {area:,.0f} m2 "
          f"({100 * float((prob > 0).mean()):.2f}% of grid)")
    if insts:
        conf = np.array([i.confidence for i in insts if i.confidence > 0])
        if conf.size:
            print(f"    confidence       : min {conf.min():.2f}  "
                  f"median {np.median(conf):.2f}  max {conf.max():.2f}")
    return {"prob": prob, "diag": diag, "insts": insts, "time": total,
            "t_super": t_super, "pair": pair}


print(f"[1/3] preparing COGs for {T1.name} / {T2.name} ...")
c1, c2 = ensure_cog(T1), ensure_cog(T2)
print(f"  original {T1.stat().st_size / 1e6:8.1f} MB -> COG {c1.stat().st_size / 1e6:7.1f} MB")
print(f"  original {T2.stat().st_size / 1e6:8.1f} MB -> COG {c2.stat().st_size / 1e6:7.1f} MB")

print("\n[2/3] running pipeline from ORIGINALS (baseline) ...")
base = run("FROM ORIGINALS (raw bands)", None, None)

print("\n[3/3] running pipeline from COGs ...")
fast = run("FROM COGs (overviews)", c1, c2)

# --- A/B comparison ---------------------------------------------------------
a = base["prob"] >= settings.change_threshold
b = fast["prob"] >= settings.change_threshold
inter, union = float((a & b).sum()), float((a | b).sum())
det_iou = inter / union if union else 1.0

print("\n" + "=" * 62)
print("ACCURACY A/B — originals vs COGs")
print("=" * 62)
print(f"  seg_trust IoU      {base['diag']['seg_trust']:.3f}  ->  {fast['diag']['seg_trust']:.3f}")
print(f"  candidates         {base['diag']['candidates']:5d}  ->  {fast['diag']['candidates']:5d}")
print(f"  reported           {base['diag']['kept']:5d}  ->  {fast['diag']['kept']:5d}")
print(f"  by type            {base['diag']['by_type']}  ->  {fast['diag']['by_type']}")
print(f"  DETECTION MASK IoU {det_iou:.3f}   "
      f"(1.000 = identical output; this is the no-accuracy-loss test)")
print(f"  superimpose speed  {base['t_super']:.1f}s  ->  {fast['t_super']:.1f}s "
      f"({base['t_super'] / max(fast['t_super'], 1e-6):.1f}x faster)")
print(f"  total pipeline     {base['time']:.1f}s  ->  {fast['time']:.1f}s")

verdict = ("NO ACCURACY LOSS" if det_iou >= 0.95 else
           "MINOR DRIFT — inspect" if det_iou >= 0.85 else
           "ACCURACY CHANGED — do not ship")
print(f"\n  VERDICT: {verdict}")

from PIL import Image

for tag, r in [("originals", base), ("cogs", fast)]:
    ov = r["pair"].t2.copy()
    m = r["prob"] > 0
    ov[m] = (0.35 * ov[m] + np.array([0.65 * 255, 0, 0])).astype(np.uint8)
    Image.fromarray(ov).save(OUT / f"detections_{tag}.png")
print(f"  overlays -> {OUT}")
