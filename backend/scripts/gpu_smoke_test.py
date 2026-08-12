"""Verify the container actually has the GPU, and that each model reaches it.

Run inside the container:
    docker compose run --rm backend python scripts/gpu_smoke_test.py

Exists because every GPU failure in this stack is SILENT. onnxruntime falls back
to CPUExecutionProvider with a warning, transformers happily runs on CPU, and
the only symptom is that an analysis takes twenty minutes instead of two. This
turns that into an explicit pass/fail before anyone uploads a raster.

Checks, in dependency order — a failure in an early check explains the later
ones, so the first FAIL is the one to fix.
"""
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


def torch_cuda():
    import torch
    if not torch.cuda.is_available():
        return FAIL, ("torch cannot see a GPU. The container is missing the "
                      "nvidia runtime — check deploy.resources.reservations "
                      "in docker-compose.yml, or run with `--gpus all`.")
    p = torch.cuda.get_device_properties(0)
    return PASS, f"{p.name}, {p.total_memory / 1e9:.1f} GB, CUDA {torch.version.cuda}"


def ort_cuda():
    import torch  # noqa: F401  — loads CUDA libs before onnxruntime
    import onnxruntime as ort
    avail = ort.get_available_providers()
    if "CUDAExecutionProvider" not in avail:
        return FAIL, (f"onnxruntime has no CUDA provider (has {avail}). "
                      "Wrong package: install onnxruntime-gpu, not onnxruntime.")
    # Availability is not the same as working — build a session and see which
    # provider actually binds. This is the check that catches a CUDA major
    # version mismatch, which reports 'available' and then fails to load.
    try:
        graph = _tiny_onnx()
    except ImportError:
        # The `onnx` package is optional; the building-segmenter check below
        # exercises a real session anyway, so this is not worth failing over.
        return WARN, (f"provider listed ({avail}) but not load-tested — "
                      "`pip install onnx` to enable the direct check")
    sess = ort.InferenceSession(graph, providers=["CUDAExecutionProvider",
                                                  "CPUExecutionProvider"])
    active = sess.get_providers()
    if "CUDAExecutionProvider" not in active:
        return FAIL, ("CUDAExecutionProvider is listed but failed to LOAD "
                      "(fell back to CPU). Almost always a CUDA major mismatch: "
                      "onnxruntime-gpu must match torch's CUDA version "
                      "(torch cu12x -> onnxruntime-gpu 1.22.x; 1.28 needs CUDA 13).")
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
    from app.services.ml import engine
    b = engine.get_seg_backend()
    t = time.time()
    out = b.segment(np.random.randint(0, 255, (1, b.tile_size, b.tile_size, 3),
                                      dtype=np.uint8))
    dt = time.time() - t
    dev = b.sess.get_providers()[0] if hasattr(b, "sess") else "?"
    slow = dt > 5.0
    return (WARN if slow else PASS,
            f"{b.name} -> {out.shape} in {dt:.1f}s on {dev}"
            + (" — SLOW, this looks like a CPU fallback" if slow else ""))


def landcover():
    from app.services.ml.landcover import get_backend
    b = get_backend()
    t = time.time()
    out = b.probs(np.random.randint(0, 255, (1, b.tile_size, b.tile_size, 3),
                                    dtype=np.uint8))
    return (PASS if b.device == "cuda" else WARN,
            f"{b.name} -> {out.shape} in {time.time() - t:.1f}s")


def sam():
    from app.services.ml.sam_refine import get_refiner
    r = get_refiner()
    return (PASS if r.device == "cuda" else WARN, r.name)


def vram():
    import torch
    if not torch.cuda.is_available():
        return WARN, "no GPU"
    free, total = torch.cuda.mem_get_info()
    used_gb = (total - free) / 1e9
    # All three models stay resident once loaded (module-level caches), so the
    # peak is roughly their sum. On a 6 GB laptop card shared with anything else
    # this is the number that decides whether an analysis OOMs.
    return (WARN if free < 1.0e9 else PASS,
            f"{used_gb:.1f} GB used / {total / 1e9:.1f} GB total, "
            f"{free / 1e9:.1f} GB free")


print("=== ADA GPU smoke test ===")
check("torch CUDA", torch_cuda)
check("onnxruntime CUDA", ort_cuda)
check("building segmenter", building_segmenter)
check("land cover", landcover)
check("SAM refiner", sam)
check("VRAM headroom", vram)

failed = [r for r in results if r[0] == FAIL]
warned = [r for r in results if r[0] == WARN]
print(f"\n{len(results) - len(failed) - len(warned)} passed, "
      f"{len(warned)} warnings, {len(failed)} failed")
if failed:
    print("\nFIRST FAILURE IS THE ONE TO FIX:")
    print(f"  {failed[0][1]}: {failed[0][2]}")
sys.exit(1 if failed else 0)
