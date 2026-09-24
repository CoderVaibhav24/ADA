"""Where work runs, and how much of the machine it is allowed to take.

Every GPU consumer in the pipeline goes through here, for three reasons.

**One accelerator abstraction.** The pipeline runs on three kinds of machine
now — an NVIDIA box (CUDA), an Apple Silicon box (Metal / MPS), or neither
(CPU). Nothing outside this module names a backend: callers ask for
`device()`, `dtype()`, `autocast()`, `ort_providers()` and get whatever the
host actually has. `ML_DEVICE=auto` (the default) picks CUDA, then MPS, then
CPU.

**One budget, enforced where it can be.** The stages use two different
runtimes — ONNX Runtime for the footprint segmenters, PyTorch for land cover
and SAM — and each has its own allocator that will happily grow until the
driver says no. ORT's arena in particular never gives memory back within a
session's lifetime. So the cap is installed in both where the backend exposes
one: `set_per_process_memory_fraction` for torch (CUDA and MPS both have it),
`gpu_mem_limit` on the CUDA execution provider for ORT. CoreML exposes no
equivalent knob — see `ort_providers`.

**The cap is per stage, not per process.** Nothing here prevents torch and ORT
from each taking the full budget at the same time. What prevents it is that the
stages run in strict sequence and release before the next one allocates
(`release_models_between_stages`). With that on, peak VRAM is one stage's
budget; with it off, the caps do not compose and the total is whatever happens
to be resident. That is why the check below warns when it is disabled.

Hitting the cap raises an OOM instead of silently spilling — which is the
point. A budget you can exceed is a suggestion, and the failure mode it hides is
a laptop that thermally throttles for ten minutes with no obvious cause.

**Apple Silicon has no separate VRAM.** On MPS the GPU allocates out of the
same unified pool as the process heap, so `GPU_MEMORY_LIMIT_GB` and
`HOST_MEMORY_LIMIT_GB` are shares of ONE number, not two. Sized as if they were
independent — the CUDA laptop defaults, 4 + 18 on a 24 GB machine — the box
starts swapping under the working grid while the model still believes it has
headroom. `check_unified_budget()` says so at startup rather than letting it be
discovered as a slow analysis.
"""

from __future__ import annotations

import contextlib
import logging
import math
import os
import platform
import subprocess
import sys
from dataclasses import dataclass

from ..config import settings

log = logging.getLogger("ada.ml")

_backend: str | None = None
_torch_capped = False
_warned_sequencing = False
_warned_unified = False
_warned_autocast = False
_warned_require_gpu = False
_forced_cpu = False
_tier: Tier | None = None
_runtime: dict | None = None

CUDA, MPS, CPU = "cuda", "mps", "cpu"
# What people read in logs and /health/ready; torch keeps the device string "mps".
LABELS = {CUDA: "CUDA", MPS: "Metal", CPU: "CPU"}
TIER_NAMES = {CUDA: "cuda", MPS: "metal", CPU: "cpu"}
GRID_STEPS = (6144, 4096, 3072)
_PINNABLE = {"cuda": CUDA, "mps": MPS, "metal": MPS, "cpu": CPU}


@dataclass(frozen=True)
class Tier:
    """What a device class may attempt: precision, working grid, batch, SAM."""
    name: str                   # cuda | metal | cpu
    fp16: bool
    grid_cap_px: int
    batch: int
    sam_refine_default: bool

    @property
    def label(self) -> str:
        return {"cuda": "CUDA", "metal": "Metal", "cpu": "CPU"}[self.name]


# --- backend selection -------------------------------------------------------

def _mps_usable(torch) -> bool:
    """True when torch has a working Metal backend.

    `is_available()` alone is not enough: a torch built without MPS reports
    `is_built() == False` and a machine that is too old reports available but
    fails on the first allocation, so an actual tensor is the only honest test.
    """
    mps = getattr(torch.backends, "mps", None)
    if mps is None or not mps.is_built() or not mps.is_available():
        return False
    try:
        torch.zeros(1, device="mps")
        return True
    except Exception:
        log.warning("torch reports Metal (MPS) available but allocation failed",
                    exc_info=True)
        return False


