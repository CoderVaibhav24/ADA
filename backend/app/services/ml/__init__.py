"""ML package init — makes the GPU reachable before onnxruntime is imported.

Why this exists: onnxruntime-gpu links against CUDA/cuDNN DLLs that it does NOT
ship. On Windows the only copies on a typical dev box are the ones vendored
inside the `torch` wheel (torch/lib/cublasLt64_12.dll, cudnn_*64_9.dll, ...),
and they are not on the process DLL search path unless torch is imported first
AND that directory is registered explicitly.

Get this wrong and onnxruntime does NOT raise. It logs a warning and silently
falls back to CPUExecutionProvider, which for the ChangeStar ViT-B means ~13 s
per 1024x1024 tile with every core pinned — minutes of full-load CPU per
analysis, and a very hot laptop. That failure mode cost us a run already, so
the search path is fixed up here, once, at package import.

Version pin that matters: onnxruntime-gpu must match the CUDA major version
torch was built against. torch cu128 -> CUDA 12 -> onnxruntime-gpu 1.22.x.
onnxruntime-gpu 1.28 requires CUDA 13 and will fail to load against a CUDA 12
torch build.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

log = logging.getLogger("ada.ml")


def _register_cuda_dlls() -> None:
    """Put torch's bundled CUDA/cuDNN DLLs on the DLL search path (Windows)."""
    if not hasattr(os, "add_dll_directory"):     # non-Windows: loader handles it
        return
    try:
        import torch
    except ImportError:
        return
    lib = Path(torch.__file__).parent / "lib"
    if lib.is_dir():
        try:
            os.add_dll_directory(str(lib))
        except OSError:                           # already registered / no access
            pass


_register_cuda_dlls()
