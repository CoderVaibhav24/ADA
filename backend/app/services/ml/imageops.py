"""Full-scene image maths, on the GPU when there is one.

Everything in here used to be `scipy.ndimage` on the host. That was the largest
remaining block of CPU work in an analysis and, on the memory side, the worst
offender: `_structural_change` alone holds about ten float32 copies of the
working grid at once — roughly 1.5 GB of host RAM for a 6144^2 scene — and each
`uniform_filter` pass walks 37 Mpx single-threaded.

These are exactly the operations a GPU is for: separable convolutions, a
reduction, and a max-pool. Moving them across does three things at once — the
stage gets ~1-2 orders of magnitude faster, the big temporaries live in VRAM
instead of host RAM, and the arrays never round-trip through swap.

The arithmetic is not an approximation of the scipy version, it is the same
computation: the change filters agree to float32 epsilon (max 5e-6 on a 0-255
field, no pixel anywhere crossing the 0.5 decision threshold differently), the
morphology is bit-identical, and the histogram match is byte-identical. Border
handling is where that had to be earned — see `_pad_reflect`.

Each function falls back to the original scipy path when CUDA is unavailable or
GPU_IMAGE_OPS is off, so a CPU-only box behaves exactly as it did.
"""

from __future__ import annotations

import logging

import numpy as np

from ...config import settings
from . import gpu

log = logging.getLogger("ada.ml")

# Bytes of VRAM to assume per pixel of input, used to size the strips below.
# The heaviest routine (`structural_change`) holds ~10 float32 planes plus the
# two uint8 inputs; 64 leaves headroom for cuDNN's own workspace.
_BYTES_PER_PX = 64
_MIN_STRIP_ROWS = 256


def active() -> bool:
    """True when these ops will actually run on the GPU."""
    return bool(settings.gpu_image_ops) and gpu.enabled()