# A card that enumerates but cannot hand out 1 GB would OOM on the first model anyway.
def _cuda_usable(torch) -> bool:
    if not torch.cuda.is_available():
        return False
    try:
        probe = torch.empty(1 << 28, dtype=torch.float32, device="cuda")
        del probe
        torch.cuda.empty_cache()
        return True
    except Exception:
        log.warning("CUDA device present but a 1 GB probe allocation failed",
                    exc_info=True)
        return False


# Metal tier needs the ONNX segmenters on the GPU too, which only CoreML reaches.
def _coreml_available() -> bool:
    try:
        import onnxruntime as ort
        return "CoreMLExecutionProvider" in ort.get_available_providers()
    except Exception:
        return False


def pinned() -> str | None:
    """The backend ML_DEVICE pins, or None for auto."""
    want = (settings.ml_device or "auto").strip().lower()
    if want == "auto":
        return None
    if want not in _PINNABLE:
        raise RuntimeError(f"ML_DEVICE={settings.ml_device!r} is not one of "
                           f"auto, cuda, mps (metal), cpu")
    return _PINNABLE[want]


def _detect() -> str:
    want = pinned()
    if want == CPU:
        return CPU
    try:
        import torch
    except Exception as exc:                          # torch missing / broken
        if want:
            raise RuntimeError(f"ML_DEVICE={settings.ml_device} is pinned but "
                               f"torch cannot be imported: {exc}") from exc
        return CPU

    if want == CUDA:
        if not _cuda_usable(torch):
            raise RuntimeError(f"ML_DEVICE={settings.ml_device} is pinned but no "
                               f"usable CUDA device was found; refusing to start "
                               f"on the CPU. Set ML_DEVICE=auto to allow it.")
        return CUDA
    if want == MPS:
        if not _mps_usable(torch):
            raise RuntimeError(f"ML_DEVICE={settings.ml_device} is pinned but the "
                               f"Metal (MPS) probe failed; refusing to start on "
                               f"the CPU. Set ML_DEVICE=auto to allow it.")
        if not _coreml_available():
            raise RuntimeError(f"ML_DEVICE={settings.ml_device} is pinned but "
                               f"onnxruntime has no CoreMLExecutionProvider; "
                               f"install the plain macOS arm64 onnxruntime wheel.")
        return MPS
    # auto: a discrete NVIDIA card beats Metal wherever both somehow exist
    if _cuda_usable(torch):
        return CUDA
    if _mps_usable(torch):
        if _coreml_available():
            return MPS
        log.warning("Metal (MPS) works but onnxruntime has no CoreML provider, "
                    "so the Metal tier is unavailable; using the CPU tier.")
    return CPU


def backend() -> str:
    """Accelerator in use: "cuda", "mps" or "cpu". Cached; forced to cpu inside `cpu_override`."""
    global _backend, _warned_require_gpu
    if _forced_cpu:
        return CPU
    if _backend is None:
        if settings.require_gpu and pinned() == CPU:
            raise RuntimeError("REQUIRE_GPU=true contradicts ML_DEVICE=cpu; drop "
                               "REQUIRE_GPU (deprecated) or pin ML_DEVICE=cuda/mps.")
        detected = _detect()
        if settings.require_gpu:
            if not _warned_require_gpu:
                _warned_require_gpu = True
                log.warning("REQUIRE_GPU is deprecated; pin ML_DEVICE=cuda or "
                            "ML_DEVICE=mps instead (a pinned device that fails "
                            "its probe refuses to start).")
            if detected == CPU and pinned() != CPU:
                raise RuntimeError(
                    f"REQUIRE_GPU is set but no GPU backend is available "
                    f"(ML_DEVICE={settings.ml_device}, platform={sys.platform}).")
        _backend = detected
        if _backend == CPU and pinned() != CPU:
            log.warning("no GPU backend available (ML_DEVICE=%s) — running on "
                        "the CPU tier. On Apple Silicon this usually means torch "
                        "was installed from a CUDA index; install the plain "
                        "`torch` wheel for macOS arm64.", settings.ml_device)
        else:
            log.info("compute backend: %s (ML_DEVICE=%s)", LABELS[_backend],
                     settings.ml_device)
    return _backend


