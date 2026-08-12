"""Raster ingestion + cross-sensor superimposing.

Ingestion: any GeoTIFF (with embedded georef or .tfw sidecar) -> 8-bit
display COG + metadata.

Superimposing (the T1/T2 alignment): reproject both rasters onto one
common working grid (reference CRS, coarser resolution), refine with
sub-pixel phase cross-correlation, then histogram-match T2 to T1 so
sensor/lighting differences are not flagged as change.
"""

from __future__ import annotations

import io
import logging
import math
import re
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds
from rasterio.windows import Window
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
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


def working_dim_cap() -> int:
    """Largest common-grid side the host memory budget will carry.

    The 6144 ceiling stays what it always was; this only lowers it when the
    budget cannot support it. Deriving the number instead of hard-coding it is
    what makes HOST_MEMORY_LIMIT_GB an actual limit rather than a comment — set
    it to 8 and the grid drops to ~5900 px on its own, rather than the process
    discovering the shortfall by swapping.
    """
    from ..config import settings

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
    from ..config import settings

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
        valid &= ~np.all(bands == np.float32(nodata), axis=0)

    bands[:, ~valid] = 0.0
    return bands, valid


def _data_bounds(src: rasterio.DatasetReader, dst_crs: CRS,
                 max_dim: int = 1024) -> tuple[float, float, float, float]:
    """Geographic bounds of the pixels that actually carry data.

    ADA's survey grid tiles arrive as a small populated region inside a very
    large nodata canvas — the sample tile measured 2.1% real data. Sizing the
    working grid from the declared extent therefore spends the entire
    resolution budget on emptiness: 3.24 m/px across the padded canvas versus
    0.40 m/px across the real data, which is the difference between a building
    being three pixels and being resolvable. Falls back to the full extent when
    the raster has no padding to trim.
    """
    scale = max(src.width / max_dim, src.height / max_dim, 1.0)
    shape = (max(1, int(src.height / scale)), max(1, int(src.width / scale)))
    mask = src.dataset_mask(out_shape=shape) > 0
    if not mask.any():
        return transform_bounds(src.crs, dst_crs, *src.bounds)

    rows, cols = np.where(mask)
    # Scale the decimated indices back to full-resolution pixel coordinates,
    # padding by one decimated cell so a partially-covered edge is not clipped.
    row_px, col_px = src.height / shape[0], src.width / shape[1]
    top = max(0.0, (rows.min() - 1) * row_px)
    bottom = min(float(src.height), (rows.max() + 2) * row_px)
    left = max(0.0, (cols.min() - 1) * col_px)
    right = min(float(src.width), (cols.max() + 2) * col_px)

    x0, y0 = src.transform * (left, top)
    x1, y1 = src.transform * (right, bottom)
    native = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    return transform_bounds(src.crs, dst_crs, *native)


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


