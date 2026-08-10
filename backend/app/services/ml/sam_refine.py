"""SAM2 full-structure refinement.

The seg-diff stage says WHERE a new building is (often only partially — the
footprint segmenter fragments dark/shadowed roofs). SAM2 (a foundation
segmentation model) then segments the ENTIRE structure at each detection from
the AFTER image, robust to off-nadir angle, shadow and low light. We highlight
the whole SAM2 mask, so a building is shown as one complete structure rather
than a patchwork.

Runs on GPU when available (~0.5 GB VRAM for hiera-small). Lazily loaded so the
model is only pulled/instantiated the first time an analysis needs it.
"""

from __future__ import annotations

import logging

import numpy as np
from scipy import ndimage

from ...config import settings

_refiner = None


def get_refiner():
    global _refiner
    if _refiner is None:
        _refiner = Sam2Refiner(settings.sam_model_repo)
    return _refiner


class Sam2Refiner:
    def __init__(self, repo: str) -> None:
        import logging

        import torch
        from transformers import Sam2Model, Sam2Processor

        local = settings.local_model(settings.sam_model_local)
        if local is not None:
            src, source = str(local), "local"
        else:
            logging.getLogger("ada.ml").warning(
                "SAM2 weights not vendored in data/weights — falling back to "
                "the HuggingFace cache. Run scripts/fetch_weights.py to vendor "
                "them.")
            src, source = repo, "hub cache"

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.proc = Sam2Processor.from_pretrained(src)
        self.model = Sam2Model.from_pretrained(src).to(self.device).eval()
        self.name = f"SAM2 refine ({repo}, {self.device}, {source})"

    def _segment_box(self, crop: np.ndarray, box: list[float]) -> np.ndarray:
        """Return SAM2's best mask for the object in `box` (crop coords)."""
        torch = self.torch
        inp = self.proc(images=crop, input_boxes=[[box]],
                        return_tensors="pt").to(self.device)
        with torch.inference_mode():
            out = self.model(**inp, multimask_output=True)
        masks = self.proc.post_process_masks(
            out.pred_masks, inp["original_sizes"])[0]      # (n_box, 3, H, W)
        iou = out.iou_scores[0]                             # (n_box, 3)
        best = int(iou[0].argmax())
        return masks[0, best].cpu().numpy().astype(bool)

    def refine(self, seed: np.ndarray, t2: np.ndarray,
               valid: np.ndarray) -> np.ndarray:
        """seed = boolean 'new building' detection (may be fragmented).
        Returns a boolean mask where every seeded structure is filled out to
        its FULL footprint via SAM2. Falls back to the seed's own connected
        component if SAM2 yields nothing sensible."""
        H, W = seed.shape
        lbl, n = ndimage.label(seed)
        if n == 0:
            return seed
        out = np.zeros((H, W), bool)
        objs = ndimage.find_objects(lbl)
        min_seed = max(20, settings.sam_min_seed_px)
        for i, sl in enumerate(objs, start=1):
            if sl is None:
                continue
            comp = lbl[sl] == i
            if comp.sum() < min_seed:
                continue
            ys, xs = sl
            # pad the seed bbox so SAM2 sees the whole building, not just the
            # flagged fragment
            pad = settings.sam_box_pad_px
            y0, y1 = max(0, ys.start - pad), min(H, ys.stop + pad)
            x0, x1 = max(0, xs.start - pad), min(W, xs.stop + pad)
            crop = t2[y0:y1, x0:x1]
            if crop.shape[0] < 8 or crop.shape[1] < 8:
                out[sl][comp] = True
                continue
            # box prompt = seeded structure's bbox in crop coordinates
            box = [float(xs.start - x0), float(ys.start - y0),
                   float(xs.stop - x0), float(ys.stop - y0)]
            try:
                m = self._segment_box(crop, box)
            except Exception:
                logging.getLogger("ada.ml").warning(
                    "SAM2 failed on one detection, keeping its footprint",
                    exc_info=True)
                m = None

            seed_full = np.zeros((H, W), bool)
            seed_full[sl] = comp

            if m is None or not m.any():
                out |= seed_full
                continue

            cand = np.zeros((H, W), bool)
            cand[y0:y1, x0:x1] = m

            # SAM2 is prompted with a box, so it can latch onto the courtyard,
            # the whole block, or the neighbouring roof. Accept its mask only
            # when it is a plausible completion of the structure we detected:
            # it must actually cover the detection, and it must not balloon
            # into the surroundings.
            covered = float((cand & seed_full).sum()) / max(seed_full.sum(), 1)
            growth = float(cand.sum()) / max(seed_full.sum(), 1)
            if covered >= 0.5 and growth <= settings.sam_max_growth:
                out |= cand | seed_full     # union: never lose detected area
            else:
                out |= seed_full
        out &= valid
        return out
