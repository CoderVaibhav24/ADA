"""Raster ingestion + cross-sensor superimposing.

Ingestion: any GeoTIFF (with embedded georef or .tfw sidecar) -> cropped,
losslessly narrowed archive master + 8-bit display COG + metadata.

Superimposing (the T1/T2 alignment): reproject both rasters onto one
common working grid (reference CRS, coarser resolution), refine with
sub-pixel phase cross-correlation, then histogram-match T2 to T1 so
sensor/lighting differences are not flagged as change.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import os
import random
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from ada_core.storage import MissingImageryError
from rasterio.crs import CRS
from rasterio.enums import ColorInterp, MaskFlags, Resampling
from rasterio.errors import RasterioError
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds
from rasterio.windows import Window
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
from scipy import ndimage
from skimage.registration import phase_cross_correlation

from .ml import imageops

log = logging.getLogger("ada.preprocess")

MAX_WORKING_DIM = 6144          # hard ceiling on the common-grid size
# Host bytes held per working-grid pixel at the pipeline's peak: the two uint8
# epochs (6) and their masks (4), two float32 footprint maps (8), two float16
# land-cover stacks at 7 classes (28) plus the float32 accumulator that builds
# one of them (28), the probability map and the instance id map (8), and the
# change/vegetation temporaries. Measured, then rounded up.
PIPELINE_BYTES_PER_PX = 110
# Share of the host budget the working grid may claim. The rest is the models,
# GDAL's block cache, and the interpreter itself.
WORKING_GRID_RAM_SHARE = 0.45
STATS_SAMPLE_DIM = 2048         # decimated read used for scene-wide statistics
INGEST_BLOCK_BYTES = 256 << 20  # target working-set per ingest strip (~256 MB)
MAX_TRUSTED_SHIFT_PX = 32.0     # phase-corr shifts beyond this are rejected
MIN_SHIFT_IMPROVEMENT = 0.02    # edge agreement must rise by this much to apply
GRID_MATCH_TOL_M = 0.01         # bounds/res closer than this = identical grid
TILE = 512                      # archive/COG block size; ingest strips are multiples of it
BOUNDS_TRIM_PCT = (0.5, 99.5)   # row/col percentiles kept when sizing the analysis grid
ISLAND_SHARE = 0.01             # grid keeps valid regions >= this share of the largest
VERIFY_BLOCKS = 16              # archive blocks compared pixel-exact against the upload
HASH_CHUNK = 8 << 20

# on_progress(fraction 0..1, human-readable stage)
ProgressFn = Callable[[float, str], None]


# Validation failures that no retry can fix: the upload itself is unreadable or unusable.
class IngestRejected(ValueError):
    pass


# The archive did not match the upload; the raw file must be kept and the ingest retried.
class IngestVerificationError(RuntimeError):
    pass


# Index-mode vegetation needs raw bands, and a cold raster's archive is in the bucket.
class ColdRasterError(MissingImageryError):
    def __init__(self, raster_id: int | None) -> None:
        super().__init__(f"raster {raster_id} is archived; restore it via "
                         f"POST /rasters/{raster_id}/restore")
        self.raster_id = raster_id


def working_dim_cap() -> int:
    """Largest common-grid side the host memory budget will carry.

    The 6144 ceiling stays what it always was; this only lowers it when the
    budget cannot support it. Deriving the number instead of hard-coding it is
    what makes HOST_MEMORY_LIMIT_GB an actual limit rather than a comment — set
    it to 8 and the grid drops to ~5900 px on its own, rather than the process
    discovering the shortfall by swapping.
    """
    from .config import settings

    budget = settings.host_memory_limit_bytes * WORKING_GRID_RAM_SHARE
    dim = int(math.sqrt(budget / PIPELINE_BYTES_PER_PX))
    return max(1024, min(MAX_WORKING_DIM, dim))


def _gdal_env(**extra):
    """A rasterio Env carrying the configured block cache.

    Every block GDAL keeps here is a block it does not re-read from disk while
    warping or building overviews, which is where essentially all of this
    pipeline's disk traffic comes from. The default is 5% of RAM; on a machine
    with a declared budget we can be far more generous, and trading host RAM for
    disk I/O is precisely the trade this pipeline wants.
    """
    from .config import settings

    return rasterio.Env(GDAL_CACHEMAX=settings.gdal_cache_mb,
                        GDAL_NUM_THREADS="ALL_CPUS", **extra)


def _edge_agreement(g1: np.ndarray, g2: np.ndarray, mask: np.ndarray) -> float:
    """Colour-invariant alignment score: correlation of the two edge maps.

    Buildings produce edges in both epochs regardless of how each sensor
    renders their colour, so this rises only when structures actually line up
    — unlike |Δgrey|, which a spurious shift can reduce just by smearing a
    systematic brightness offset around.
    """
    e1, e2 = imageops.sobel_mag(g1)[mask], imageops.sobel_mag(g2)[mask]
    if e1.size < 100:
        return 0.0
    e1 = e1 - e1.mean()
    e2 = e2 - e2.mean()
    denom = float(np.sqrt((e1 * e1).sum() * (e2 * e2).sum()))
    return float((e1 * e2).sum() / denom) if denom > 1e-9 else 0.0


def _detect_false_color_ir(arr: np.ndarray, valid: np.ndarray) -> bool:
    """Detect a CIR (NIR-R-G) false-color composite, where vegetation
    renders bright red. NIR is highly reflective over vegetation and
    decorrelated from the visible bands; true-color R/G/B are not."""
    if arr.shape[0] < 3 or valid.sum() < 1000:
        return False
    b1, b2, b3 = (arr[i][valid].astype(np.float32) for i in range(3))
    ndvi = (b1 - b2) / (b1 + b2 + 1e-6)
    if float((ndvi > 0.25).mean()) < 0.08:
        return False
    c12 = np.corrcoef(b1, b2)[0, 1]
    c23 = np.corrcoef(b2, b3)[0, 1]
    return bool(c23 > c12 + 0.08)


def _cir_to_pseudo_natural(arr: np.ndarray) -> np.ndarray:
    """(NIR, R, G) -> pseudo natural (R, G, synthetic B) so a false-color
    satellite epoch can be compared against a true-color drone epoch."""
    _, red, green = arr[0], arr[1], arr[2]
    return np.stack([red, green, 0.75 * green])


def _normalize_spectral(arr: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, bool]:
    if _detect_false_color_ir(arr, valid):
        return _cir_to_pseudo_natural(arr), True
    return arr, False


def _vegetation_mask_raw(arr: np.ndarray, valid: np.ndarray, is_cir: bool) -> np.ndarray:
    """Vegetation mask on RAW band values (before stretch/histogram match).

    CIR epoch: true NDVI from the NIR band — the strongest veg signal.
    RGB epoch: normalized excess-green (scale-invariant on any dtype).
    """
    a = arr.astype(np.float32)
    if is_cir:
        nir, red = a[0], a[1]
        index = (nir - red) / (nir + red + 1e-6)
        mask = index > 0.25
    else:
        r, g, b = a[0], a[1], a[2]
        exg = (2 * g - r - b) / (r + g + b + 1e-6)
        mask = (exg > 0.04) & (g > r) & (g > b)
    return mask & valid


def _stretch_to_uint8(arr: np.ndarray, valid: np.ndarray | None = None) -> np.ndarray:
    """Percentile (2-98) stretch each band to 1..255, 0 reserved for nodata."""
    out = np.zeros(arr.shape, dtype=np.uint8)
    for b in range(arr.shape[0]):
        band = arr[b].astype(np.float32)
        sel = band[valid] if valid is not None else band.ravel()
        sel = sel[np.isfinite(sel)]
        if sel.size == 0:
            continue
        lo, hi = np.percentile(sel, (2, 98))
        if hi <= lo:
            hi = lo + 1
        scaled = np.clip((band - lo) / (hi - lo), 0, 1) * 254 + 1
        out[b] = scaled.astype(np.uint8)
    if valid is not None:
        out[:, ~valid] = 0
    return out


def _read_rgb(src: rasterio.DatasetReader, vrt_opts: dict | None = None) -> np.ndarray:
    """Read up to 3 bands (replicating band 1 for single-band rasters)."""
    reader = WarpedVRT(src, **vrt_opts) if vrt_opts else src
    try:
        indexes = [1, 2, 3] if reader.count >= 3 else [1, 1, 1]
        return reader.read(indexes)
    finally:
        if vrt_opts:
            reader.close()


# --- The validity contract ---------------------------------------------------
#
# Exactly one question decides whether a pixel exists: does the source's own
# mask say so? Every stage downstream — stretching, CIR detection, vegetation
# indices, segmentation, change gating, vectorisation — receives `valid` and
# must apply it. Deriving validity any other way is what broke this pipeline
# twice: a "brightness > 0" test silently classifies ADA's declared nodata fill
# (65535) as the brightest data in the scene, which both destroys the percentile
# stretch and feeds pure padding to the models as though it were ground.


def _read_epoch(src: rasterio.DatasetReader,
                vrt_opts: dict) -> tuple[np.ndarray, np.ndarray]:
    """Read one epoch onto the working grid, already filtered.

    Returns (bands, valid) where `bands` is (3, H, W) float32 with every
    invalid pixel forced to 0, and `valid` is the authoritative mask carried
    through the rest of the pipeline. The mask comes from the warped dataset
    mask, so declared nodata, an alpha band and the reprojection footprint are
    all honoured by the same code path.
    """
    with WarpedVRT(src, **vrt_opts) as vrt:
        indexes = [1, 2, 3] if vrt.count >= 3 else [1, 1, 1]
        bands = vrt.read(indexes).astype(np.float32)
        valid = vrt.dataset_mask() > 0

    # Belt and braces: if a source declares nodata but carries no usable mask,
    # drop exact nodata matches too. Costs one comparison, closes the gap where
    # a malformed mask would let the fill value through.
    for nodata in {v for v in (src.nodatavals or ()) if v is not None}:
        fill = np.isnan(bands) if math.isnan(nodata) else bands == np.float32(nodata)
        valid &= ~np.all(fill, axis=0)
    valid &= _no_nan(bands)

    bands[:, ~valid] = 0.0
    return bands, valid



# Km, not degrees: extent and m/px are what an officer and the stats line read.
def _metric_extent(bounds, crs: CRS) -> tuple[float, float]:
    """(east-west, north-south) size of `bounds` in kilometres."""
    w, s, e, n = bounds
    if crs.is_geographic:
        lat = math.radians((s + n) / 2)
        return abs(e - w) * 111.320 * math.cos(lat), abs(n - s) * 110.574
    try:
        factor = float(crs.linear_units_factor[1])
    except Exception:
        factor = 1.0
    return abs(e - w) * factor / 1000, abs(n - s) * factor / 1000


# window_bounds uses two corners, which is wrong once the transform is rotated.
def _window_bounds(transform, window: Window) -> tuple[float, float, float, float]:
    t = transform * rasterio.Affine.translation(window.col_off, window.row_off)
    xs, ys = zip(*(t * (c, r) for c, r in ((0, 0), (window.width, 0), (0, window.height),
                                           (window.width, window.height))), strict=True)
    return min(xs), min(ys), max(xs), max(ys)


def _window_extent_km(src, window: Window) -> tuple[float, float]:
    """Ground size of a window in km, from pixel size along each (possibly rotated) axis."""
    t = src.transform
    xres, yres = math.hypot(t.a, t.d), math.hypot(t.b, t.e)
    if src.crs.is_geographic:
        w, s, e, n = _window_bounds(t, window)
        xres *= 111_320 * math.cos(math.radians((s + n) / 2))
        yres *= 110_574
    else:
        try:
            factor = float(src.crs.linear_units_factor[1])
        except Exception:
            factor = 1.0
        xres, yres = xres * factor, yres * factor
    return window.width * xres / 1000, window.height * yres / 1000


def _m_per_px(extent_km: tuple[float, float], width: float, height: float) -> float:
    return (extent_km[0] * 1000 / max(width, 1) + extent_km[1] * 1000 / max(height, 1)) / 2


# One stray valid pixel in a far corner otherwise stretches the box back to the whole canvas.
def _main_region(mask: np.ndarray, share: float = ISLAND_SHARE) -> np.ndarray:
    """8-connected valid regions at least `share` of the largest one's size."""
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=bool))
    if count <= 1:
        return mask
    sizes = np.bincount(labels.ravel())[1:]
    keep = (np.flatnonzero(sizes >= sizes.max() * share) + 1).tolist()
    return np.isin(labels, keep)