@contextlib.contextmanager
def cpu_override():
    """Run the enclosed stage on the CPU; callers release cached models on both sides."""
    global _forced_cpu
    previous = _forced_cpu
    _forced_cpu = True
    try:
        yield
    finally:
        _forced_cpu = previous


def reset() -> None:
    """Forget the cached backend, tier and runtime info (tests, re-probe)."""
    global _backend, _tier, _runtime, _torch_capped, _forced_cpu
    _backend = _tier = _runtime = None
    _torch_capped = _forced_cpu = False


def enabled() -> bool:
    """True when a GPU backend is usable and the config has not forced the CPU."""
    return backend() != CPU


def is_apple() -> bool:
    return backend() == MPS


def budget_bytes() -> int:
    """Memory ceiling for one stage."""
    return int(settings.gpu_memory_limit_gb * (1 << 30))


# --- budget checks -----------------------------------------------------------

def _check_sequencing() -> None:
    global _warned_sequencing
    if _warned_sequencing or settings.release_models_between_stages:
        return
    _warned_sequencing = True
    if backend() == MPS:
        # Not the same failure as on CUDA. torch's MPS watermark counts every
        # Metal allocation the PROCESS holds, CoreML's included, so a resident
        # ORT session is subtracted from the torch budget: measured here, the
        # ChangeStar session holds ~9 GB of the pool and the next stage's first
        # tensor raises "MPS backend out of memory ... other allocations:
        # 10.19 GiB, max allowed: 6.00 GiB". Releasing gives that 9 GB back.
        log.error("RELEASE_MODELS_BETWEEN_STAGES is off on Apple Silicon. The "
                  "onnxruntime/CoreML session's memory counts against torch's "
                  "%.1f GB budget on unified memory, so the next torch stage "
                  "will OOM at its first allocation rather than merely running "
                  "tight. Turn it back on.", settings.gpu_memory_limit_gb)
        return
    log.warning("RELEASE_MODELS_BETWEEN_STAGES is off, so the %.1f GB GPU "
                "budget applies per runtime rather than per process — torch and "
                "onnxruntime can each hold that much at once.",
                settings.gpu_memory_limit_gb)


def check_unified_budget() -> None:
    """Warn when the two memory budgets over-subscribe one unified pool.

    Only meaningful on MPS. On CUDA the two numbers name two different pieces
    of hardware and adding them is correct.
    """
    global _warned_unified
    if _warned_unified or backend() != MPS:
        return
    _warned_unified = True
    try:
        import torch
        total = torch.mps.recommended_max_memory()
    except Exception:
        return
    asked = budget_bytes() + settings.host_memory_limit_bytes
    if total and asked > total:
        log.warning("unified memory over-subscribed: GPU_MEMORY_LIMIT_GB "
                    "(%.1f) + HOST_MEMORY_LIMIT_GB (%.1f) = %.1f GB, but this "
                    "machine recommends a %.1f GB working set TOTAL — the GPU "
                    "and the working grid share one pool on Apple Silicon. "
                    "Lower both until they sum below that.",
                    settings.gpu_memory_limit_gb, settings.host_memory_limit_gb,
                    asked / (1 << 30), total / (1 << 30))


