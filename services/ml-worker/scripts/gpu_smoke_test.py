"""Verify this machine actually has the GPU, and that each model reaches it.

Run on the host (Apple Silicon — Docker Desktop has no GPU passthrough on
macOS, so a containerised run can only ever report CPU):

    .venv/bin/python scripts/gpu_smoke_test.py

Or inside the container, on an NVIDIA box:

    docker compose run --rm ada-ml python scripts/gpu_smoke_test.py

Exists because every GPU failure in this stack is SILENT. onnxruntime falls back
to CPUExecutionProvider with a warning, transformers happily runs on CPU,
`ml/imageops` catches an unimplemented Metal kernel and quietly returns to
scipy, and the only symptom of any of it is that an analysis takes twenty
minutes instead of two. This turns that into an explicit pass/fail before anyone
uploads a raster.

Checks, in dependency order — a failure in an early check explains the later
ones, so the first FAIL is the one to fix.
"""
import platform
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"
results: list[tuple[str, str, str]] = []


def check(name, fn):
    try:
        status, detail = fn()
    except Exception as exc:                                   # noqa: BLE001
        status, detail = FAIL, f"{type(exc).__name__}: {exc}"
    results.append((status, name, detail))
    print(f"  [{status:4}] {name}: {detail}", flush=True)
    return status


def torch_backend():
    """Which accelerator ml/gpu.py selected, and whether it is real."""
    import torch

    from app.config import settings
    from app.ml import gpu

    kind = gpu.backend()
    if kind == "cpu":
        if platform.system() == "Darwin" and platform.machine() == "arm64":
            return FAIL, ("no GPU backend on an Apple Silicon host. Either "
                          "ML_DEVICE=cpu, or torch has no MPS support — check "
                          "`torch.backends.mps.is_built()`; a CUDA-index wheel "
                          "reports False. Install the default macOS arm64 "
                          "`torch` wheel.")
        return FAIL, ("torch cannot see a GPU. On an NVIDIA box the container "
                      "is missing the nvidia runtime — check "
                      "deploy.resources.reservations in docker-compose.yml, or "
                      "run with `--gpus all`.")
    if kind == "cuda":
        p = torch.cuda.get_device_properties(0)
        return PASS, (f"cuda: {p.name}, {p.total_memory / 1e9:.1f} GB, "
                      f"CUDA {torch.version.cuda}")
    rec = torch.mps.recommended_max_memory() / 1e9
    return PASS, (f"mps: Apple {platform.machine()} GPU, torch "
                  f"{torch.__version__}, {rec:.1f} GB recommended working set "
                  f"(ML_DEVICE={settings.ml_device})")


def unified_budget():
    """On Apple, the two memory budgets divide ONE pool — check they fit it."""
    import torch

    from app.config import settings
    from app.ml import gpu

    if gpu.backend() != "mps":
        return PASS, "not applicable (discrete GPU: the two budgets are separate)"
    total = torch.mps.recommended_max_memory()
    asked = gpu.budget_bytes() + settings.host_memory_limit_bytes
    # GiB, matching gpu.py's own warning — the two printed the same check in
    # different units, which reads as two different numbers.
    gib = 1 << 30
    detail = (f"GPU {settings.gpu_memory_limit_gb:.1f} + host "
              f"{settings.host_memory_limit_gb:.1f} = {asked / gib:.1f} GiB "
              f"against a {total / gib:.1f} GiB recommended working set")
    if asked > total:
        return WARN, (detail + " — OVER-SUBSCRIBED. The GPU and the working "
                      "grid share unified memory; lower both until they sum "
                      "under it or the box will page mid-analysis.")
    return PASS, detail