def _data_bounds(src: rasterio.DatasetReader, dst_crs: CRS, max_dim: int = 1024,
                 trim: bool = True) -> tuple[tuple[float, float, float, float], Window]:
    """Geographic bounds of the pixels that carry data, and that window in source pixels.

    ADA's survey grid tiles arrive as a small populated region inside a very
    large nodata canvas — the sample tile measured 2.1% real data. Sizing the
    working grid from the declared extent therefore spends the entire
    resolution budget on emptiness: 3.24 m/px across the padded canvas versus
    0.40 m/px across the real data, which is the difference between a building
    being three pixels and being resolvable. Falls back to the full extent when
    the raster has no padding to trim.

    trim=True (grid): sizeable regions, percentile-trimmed; False (ingest crop): every valid pixel.
    """
    full = Window(0, 0, src.width, src.height)
    scale = max(src.width / max_dim, src.height / max_dim, 1.0)
    shape = (max(1, int(src.height / scale)), max(1, int(src.width / scale)))
    # average, not nearest: a valid patch smaller than one cell must still mark its cell.
    mask = src.dataset_mask(out_shape=shape, resampling=Resampling.average) > 0
    if not mask.any() and not trim:
        raise IngestRejected("The upload has no valid pixels; every pixel is nodata.")
    if not mask.any() or mask.all():
        return transform_bounds(src.crs, dst_crs, *src.bounds), full

    region = _main_region(mask) if trim else mask
    rows, cols = np.nonzero(region)
    if trim:
        r0, r1 = np.percentile(rows, BOUNDS_TRIM_PCT)
        c0, c1 = np.percentile(cols, BOUNDS_TRIM_PCT)
    else:
        r0, r1, c0, c1 = rows.min(), rows.max(), cols.min(), cols.max()
    # Scale the decimated indices back to full-resolution pixel coordinates,
    # padding by one decimated cell so a partially-covered edge is not clipped.
    row_px, col_px = src.height / shape[0], src.width / shape[1]
    top = max(0, int(math.floor((r0 - 1) * row_px)))
    bottom = min(src.height, int(math.ceil((r1 + 2) * row_px)))
    left = max(0, int(math.floor((c0 - 1) * col_px)))
    right = min(src.width, int(math.ceil((c1 + 2) * col_px)))
    window = Window(left, top, right - left, bottom - top)

    native = _window_bounds(src.transform, window)
    km = _window_extent_km(src, window)
    log.info("data bounds: %.2f x %.2f km at %.3f m/px, window %dx%d+%d+%d "
             "(%.1f%% of the canvas, %d stray decimated px ignored)",
             km[0], km[1], _m_per_px(km, window.width, window.height),
             window.width, window.height, left, top,
             100 * window.width * window.height / (src.width * src.height),
             int(mask.sum() - region.sum()))
    return transform_bounds(src.crs, dst_crs, *native), window