def cap_torch() -> None:
    """Hard-limit torch's caching allocator to the budget. Idempotent."""
    global _torch_capped
    if _torch_capped or not enabled():
        return
    import torch

    kind = backend()
    if kind == CUDA:
        total = torch.cuda.get_device_properties(0).total_memory
        fraction = min(1.0, budget_bytes() / total)
        torch.cuda.set_per_process_memory_fraction(fraction, 0)
        name = torch.cuda.get_device_properties(0).name
    else:
        # MPS's fraction is of the RECOMMENDED working set, not of installed
        # RAM, and unlike CUDA it accepts values above 1.0 (Metal will let a
        # process exceed the recommendation and start paging). Clamping at 1.0
        # is deliberate: past that the allocator stops being a budget.
        total = torch.mps.recommended_max_memory()
        fraction = min(1.0, budget_bytes() / total) if total else 1.0
        torch.mps.set_per_process_memory_fraction(fraction)
        name = f"Apple {platform.machine()} GPU (Metal)"
        check_unified_budget()

    _torch_capped = True
    _check_sequencing()
    log.info("GPU budget: torch capped at %.1f GB of %.1f GB (%.0f%%) on %s",
             budget_bytes() / (1 << 30), total / (1 << 30), fraction * 100, name)


# --- device handles ----------------------------------------------------------

def device() -> str:
    """"cuda", "mps" or "cpu", with the torch cap installed on first use."""
    if not enabled():
        if settings.require_gpu and not _forced_cpu:
            raise RuntimeError(
                f"REQUIRE_GPU is set but no GPU backend is available "
                f"(ML_DEVICE={settings.ml_device}, platform={sys.platform}). "
                f"Set REQUIRE_GPU=false to allow CPU.")
        return CPU
    cap_torch()
    return backend()


def torch_device():
    """The same choice as `device()`, as a `torch.device`."""
    import torch
    return torch.device(device())


def dtype(device_str: str | None = None):
    """fp16 on the GPU, fp32 on the CPU.

    Half precision is not a speed trick here, it is what makes the budget fit:
    weights and activations both halve, and every model in this pipeline is a
    frozen inference-only network where the loss of mantissa is immaterial
    against a 0.5 probability threshold.

    fp16 rather than bf16 on MPS as well: Metal implements both, but the fp16
    kernels are the well-trodden path and the range argument that favours bf16
    only matters for training gradients, which this never does on the GPU.
    """
    import torch

    dev = device_str if device_str is not None else device()
    return torch.float16 if dev in (CUDA, MPS) else torch.float32


def autocast(device_str: str | None = None):
    """fp16 autocast for the active backend; a no-op on the CPU.

    Used where converting the weights outright is wrong — SAM's mask decoder
    accumulates in fp32 and returns NaN in half precision, which produces an
    empty refinement rather than an error, so it would fail silently.

    MPS autocast landed later than CUDA's and older wheels raise on it, so a
    failure here degrades to full precision (slower, correct) instead of
    killing the stage.
    """
    global _warned_autocast
    import torch

    dev = device_str if device_str is not None else device()
    if dev == CPU:
        return contextlib.nullcontext()
    try:
        return torch.autocast(dev, dtype=torch.float16)
    except Exception:
        if not _warned_autocast:
            _warned_autocast = True
            log.warning("torch.autocast('%s') unsupported in this build — "
                        "running SAM in fp32 (slower, same result)", dev,
                        exc_info=True)
        return contextlib.nullcontext()


# --- onnxruntime -------------------------------------------------------------