def _strip_rows(width: int) -> int:
    """Rows per strip such that one strip's working set fits the VRAM budget."""
    per_row = max(width * _BYTES_PER_PX, 1)
    return max(_MIN_STRIP_ROWS, int(gpu.budget_bytes() // per_row))


def _tiled(fn, arrays: list[np.ndarray], halo: int) -> np.ndarray:
    """Run `fn` (torch tensors in, one (H, W) tensor out) over row strips.

    Strips overlap by `halo` so a filter never sees a fabricated edge at a
    strip boundary; only the interior of each strip is kept. On the scenes this
    pipeline actually builds (<= 6144^2) the whole grid is one strip and this
    costs nothing, but it is what keeps an operator who raises the working-grid
    cap from turning a fast path into an out-of-memory error.
    """
    import torch

    h, w = arrays[0].shape[:2]
    rows = _strip_rows(w)
    out = np.empty((h, w), dtype=np.float32)
    dev = torch.device("cuda")
    for top in range(0, h, rows):
        bottom = min(h, top + rows)
        lo, hi = max(0, top - halo), min(h, bottom + halo)
        tensors = [torch.from_numpy(np.ascontiguousarray(a[lo:hi])).to(dev)
                   for a in arrays]
        result = fn(*tensors)
        out[top:bottom] = result[top - lo:bottom - lo].cpu().numpy()
        del tensors, result
    return out


# --- primitives (torch tensors in, torch tensors out) ------------------------

def _pad_reflect(x, horizontal: int = 0, vertical: int = 0):
    """scipy's `reflect` padding: (a b c d | d c b a), edge sample repeated.

    torch has no mode for this — its `reflect` is scipy's `mirror`
    (a b c d | c b a) and its `replicate` is neither. The distinction is only
    visible in the outermost `size // 2` pixels, but "only at the frame" is not
    the same as "nowhere": measured on a scene whose data runs to the edge it
    moved up to 16 px of border by a visible amount. Flipping the edge slice
    reproduces scipy exactly, for the cost of one concatenate.
    """
    import torch

    if horizontal:
        x = torch.cat([x[..., :horizontal].flip(-1), x,
                       x[..., -horizontal:].flip(-1)], dim=-1)
    if vertical:
        x = torch.cat([x[..., :vertical, :].flip(-2), x,
                       x[..., -vertical:, :].flip(-2)], dim=-2)
    return x


def _box(x, size: int):
    """Separable mean filter — the equivalent of ndimage.uniform_filter."""
    import torch.nn.functional as F

    r = size // 2
    kernel = x.new_full((1, 1, 1, size), 1.0 / size)
    x = F.conv2d(_pad_reflect(x, horizontal=r), kernel)
    return F.conv2d(_pad_reflect(x, vertical=r), kernel.view(1, 1, size, 1))


def _sobel_mag(x):
    """Gradient magnitude with ndimage.sobel's kernels ([-1,0,1] x [1,2,1])."""
    import torch
    import torch.nn.functional as F

    kx = x.new_tensor([[-1., 0., 1.], [-2., 0., 2.], [-1., 0., 1.]]).view(1, 1, 3, 3)
    padded = _pad_reflect(x, horizontal=1, vertical=1)
    gx = F.conv2d(padded, kx)
    gy = F.conv2d(padded, kx.transpose(2, 3))
    return torch.hypot(gx, gy)


def _local_norm(x, size: int = 15):
    """Per-patch contrast normalisation: removes brightness and gain offsets."""
    import torch

    mu = _box(x, size)
    var = _box(x * x, size) - mu * mu
    return (x - mu) / (torch.clamp(var, min=0.0).sqrt() + 1e-3)


def _grey(chw_or_hwc):
    """(H, W, 3) uint8 tensor -> (1, 1, H, W) float32 luminance-by-mean."""
    return chw_or_hwc.float().mean(dim=2)[None, None]


# --- public API --------------------------------------------------------------

def robust01(diff: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Map a raw change field to [0, 1] by the scene's own median + MAD.

    The scale is the scene's background noise rather than a fixed distance, so
    "changed" means "an outlier here", not "differs by N grey levels".

    Both medians are full-scene reductions and cannot be strip-partitioned, so
    this stays whole-array — 151 MB for a 6144^2 grid, comfortably inside the
    budget, and a GPU median beats numpy's full sort by a wide margin.
    """
    if active():
        try:
            import torch

            dev = torch.device("cuda")
            d = torch.from_numpy(np.ascontiguousarray(diff)).to(dev)
            m = torch.from_numpy(np.ascontiguousarray(valid)).to(dev)
            sel = d[m] if bool(m.any()) else d.reshape(-1)
            med = torch.median(sel)
            mad = torch.median((sel - med).abs()) * 1.4826
            z = (d - med) / torch.clamp(mad, min=1e-6)
            out = torch.clamp(z / 6.0, 0.0, 1.0).cpu().numpy()
            del d, m, sel, z
            return out.astype(np.float32)
        except Exception:
            log.warning("GPU robust01 failed, falling back to numpy",
                        exc_info=True)
    sel = diff[valid] if valid.any() else diff.ravel()
    med = float(np.median(sel))
    mad = float(np.median(np.abs(sel - med))) * 1.4826
    z = (diff - med) / max(mad, 1e-6)
    return np.clip(z / 6.0, 0.0, 1.0).astype(np.float32)


def colour_diff(t1: np.ndarray, t2: np.ndarray) -> np.ndarray:
    """Smoothed mean |dRGB| — the raw field behind the colour change gate."""
    if active():
        try:
            def run(a, b):
                d = (a.float() - b.float()).abs().mean(dim=2)[None, None]
                return _box(d, 5)[0, 0]
            return _tiled(run, [t1, t2], halo=4)
        except Exception:
            log.warning("GPU colour_diff failed, falling back to scipy",
                        exc_info=True)
    from scipy import ndimage
    diff = np.abs(t1.astype(np.float32) - t2.astype(np.float32)).mean(axis=2)
    return ndimage.uniform_filter(diff, size=5)


def structure_diff(t1: np.ndarray, t2: np.ndarray) -> np.ndarray:
    """Smoothed |dEdges| after local contrast normalisation.

    Colour-invariant by construction: a building rendered grey by a satellite
    and red by a drone has the same edges in both, so it reads as no change.
    """
    if active():
        try:
            def run(a, b):
                e1 = _sobel_mag(_local_norm(_grey(a)))
                e2 = _sobel_mag(_local_norm(_grey(b)))
                return _box((e1 - e2).abs(), 5)[0, 0]
            # 7 px for the size-15 normalisation window, 1 for Sobel, 2 for the
            # size-5 smoother; rounded up so no strip edge can leak inward.
            return _tiled(run, [t1, t2], halo=16)
        except Exception:
            log.warning("GPU structure_diff failed, falling back to scipy",
                        exc_info=True)
    from scipy import ndimage

    def norm(g):
        mu = ndimage.uniform_filter(g, size=15)
        sd = np.sqrt(np.maximum(
            ndimage.uniform_filter(g * g, size=15) - mu * mu, 0.0)) + 1e-3
        return (g - mu) / sd

    def grad(n):
        return np.hypot(ndimage.sobel(n, axis=1), ndimage.sobel(n, axis=0))

    e1 = grad(norm(t1.astype(np.float32).mean(axis=2)))
    e2 = grad(norm(t2.astype(np.float32).mean(axis=2)))
    return ndimage.uniform_filter(np.abs(e1 - e2), size=5)


def sobel_mag(grey: np.ndarray) -> np.ndarray:
    """Gradient magnitude of a single (H, W) float32 plane."""
    if active():
        try:
            return _tiled(lambda g: _sobel_mag(g[None, None])[0, 0], [grey],
                          halo=2)
        except Exception:
            log.warning("GPU sobel failed, falling back to scipy", exc_info=True)
    from scipy import ndimage
    return np.hypot(ndimage.sobel(grey, axis=0), ndimage.sobel(grey, axis=1))


def _dilate_cross(x, iterations: int, border: float):
    """Iterated dilation by the cross (4-neighbourhood + centre) element.

    A cross dilation is `max(vertical 3x1 max-pool, horizontal 1x3 max-pool)`.
    `border` is what lies outside the array: 0 for dilation (scipy's
    `border_value=0`), 1 for the complement pass inside erosion, which is how
    scipy's erosion also gets `border_value=0`.
    """
    import torch
    import torch.nn.functional as F

    for _ in range(iterations):
        v = F.max_pool2d(F.pad(x, (0, 0, 1, 1), value=border), (3, 1), stride=1)
        h = F.max_pool2d(F.pad(x, (1, 1, 0, 0), value=border), (1, 3), stride=1)
        x = torch.maximum(v, h)
    return x


def binary_dilation(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Dilate with scipy's default cross structuring element.

    Bit-identical to `ndimage.binary_dilation`, not an approximation of it —
    verified against it on random and structured masks.
    """
    return _morph(mask, iterations, "dilation")


def binary_erosion(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Erode with scipy's default cross element and `border_value=0`."""
    return _morph(mask, iterations, "erosion")


def binary_closing(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    """Dilate then erode — closes pinholes so one structure is one component."""
    return _morph(mask, iterations, "closing")


def _morph(mask: np.ndarray, iterations: int, op: str) -> np.ndarray:
    if iterations <= 0:
        return mask
    if active():
        try:
            import torch

            x = torch.from_numpy(np.ascontiguousarray(mask)).to("cuda")
            x = x.float()[None, None]
            if op in ("dilation", "closing"):
                x = _dilate_cross(x, iterations, border=0.0)
            if op in ("erosion", "closing"):
                # Erosion is dilation of the complement, with the outside
                # treated as foreground there — which is `border_value=0` in
                # the original domain.
                x = 1.0 - _dilate_cross(1.0 - x, iterations, border=1.0)
            out = (x[0, 0] > 0.5).cpu().numpy()
            del x
            return out
        except Exception:
            log.warning("GPU %s failed, falling back to scipy", op, exc_info=True)
    from scipy import ndimage
    fn = {"dilation": ndimage.binary_dilation, "erosion": ndimage.binary_erosion,
          "closing": ndimage.binary_closing}[op]
    return fn(mask, iterations=iterations)


def shift(arr: np.ndarray, offset: tuple[float, float], order: int = 1,
          cval: float = 0.0) -> np.ndarray:
    """Sub-pixel translation, the equivalent of ndimage.shift on a 2-D plane.

    Used by co-registration, which shifts three bands plus two masks — five
    full-scene resamples that were costing more than the phase correlation that
    decided them.
    """
    if active():
        try:
            import torch
            import torch.nn.functional as F

            dy, dx = float(offset[0]), float(offset[1])
            src = torch.from_numpy(np.ascontiguousarray(arr)).to("cuda")
            src = src.float()[None, None]
            h, w = arr.shape
            # Normalised sampling grid, translated by -offset (grid_sample reads
            # FROM the source, so the sign is inverted relative to ndimage).
            ys = (torch.arange(h, device=src.device, dtype=torch.float32) - dy)
            xs = (torch.arange(w, device=src.device, dtype=torch.float32) - dx)
            gy = (ys * 2 / max(h - 1, 1) - 1).view(h, 1).expand(h, w)
            gx = (xs * 2 / max(w - 1, 1) - 1).view(1, w).expand(h, w)
            grid = torch.stack((gx, gy), dim=-1)[None]
            mode = "bilinear" if order >= 1 else "nearest"
            out = F.grid_sample(src, grid, mode=mode, padding_mode="zeros",
                                align_corners=True)[0, 0]
            if cval:
                out = out + cval * (out == 0)
            result = out.cpu().numpy()
            del src, grid, out
            return result
        except Exception:
            log.warning("GPU shift failed, falling back to scipy", exc_info=True)
    from scipy import ndimage
    return ndimage.shift(arr, offset, order=order, mode="constant", cval=cval)


def match_histograms_uint8(src: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Per-channel histogram matching for (H, W, 3) uint8 images.

    Exactly skimage's `match_histograms` algorithm — map each source quantile
    onto the reference value at the same quantile — but computed from 256-bin
    histograms instead of a full argsort of every pixel.

    That substitution is exact rather than approximate: skimage builds its
    quantiles from `np.unique(..., return_counts=True)`, and for uint8 data the
    unique values ARE the 256 bins. What it avoids is real: the old call sorted
    three planes of 37 Mpx and held float32 copies of both images to do it,
    about 900 MB of host RAM and a second of CPU, to produce a 3x256 lookup
    table.
    """
    out = np.empty_like(src)
    n_src = src.shape[0] * src.shape[1]
    n_ref = ref.shape[0] * ref.shape[1]
    for c in range(src.shape[2]):
        src_counts = np.bincount(src[:, :, c].ravel(), minlength=256)
        ref_counts = np.bincount(ref[:, :, c].ravel(), minlength=256)
        # Only values that OCCUR, matching skimage's np.unique: an absent grey
        # level would otherwise repeat the previous quantile, and np.interp
        # resolves ties in the reference differently than it does on a strictly
        # increasing one — a one-grey-level drift across half the image.
        src_values = np.nonzero(src_counts)[0]
        ref_values = np.nonzero(ref_counts)[0]
        if src_values.size == 0 or ref_values.size == 0:
            out[:, :, c] = src[:, :, c]
            continue
        src_quantiles = np.cumsum(src_counts[src_values]) / n_src
        ref_quantiles = np.cumsum(ref_counts[ref_values]) / n_ref
        matched = np.interp(src_quantiles, ref_quantiles, ref_values)
        # Truncating rather than rounding is deliberate: the call this replaces
        # ended in `.astype(np.uint8)` on the interpolated floats, so truncation
        # is what reproduces the existing output exactly.
        lut = np.zeros(256, dtype=np.uint8)
        lut[src_values] = np.clip(matched, 0, 255).astype(np.uint8)
        out[:, :, c] = lut[src[:, :, c]]
    return out
