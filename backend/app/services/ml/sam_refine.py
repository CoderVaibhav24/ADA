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

import contextlib
import logging

import numpy as np
from scipy import ndimage

from ...config import settings
from . import gpu

_refiner = None


def _half(torch, device: str):
    """Autocast the forward pass to fp16 on the GPU, a no-op on the CPU.

    Autocast rather than half weights: the processor resizes every crop to
    1024x1024, so it is the ACTIVATIONS that dominate SAM's footprint, and
    those are what autocast halves. It also leaves the normalisations and the
    mask decoder's accumulations in fp32, which converting the weights outright
    would not — and a mask decoder that quietly returns NaN produces an empty
    refinement rather than an error, so it would fail silently.
    """
    if device != "cuda":
        return contextlib.nullcontext()
    return torch.autocast("cuda", dtype=torch.float16)


def get_refiner():
    global _refiner
    if _refiner is None:
        if settings.sam_backend == "sam3":
            _refiner = Sam3Refiner(settings.sam3_model_repo)
        else:
            _refiner = Sam2Refiner(settings.sam_model_repo)
    return _refiner


class _BoxRefiner:
    """Shared box-prompt refinement loop; subclasses supply `_segment_box`.

    A note on why every prompt here is a BOX and never text, even though SAM 3
    accepts text: SAM 3's text encoder was aligned on ground-level internet
    imagery, and on overhead imagery that alignment does not hold. Measured on
    remote-sensing benchmarks, text prompts score 11.7 mAP against 66.6 for
    visual/box prompts on DIOR — and function words like "school" or "church"
    score near zero, because those categories are simply not visible from nadir.
    The seg-diff stage already knows WHERE each structure is, so a box is both
    the stronger prompt and the one we can actually produce.
    """

    def refine(self, seed: np.ndarray, t2: np.ndarray,
               valid: np.ndarray) -> np.ndarray:
        """seed = boolean 'new building' detection (may be fragmented).
        Returns a boolean mask where every seeded structure is filled out to
        its FULL footprint. Falls back to the seed's own connected component if
        the model yields nothing sensible."""
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
            # pad the seed bbox so the model sees the whole building, not just
            # the flagged fragment
            pad = settings.sam_box_pad_px
            y0, y1 = max(0, ys.start - pad), min(H, ys.stop + pad)
            x0, x1 = max(0, xs.start - pad), min(W, xs.stop + pad)
            crop = t2[y0:y1, x0:x1]
            if crop.shape[0] < 8 or crop.shape[1] < 8:
                out[sl][comp] = True
                continue
            box = [float(xs.start - x0), float(ys.start - y0),
                   float(xs.stop - x0), float(ys.stop - y0)]
            try:
                m = self._segment_box(crop, box)
            except Exception:
                logging.getLogger("ada.ml").warning(
                    "%s failed on one detection, keeping its footprint",
                    type(self).__name__, exc_info=True)
                m = None

            seed_full = np.zeros((H, W), bool)
            seed_full[sl] = comp

            if m is None or not m.any():
                out |= seed_full
                continue

            cand = np.zeros((H, W), bool)
            cand[y0:y1, x0:x1] = m

            # A box prompt can latch onto the courtyard, the whole block, or the
            # neighbouring roof. Accept the mask only when it is a plausible
            # completion: it must cover the detection and must not balloon.
            covered = float((cand & seed_full).sum()) / max(seed_full.sum(), 1)
            growth = float(cand.sum()) / max(seed_full.sum(), 1)
            if covered >= 0.5 and growth <= settings.sam_max_growth:
                out |= cand | seed_full     # union: never lose detected area
            else:
                out |= seed_full
        out &= valid
        return out


class Sam2Refiner(_BoxRefiner):
    def __init__(self, repo: str) -> None:
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
        self.device = gpu.device()
        self.proc = Sam2Processor.from_pretrained(src)
        self.model = Sam2Model.from_pretrained(src).to(self.device).eval()
        self.name = f"SAM2 refine ({repo}, {self.device}, {source})"

    def _segment_box(self, crop: np.ndarray, box: list[float]) -> np.ndarray:
        """Return SAM2's best mask for the object in `box` (crop coords)."""
        torch = self.torch
        inp = self.proc(images=crop, input_boxes=[[box]],
                        return_tensors="pt").to(self.device)
        with torch.inference_mode(), _half(torch, self.device):
            out = self.model(**inp, multimask_output=True)
        masks = self.proc.post_process_masks(
            out.pred_masks, inp["original_sizes"])[0]      # (n_box, 3, H, W)
        iou = out.iou_scores[0]                             # (n_box, 3)
        best = int(iou[0].argmax())
        return masks[0, best].cpu().numpy().astype(bool)


class Sam3Refiner(_BoxRefiner):
    """SAM 3 with a positive box prompt.

    Same contract as Sam2Refiner, different API: SAM 3 is a detector as well as
    a segmenter, so it returns a variable-length set of instances scored by
    confidence rather than a fixed 3-way multimask. We take the highest-scoring
    instance, which for a tightly-drawn box around one structure is that
    structure.
    """

    def __init__(self, repo: str) -> None:
        import torch
        from transformers import Sam3Model, Sam3Processor

        local = settings.local_model(settings.sam3_model_local)
        if local is not None:
            src, source = str(local), "local"
        else:
            logging.getLogger("ada.ml").warning(
                "SAM3 weights not vendored in data/weights — falling back to "
                "the HuggingFace cache. Run scripts/fetch_weights.py to vendor "
                "them. Note facebook/sam3 is a GATED repo: request access on "
                "the model page and `huggingface-cli login` first.")
            src, source = repo, "hub cache"

        self.torch = torch
        self.device = gpu.device()
        self.proc = Sam3Processor.from_pretrained(src)
        self.model = Sam3Model.from_pretrained(src).to(self.device).eval()
        self.name = f"SAM3 refine ({repo}, {self.device}, {source})"

    def _segment_box(self, crop: np.ndarray, box: list[float]) -> np.ndarray:
        torch = self.torch
        inp = self.proc(images=crop, input_boxes=[[box]],
                        input_boxes_labels=[[1]],       # 1 = positive prompt
                        return_tensors="pt").to(self.device)
        with torch.inference_mode(), _half(torch, self.device):
            out = self.model(**inp)
        res = self.proc.post_process_instance_segmentation(
            out, threshold=0.5, mask_threshold=0.5,
            target_sizes=inp.get("original_sizes").tolist())[0]
        masks, scores = res["masks"], res["scores"]
        if len(masks) == 0:
            return np.zeros(crop.shape[:2], bool)
        best = int(np.asarray(scores).argmax())
        m = masks[best]
        m = m.cpu().numpy() if hasattr(m, "cpu") else np.asarray(m)
        return m.astype(bool)