def metal_ops():
    """Every torch op ml/imageops needs, run on the device for real.

    This is the check with no CUDA equivalent. MPS does not implement all of
    ATen, an unimplemented op raises at call time, and `imageops` catches that
    and falls back to scipy per function — correct, ~100x slower, one WARNING
    line deep in the log. So exercise them here where a gap is a visible FAIL.
    """
    import torch
    import torch.nn.functional as F

    from app.ml import gpu

    if not gpu.enabled():
        return WARN, "no GPU backend"
    dev = gpu.torch_device()
    x = torch.rand(1, 1, 64, 64, device=dev)
    missing = []
    ops = {
        # imageops._box / _dilate_cross: separable and non-square kernels
        "conv2d (1xN kernel)": lambda: F.conv2d(x, x.new_full((1, 1, 1, 5), 0.2)),
        "max_pool2d (3x1)": lambda: F.max_pool2d(x, (3, 1), stride=1),
        # imageops.shift
        "grid_sample": lambda: F.grid_sample(
            x, torch.zeros(1, 64, 64, 2, device=dev), align_corners=True),
        # imageops.robust01 — a full-tensor reduction and a boolean gather
        "median": lambda: torch.median(x),
        "boolean mask index": lambda: x[x > 0.5],
        # imageops._hypot's explicit form, and the fused op it replaces
        "sqrt/mul": lambda: (x * x + x * x).sqrt(),
        "flip (pad_reflect)": lambda: x.flip(-1),
    }
    for name, fn in ops.items():
        try:
            fn()
        except Exception as exc:                               # noqa: BLE001
            missing.append(f"{name} ({type(exc).__name__})")
    try:
        torch.hypot(x, x)
        hypot_ok = True
    except Exception:
        hypot_ok = False
    if missing:
        return FAIL, (f"{len(missing)} op(s) unimplemented on {dev.type}: "
                      + "; ".join(missing) + " — imageops will fall back to "
                      "scipy for the affected stage")
    note = "" if hypot_ok else " (torch.hypot absent — _hypot's explicit form covers it)"
    return PASS, f"all {len(ops)} imageops kernels run on {dev.type}{note}"


def ort_provider():
    """The accelerated ORT provider is present AND actually binds."""
    import onnxruntime as ort
    import torch  # noqa: F401  — on Windows/CUDA this loads the CUDA libs first

    from app.ml import gpu

    expected = gpu.expected_ort_provider()
    if expected is None:
        return WARN, "no GPU backend, so ORT is expected on CPU"
    avail = ort.get_available_providers()
    if expected not in avail:
        hint = ("Wrong package: on Apple Silicon install plain `onnxruntime` "
                "(its arm64 wheel carries the CoreML EP); onnxruntime-gpu is "
                "CUDA-only." if expected == "CoreMLExecutionProvider" else
                "Wrong package: install onnxruntime-gpu, not onnxruntime.")
        return FAIL, f"onnxruntime has no {expected} (has {avail}). {hint}"
    # Availability is not the same as working — build a session and see which
    # provider actually binds. On CUDA this catches a major-version mismatch,
    # which reports 'available' and then fails to load; on CoreML it catches a
    # graph the EP declines and hands back to the CPU.
    try:
        graph = _tiny_onnx()
    except ImportError:
        # The `onnx` package is optional; the building-segmenter check below
        # exercises a real session anyway, so this is not worth failing over.
        return WARN, (f"provider listed ({expected}) but not load-tested — "
                      "`pip install onnx` to enable the direct check")
    sess = ort.InferenceSession(graph, providers=gpu.ort_providers())
    active = sess.get_providers()
    if expected not in active:
        return FAIL, (f"{expected} is listed but failed to BIND (fell back to "
                      f"CPU, active={active}). "
                      + ("Almost always a CUDA major mismatch: onnxruntime-gpu "
                         "must match torch's CUDA version (torch cu12x -> "
                         "onnxruntime-gpu 1.22.x; 1.28 needs CUDA 13)."
                         if expected == "CUDAExecutionProvider" else
                         "Check the onnxruntime version supports CoreML string "
                         "provider options (>= 1.20)."))
    return PASS, f"active providers {active}"


def _tiny_onnx() -> bytes:
    """A 1-node graph, enough to force provider binding."""
    from onnx import TensorProto, helper
    node = helper.make_node("Relu", ["x"], ["y"])
    graph = helper.make_graph(
        [node], "t",
        [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 4])],
        [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1, 4])])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    return model.SerializeToString()


def building_segmenter():
    from app.ml import engine
    b = engine.get_seg_backend()
    t = time.time()
    out = b.segment(np.random.randint(0, 255, (1, b.tile_size, b.tile_size, 3),
                                      dtype=np.uint8))
    dt = time.time() - t
    dev = b.sess.get_providers()[0] if hasattr(b, "sess") else "?"
    # First call includes CoreML's ahead-of-time compile of the graph, which is
    # seconds on a ViT-B and cached afterwards, so time the SECOND one.
    t = time.time()
    b.segment(np.random.randint(0, 255, (1, b.tile_size, b.tile_size, 3),
                                dtype=np.uint8))
    warm = time.time() - t
    # Measured on an M4 Pro: 1.53 s/tile on the CPU EP, 0.93 s on CoreML. The
    # old "> 5 s means CPU fallback" rule was written against a machine where
    # the CPU took ~13 s and cannot tell the two apart here — which provider
    # bound is checked directly above, so this only flags absolute slowness.
    slow = warm > 3.0
    return (WARN if slow else PASS,
            f"{b.name} -> {out.shape} in {dt:.1f}s cold / {warm:.1f}s warm "
            f"on {dev}" + (" — slower than either provider should be" if slow else ""))