def _coreml_providers() -> list:
    """CoreML execution provider, tuned for this pipeline's graphs.

    CoreML is the only way to reach the Apple GPU/ANE from onnxruntime — there
    is no Metal EP — and it comes with constraints the CUDA path does not have:

      * no memory-limit knob exists, so the `GPU_MEMORY_LIMIT_GB` budget is NOT
        enforced for ORT on Apple. It is less dangerous than it sounds: unified
        memory means an over-allocation pages rather than hard-OOMs, and
        `check_unified_budget()` already warns when the budgets over-subscribe.
      * `MLComputeUnits=ALL` lets CoreML place ops on the ANE. Measured on an
        M4 Pro at 1024 px, ChangeStar runs 1.53 s/tile on the CPU EP and
        0.93 s/tile on CoreML — worth having, but nothing like the ~10x a
        discrete card gives, because the graph splits into 29 partitions
        (1075 of 1147 nodes taken) and the round trips eat the win. ALL and
        CPUAndGPU measured within noise of each other, so the ANE is not what
        is carrying it.
      * MLProgram, not NeuralNetwork: the older format has no fp16 conv
        transpose and silently partitions those subgraphs back to the CPU.
    """
    import onnxruntime as ort

    if "CoreMLExecutionProvider" not in ort.get_available_providers():
        return ["CPUExecutionProvider"]
    options = {
        "ModelFormat": "MLProgram",
        "MLComputeUnits": "ALL",
        # Take only nodes whose shapes CoreML can resolve at compile time. The
        # segmenters always run at one fixed tile size, so this costs nothing —
        # and without it the ChangeStar ViT-B graph, whose export leaves
        # height/width symbolic, is claimed by the EP and then fails at
        # execution inside a pad. `backends._check_static_shapes` catches the
        # unfrozen graph before it gets this far.
        "RequireStaticInputShapes": "1",
        "EnableOnSubgraphs": "0",
    }
    # String provider options landed in ORT 1.20. Before that the EP took an
    # integer flags bitmask under a different key, and passing this dict makes
    # session creation fail outright — so on an older wheel take the EP with its
    # defaults (NeuralNetwork format, CPU+GPU) rather than nothing at all.
    if _ort_version(ort) < (1, 20):
        log.warning("onnxruntime %s predates CoreML string provider options — "
                    "using EP defaults. Upgrade to >= 1.20 for MLProgram + ANE.",
                    getattr(ort, "__version__", "?"))
        return ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    return [("CoreMLExecutionProvider", options), "CPUExecutionProvider"]


def _ort_version(ort) -> tuple[int, ...]:
    try:
        return tuple(int(x) for x in
                     getattr(ort, "__version__", "0").split(".")[:2])
    except Exception:
        return (0,)


def ort_providers() -> list:
    """Execution providers for an onnxruntime session, capped where possible.

    On CUDA, `kSameAsRequested` matters as much as the limit itself: the default
    arena strategy doubles its reservation each time it grows, so a model that
    needs 2.1 GB reserves 4 GB and the next stage has nowhere to live.
    """
    import onnxruntime as ort

    if not enabled():
        return ["CPUExecutionProvider"]
    _check_sequencing()

    if backend() == MPS:
        return _coreml_providers()

    if "CUDAExecutionProvider" not in ort.get_available_providers():
        return ["CPUExecutionProvider"]
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


def expected_ort_provider() -> str | None:
    """The provider name a GPU session is supposed to bind, or None on CPU.

    `backends._make_session` compares this against what actually bound, so a
    silent CPU fallback becomes an error rather than a warning nobody reads.
    """
    if not enabled():
        return None
    return "CoreMLExecutionProvider" if backend() == MPS else "CUDAExecutionProvider"


# --- lifecycle ---------------------------------------------------------------

def free() -> None:
    """Return cached blocks to the driver; uses the real device even under `cpu_override`."""
    try:
        import torch
        if _backend == CUDA and torch.cuda.is_available():
            torch.cuda.empty_cache()
        elif _backend == MPS:
            torch.mps.empty_cache()
    except Exception:
        log.debug("empty_cache failed", exc_info=True)


