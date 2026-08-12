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


def _to_tensor(batch: np.ndarray, device: str = "cpu",
               dtype=torch.float32) -> torch.Tensor:
    """(N, H, W, 3) uint8 -> normalized (N, 3, H, W) float tensor on `device`.

    The uint8 batch is moved BEFORE the float conversion: a 256^2 x 8 chip
    stack is 1.5 MB as uint8 and 6 MB as float32, so casting host-side would
    quadruple the transfer for no reason.
    """
    t = torch.from_numpy(batch).to(device).permute(0, 3, 1, 2).to(dtype) / 255.0
    mean = _IMAGENET_MEAN.to(device=device, dtype=dtype)
    std = _IMAGENET_STD.to(device=device, dtype=dtype)
    return (t - mean) / std


class FeatureDiffBackend:
    """DCVA with ImageNet ResNet-18 multi-scale features."""

    calibrated = False  # raw distances; engine normalizes scene-wide
    # deeper scales see more context; weight them slightly higher
    _SCALE_WEIGHTS = (0.5, 1.0, 1.5)

    def __init__(self) -> None:
        from ...config import settings

        from . import gpu

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
        # This backend ran entirely on the CPU, which made CD mode the one
        # pipeline that left the card idle while pinning every core. ResNet-18
        # in half precision is ~23 MB of weights — the smallest resident of the
        # budget by an order of magnitude.
        self.device = gpu.device()
        self.dtype = gpu.dtype(self.device)
        net = net.to(device=self.device, dtype=self.dtype)
        self.name = (f"feature_diff (DCVA, ResNet-18 ImageNet, {source}, "
                     f"{self.device})")
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
        x1 = _to_tensor(t1, self.device, self.dtype)
        x2 = _to_tensor(t2, self.device, self.dtype)
        # The distance accumulator stays fp32 even when the features are fp16:
        # three weighted scales summed in half precision lose the low end of a
        # cosine distance, which is exactly the range the scene-wide median+MAD
        # normalization downstream is measuring.
        dist = torch.zeros((x1.shape[0], 1, h, w), device=self.device)
        for weight, fa, fb in zip(self._SCALE_WEIGHTS,
                                  self._features(x1), self._features(x2)):
            d = 1.0 - F.cosine_similarity(fa, fb, dim=1, eps=1e-8).unsqueeze(1)
            dist += weight * F.interpolate(d.float(), size=(h, w),
                                           mode="bilinear", align_corners=False)
        return (dist.squeeze(1) / sum(self._SCALE_WEIGHTS)).cpu().numpy()


class TorchScriptBackend:
    """Any exported CD network: model(t1, t2) -> (N,1,H,W) or (N,2,H,W) logits."""

    calibrated = True  # already outputs probabilities

    def __init__(self, weights: Path) -> None:
        from . import gpu

        # An exported checkpoint may or may not be half-safe, so this one keeps
        # fp32 and takes only the device. Speed still improves by an order of
        # magnitude; the budget can absorb it because nothing else is resident
        # while CD mode runs.
        self.device = gpu.device()
        self.model = torch.jit.load(str(weights), map_location=self.device).eval()
        self.name = f"deep (TorchScript: {weights.name}, {self.device})"

    @torch.no_grad()
    def predict(self, t1: np.ndarray, t2: np.ndarray) -> np.ndarray:
        out = self.model(_to_tensor(t1, self.device), _to_tensor(t2, self.device))
        if out.shape[1] == 2:                       # 2-class logits
            prob = torch.softmax(out, dim=1)[:, 1]
        else:                                       # single-channel logits
            prob = torch.sigmoid(out[:, 0])
        return prob.cpu().numpy()


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

    # Native inference geometry, read by engine.segment_scene. The U-Net is
    # fully convolutional and small, so it tiles at 256 and batches happily.
    tile_size = 256
    batch_size = 8

    def __init__(self, repo: str, file: str) -> None:
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

        # Tiny net — fine on the CPU, but still thread-capped so it cannot
        # saturate the machine alongside the GPU models.
        self.sess = _make_session(path, settings)
        self._in = self.sess.get_inputs()[0].name
        self._out = self.sess.get_outputs()[0].name
        device = self.sess.get_providers()[0].replace("ExecutionProvider", "")
        self.name = f"building_segdiff (ONNX U-Net: {repo}, {source}, {device})"

    def segment(self, chips: np.ndarray) -> np.ndarray:
        """(N, H, W, 3) uint8 -> (N, H, W) float32 building probability."""
        x = chips.astype(np.float32) / 255.0            # NHWC, [0, 1]
        y = self.sess.run([self._out], {self._in: x})[0]  # (N, H, W, 1)
        y = y[..., 0]
        if y.min() < 0.0 or y.max() > 1.0:              # raw logits -> sigmoid
            y = 1.0 / (1.0 + np.exp(-y))
        return y.astype(np.float32)


