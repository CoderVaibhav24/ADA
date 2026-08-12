"""Learned land-cover segmentation — vegetation without a colour rule.

Why this replaces the index maths in preprocess._vegetation_mask_raw:

NDVI and excess-green both assume vegetation announces itself by CHANNEL RATIO.
That assumption breaks the moment the two epochs are not the same kind of
picture. On the Agra pair it broke badly in both directions — NDVI marked 14.8%
of the satellite epoch as vegetation, painting whole rooftops and courtyards
green, while excess-green marked 9.1% of the drone epoch and bled across roofs
and shadow. Their difference (`veg_loss`) came out at 8.5% of the entire scene,
which the engine was then treating as "green space that disappeared" — a very
large false-encroachment source.

The failure is structural, not a threshold that needs tuning. Vegetation renders
green in true colour, red in colour-infrared, brown when dry, and near-black in
shadow; a rule keyed on colour has to be re-tuned per sensor, per season, per
time of day, and is wrong the rest of the time.

A semantic segmenter recognises vegetation the way a person does — by texture,
shape and context (canopy is blobby and irregular, fields are large and flat,
roofs are polygonal and abut streets) — so the answer no longer depends on how
the sensor happened to encode the colour.

Model: SegFormer-B5 fine-tuned on LoveDA (0.3 m/px urban+rural remote sensing,
7 classes). Chosen over the Chesapeake/NAIP alternatives because LoveDA's domain
— dense low-rise Asian settlement mixed with fields — is much closer to Agra
than US suburbia, and B5 is the largest variant in the family.
"""

from __future__ import annotations

import logging

import numpy as np

from ...config import settings

log = logging.getLogger("ada.ml")

_backend = None

# LoveDA label map (from the checkpoint's config.json).
LABELS = {0: "background", 1: "building", 2: "road", 3: "water",
          4: "barren", 5: "forest", 6: "agriculture"}
VEGETATION_CLASSES = (5, 6)      # forest + agriculture
BUILDING_CLASS = 1
# Surfaces that are already developed or undevelopable. Everything else is
# OPEN LAND — see open_land() for why that, not vegetation, is the signal the
# encroachment logic actually wants.
BUILT_CLASSES = (1, 2, 3)        # building + road + water


def open_land(probs: np.ndarray) -> np.ndarray:
    """(C, H, W) class probabilities -> (H, W) probability of undeveloped land.

    Vegetation turned out to be the wrong question. Measuring it on the Agra
    pair, the same open plots read as `agriculture` on the satellite epoch and
    as nothing at all on the drone epoch (5.94% -> 2.58%): they had simply dried
    from green to brown between the two dates. Any detector keyed on the plant
    itself — colour index or learned vegetation class — inherits that seasonal
    swing and reports it as vegetation LOSS, which the engine then reads as
    encroachment. Brown grass in March is not a demolished park.

    So ask the question that is actually stable: is this land BUILT ON? Roofs,
    roads and water are what they are in every season and under every sensor,
    and their complement is land that could be developed. Encroachment then
    means open land in T1 that carries a building in T2 — which holds whether
    the plot was green, brown, ploughed or bare.
    """
    return 1.0 - probs[list(BUILT_CLASSES)].sum(axis=0)


def get_backend():
    global _backend
    if _backend is None:
        _backend = LandCoverBackend(settings.landcover_model_repo)
    return _backend


class LandCoverBackend:
    """SegFormer-B5 / LoveDA. RGB in, per-class probability out."""

    tile_size = 512
    batch_size = 2      # small: VRAM is shared with ChangeStar and SAM

    def __init__(self, repo: str) -> None:
        import torch
        from transformers import SegformerForSemanticSegmentation

        from . import gpu

        local = settings.local_model(settings.landcover_model_local)
        if local is not None:
            src, source = str(local), "local"
        else:
            log.warning("land-cover model not vendored in data/weights — "
                        "falling back to the HuggingFace cache. Run "
                        "scripts/fetch_weights.py to vendor it.")
            src, source = repo, "hub cache"

        self.torch = torch
        # gpu.device() also installs the process-wide VRAM cap on first use, so
        # this model cannot grow past the budget however large the scene is.
        self.device = gpu.device()
        # fp16 on GPU: halves the weights and activations so this coexists with
        # ChangeStar and SAM inside a laptop's VRAM budget.
        self.dtype = gpu.dtype(self.device)
        self.model = SegformerForSemanticSegmentation.from_pretrained(
            src, torch_dtype=self.dtype).to(self.device).eval()
        self.name = f"landcover (SegFormer-B5 LoveDA: {repo}, {self.device}, {source})"
        log.info("loaded %s", self.name)

    @property
    def _mean_std(self):
        t = self.torch
        mean = t.tensor([0.485, 0.456, 0.406], device=self.device,
                        dtype=self.dtype).view(1, 3, 1, 1)
        std = t.tensor([0.229, 0.224, 0.225], device=self.device,
                       dtype=self.dtype).view(1, 3, 1, 1)
        return mean, std

    def probs(self, chips: np.ndarray) -> np.ndarray:
        """(N, H, W, 3) uint8 -> (N, n_classes, H, W) float32 class probability.

        The upsample-and-softmax runs on the GPU deliberately: done host-side it
        would move (N, C, 128, 128) logits across and then expand them 16x in
        host RAM, where the same expansion in VRAM is free and the transfer is
        of the finished result.
        """
        t = self.torch
        h, w = chips.shape[1:3]
        x = t.from_numpy(chips).to(self.device).permute(0, 3, 1, 2).to(self.dtype) / 255.0
        mean, std = self._mean_std
        x = (x - mean) / std
        with t.inference_mode():
            logits = self.model(pixel_values=x).logits      # (N, C, h/4, w/4)
            logits = t.nn.functional.interpolate(
                logits.float(), size=(h, w), mode="bilinear", align_corners=False)
            p = t.softmax(logits, dim=1)
        return p.cpu().numpy().astype(np.float32)