def release_segmenter():
    """Drop the ORT session, and report whether the pool actually came back.

    This is not housekeeping, it is the check that the per-stage budget means
    anything on Apple Silicon. torch's MPS watermark counts EVERY Metal
    allocation the process holds, CoreML's included — so a resident ORT session
    is subtracted from the torch budget, and the next stage OOMs at its first
    tensor rather than merely running tight. The engine already releases between
    stages (`release_seg_backend`); doing it here is what makes the checks below
    represent the pipeline instead of a case it never runs.
    """
    import torch

    from app.ml import engine, gpu

    if gpu.backend() != "mps":
        engine.release_seg_backend()
        return PASS, "not applicable (discrete GPU: separate pools)"
    before = torch.mps.driver_allocated_memory()
    engine.release_seg_backend()
    gpu.free()
    after = torch.mps.driver_allocated_memory()
    detail = (f"Metal held {before / 1e9:.1f} GB with the ORT session resident, "
              f"{after / 1e9:.1f} GB after releasing it")
    # CoreML compiles the ViT into 29 partitions and holds their buffers; if it
    # gives none of that back the stages cannot share one 24 GB machine and the
    # answer is BUILDING_BACKEND=geobase, not a bigger budget.
    if after > before * 0.8:
        return WARN, detail + " — CoreML gave back little or nothing"
    return PASS, detail


def landcover():
    from app.ml import gpu
    from app.ml.landcover import get_backend
    b = get_backend()
    t = time.time()
    out = b.probs(np.random.randint(0, 255, (1, b.tile_size, b.tile_size, 3),
                                    dtype=np.uint8))
    return (PASS if b.device == gpu.backend() and gpu.enabled() else WARN,
            f"{b.name} -> {out.shape} in {time.time() - t:.1f}s")


def sam():
    from app.ml import gpu
    from app.ml.sam_refine import get_refiner
    r = get_refiner()
    return (PASS if r.device == gpu.backend() and gpu.enabled() else WARN, r.name)


def headroom():
    import torch

    from app.ml import gpu

    kind = gpu.backend()
    if kind == "cpu":
        return WARN, "no GPU"
    if kind == "cuda":
        free, total = torch.cuda.mem_get_info()
        # All three models stay resident once loaded (module-level caches), so
        # the peak is roughly their sum. On a 6 GB laptop card shared with
        # anything else this is the number that decides whether an analysis OOMs.
        return (WARN if free < 1.0e9 else PASS,
                f"{(total - free) / 1e9:.1f} GB used / {total / 1e9:.1f} GB "
                f"total, {free / 1e9:.1f} GB free")
    # MPS: driver_allocated is what Metal has taken from the system for this
    # process — the figure that is no longer available to the working grid.
    held = torch.mps.driver_allocated_memory()
    rec = torch.mps.recommended_max_memory()
    free = rec - held
    return (WARN if free < 1.0e9 else PASS,
            f"{held / 1e9:.1f} GB held by Metal / {rec / 1e9:.1f} GB "
            f"recommended, {free / 1e9:.1f} GB left in the shared pool")


print("=== ADA GPU smoke test ===")
print(f"  host: {platform.platform()} ({platform.machine()})")
check("torch GPU backend", torch_backend)
check("memory budgets", unified_budget)
check("imageops kernels", metal_ops)
check("onnxruntime provider", ort_provider)
check("building segmenter", building_segmenter)
check("release segmenter", release_segmenter)
check("land cover", landcover)
check("SAM refiner", sam)
check("GPU headroom", headroom)

failed = [r for r in results if r[0] == FAIL]
warned = [r for r in results if r[0] == WARN]
print(f"\n{len(results) - len(failed) - len(warned)} passed, "
      f"{len(warned)} warnings, {len(failed)} failed")
if failed:
    print("\nFIRST FAILURE IS THE ONE TO FIX:")
    print(f"  {failed[0][1]}: {failed[0][2]}")
sys.exit(1 if failed else 0)
