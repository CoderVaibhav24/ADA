"""Device and precision selection for the training box.

Deliberately separate from services/ml-worker/app/ml/gpu.py: that module picks a
device for *serving* and installs a memory cap so three models can coexist
inside a laptop's budget. Training is the opposite situation -- one model, all
of the VRAM, and a wrong answer costs days rather than seconds.

The one failure this module exists to prevent: on Windows the default PyPI
torch wheel is CPU-only, so `pip install torch` succeeds, training runs, and an
epoch that should take 50 minutes takes two days with no error anywhere. That
is why `require` raises instead of warning.
"""

from __future__ import annotations

import logging
import os
import platform

log = logging.getLogger("ada.train")

CUDA = "cuda"
MPS = "mps"
CPU = "cpu"


def detect(want: str = "auto") -> str:
    import torch

    want = (want or "auto").strip().lower()
    if want in (CUDA, MPS, CPU):
        return want
    if torch.cuda.is_available():
        return CUDA
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return MPS
    return CPU


def require(device: str) -> None:
    """Fail loudly when the chosen device is not actually usable."""
    import torch

    if device == CUDA and not torch.cuda.is_available():
        hint = ""
        if platform.system() == "Windows":
            hint = (" On Windows the default PyPI torch wheel is CPU-only. "
                    "Install the CUDA build:\n"
                    "  pip install torch torchvision "
                    "--index-url https://download.pytorch.org/whl/cu126")
        raise RuntimeError(
            f"device=cuda requested but torch.cuda.is_available() is False "
            f"(torch {torch.__version__}, built for CUDA "
            f"{torch.version.cuda!r}).{hint}"
        )
    if device == MPS and not torch.backends.mps.is_available():
        raise RuntimeError(
            "device=mps requested but MPS is unavailable. Install the PyPI "
            "torch wheel (a CUDA-index wheel on macOS has no MPS backend)."
        )


def amp_dtype(precision: str, device: str):
    """Map the config's precision to a torch dtype, refusing bad combinations."""
    import torch

    precision = (precision or "bf16").lower()
    if precision == "fp32":
        return None
    if precision == "bf16":
        if device == CUDA and not torch.cuda.is_bf16_supported():
            raise RuntimeError(
                "precision=bf16 but this GPU does not support bfloat16. Use "
                "precision=fp16 (a GradScaler is applied automatically)."
            )
        if device == MPS:
            # torch's MPS autocast path is fp16 only. Silently promoting would
            # hide a real difference between the dev box and the training box.
            raise RuntimeError("precision=bf16 is not supported on MPS; use fp16 or fp32.")
        return torch.bfloat16
    if precision == "fp16":
        return torch.float16
    raise ValueError(f"unknown precision {precision!r}; use bf16, fp16 or fp32")


def tune(device: str, cudnn_benchmark: bool = True) -> None:
    """Throughput knobs that are safe for this workload.

    cudnn.benchmark is worth having because every tile is exactly `crop` px, so
    the autotuner picks once and the choice holds for the whole run. It would
    be a mistake on variable input sizes, where it re-benchmarks per new shape.
    """
    import torch

    if device != CUDA:
        return
    torch.backends.cudnn.benchmark = bool(cudnn_benchmark)
    # TF32 for the 3x3 convolutions. Ada has the tensor cores; the accuracy
    # difference on a segmentation head is not measurable.
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True


def describe(device: str) -> str:
    import torch

    if device == CUDA:
        props = torch.cuda.get_device_properties(0)
        gb = props.total_memory / 1024 ** 3
        return (f"cuda: {props.name}, {gb:.1f} GiB VRAM, "
                f"sm_{props.major}{props.minor}, torch {torch.__version__} "
                f"(CUDA {torch.version.cuda})")
    if device == MPS:
        return f"mps: {platform.machine()}, torch {torch.__version__}"
    return (f"cpu: {platform.processor() or platform.machine()}, "
            f"{os.cpu_count()} threads, torch {torch.__version__}")


def vram_free_gib() -> float | None:
    import torch

    if not torch.cuda.is_available():
        return None
    free, _total = torch.cuda.mem_get_info()
    return free / 1024 ** 3


def oom_advice(cfg) -> str:
    """What to actually change after a CUDA OOM, in the order that costs least."""
    return (
        "CUDA out of memory. Change these in the config, in this order:\n"
        f"  1. train.grad_checkpoint: true          (currently "
        f"{cfg.model.grad_checkpoint}) -- costs ~30% throughput, halves activations\n"
        f"  2. data.crop: 384                       (currently {cfg.data.crop})\n"
        f"  3. train.batch_size: {max(1, cfg.train.batch_size // 2)} with "
        f"train.grad_accum: {cfg.train.grad_accum * 2}  "
        f"(keeps the effective batch at "
        f"{cfg.train.batch_size * cfg.train.grad_accum})\n"
        "  4. a smaller encoder (resnet18)\n"
        "Lower the batch size LAST: below 4 the BatchNorm statistics get noisy, "
        "which hurts accuracy in a way slow steps do not."
    )
