"""ADA's own trained backends: UPerNet + Swin-B footprint and 7-class land cover.

The default backends (BUILDING_BACKEND=ada, LANDCOVER_BACKEND=ada). Both match the
contracts engine.segment_scene / engine.landcover_probs already use:

    footprint   tile_size, batch_size, segment(chips) -> (N, H, W) float32
    land cover  tile_size, batch_size, probs(chips)   -> (N, C, H, W) float32

Weights are read from safetensors written by scripts/convert_ada_checkpoint.py;
the pickled training checkpoints are never loaded by the service.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np

from ..config import settings

log = logging.getLogger("ada.ml")

ADA_ENCODER = "tu-swin_base_patch4_window12_384"
ADA_DECODER_CHANNELS = 64
ADA_CROP = 384
# FLAIR-HUB normalisation on 0-255 RGB, which both runs were trained with.
ADA_MEAN = (105.66, 111.35, 102.18)
ADA_STD = (52.23, 45.62, 44.30)
HEAD_KEY = "segmentation_head.0.weight"
MODEL_FILE = "model.safetensors"
CONFIG_FILE = "config.json"
# Default tiles per forward pass by device; ADA_BATCH_SIZE overrides all three.
TIER_BATCH = {"cuda": 4, "mps": 2, "cpu": 1}
# Class-level ceiling jobs._cap_batch reads; the per-instance tier cap still applies.
_CLASS_BATCH = 64


def _build(classes: int, encoder: str = ADA_ENCODER,
           decoder_channels: int = ADA_DECODER_CHANNELS):
    import segmentation_models_pytorch as smp

    return smp.UPerNet(encoder_name=encoder, encoder_weights=None, in_channels=3,
                       classes=classes, decoder_channels=decoder_channels)


def default_batch_size(device_type: str) -> int:
    """ADA_BATCH_SIZE when set, else the tier default for `device_type`."""
    if settings.ada_batch_size:
        return settings.ada_batch_size
    return TIER_BATCH.get(device_type, 1)


class _TierBatch:
    """batch_size that reads as an int on the class and clamps to the tier cap on an instance."""

    def __get__(self, obj, owner=None):
        return _CLASS_BATCH if obj is None else obj._batch

    def __set__(self, obj, value) -> None:
        obj._batch = max(1, min(int(value), obj._batch_ceiling))


def read_config(model_dir: Path) -> dict:
    """config.json next to the weights, or a FileNotFoundError that says how to make it."""
    weights, config = model_dir / MODEL_FILE, model_dir / CONFIG_FILE
    if not weights.is_file() or not config.is_file():
        raise FileNotFoundError(
            f"ADA weights not found in {model_dir} (need {MODEL_FILE} and {CONFIG_FILE}). "
            f"Convert the training checkpoint with "
            f"services/ml-worker/scripts/convert_ada_checkpoint.py, or set the backend "
            f"back to its default.")
    return json.loads(config.read_text(encoding="utf-8"))


class _AdaBase:
    """Load, validate and run one ADA UPerNet head; subclasses fix the class count."""

    classes: int = 0
    label: str = ""
    tile_size = ADA_CROP
    batch_size = _TierBatch()

    def __init__(self, model_dir: Path) -> None:
        import torch
        from safetensors.torch import load_file

        from . import gpu

        model_dir = Path(model_dir)
        cfg = read_config(model_dir)
        self._check_config(model_dir, cfg)
        state = load_file(str(model_dir / MODEL_FILE), device="cpu")
        head = state.get(HEAD_KEY)
        if head is None:
            raise ValueError(f"{model_dir / MODEL_FILE} has no {HEAD_KEY}; not an ADA "
                             f"UPerNet checkpoint")
        if head.shape[0] != self.classes:
            raise ValueError(f"{model_dir / MODEL_FILE} has a {head.shape[0]}-class head, "
                             f"expected {self.classes} for {type(self).__name__}")

        self.torch = torch
        self.device = gpu.torch_device()
        self.tile_size = int(cfg.get("crop", ADA_CROP))
        model = _build(self.classes, cfg.get("encoder", ADA_ENCODER),
                       int(cfg.get("decoder_channels", ADA_DECODER_CHANNELS)))
        model.load_state_dict(state, strict=True)
        self.model = model.to(self.device).eval()
        for p in self.model.parameters():
            p.requires_grad_(False)
        mean = cfg.get("mean", ADA_MEAN)
        std = cfg.get("std", ADA_STD)
        self._mean = torch.tensor(mean, dtype=torch.float32, device=self.device).view(1, 3, 1, 1)
        self._std = torch.tensor(std, dtype=torch.float32, device=self.device).view(1, 3, 1, 1)
        self._batch_ceiling = default_batch_size(self.device.type)
        self._batch = self._batch_ceiling
        self.name = (f"{self.label} (ADA {cfg.get('source_run', model_dir.name)}, "
                     f"epoch {cfg.get('epoch')}, {self.device.type})")
        log.info("loaded %s, batch %d", self.name, self._batch)

    def _check_config(self, model_dir: Path, cfg: dict) -> None:
        if int(cfg.get("classes", self.classes)) != self.classes:
            raise ValueError(f"{model_dir / CONFIG_FILE} declares {cfg.get('classes')} "
                             f"classes, expected {self.classes}")

    def _forward(self, chips: np.ndarray):
        """(N, tile, tile, 3) uint8 RGB -> (N, C, tile, tile) float32 logits on the device."""
        from . import gpu

        if chips.ndim != 4 or chips.shape[1:] != (self.tile_size, self.tile_size, 3):
            raise ValueError(f"expected (N, {self.tile_size}, {self.tile_size}, 3) chips, "
                             f"got {chips.shape}")
        t = self.torch
        x = t.from_numpy(np.ascontiguousarray(chips)).to(self.device)
        x = (x.permute(0, 3, 1, 2).float() - self._mean) / self._std
        with t.inference_mode(), gpu.autocast(self.device.type):
            out = self.model(x)
        return out.float()


class AdaFootprintBackend(_AdaBase):
    """Single-logit building footprint; alternative to ChangeStar and geobase."""

    classes = 1
    label = "building footprint"

    def segment(self, chips: np.ndarray) -> np.ndarray:
        """(N, H, W, 3) uint8 -> (N, H, W) float32 building probability."""
        prob = self.torch.sigmoid(self._forward(chips))[:, 0]
        return prob.cpu().numpy().astype(np.float32)


class AdaLandCoverBackend(_AdaBase):
    """7-class land cover in LoveDA class order, so landcover.py indexes it unchanged."""

    classes = 7
    label = "landcover"

    def _check_config(self, model_dir: Path, cfg: dict) -> None:
        from .landcover import LABELS

        super()._check_config(model_dir, cfg)
        names = cfg.get("class_names")
        expected = [LABELS[i] for i in range(self.classes)]
        if names is not None and list(names) != expected:
            raise ValueError(f"{model_dir / CONFIG_FILE} class order {names} is not the "
                             f"LoveDA order {expected}")

    def probs(self, chips: np.ndarray) -> np.ndarray:
        """(N, H, W, 3) uint8 -> (N, 7, H, W) float32 class probability."""
        p = self.torch.softmax(self._forward(chips), dim=1)
        return p.cpu().numpy().astype(np.float32)