def log_usage(tag: str) -> None:
    if not _torch_capped:
        return
    try:
        import torch
        if backend() == CUDA:
            allocated = torch.cuda.memory_allocated()
            reserved = torch.cuda.memory_reserved()
        else:
            # MPS reports what the process holds and what Metal has taken from
            # the system for it; the second is the one that matters on unified
            # memory, because it is not available to the working grid.
            allocated = torch.mps.current_allocated_memory()
            reserved = torch.mps.driver_allocated_memory()
        log.info("GPU memory after %s: %.2f GB allocated, %.2f GB reserved "
                 "(budget %.1f GB, backend %s)", tag,
                 allocated / (1 << 30), reserved / (1 << 30),
                 settings.gpu_memory_limit_gb, LABELS[backend()])
    except Exception:
        log.debug("GPU memory query failed", exc_info=True)


# --- tiers and reporting -----------------------------------------------------

# Unified memory: the grid gets what the host budget allows AND Metal leaves after the GPU budget.
def _metal_grid_cap() -> int:
    try:
        from ..preprocess import PIPELINE_BYTES_PER_PX, WORKING_GRID_RAM_SHARE
    except Exception:
        PIPELINE_BYTES_PER_PX, WORKING_GRID_RAM_SHARE = 110, 0.45
    pool = settings.host_memory_limit_bytes
    try:
        import torch
        total = torch.mps.recommended_max_memory()
        if total:
            pool = min(pool, max(0, total - budget_bytes()))
    except Exception:
        log.debug("recommended_max_memory unavailable", exc_info=True)
    dim = int(math.sqrt(pool * WORKING_GRID_RAM_SHARE / PIPELINE_BYTES_PER_PX))
    return max(1024, min(GRID_STEPS[0], dim))


def tier_for(kind: str) -> Tier:
    """The tier a backend kind runs as (doc §4.1)."""
    if kind == CUDA:
        return Tier("cuda", True, GRID_STEPS[0], 8, True)
    if kind == MPS:
        return Tier("metal", True, _metal_grid_cap(), 4, True)
    return Tier("cpu", False, min(GRID_STEPS[0], settings.ml_cpu_grid_cap_px), 1,
                bool(settings.ml_cpu_sam_refine))


def select_tier() -> Tier:
    """The process tier; raises at startup when a pinned ML_DEVICE fails its probe."""
    global _tier
    if _tier is None:
        _tier = tier_for(backend())
        log.info("runtime tier: %s (%s, grid cap %d px, batch %d, SAM refine %s)",
                 _tier.label, "fp16" if _tier.fp16 else "fp32", _tier.grid_cap_px,
                 _tier.batch, "on" if _tier.sam_refine_default else "off")
    return _tier


def _apple_chip() -> str:
    try:
        out = subprocess.run(["/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"],
                             capture_output=True, text=True, timeout=2)
        name = out.stdout.strip()
        if name:
            return name
    except Exception:
        log.debug("sysctl chip name unavailable", exc_info=True)
    return f"Apple {platform.machine()}"


def _device_name(kind: str) -> str:
    if kind == CUDA:
        try:
            import torch
            return torch.cuda.get_device_name(0)
        except Exception:
            return "NVIDIA GPU"
    if kind == MPS:
        return f"{_apple_chip()} GPU"
    cpu = platform.processor() or platform.machine() or "CPU"
    if sys.platform == "darwin":
        cpu = _apple_chip()
    return f"{cpu} ({os.cpu_count() or 1} cores)"


def runtime_info() -> dict:
    """backend, device_name, tier, fp16, ort_provider, gpu_budget_gb; cached with the backend."""
    global _runtime
    if _runtime is None:
        kind = backend()
        tier = select_tier()
        _runtime = {
            "backend": LABELS[kind],
            "device_name": _device_name(kind),
            "tier": tier.name,
            "fp16": tier.fp16,
            "ort_provider": expected_ort_provider() or "CPUExecutionProvider",
            "gpu_budget_gb": settings.gpu_memory_limit_gb if kind != CPU else None,
        }
    return dict(_runtime)