def _sample_rgb(src: rasterio.DatasetReader, max_windows: int = 96,
                win: int = 256) -> tuple[np.ndarray, np.ndarray]:
    """Read a scattered grid of small windows. Returns (pixels, valid).

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
    """
    ratio = max(src.height / max(src.width, 1), 1e-6)
    cols = max(1, int(round((max_windows / ratio) ** 0.5)))
    rows = max(1, max_windows // cols)

    blocks, masks, valid_px = [], [], 0
    for r in range(rows):
        for c in range(cols):
            top = min(int((r + 0.5) * src.height / rows) - win // 2,
                      src.height - win)
            left = min(int((c + 0.5) * src.width / cols) - win // 2,
                       src.width - win)
            window = Window(max(0, left), max(0, top),
                            min(win, src.width), min(win, src.height))
            indexes = [1, 2, 3] if src.count >= 3 else [1, 1, 1]
            block = src.read(indexes, window=window).astype(np.float32)
            blocks.append(block)
            m = _valid_mask(src, block, window=window)
            masks.append(m)
            valid_px += int(m.sum())

    sample = np.concatenate(blocks, axis=1)
    valid = np.concatenate(masks, axis=0)
    if valid_px == 0:
        log.warning("ingest: sampled %d windows and found no valid pixels — "
                    "the raster may be entirely nodata", len(blocks))
    return sample, valid


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
        return ~np.all(block == nodata, axis=0)
    if out_shape is not None:
        return src.dataset_mask(out_shape=out_shape) > 0
    return src.dataset_mask(window=window) > 0


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


def _row_windows(src: rasterio.DatasetReader):
    """Full-width row strips sized so one block stays near INGEST_BLOCK_BYTES."""
    per_row = max(src.width * 3 * 4, 1)          # 3 bands, float32
    rows = int(min(4096, max(256, INGEST_BLOCK_BYTES / per_row)))
    for top in range(0, src.height, rows):
        height = min(rows, src.height - top)
        yield Window(0, top, src.width, height)


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

    def __init__(self, label: str, step: int = 10) -> None:
        self.label = label
        self.step = step
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
        except Exception:                     # never let logging break an ingest
            pass
        return len(text)

    def flush(self) -> None:
        pass


def _build_cog(source, cog_path: Path, dst_profile: dict, in_memory: bool,
               label: str) -> None:
    """cog_translate with progress reporting and a timing summary."""
    started = time.perf_counter()
    log.info("%s: starting (block copy, then overview pyramid)", label)
    cog_translate(source, str(cog_path), dst_profile,
                  in_memory=in_memory, quiet=False,
                  progress_out=_CogProgress(label),
                  config={"GDAL_NUM_THREADS": "ALL_CPUS"})
    size_gb = cog_path.stat().st_size / (1 << 30) if cog_path.is_file() else 0.0
    log.info("%s: done in %.1f s, %.2f GB written to %s",
             label, time.perf_counter() - started, size_gb, cog_path.name)


def _intermediate_fits_ram(width: int, height: int) -> bool:
    """Whether the ingest intermediate can be staged in RAM instead of on disk.

    Ingestion is by far this pipeline's heaviest disk user: it writes a
    full-size uint8 GeoTIFF, reads it all back, and writes the COG — three
    passes over multiple GB, on top of reading the upload itself. When the
    intermediate fits the host budget, the middle file never touches the disk
    and the whole ingest becomes one read and one write.

    The estimate is uncompressed even though the staged file is deflated, and
    it triples for rio-cogeo's own in-memory staging and its overview pyramid
    (~1.33x), so a raster that clears this bar clears it with room to spare.
    On the default 18 GB budget the cut lands near 700 Mpx: ordinary drone and
    satellite scenes stage in RAM, ADA's multi-gigapixel survey tiles keep the
    streaming path exactly as before. Correctness does not depend on which
    branch runs.
    """
    from ..config import settings

    need = width * height * 3 * 3.0
    return need <= settings.host_memory_limit_bytes * 0.35


def ingest_raster(original_path: Path, cog_path: Path) -> dict:
    """Create an 8-bit display COG and return raster metadata.

    Streams the source in row strips. The previous implementation read the
    whole raster and cast it to float32 up front, which costs ~12 bytes per
    pixel: a 1 Gpx orthophoto needed ~12.8 GB of RAM before it wrote anything,
    so ADA's own grid tiles (6-20 GB on disk) could not be ingested at all on a
    normal machine. Peak memory here is one strip, independent of file size.
    """
    with _gdal_env(), rasterio.open(original_path) as src:
        if src.crs is None:
            raise ValueError(
                "Raster has no CRS. Upload the matching .tfw AND .prj/.aux.xml "
                "sidecar files, or a GeoTIFF with embedded geo-referencing."
            )

        # Pass 1 — scene-wide statistics from a decimated read.
        # The valid mask MUST come from dataset_mask, not from "any band > 0":
        # ADA's grid tiles declare nodata=65535, so a brightness test counts the
        # nodata fill as the brightest data in the scene, drags the 98th
        # percentile up to 65535 and stretches every real pixel to black.
        sample, sample_valid = _sample_rgb(src)
        sample, is_cir = _normalize_spectral(sample, sample_valid)
        params = _stretch_params(sample, sample_valid)
        del sample, sample_valid

        profile = {
            "driver": "GTiff", "dtype": "uint8", "count": 3,
            "width": src.width, "height": src.height,
            "crs": src.crs, "transform": src.transform, "nodata": 0,
            "tiled": True, "blockxsize": 512, "blockysize": 512,
            "compress": "deflate", "BIGTIFF": "IF_SAFER",
        }

        # Pass 2 — convert strip by strip into an intermediate, then COG-ify it.
        windows = list(_row_windows(src))

        def fill(dst) -> None:
            for i, window in enumerate(windows, start=1):
                indexes = [1, 2, 3] if src.count >= 3 else [1, 1, 1]
                block = src.read(indexes, window=window).astype(np.float32)
                block_valid = _valid_mask(src, block, window=window)
                if is_cir:
                    block = _cir_to_pseudo_natural(block)
                dst.write(_apply_stretch(block, params, block_valid),
                          window=window)
                log.info("ingest: strip %s/%s", i, len(windows))

        # BIGTIFF on the COG profile too: rio-cogeo stages its output in a
        # temporary GeoTIFF built from these same creation options, and a
        # classic TIFF dies at 4 GB ("Maximum TIFF file size exceeded"), which
        # is exactly the size range ADA's grid tiles land in.
        dst_profile = cog_profiles.get("deflate")
        dst_profile.update({"BIGTIFF": "YES"})

        if _intermediate_fits_ram(src.width, src.height):
            # The intermediate exists only to be read straight back. When the
            # budget can hold it, keeping it in RAM removes a full-size write
            # AND the read that follows — the largest single piece of disk
            # traffic in the whole application.
            log.info("ingest: staging the %s x %s intermediate in RAM "
                     "(no temporary file written)", src.width, src.height)
            with MemoryFile() as mem:
                with mem.open(**profile) as dst:
                    fill(dst)
                with mem.open() as staged:
                    _build_cog(staged, cog_path, dst_profile, True,
                               "ingest: building COG")
        else:
            tmp_path = cog_path.with_suffix(".tmp.tif")
            try:
                with rasterio.open(tmp_path, "w", **profile) as dst:
                    fill(dst)
                log.info("ingest: %s x %s intermediate too large for the host "
                         "budget, staged on disk", src.width, src.height)
                _build_cog(str(tmp_path), cog_path, dst_profile, False,
                           "ingest: building COG")
            finally:
                tmp_path.unlink(missing_ok=True)

        bounds_4326 = list(transform_bounds(src.crs, CRS.from_epsg(4326), *src.bounds))
        res_x = abs(src.transform.a)
        res_m = res_x * 111_320 if src.crs.is_geographic else res_x
        return {
            "crs": str(src.crs),
            "bounds_4326": bounds_4326,
            "resolution_m": round(float(res_m), 4),
        }


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


def _pick_source(original: Path, cog: Path | None) -> tuple[Path, bool]:
    """Choose which file to warp from. Returns (path, is_cog).

    Reading the ORIGINAL is the conservative choice and the only one that
    preserves the raw bands, so it stays the default whenever anything
    downstream still needs them.

    But it is brutally slow on the grid tiles ADA actually receives. Building
    the 6144 px working grid means warping down from the source, and the
    uploads have no overviews — so GDAL reads every pixel of a 1069 Mpx and a
    3251 Mpx raster (~26 GB) to produce a 6144 px output. The COG written at
    ingest has overviews and is ~100x smaller (60 MB vs 6.4 GB), so the same
    warp becomes near-instant.

    The COG is safe to substitute ONLY because ingest already applied, once and
    from a scene-wide sample, exactly the transforms superimpose would apply
    here: CIR -> pseudo-natural conversion and the percentile stretch to uint8.
    What it does NOT preserve is the raw band values, and those feed
    `_vegetation_mask_raw` (NDVI / excess-green). Hence the guard in the caller:
    the COG is only chosen when vegetation comes from the learned land-cover
    model instead, which reads the same RGB either way.
    """
    if cog is not None and Path(cog).is_file():
        return Path(cog), True
    return original, False


def superimpose(path_t1: Path, path_t2: Path,
                cog_t1: Path | None = None,
                cog_t2: Path | None = None) -> AlignedPair:
    """Put both rasters onto one common grid, aligned pixel-to-pixel.

    Pass `cog_t1`/`cog_t2` to warp from the ingested COGs instead of the
    originals — far faster, and equivalent as long as the raw bands are not
    needed. See `_pick_source`; the caller decides via SUPERIMPOSE_SOURCE.
    """
    from ..config import settings

    use_cog = settings.superimpose_source != "original"
    if use_cog and settings.superimpose_source == "auto":
        # Raw bands are still required by the index-based vegetation masks.
        use_cog = settings.vegetation_mode == "learned"
    src_t1, cog1 = _pick_source(path_t1, cog_t1 if use_cog else None)
    src_t2, cog2 = _pick_source(path_t2, cog_t2 if use_cog else None)
    if cog1 or cog2:
        log.info("superimpose: reading %s / %s (COG has overviews; the "
                 "originals have none, so warping them costs a full read)",
                 "COG" if cog1 else "original", "COG" if cog2 else "original")

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
        b1 = _data_bounds(s1, crs)
        b2 = _data_bounds(s2, crs)
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
        cap = working_dim_cap()
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
                    for a, b in zip(s1.bounds, s2.bounds))
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

    log.info("superimpose: working grid %sx%s @ %.3f m/px; "
             "valid coverage T1 %.1f%%, T2 %.1f%%, overlap %.1f%%",
             width, height, res, 100 * valid1.mean(), 100 * valid2.mean(),
             100 * (valid1 & valid2).mean())
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
    )


def write_rgb_geotiff(rgb_hwc: np.ndarray, transform, crs, out_path: Path) -> None:
    """Persist an aligned (H, W, 3) uint8 scene, tiled for fast window reads."""
    profile = {
        "driver": "GTiff", "dtype": "uint8", "count": 3,
        "width": rgb_hwc.shape[1], "height": rgb_hwc.shape[0],
        "crs": crs, "transform": transform, "nodata": 0,
        "tiled": True, "blockxsize": 256, "blockysize": 256,
        "compress": "deflate",
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
            cog_translate(tmp, str(out_path), cog_profiles.get("deflate"),
                          in_memory=True, quiet=True)
