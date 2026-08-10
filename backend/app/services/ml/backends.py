"""Change-detection model backends.

Both backends map a pair of 256x256 RGB chips to a per-pixel change
score. The engine normalizes scores scene-wide afterwards.

- FeatureDiffBackend (default): Deep Change Vector Analysis (DCVA) —
  multi-scale features from an ImageNet-pretrained ResNet-18
  (open-source torchvision weights), per-pixel cosine distance between
  the T1 and T2 feature stacks. Needs no CD-specific checkpoint, so the
  POC always runs end-to-end.

- TorchScriptBackend: drop-in slot for a real CD network (BIT,
  ChangeFormer, TinyCD...). Export any open-source checkpoint to
  TorchScript taking (t1, t2) normalized tensors and returning logits;
  point MODEL_WEIGHTS at the file and set MODEL_BACKEND=deep.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torchvision.models import ResNet18_Weights, resnet18

log = logging.getLogger("ada.ml")

_IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_IMAGENET_STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


def _to_tensor(batch: np.ndarray) -> torch.Tensor:
    """(N, H, W, 3) uint8 -> normalized (N, 3, H, W) float tensor."""
    t = torch.from_numpy(batch.astype(np.float32) / 255.0).permute(0, 3, 1, 2)
    return (t - _IMAGENET_MEAN) / _IMAGENET_STD


class FeatureDiffBackend:
    """DCVA with ImageNet ResNet-18 multi-scale features."""

    calibrated = False  # raw distances; engine normalizes scene-wide
    # deeper scales see more context; weight them slightly higher
    _SCALE_WEIGHTS = (0.5, 1.0, 1.5)

    def __init__(self) -> None:
        from ...config import settings

        local = settings.local_model(settings.resnet18_local)
        if local is not None:
            # vendored ImageNet weights — no download, pinned revision
            net = resnet18(weights=None)
            net.load_state_dict(torch.load(local, map_location="cpu"))
            net = net.eval()
        else:
            log.warning("resnet18 weights not vendored in data/weights — "
                        "falling back to the torch cache. Run "
                        "scripts/fetch_weights.py to vendor them.")
            net = resnet18(weights=ResNet18_Weights.IMAGENET1K_V1).eval()
        source = "local" if local is not None else "torch cache"
        self.name = f"feature_diff (DCVA, ResNet-18 ImageNet, {source})"
        self.stem = torch.nn.Sequential(net.conv1, net.bn1, net.relu, net.maxpool)
        self.layer1, self.layer2, self.layer3 = net.layer1, net.layer2, net.layer3
        for p in net.parameters():
            p.requires_grad_(False)

    def _features(self, x: torch.Tensor) -> list[torch.Tensor]:
        f0 = self.stem(x)
        f1 = self.layer1(f0)
        f2 = self.layer2(f1)
        f3 = self.layer3(f2)
        return [f1, f2, f3]

    @torch.no_grad()
    def predict(self, t1: np.ndarray, t2: np.ndarray) -> np.ndarray:
        """(N, H, W, 3) uint8 pair -> (N, H, W) float32 raw change score."""
        h, w = t1.shape[1:3]
        x1, x2 = _to_tensor(t1), _to_tensor(t2)
        dist = torch.zeros((x1.shape[0], 1, h, w))
        for weight, fa, fb in zip(self._SCALE_WEIGHTS,
                                  self._features(x1), self._features(x2)):
            d = 1.0 - F.cosine_similarity(fa, fb, dim=1, eps=1e-8).unsqueeze(1)
            dist += weight * F.interpolate(d, size=(h, w), mode="bilinear",
                                           align_corners=False)
        return (dist.squeeze(1) / sum(self._SCALE_WEIGHTS)).numpy()


class TorchScriptBackend:
    """Any exported CD network: model(t1, t2) -> (N,1,H,W) or (N,2,H,W) logits."""

    calibrated = True  # already outputs probabilities

    def __init__(self, weights: Path) -> None:
        self.model = torch.jit.load(str(weights), map_location="cpu").eval()
        self.name = f"deep (TorchScript: {weights.name})"

    @torch.no_grad()
    def predict(self, t1: np.ndarray, t2: np.ndarray) -> np.ndarray:
        out = self.model(_to_tensor(t1), _to_tensor(t2))
        if out.shape[1] == 2:                       # 2-class logits
            prob = torch.softmax(out, dim=1)[:, 1]
        else:                                       # single-channel logits
            prob = torch.sigmoid(out[:, 0])
        return prob.numpy()


def load_backend(kind: str, weights: Path):
    if kind == "deep" or (kind == "auto" and weights.is_file()):
        return TorchScriptBackend(weights)
    return FeatureDiffBackend()


class BuildingSegBackend:
    """Per-epoch building-footprint segmentation (for the seg-diff engine).

    Wraps the open-source geobase U-Net (ONNX, ~45 MB, trained on aerial +
    satellite building footprints). Input is (N, 256, 256, 3) uint8; output is
    a per-pixel building probability. Unlike the CD backends this scores ONE
    epoch at a time — the engine segments T1 and T2 separately and diffs the
    footprints, so vegetation and sensor/colour differences can never be
    flagged as change (the model only ever outputs buildings).
    """

    def __init__(self, repo: str, file: str) -> None:
        import onnxruntime as ort

        from ...config import settings

        local = settings.local_model(settings.building_model_local)
        if local is not None:
            path, source = str(local), "local"
        else:
            from huggingface_hub import hf_hub_download
            log.warning("building segmenter not vendored in data/weights — "
                        "falling back to the HuggingFace cache. Run "
                        "scripts/fetch_weights.py to vendor it.")
            path, source = hf_hub_download(repo, file), "hub cache"

        # CPU is plenty for this tiny net; leaves the GPU free for SAM2.
        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self._in = self.sess.get_inputs()[0].name
        self._out = self.sess.get_outputs()[0].name
        self.name = f"building_segdiff (ONNX U-Net: {repo}, {source})"

    def segment(self, chips: np.ndarray) -> np.ndarray:
        """(N, H, W, 3) uint8 -> (N, H, W) float32 building probability."""
        x = chips.astype(np.float32) / 255.0            # NHWC, [0, 1]
        y = self.sess.run([self._out], {self._in: x})[0]  # (N, H, W, 1)
        y = y[..., 0]
        if y.min() < 0.0 or y.max() > 1.0:              # raw logits -> sigmoid
            y = 1.0 / (1.0 + np.exp(-y))
        return y.astype(np.float32)


def load_seg_backend(repo: str, file: str) -> BuildingSegBackend:
    return BuildingSegBackend(repo, file)