def _decimated_rgb(src: rasterio.DatasetReader,
                   max_dim: int = STATS_SAMPLE_DIM) -> np.ndarray:
    """Whole-extent read, decimated to at most `max_dim` on the long side.

    Percentile stretch limits and the CIR test are *global* properties of the
    scene, and both are statistics — they converge long before you have read
    every pixel. Sampling them from a decimated read is what lets ingestion of
    an arbitrarily large raster run in bounded memory.

    Kept for small rasters and for callers that need full spatial extent. For
    ingestion statistics use `_sample_rgb` instead — see the note there on why a
    decimated whole-extent read is a trap on large tiled files.
    """
    scale = max(src.width / max_dim, src.height / max_dim, 1.0)
    out_h = max(1, int(src.height / scale))
    out_w = max(1, int(src.width / scale))
    indexes = [1, 2, 3] if src.count >= 3 else [1, 1, 1]
    return src.read(indexes, out_shape=(len(indexes), out_h, out_w),
                    resampling=Resampling.nearest).astype(np.float32)



def _sample_rgb(src: rasterio.DatasetReader, max_windows: int = 96, win: int = 256,
                crop: Window | None = None
                ) -> tuple[np.ndarray, np.ndarray, tuple[float, float] | None]:
    """Read a scattered grid of small windows. Returns (pixels, valid, dn_range).

    Why not a decimated whole-extent read: on a large TILED raster, decimation
    does not reduce I/O. A 26824x39854 upload decimated to 2048 samples every
    ~19th pixel, but the file's blocks are 128x128 — so consecutive sampled
    pixels land in DIFFERENT blocks and GDAL ends up reading essentially every
    block in the file. Measured on that upload: 155 s with `average`, and 520 s
    with `nearest`, which is why switching the resampling method fixed nothing.
    The cost is set by the block layout, not by the output size.

    Reading whole windows inverts that: 96 windows of 256x256 is ~37 Mpx of
    contiguous blocks instead of 1069 Mpx of scattered ones, and every byte read
    contributes to the statistics. Percentiles and the CIR band correlation are
    scene-level aggregates that converge on far fewer samples than this.

    The windows are laid out on a regular grid rather than at random so the
    sample is spatially stratified — a corner-heavy random draw would bias the
    stretch on a scene whose exposure varies across the frame. Grid tiles are
    also frequently mostly nodata (this upload's probe windows were 100% fill),
    so windows are collected until enough VALID pixels accumulate.

    `crop` confines the grid to the data window; `dn_range` is the min/max raw
    value over valid pixels of every band, the hint for dtype narrowing.
    """
    crop = crop or Window(0, 0, src.width, src.height)
    cw, ch = int(crop.width), int(crop.height)
    ox, oy = int(crop.col_off), int(crop.row_off)
    ratio = max(ch / max(cw, 1), 1e-6)
    cols = max(1, int(round((max_windows / ratio) ** 0.5)))
    rows = max(1, max_windows // cols)

    blocks, masks, valid_px = [], [], 0
    lo, hi = math.inf, -math.inf
    for r in range(rows):
        for c in range(cols):
            top = min(int((r + 0.5) * ch / rows) - win // 2, ch - win)
            left = min(int((c + 0.5) * cw / cols) - win // 2, cw - win)
            window = Window(ox + max(0, left), oy + max(0, top), min(win, cw), min(win, ch))
            block = src.read(window=window)
            m = _valid_mask(src, block, window=window)
            rgb = block[:3] if src.count >= 3 else block[[0, 0, 0]]
            blocks.append(rgb.astype(np.float32))
            masks.append(m)
            if m.any():
                vals = block[:, m]
                lo, hi = min(lo, float(vals.min())), max(hi, float(vals.max()))
            valid_px += int(m.sum())

    sample = np.concatenate(blocks, axis=1)
    valid = np.concatenate(masks, axis=0)
    if valid_px == 0:
        log.warning("ingest: sampled %d windows and found no valid pixels — "
                    "the raster may be entirely nodata", len(blocks))
    return sample, valid, ((lo, hi) if valid_px else None)


def _valid_mask(src: rasterio.DatasetReader, block: np.ndarray,
                window: Window | None = None,
                out_shape: tuple[int, int] | None = None) -> np.ndarray:
    """Validity for an already-read block, avoiding a second pass when possible.

    `dataset_mask()` is correct but costs a whole extra read of the same pixels
    — measured at 173 s on the 1069 Mpx upload, on top of the read that just
    happened. When the dataset declares a nodata value, the mask is by
    definition derivable from the pixels already in hand: a pixel is nodata only
    where every band equals the nodata value, which is precisely how GDAL builds
    the dataset-level mask from per-band nodata.

    Anything more exotic — an alpha band, an internal .msk, per-band nodata —
    still goes through dataset_mask, because reconstructing those from pixels is
    not possible. Correctness first; the fast path only covers the case where it
    is provably equivalent.
    """
    nodata = src.nodata
    has_alpha = any(ci is not None and ci.name == "alpha"
                    for ci in (src.colorinterp or []))
    if nodata is not None and not has_alpha:
        if math.isnan(nodata):
            valid = ~np.all(np.isnan(block), axis=0)
        else:
            valid = ~np.all(block == nodata, axis=0)
    elif out_shape is not None:
        valid = src.dataset_mask(out_shape=out_shape) > 0
    else:
        valid = src.dataset_mask(window=window) > 0
    return valid & _no_nan(block)


# NaN in any band makes the pixel unusable: it would reach the uint8 cast and the models.
def _no_nan(block: np.ndarray) -> np.ndarray | bool:
    if block.dtype.kind != "f":
        return True
    return ~np.isnan(block).any(axis=0)


def _stretch_params(arr: np.ndarray,
                    valid: np.ndarray) -> list[tuple[float, float]]:
    """Per-band (2nd, 98th) percentile limits, computed once for the scene."""
    params: list[tuple[float, float]] = []
    for b in range(arr.shape[0]):
        sel = arr[b][valid]
        sel = sel[np.isfinite(sel)]
        if sel.size == 0:
            params.append((0.0, 1.0))
            continue
        lo, hi = (float(v) for v in np.percentile(sel, (2, 98)))
        params.append((lo, hi if hi > lo else lo + 1.0))
    return params


def _apply_stretch(arr: np.ndarray, params: list[tuple[float, float]],
                   valid: np.ndarray) -> np.ndarray:
    """Apply scene-wide stretch limits to one block. 0 is reserved for nodata."""
    out = np.zeros(arr.shape, dtype=np.uint8)
    for b, (lo, hi) in enumerate(params):
        scaled = np.clip((arr[b] - lo) / (hi - lo), 0, 1) * 254 + 1
        out[b] = scaled.astype(np.uint8)
    out[:, ~valid] = 0
    return out


def _strip_windows(crop: Window, count: int) -> list[Window]:
    """Full-width strips of the crop in whole tile rows, each near INGEST_BLOCK_BYTES."""
    per_row = max(int(crop.width) * max(count, 3) * 4, 1)     # float32 working copy
    rows = int(min(4096, max(TILE, INGEST_BLOCK_BYTES / per_row))) // TILE * TILE
    top0, bottom = int(crop.row_off), int(crop.row_off + crop.height)
    return [Window(int(crop.col_off), top, int(crop.width), min(rows, bottom - top))
            for top in range(top0, bottom, rows)]


# Ingest phase weights, from measured runs on ADA's grid tiles. The strip pass
# reads and converts every pixel; the COG copy re-reads and re-tiles them; the
# overview pyramid is the tail after the copy reports 100% and is the phase most
# likely to look like a hang, so it gets its own visible slice.
STRIP_START, STRIP_SHARE = 0.05, 0.55       # 0.05 -> 0.60
COG_START, COG_SHARE = 0.62, 0.28           # 0.62 -> 0.90
OVERVIEW_START = 0.90                       # 0.90 -> 1.00


def _cog_reporter(report: ProgressFn) -> ProgressFn:
    """Map cog_translate's own 0-1 progress into the ingest's COG slice.

    Once the block copy reports 100% the remaining work — the overview pyramid
    and tag rewrite — emits nothing we can hook, so the bar parks at the start
    of its slice with an honest label rather than sitting at "100%" for another
    half minute.
    """
    def relay(fraction: float, stage: str) -> None:
        if fraction >= 1.0:
            report(OVERVIEW_START, "Building overview pyramid")
        else:
            report(COG_START + COG_SHARE * fraction, stage)

    return relay


class _CogProgress(io.TextIOBase):
    """Turn rio-cogeo's click progress bar into periodic log lines.

    Building the COG is the second half of an ingest and, on a gigapixel
    raster, the longer one — but it logged nothing at all between "building
    COG" and the row flipping to `ready`, so there was no way to tell a slow
    job from a hung one.

    rio-cogeo will drive a `click.progressbar` at any file passed as
    `progress_out`, but click renders a bar only when it believes it is writing
    to a terminal, and a log stream is not one — it emits the label once and
    then stays silent. So this claims to be a tty and parses the percentage back
    out of what click draws. Coarse on purpose: one line per `step` percent,
    because the question being answered is "is it still moving", not "exactly
    how far".
    """

    def __init__(self, label: str, step: int = 10,
                 on_percent: ProgressFn | None = None) -> None:
        self.label = label
        self.step = step
        self.on_percent = on_percent
        self._last = -1

    def isatty(self) -> bool:                 # what makes click render at all
        return True

    def write(self, text: str) -> int:
        try:
            found = re.findall(r"(\d{1,3})\s*%", text)
            if found:
                percent = int(found[-1])
                if percent >= self._last + self.step or percent == 100:
                    self._last = percent
                    log.info("%s: %d%%", self.label, percent)
                if self.on_percent is not None:
                    self.on_percent(percent / 100.0, f"Building COG ({percent}%)")
        except Exception:                     # never let logging break an ingest
            log.debug("COG progress parse failed", exc_info=True)
        return len(text)

    def flush(self) -> None:
        pass


def _build_cog(source, cog_path: Path, dst_profile: dict, in_memory: bool,
               label: str, on_percent: ProgressFn | None = None) -> None:
    """cog_translate with progress reporting and a timing summary."""
    started = time.perf_counter()
    log.info("%s: starting (block copy, then overview pyramid)", label)
    cog_translate(source, str(cog_path), dst_profile,
                  in_memory=in_memory, quiet=False,
                  progress_out=_CogProgress(label, on_percent=on_percent),
                  config={"GDAL_NUM_THREADS": "ALL_CPUS"})
    size_gb = cog_path.stat().st_size / (1 << 30) if cog_path.is_file() else 0.0
    log.info("%s: done in %.1f s, %.2f GB written to %s",
             label, time.perf_counter() - started, size_gb, cog_path.name)


@dataclass
class IngestResult:
    cog_path: Path
    archive_path: Path
    raw_sha256: str
    archive_sha256: str
    archive_bytes: int
    crop_window: tuple[int, int, int, int]       # col_off, row_off, width, height (source px)
    extent_km: tuple[float, float]
    m_per_px: float
    narrowed_dtype: str                          # archive dtype (== source dtype when not narrowed)
    crs: str = ""
    bounds_4326: list[float] | None = None
    resolution_m: float = 0.0

    def row_fields(self) -> dict:
        """Raster columns this ingest sets."""
        return {"crs": self.crs, "bounds_4326": self.bounds_4326,
                "resolution_m": self.resolution_m, "sha256": self.raw_sha256,
                "archive_path": str(self.archive_path),
                "archive_sha256": self.archive_sha256,
                "archive_bytes": self.archive_bytes}


@dataclass
class _ArchivePlan:
    dtype: str
    nodata: float | None
    masked: bool        # validity carried by an internal mask, not a nodata value
    narrowed: bool


# Raised mid-pass when a strip holds a value the narrowed dtype cannot represent.
class _NarrowingAborted(Exception):
    pass


def default_archive_path(original_path: Path) -> Path:
    return Path(original_path).with_name(f"{Path(original_path).stem}.archive.tif")


def ingest_scratch_paths(cog_path: Path, archive_path: Path) -> list[Path]:
    """Checkpoint files an interrupted ingest leaves: display tmp, sidecar(s), archive tmp."""
    cog = Path(cog_path)
    return [cog.with_suffix(".tmp.tif"), cog.with_suffix(".tmp.json"),
            cog.with_suffix(".tmp.json.part"), Path(archive_path).with_suffix(".tmp.tif")]


def _fits(value: float, dtype: str) -> bool:
    info = np.iinfo(dtype)
    return float(value).is_integer() and info.min <= value <= info.max


def _plan_archive(src: rasterio.DatasetReader,
                  dn_range: tuple[float, float] | None, native: bool = False) -> _ArchivePlan:
    """Pick the archive dtype and how nodata survives the cast."""
    source = np.dtype(src.dtypes[0])
    target = source
    if not native and dn_range is not None and np.issubdtype(source, np.integer):
        lo, hi = dn_range
        if lo >= 0 and hi <= 255 and source.itemsize > 1:
            target = np.dtype("uint8")
        # No NBITS=12 for 12-bit data: GDAL refuses NBITS together with PREDICTOR=2.
        elif lo >= 0 and hi <= 65535 and source.itemsize > 2:
            target = np.dtype("uint16")
    narrowed = target != source
    nodata = src.nodata
    has_alpha = any(ci == ColorInterp.alpha for ci in (src.colorinterp or []))
    if nodata is not None and narrowed and not _fits(nodata, target.name):
        return _ArchivePlan(target.name, None, True, narrowed)
    if nodata is None:
        all_valid = all(MaskFlags.all_valid in flags for flags in src.mask_flag_enums)
        return _ArchivePlan(target.name, None, not (all_valid or has_alpha), narrowed)
    return _ArchivePlan(target.name, nodata, False, narrowed)


def _to_archive(block: np.ndarray, valid: np.ndarray, plan: _ArchivePlan) -> np.ndarray:
    """Cast one source block to the archive dtype, refusing values that do not fit."""
    if not plan.narrowed:
        return block
    if valid.any():
        vals = block[:, valid]
        if vals.min() < 0 or vals.max() > np.iinfo(plan.dtype).max:
            raise _NarrowingAborted(f"value {vals.max()} exceeds {plan.dtype}")
    out = block.astype(plan.dtype)
    out[:, ~valid] = plan.nodata if plan.nodata is not None else 0
    return out


def _tiles_with_data(valid: np.ndarray, first_row: int) -> list[list[int]]:
    """[bx, by] of every archive tile in this strip holding a valid pixel."""
    out = []
    for r in range(0, valid.shape[0], TILE):
        for c in range(0, valid.shape[1], TILE):
            if valid[r:r + TILE, c:c + TILE].any():
                out.append([c // TILE, (first_row + r) // TILE])
    return out


def _overview_factors(width: int, height: int, min_size: int = 256) -> list[int]:
    factors, f = [], 2
    while max(width, height) / f >= min_size:
        factors.append(f)
        f *= 2
    return factors


def _fsync(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


# The sidecar is the checkpoint's truth; written atomically so a kill never leaves half a JSON.
def _save_checkpoint(path: Path, state: dict) -> None:
    part = path.with_suffix(".json.part")
    part.write_text(json.dumps(state))
    os.replace(part, path)


# Streams the whole upload through sha256 on its own thread while the strip pass reads the crop.
class _Sha256Reader(threading.Thread):
    def __init__(self, path: Path) -> None:
        super().__init__(name="ada-ingest-sha256", daemon=True)
        self.path, self.digest, self.error = path, "", None
        self.stop = threading.Event()

    def run(self) -> None:
        try:
            h = hashlib.sha256()
            with open(self.path, "rb") as f:
                while not self.stop.is_set() and (chunk := f.read(HASH_CHUNK)):
                    h.update(chunk)
            self.digest = h.hexdigest()
        except BaseException as exc:             # surfaced by result()
            self.error = exc

    def result(self) -> str:
        self.join()
        if self.error is not None:
            raise self.error
        return self.digest


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(HASH_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def _create_outputs(src, crop: Window, plan: _ArchivePlan,
                    archive_tmp: Path, display_tmp: Path) -> None:
    """Create both staging files empty; every strip is then written into them in r+ mode."""
    transform = src.window_transform(crop)
    common = {"driver": "GTiff", "width": int(crop.width), "height": int(crop.height),
              "crs": src.crs, "transform": transform, "tiled": True,
              "blockxsize": TILE, "blockysize": TILE, "compress": "zstd",
              "zstd_level": 9, "BIGTIFF": "IF_SAFER", "interleave": "pixel"}
    predictor = 2 if np.issubdtype(np.dtype(plan.dtype), np.integer) else 3
    with rasterio.open(archive_tmp, "w", dtype=plan.dtype, count=src.count,
                       nodata=plan.nodata, predictor=predictor, **common) as dst:
        dst.colorinterp = src.colorinterp
    with rasterio.open(display_tmp, "w", dtype="uint8", count=3, nodata=0,
                       predictor=2, **common):
        pass


def _write_strip(archive_tmp: Path, display_tmp: Path, window: Window,
                 archive_block: np.ndarray, mask: np.ndarray | None,
                 display_block: np.ndarray) -> None:
    """Write one strip into both staging files and make it durable before the checkpoint says so."""
    with rasterio.open(archive_tmp, "r+") as dst:
        dst.write(archive_block, window=window)
        if mask is not None:
            dst.write_mask(mask, window=window)
    with rasterio.open(display_tmp, "r+") as dst:
        dst.write(display_block, window=window)
    _fsync(archive_tmp)
    _fsync(display_tmp)


def _resume_state(sidecar: Path, key: dict, archive_tmp: Path, display_tmp: Path) -> dict | None:
    """The checkpoint, if it is for this upload and crop and both staging files agree with it."""
    try:
        state = json.loads(sidecar.read_text())
    except (OSError, ValueError):
        return None
    if any(state.get(k) != v for k, v in key.items()):
        log.info("ingest: checkpoint %s is for a different upload or crop; starting over",
                 sidecar.name)
        return None
    width, height = key["crop"][2], key["crop"][3]
    try:
        with rasterio.open(archive_tmp) as a, rasterio.open(display_tmp) as d:
            ok = ((a.width, a.height, a.count, a.dtypes[0])
                  == (width, height, key["count"], state["plan"]["dtype"])
                  and (d.width, d.height, d.count, d.dtypes[0]) == (width, height, 3, "uint8"))
    except (RasterioError, OSError, KeyError):
        ok = False
    if not ok:
        log.info("ingest: staging files do not match the checkpoint; starting over")
        return None
    return state


def _strip_pass(src, crop: Window, strips: list[Window], plan: _ArchivePlan,
                params: list[tuple[float, float]], is_cir: bool, start: int,
                archive_tmp: Path, display_tmp: Path, sidecar: Path, state: dict,
                report: ProgressFn) -> None:
    """Convert strips `start..` into the archive and display staging files, checkpointing each."""
    total = len(strips)
    for i in range(start, total):
        window = strips[i]
        block = src.read(window=window)
        valid = _valid_mask(src, block, window=window)
        archive_block = _to_archive(block, valid, plan)
        rgb = (block[:3] if src.count >= 3 else block[[0, 0, 0]]).astype(np.float32)
        if is_cir:
            rgb = _cir_to_pseudo_natural(rgb)
        rel = Window(0, window.row_off - crop.row_off, window.width, window.height)
        _write_strip(archive_tmp, display_tmp, rel, archive_block,
                     valid.astype(np.uint8) * 255 if plan.masked else None,
                     _apply_stretch(rgb, params, valid))
        state["done"] = i + 1
        state["valid_tiles"] = [t for t in state.get("valid_tiles", [])
                                if t[1] * TILE < rel.row_off] + _tiles_with_data(
                                    valid, int(rel.row_off))
        _save_checkpoint(sidecar, state)
        log.info("ingest: strip %s/%s", i + 1, total)
        report(STRIP_START + STRIP_SHARE * (i + 1) / total, f"strip:{i + 1}/{total}")


def _build_archive_overviews(archive_tmp: Path, plan: _ArchivePlan) -> None:
    with rasterio.open(archive_tmp) as a:
        factors = _overview_factors(a.width, a.height)
    if not factors:
        return
    predictor = "2" if np.issubdtype(np.dtype(plan.dtype), np.integer) else "3"
    with rasterio.Env(COMPRESS_OVERVIEW="ZSTD", ZSTD_LEVEL_OVERVIEW="9",
                      PREDICTOR_OVERVIEW=predictor, GDAL_TIFF_INTERNAL_MASK=True), \
            rasterio.open(archive_tmp, "r+") as dst:
        dst.build_overviews(factors, Resampling.average)
        dst.update_tags(ns="rio_overview", resampling="average")


def _same_transform(a, b) -> bool:
    pairs = zip(tuple(a)[:6], tuple(b)[:6], strict=True)
    return all(abs(x - y) <= 1e-9 * max(1.0, abs(y)) for x, y in pairs)


# A wrong archive is worse than none: it replaces the raw upload, so it must match pixel for pixel.
# All-nodata tiles prove nothing, and the footprint's extremes are where a crop error shows.
def _pick_tiles(valid_tiles: list[list[int]], blocks: int) -> list[tuple[int, int]]:
    tiles = sorted({(int(bx), int(by)) for bx, by in valid_tiles})
    if not tiles:
        raise IngestVerificationError("archive verification failed: no tile holds valid data")
    if len(tiles) <= blocks:
        return tiles
    corners = {min(tiles, key=lambda t: t[0] + t[1]), max(tiles, key=lambda t: t[0] + t[1]),
               min(tiles, key=lambda t: t[0] - t[1]), max(tiles, key=lambda t: t[0] - t[1])}
    rest = [t for t in tiles if t not in corners]
    return sorted(corners) + random.sample(rest, blocks - len(corners))


def _verify_archive(src, archive: Path, crop: Window, plan: _ArchivePlan,
                    valid_tiles: list[list[int]], blocks: int = VERIFY_BLOCKS) -> None:
    """Reopen the archive; compare structure, outermost and random data tiles to the upload."""
    width, height = int(crop.width), int(crop.height)
    with rasterio.open(archive) as arc:
        problems = []
        if (arc.width, arc.height) != (width, height):
            problems.append(f"size {arc.width}x{arc.height} != crop {width}x{height}")
        if arc.count != src.count:
            problems.append(f"{arc.count} bands != {src.count}")
        if arc.dtypes[0] != plan.dtype:
            problems.append(f"dtype {arc.dtypes[0]} != {plan.dtype}")
        if arc.crs != src.crs:
            problems.append("CRS differs from the upload")
        if not _same_transform(arc.transform, src.window_transform(crop)):
            problems.append("geotransform differs from the crop")
        if (arc.compression is None or arc.compression.name.lower() != "zstd"):
            problems.append(f"compression {arc.compression}")
        if _overview_factors(width, height) and not arc.overviews(1):
            problems.append("overviews missing")
        if problems:
            raise IngestVerificationError("archive verification failed: " + "; ".join(problems))

        for bx, by in _pick_tiles(valid_tiles, blocks):
            aw = Window(bx * TILE, by * TILE, min(TILE, width - bx * TILE),
                        min(TILE, height - by * TILE))
            sw = Window(crop.col_off + aw.col_off, crop.row_off + aw.row_off, aw.width, aw.height)
            s = src.read(window=sw)
            sv = _valid_mask(src, s, window=sw)
            a = arc.read(window=aw)
            av = (arc.dataset_mask(window=aw) > 0) & _no_nan(a)
            if not np.array_equal(av, sv):
                bad = "validity mask"
            elif plan.narrowed:
                bad = "" if np.array_equal(a[:, sv].astype(np.int64),
                                           s[:, sv].astype(np.int64)) else "pixel values"
            else:
                bad = "" if np.array_equal(a, s, equal_nan=a.dtype.kind == "f") else "pixel values"
            if bad:
                raise IngestVerificationError(
                    f"archive verification failed: {bad} differ in block ({bx}, {by})")


# Pixels outside the crop are lost with the raw file; a band one decimation cell wide must be empty.
def _check_crop_margins(src, crop: Window, max_dim: int = 1024) -> None:
    step = math.ceil(max(src.width / max_dim, src.height / max_dim, 1.0))
    c0, r0 = int(crop.col_off), int(crop.row_off)
    c1, r1 = c0 + int(crop.width), r0 + int(crop.height)
    top, bottom = max(0, r0 - step), min(src.height, r1 + step)
    bands = [(c0, top, c1 - c0, r0 - top), (c0, r1, c1 - c0, bottom - r1),
             (max(0, c0 - step), top, c0 - max(0, c0 - step), bottom - top),
             (c1, top, min(src.width, c1 + step) - c1, bottom - top)]
    found = 0
    for col, row, width, height in bands:
        if width > 0 and height > 0:
            window = Window(col, row, width, height)
            found += int(_valid_mask(src, src.read(window=window), window=window).sum())
    if found:
        raise IngestVerificationError(
            f"crop verification failed: {found} valid pixels just outside the crop "
            f"{(c0, r0, c1 - c0, r1 - r0)}")


def ingest_raster(original_path: Path, cog_path: Path,
                  on_progress: ProgressFn | None = None,
                  archive_path: Path | None = None) -> IngestResult:
    """Crop to the data, write the archive master and the display COG in one strip pass, verify.

    Streams the source in row strips. The previous implementation read the
    whole raster and cast it to float32 up front, which costs ~12 bytes per
    pixel: a 1 Gpx orthophoto needed ~12.8 GB of RAM before it wrote anything,
    so ADA's own grid tiles (6-20 GB on disk) could not be ingested at all on a
    normal machine. Peak memory here is one strip, independent of file size.

    `on_progress(fraction, stage)` is called throughout so the caller can show
    the officer where a long ingest has got to; strips report "strip:{n}/{total}".
    An interrupted pass resumes from the `.tmp.json` checkpoint beside the COG.
    """
    report = on_progress or (lambda fraction, stage: None)
    original_path = Path(original_path)
    archive_path = Path(archive_path) if archive_path else default_archive_path(original_path)
    display_tmp, sidecar, _, archive_tmp = ingest_scratch_paths(cog_path, archive_path)
    Path(cog_path).parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    try:
        opened = rasterio.open(original_path)
    except RasterioError as exc:
        raise IngestRejected(f"The upload is not a readable GeoTIFF: {exc}") from exc
    hasher = _Sha256Reader(original_path)
    with _gdal_env(GDAL_TIFF_INTERNAL_MASK=True), opened as src:
        if src.crs is None:
            raise IngestRejected(
                "Raster has no CRS. Upload the matching .tfw AND .prj/.aux.xml "
                "sidecar files, or a GeoTIFF with embedded geo-referencing."
            )
        hasher.start()
        try:
            report(0.01, "Finding the data footprint")
            _, crop = _data_bounds(src, src.crs, trim=False)
            _check_crop_margins(src, crop)
            strips = _strip_windows(crop, src.count)
            stat = original_path.stat()
            key = {"source_size": stat.st_size, "source_mtime": int(stat.st_mtime),
                   "width": src.width, "height": src.height, "count": src.count,
                   "source_dtype": src.dtypes[0],
                   "crop": [int(crop.col_off), int(crop.row_off),
                            int(crop.width), int(crop.height)],
                   "strips": len(strips), "strip_rows": int(strips[0].height)}

            state = _resume_state(sidecar, key, archive_tmp, display_tmp)
            if state is not None:
                plan = _ArchivePlan(**state["plan"])
                params = [tuple(p) for p in state["params"]]
                is_cir = bool(state["is_cir"])
                log.info("ingest: resuming %s from strip %s/%s", original_path.name,
                         state["done"] + 1, len(strips))
            else:
                # Validity from the mask, never "any band > 0": nodata 65535 reads as brightest.
                report(0.02, "Sampling the scene for colour statistics")
                sample, sample_valid, dn_range = _sample_rgb(src, crop=crop)
                sample, is_cir = _normalize_spectral(sample, sample_valid)
                params = _stretch_params(sample, sample_valid)
                del sample, sample_valid
                plan = _plan_archive(src, dn_range)
                log.info("ingest: sampled DN range %s -> archive %s%s", dn_range, plan.dtype,
                         " (narrowed)" if plan.narrowed else "")

            for attempt in range(2):
                if state is None:
                    state = {**key, "plan": plan.__dict__, "params": params,
                             "is_cir": is_cir, "done": 0, "overviews": False,
                             "valid_tiles": []}
                    _create_outputs(src, crop, plan, archive_tmp, display_tmp)
                    _save_checkpoint(sidecar, state)
                try:
                    _strip_pass(src, crop, strips, plan, params, is_cir, state["done"],
                                archive_tmp, display_tmp, sidecar, state, report)
                    break
                except _NarrowingAborted as exc:
                    if attempt:
                        raise
                    log.warning("ingest: %s; rewriting the archive as %s", exc, src.dtypes[0])
                    plan, state = _plan_archive(src, None, native=True), None
            log.info("ingest: strip pass done in %.1f s", time.perf_counter() - started)

            if not state.get("overviews"):
                report(STRIP_START + STRIP_SHARE, "Building archive overviews")
                _build_archive_overviews(archive_tmp, plan)
                state["overviews"] = True
                _save_checkpoint(sidecar, state)
                report(COG_START, "Archive overviews built")

            # BIGTIFF: rio-cogeo stages with these options; classic TIFF stops at 4 GB.
            dst_profile = cog_profiles.get("zstd")
            dst_profile.update({"BIGTIFF": "YES", "predictor": 2})
            _build_cog(str(display_tmp), cog_path, dst_profile, False,
                       "ingest: building COG", _cog_reporter(report))

            report(0.95, "Verifying archive against the upload")
            try:
                _verify_archive(src, archive_tmp, crop, plan, state["valid_tiles"])
            except IngestVerificationError:
                archive_tmp.unlink(missing_ok=True)
                sidecar.unlink(missing_ok=True)
                raise
            os.replace(archive_tmp, archive_path)
            report(0.96, "Archive verified")

            while hasher.is_alive():
                report(0.97, "Checksumming the upload")
                hasher.join(15)
            raw_sha = hasher.result()
            archive_sha = _file_sha256(archive_path)
            report(0.98, "Checksummed")
        except BaseException:
            hasher.stop.set()
            raise

        display_tmp.unlink(missing_ok=True)
        sidecar.unlink(missing_ok=True)
        report(0.99, "Finalising")

        native = _window_bounds(src.transform, crop)
        km = _window_extent_km(src, crop)
        res_x = math.hypot(src.transform.a, src.transform.d)
        res_m = res_x * 111_320 if src.crs.is_geographic else res_x
        result = IngestResult(
            cog_path=Path(cog_path), archive_path=archive_path,
            raw_sha256=raw_sha, archive_sha256=archive_sha,
            archive_bytes=archive_path.stat().st_size,
            crop_window=tuple(key["crop"]), extent_km=(round(km[0], 3), round(km[1], 3)),
            m_per_px=round(_m_per_px(km, crop.width, crop.height), 4),
            narrowed_dtype=plan.dtype, crs=str(src.crs),
            bounds_4326=list(transform_bounds(src.crs, CRS.from_epsg(4326), *native)),
            resolution_m=round(float(res_m), 4),
        )
    log.info("ingest: %s done in %.1f s — crop %s, %.2f x %.2f km at %.3f m/px, archive %s "
             "%.1f MB, verified", original_path.name, time.perf_counter() - started,
             result.crop_window, *result.extent_km, result.m_per_px, result.narrowed_dtype,
             result.archive_bytes / 1e6)
    return result


@dataclass
class AlignedPair:
    t1: np.ndarray            # (H, W, 3) uint8
    t2: np.ndarray            # (H, W, 3) uint8, aligned + histogram-matched to t1
    valid: np.ndarray         # (H, W) bool — pixels valid in BOTH epochs
    transform: rasterio.Affine
    crs: CRS
    resolution_m: float
    shift_px: tuple[float, float]
    cir_corrected: tuple[bool, bool] = (False, False)  # (t1, t2) false-color fixed
    veg1: np.ndarray | None = None  # vegetation in T1 (from raw bands)
    veg2: np.ndarray | None = None  # vegetation in T2 (from raw bands)
    grid_extent_km: tuple[float, float] = (0.0, 0.0)  # (east-west, north-south) of the grid
    grid_m_per_px: float = 0.0
    grid_bounds_4326: list[float] | None = None       # [w, s, e, n]
    source_tier: str = "raw"                          # archive | cog | raw


@dataclass
class EpochSource:
    """Every file one epoch can be warped from; superimpose picks among them."""
    original: Path | None = None
    cog: Path | None = None
    archive: Path | None = None
    cold: bool = False                 # archive lives in the cold bucket, not on disk
    raster_id: int | None = None


def _usable(path: Path | None) -> Path | None:
    return Path(path) if path is not None and Path(path).is_file() else None


# The COG lost raw band values (stretched, CIR-converted); index-mode vegetation needs them.
def _pick_source(source: EpochSource, raw_bands: bool) -> tuple[Path, str]:
    """(path, tier): raw_bands prefers archive then original; else COG, archive, original."""
    archive, original, cog = (_usable(source.archive), _usable(source.original),
                              _usable(source.cog))
    if raw_bands:
        if archive:
            return archive, "archive"
        if original:
            return original, "raw"
        if source.cold:
            raise ColdRasterError(source.raster_id)
    else:
        for path, tier in ((cog, "cog"), (archive, "archive"), (original, "raw")):
            if path:
                return path, tier
        if source.cold:
            raise ColdRasterError(source.raster_id)
    raise MissingImageryError(
        f"Source imagery for raster {source.raster_id} is missing on disk "
        f"({source.archive or source.original}). Re-upload the imagery and re-run the analysis.")


# Mixed tiers report the one that lost raw band values, since that bounds what the run could see.
def _pair_tier(a: str, b: str) -> str:
    if a == b:
        return a
    return "cog" if "cog" in (a, b) else "archive"


def superimpose(path_t1: Path | EpochSource, path_t2: Path | EpochSource,
                cog_t1: Path | None = None,
                cog_t2: Path | None = None,
                max_dim: int | None = None) -> AlignedPair:
    """Put both rasters onto one common grid, aligned pixel-to-pixel.

    Pass `EpochSource`s (or originals plus `cog_t1`/`cog_t2`); `_pick_source`
    chooses archive, COG or original per SUPERIMPOSE_SOURCE and the vegetation
    mode. `max_dim` lowers the working-grid cap below the memory-derived one.
    """
    from .config import settings

    e1 = path_t1 if isinstance(path_t1, EpochSource) else EpochSource(original=path_t1,
                                                                        cog=cog_t1)
    e2 = path_t2 if isinstance(path_t2, EpochSource) else EpochSource(original=path_t2,
                                                                        cog=cog_t2)
    use_cog = settings.superimpose_source != "original"
    if use_cog and settings.superimpose_source == "auto":
        # Raw bands are still required by the index-based vegetation masks.
        use_cog = settings.vegetation_mode == "learned"
    src_t1, tier1 = _pick_source(e1, raw_bands=not use_cog)
    src_t2, tier2 = _pick_source(e2, raw_bands=not use_cog)
    source_tier = _pair_tier(tier1, tier2)
    log.info("superimpose: reading %s / %s", tier1, tier2)

    with _gdal_env(), rasterio.open(src_t1) as s1, rasterio.open(src_t2) as s2:
        if s1.crs is None or s2.crs is None:
            raise ValueError("Both rasters need a CRS for alignment.")
        crs = s1.crs

        # T2 footprint + resolution expressed in the T1 CRS
        b2_full = transform_bounds(s2.crs, crs, *s2.bounds)
        res2_x = (b2_full[2] - b2_full[0]) / s2.width
        res2_y = (b2_full[3] - b2_full[1]) / s2.height
        res = max(abs(s1.transform.a), abs(s1.transform.e), res2_x, res2_y)

        # Overlap of the two DATA footprints, not of their declared extents.
        # Nodata padding is not ground, so it must not consume the working grid.
        b1, _ = _data_bounds(s1, crs)
        b2, _ = _data_bounds(s2, crs)
        w, s_, e, n = (max(b1[0], b2[0]), max(b1[1], b2[1]),
                       min(b1[2], b2[2]), min(b1[3], b2[3]))
        if w >= e or s_ >= n:
            raise ValueError(
                "The two rasters carry no overlapping data. They may cover "
                "different areas, or one may be entirely nodata."
            )

        # Working grid at the coarser resolution (capped for memory)
        width = math.ceil((e - w) / res)
        height = math.ceil((n - s_) / res)
        cap = min(working_dim_cap(), max_dim) if max_dim else working_dim_cap()
        scale = max(width / cap, height / cap, 1.0)
        if scale > 1.0:
            res *= scale
            width = math.ceil((e - w) / res)
            height = math.ceil((n - s_) / res)
        transform = from_origin(w, n, res, res)

        # Do the two sources already sit on exactly the same grid? If so their
        # geo-referencing is authoritative and no residual shift search is
        # warranted (see the co-registration guards below).
        grids_identical = (
            s1.crs == s2.crs
            and s1.width == s2.width and s1.height == s2.height
            and all(abs(a - b) <= GRID_MATCH_TOL_M
                    for a, b in zip(s1.bounds, s2.bounds, strict=True))
            and abs(abs(s1.transform.a) - abs(s2.transform.a)) <= GRID_MATCH_TOL_M
            and abs(abs(s1.transform.e) - abs(s2.transform.e)) <= GRID_MATCH_TOL_M
        )

        # src_nodata must be declared on the VRT. Without it the warp
        # interpolates the fill value into its neighbours, so a bilinear
        # resample smears 65535 across the boundary and contaminates real
        # pixels — damage that no downstream mask can undo, because by then
        # the corrupted values sit inside the valid area.
        vrt_opts = dict(crs=crs, transform=transform, width=width, height=height,
                        resampling=Resampling.bilinear)
        arr1, valid1 = _read_epoch(s1, vrt_opts)
        arr2, valid2 = _read_epoch(s2, vrt_opts)

    grid_native = (w, n - height * res, w + width * res, n)
    grid_km = _metric_extent(grid_native, crs)
    grid_m_px = _m_per_px(grid_km, width, height)
    log.info("superimpose: working grid %sx%s @ %.3f m/px (%.2f x %.2f km, source %s); "
             "valid coverage T1 %.1f%%, T2 %.1f%%, overlap %.1f%%",
             width, height, grid_m_px, grid_km[0], grid_km[1], source_tier,
             100 * valid1.mean(), 100 * valid2.mean(), 100 * (valid1 & valid2).mean())
    # Spectral normalization: convert any CIR false-color epoch to pseudo
    # natural color so vegetation doesn't read as change vs a true-color epoch
    cir1 = _detect_false_color_ir(arr1, valid1)
    cir2 = _detect_false_color_ir(arr2, valid2)
    # Vegetation from RAW bands (NDVI for CIR, excess-green for RGB) —
    # must happen before stretch/histogram matching wipes out the signal
    veg1 = _vegetation_mask_raw(arr1, valid1, cir1)
    veg2 = _vegetation_mask_raw(arr2, valid2, cir2)
    if cir1:
        arr1 = _cir_to_pseudo_natural(arr1)
    if cir2:
        arr2 = _cir_to_pseudo_natural(arr2)
    t1 = _stretch_to_uint8(arr1, valid1)
    t2 = _stretch_to_uint8(arr2, valid2)

    # Sub-pixel residual co-registration (phase correlation on grayscale).
    #
    # Two guards, both learned the hard way:
    #  (a) If the two rasters already share an identical grid (same CRS, same
    #      bounds, same resolution) their geo-referencing IS the alignment.
    #      Running phase correlation there can only invent a shift, and a
    #      fabricated 3 m offset manufactures a "new building" sliver along
    #      every single wall in the scene.
    #  (b) Otherwise a candidate shift must improve a COLOUR-INVARIANT measure
    #      (correlation of edge maps). Raw |Δgrey| is dominated by the
    #      satellite-vs-drone colour difference, so it can be "improved" by a
    #      shift that actually destroys the alignment.
    shift_yx = (0.0, 0.0)
    if grids_identical:
        log.info("co-registration: grids identical, trusting geo-referencing")
    else:
        # float64, as numpy's integer mean gives: the phase correlation below
        # is host-side scipy where the width is free. The GPU image ops cannot
        # take fp64 on Metal, but they narrow it themselves at the device
        # boundary rather than making every caller think about it — see
        # imageops._as_device_array.
        g1 = t1.mean(axis=0)
        g2 = t2.mean(axis=0)
        try:
            shift, _, _ = phase_cross_correlation(g1, g2, upsample_factor=10)
            candidate = (float(shift[0]), float(shift[1]))
            if (np.all(np.abs(shift) <= MAX_TRUSTED_SHIFT_PX)
                    and any(abs(v) > 0.05 for v in candidate)):
                g2_shifted = imageops.shift(g2, candidate, order=1)
                overlap = valid1 & valid2 & (g2_shifted > 0)
                if overlap.sum() > 10_000:
                    before = _edge_agreement(g1, g2, overlap)
                    after = _edge_agreement(g1, g2_shifted, overlap)
                    if after > before + MIN_SHIFT_IMPROVEMENT:
                        shift_yx = candidate
                        # Five full-scene resamples — three bands and two masks
                        # — which on the GPU cost less than the phase
                        # correlation that decided to do them.
                        t2 = np.stack([
                            imageops.shift(t2[b].astype(np.float32), shift_yx,
                                           order=1)
                            for b in range(3)
                        ]).clip(0, 255).astype(np.uint8)
                        # Shift the mask itself rather than re-deriving it from
                        # brightness: a genuinely black but valid pixel would
                        # otherwise be dropped, and the shifted-in border would
                        # be counted as data.
                        valid2 = imageops.shift(valid2.astype(np.float32),
                                                shift_yx, order=0) > 0.5
                        veg2 = imageops.shift(veg2.astype(np.float32), shift_yx,
                                              order=0) > 0.5
                        log.info("co-registration: applied shift %s "
                                 "(edge agreement %.3f -> %.3f)",
                                 shift_yx, before, after)
                    else:
                        log.info("co-registration: rejected shift %s "
                                 "(edge agreement %.3f -> %.3f, no gain)",
                                 candidate, before, after)
        except Exception:
            log.warning("co-registration: phase correlation failed, using "
                        "geo-referencing only", exc_info=True)

    # A pixel is comparable only where BOTH epochs observed ground.
    valid = valid1 & valid2
    if not valid.any():
        raise ValueError(
            "The two epochs share no commonly observed ground after masking "
            "nodata. Check that both rasters cover the same area and that "
            "their nodata values are declared correctly."
        )

    # Radiometric normalization: histogram-match T2 onto T1.
    #
    # skimage's match_histograms argsorts every pixel of both images to build
    # its quantiles. On a 6144^2 grid that is three planes of 37 Mpx sorted
    # twice, plus float32 copies of both epochs to sort — about 900 MB of host
    # RAM and a second of CPU to produce what is, for uint8 input, a 3x256
    # lookup table. imageops computes that table from 256-bin histograms
    # instead: byte-identical output, a fraction of the memory.
    if valid.any():
        t2 = imageops.match_histograms_uint8(
            t2.transpose(1, 2, 0), t1.transpose(1, 2, 0)).transpose(2, 0, 1)

    # Single exit point for the contract: nothing leaves this function carrying
    # values outside the commonly observed area. Downstream stages still apply
    # `valid` themselves, but they no longer have to be trusted to do so for
    # correctness of the pixel values they read.
    t1[:, ~valid] = 0
    t2[:, ~valid] = 0
    veg1 &= valid
    veg2 &= valid

    log.info("superimpose: %.1f%% of the working grid is comparable ground",
             100 * valid.mean())

    res_m = res * 111_320 if crs.is_geographic else res
    return AlignedPair(
        t1=t1.transpose(1, 2, 0),
        t2=t2.transpose(1, 2, 0),
        valid=valid,
        transform=transform,
        crs=crs,
        resolution_m=float(res_m),
        shift_px=shift_yx,
        cir_corrected=(cir1, cir2),
        veg1=veg1,
        veg2=veg2,
        grid_extent_km=(round(grid_km[0], 3), round(grid_km[1], 3)),
        grid_m_per_px=round(grid_m_px, 4),
        grid_bounds_4326=list(transform_bounds(crs, CRS.from_epsg(4326), *grid_native)),
        source_tier=source_tier,
    )


def write_rgb_geotiff(rgb_hwc: np.ndarray, transform, crs, out_path: Path) -> None:
    """Persist an aligned (H, W, 3) uint8 scene, tiled for fast window reads."""
    profile = {
        "driver": "GTiff", "dtype": "uint8", "count": 3,
        "width": rgb_hwc.shape[1], "height": rgb_hwc.shape[0],
        "crs": crs, "transform": transform, "nodata": 0,
        "tiled": True, "blockxsize": 256, "blockysize": 256,
        "compress": "zstd", "predictor": 2,
    }
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(rgb_hwc.transpose(2, 0, 1))


def write_mask_cog(prob: np.ndarray, valid: np.ndarray, transform, crs,
                   out_path: Path) -> None:
    """Persist the change-probability map (0-100 uint8) as a COG."""
    band = np.clip(prob * 100, 0, 100).astype(np.uint8)
    band[~valid] = 255  # nodata
    profile = {
        "driver": "GTiff", "dtype": "uint8", "count": 1,
        "width": band.shape[1], "height": band.shape[0],
        "crs": crs, "transform": transform, "nodata": 255,
    }
    with MemoryFile() as mem:
        with mem.open(**profile) as tmp:
            tmp.write(band, 1)
        with mem.open() as tmp:
            profile = cog_profiles.get("zstd")
            profile.update({"predictor": 2})
            cog_translate(tmp, str(out_path), profile, in_memory=True, quiet=True)
