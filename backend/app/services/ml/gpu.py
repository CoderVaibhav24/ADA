"""Where work runs, and how much of the machine it is allowed to take.

Every GPU consumer in the pipeline goes through here, for two reasons.

**One budget, enforced twice.** The stages use two different runtimes — ONNX
Runtime for the footprint segmenters, PyTorch for land cover and SAM — and each
has its own allocator that will happily grow until the driver says no. ORT's
arena in particular never gives memory back within a session's lifetime. So the
cap has to be installed in both: `set_per_process_memory_fraction` for torch,
`gpu_mem_limit` on the CUDA execution provider for ORT.

**The cap is per stage, not per process.** Nothing here prevents torch and ORT
from each taking the full budget at the same time. What prevents it is that the
stages run in strict sequence and release before the next one allocates
(`release_models_between_stages`). With that on, peak VRAM is one stage's
budget; with it off, the caps do not compose and the total is whatever happens
to be resident. That is why the check below warns when it is disabled.

Hitting the cap raises a CUDA OOM instead of silently spilling — which is the
point. A budget you can exceed is a suggestion, and the failure mode it hides is
a laptop that thermally throttles for ten minutes with no obvious cause.
"""

from __future__ import annotations

import logging

from ...config import settings

log = logging.getLogger("ada.ml")

_torch_capped = False
_warned_sequencing = False


def enabled() -> bool:
    """True when CUDA is usable and the config has not forced the CPU."""
    if settings.ml_device == "cpu":
        return False
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:                                 # torch missing / broken
        return False


def budget_bytes() -> int:
    """VRAM ceiling for one stage."""
    return int(settings.gpu_memory_limit_gb * (1 << 30))


def _check_sequencing() -> None:
    global _warned_sequencing
    if _warned_sequencing or settings.release_models_between_stages:
        return
    _warned_sequencing = True
    log.warning("RELEASE_MODELS_BETWEEN_STAGES is off, so the %.1f GB VRAM "
                "budget applies per runtime rather than per process — torch and "
                "onnxruntime can each hold that much at once.",
                settings.gpu_memory_limit_gb)


def cap_torch() -> None:
    """Hard-limit torch's caching allocator to the budget. Idempotent."""
    global _torch_capped
    if _torch_capped or not enabled():
        return
    import torch

    total = torch.cuda.get_device_properties(0).total_memory
    fraction = min(1.0, budget_bytes() / total)
    torch.cuda.set_per_process_memory_fraction(fraction, 0)
    _torch_capped = True
    _check_sequencing()
    log.info("VRAM budget: torch capped at %.1f GB of %.1f GB (%.0f%%) on %s",
             budget_bytes() / (1 << 30), total / (1 << 30), fraction * 100,
             torch.cuda.get_device_properties(0).name)


def device() -> str:
    """"cuda" or "cpu", with the torch cap installed on first use."""
    if not enabled():
        if settings.require_gpu:
            raise RuntimeError("REQUIRE_GPU is set but no CUDA device is "
                               "available. Set REQUIRE_GPU=false to allow CPU.")
        return "cpu"
    cap_torch()
    return "cuda"


def dtype(device_str: str | None = None):
    """fp16 on the GPU, fp32 on the CPU.

    Half precision is not a speed trick here, it is what makes the budget fit:
    weights and activations both halve, and every model in this pipeline is a
    frozen inference-only network where the loss of mantissa is immaterial
    against a 0.5 probability threshold.
    """
    import torch

    dev = device_str if device_str is not None else device()
    return torch.float16 if dev == "cuda" else torch.float32


def ort_providers() -> list:
    """Execution providers for an onnxruntime session, CUDA capped to budget.

    `kSameAsRequested` matters as much as the limit itself: the default arena
    strategy doubles its reservation each time it grows, so a model that needs
    2.1 GB reserves 4 GB and the next stage has nowhere to live.
    """
    import onnxruntime as ort

    if not enabled() or "CUDAExecutionProvider" not in ort.get_available_providers():
        return ["CPUExecutionProvider"]
    _check_sequencing()
    cuda_options = {
        "device_id": 0,
        "gpu_mem_limit": budget_bytes(),
        "arena_extend_strategy": "kSameAsRequested",
        # Exhaustive cuDNN algo search benchmarks every candidate and allocates
        # each one's workspace to do it — several hundred MB of the budget spent
        # on picking a convolution.
        "cudnn_conv_algo_search": "HEURISTIC",
        "cudnn_conv_use_max_workspace": "0",
        "do_copy_in_default_stream": True,
    }
    return [("CUDAExecutionProvider", cuda_options), "CPUExecutionProvider"]


def free() -> None:
    """Return cached blocks to the driver between stages."""
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def log_usage(tag: str) -> None:
    if not _torch_capped:
        return
    try:
        import torch
        log.info("VRAM after %s: %.2f GB allocated, %.2f GB reserved "
                 "(budget %.1f GB)", tag,
                 torch.cuda.memory_allocated() / (1 << 30),
                 torch.cuda.memory_reserved() / (1 << 30),
                 settings.gpu_memory_limit_gb)
    except Exception:
        pass