def _make_session(path: str, settings):
    """Build an ORT session on the GPU, refusing to quietly land on the CPU.

    onnxruntime's default behaviour when CUDA cannot initialise is to log a
    warning and run on CPU. For a ViT-B at 1024x1024 that is ~13 s per tile with
    every core saturated, which on a laptop reads as "the machine froze and got
    hot" rather than as a misconfiguration. So: if the caller asked for the GPU
    and we did not get it, say so at ERROR, and hard-fail when `require_gpu` is
    set. CPU threads are capped either way so a fallback degrades speed instead
    of making the box unusable.
    """
    import onnxruntime as ort

    from . import gpu

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, settings.onnx_cpu_threads)
    opts.inter_op_num_threads = 1
    # Reuse one arena across the session's runs instead of letting each run's
    # peak stack on the last — with `gpu_mem_limit` set, a growing arena is the
    # difference between a stage that fits the budget and one that trips it.
    opts.enable_mem_pattern = True

    want_gpu = settings.ml_device != "cpu"
    # gpu.ort_providers() carries the VRAM cap (gpu_mem_limit +
    # kSameAsRequested); without it ORT's arena grows by doubling and one
    # segmenter can reserve the whole card.
    providers = gpu.ort_providers()

    sess = ort.InferenceSession(path, sess_options=opts, providers=providers)
    active = sess.get_providers()

    if want_gpu and "CUDAExecutionProvider" not in active:
        msg = ("onnxruntime fell back to the CPU: CUDAExecutionProvider failed "
               "to initialise. Almost always a CUDA major-version mismatch — "
               "onnxruntime-gpu must match the CUDA version torch was built "
               "against (torch cu12x -> onnxruntime-gpu 1.22.x, NOT 1.28 which "
               "needs CUDA 13). Inference will be ~10x slower and will saturate "
               f"{opts.intra_op_num_threads} CPU threads.")
        if settings.require_gpu:
            raise RuntimeError(msg + " Set REQUIRE_GPU=false to allow CPU.")
        log.error(msg)
    elif "CUDAExecutionProvider" in active:
        log.info("onnxruntime on CUDA, arena capped at %.1f GB",
                 settings.gpu_memory_limit_gb)
    return sess


class ChangeStarSegBackend:
    """Per-epoch building segmentation with ChangeStar (ViT-B, ONNX ~395 MB).

    Same contract as BuildingSegBackend — one epoch in, building probability
    out — but a far larger model with a transformer backbone and a 1024 px
    receptive field instead of the U-Net's 256. That context window is the
    point: at 256 px a dense Agra block is mostly roof texture with no visible
    street or courtyard to anchor on, which is a large part of why the small
    U-Net reads tree canopy as building on the CIR epoch.

    Two hard constraints from the export, both load-bearing:
      * the tile MUST be 1024x1024 — the ViT has fixed positional embeddings
        even though the ONNX graph advertises symbolic height/width, so a
        differently-sized input produces silent garbage rather than an error;
      * batch is pinned to 1 in the graph, so tiles go through one at a time.
    """

    tile_size = 1024
    batch_size = 1

    def __init__(self, repo: str, file: str) -> None:
        import onnxruntime as ort

        from ...config import settings

        local = settings.local_model(settings.changestar_model_local)
        if local is not None:
            path, source = str(local), "local"
        else:
            from huggingface_hub import hf_hub_download
            log.warning("ChangeStar not vendored in data/weights — falling "
                        "back to the HuggingFace cache. Run "
                        "scripts/fetch_weights.py to vendor it.")
            path, source = hf_hub_download(repo, file), "hub cache"

        self.sess = _make_session(path, settings)
        self._in = self.sess.get_inputs()[0].name
        self._out = self.sess.get_outputs()[0].name
        device = self.sess.get_providers()[0].replace("ExecutionProvider", "")
        self.name = f"building_segdiff (ChangeStar ViT-B ONNX: {repo}, {source}, {device})"

    def segment(self, chips: np.ndarray) -> np.ndarray:
        """(N, 1024, 1024, 3) uint8 -> (N, 1024, 1024) float32 building prob.

        ImageNet-normalized NCHW, per preprocessor_config.json.
        """
        x = chips.astype(np.float32) / 255.0
        x = (x - _IMAGENET_MEAN.numpy().transpose(0, 2, 3, 1)) / \
            _IMAGENET_STD.numpy().transpose(0, 2, 3, 1)
        x = x.transpose(0, 3, 1, 2)                     # NHWC -> NCHW
        outs = []
        for i in range(x.shape[0]):                     # graph batch is fixed at 1
            y = self.sess.run([self._out], {self._in: x[i:i + 1]})[0]
            outs.append(y[0, 0])
        y = np.stack(outs)
        if y.min() < 0.0 or y.max() > 1.0:              # raw logits -> sigmoid
            y = 1.0 / (1.0 + np.exp(-y))
        return y.astype(np.float32)


def load_seg_backend(repo: str, file: str):
    from ...config import settings

    if settings.building_backend == "changestar":
        return ChangeStarSegBackend(settings.changestar_model_repo,
                                    settings.changestar_model_file)
    return BuildingSegBackend(repo, file)
