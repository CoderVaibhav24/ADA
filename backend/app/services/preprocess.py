"""Raster ingestion + cross-sensor superimposing.

Ingestion: any GeoTIFF (with embedded georef or .tfw sidecar) -> 8-bit
display COG + metadata.

Superimposing (the T1/T2 alignment): reproject both rasters onto one
common working grid (reference CRS, coarser resolution), refine with
sub-pixel phase cross-correlation, then histogram-match T2 to T1 so
sensor/lighting differences are not flagged as change.
"""

from __future__ import annotations

import logging
import math
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
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
from scipy import ndimage
from skimage.exposure import match_histograms
from skimage.registration import phase_cross_correlation

log = logging.getLogger("ada.preprocess")

MAX_WORKING_DIM = 6144          # cap the common-grid size (POC memory guard)
MAX_TRUSTED_SHIFT_PX = 32.0     # phase-corr shifts beyond this are rejected
MIN_SHIFT_IMPROVEMENT = 0.02    # edge agreement must rise by this much to apply
GRID_MATCH_TOL_M = 0.01         # bounds/res closer than this = identical grid


def _edge_agreement(g1: np.ndarray, g2: np.ndarray, mask: np.ndarray) -> float:
    """Colour-invariant alignment score: correlation of the two edge maps.

    Buildings produce edges in both epochs regardless of how each sensor
    renders their colour, so this rises only when structures actually line up
    — unlike |Δgrey|, which a spurious shift can reduce just by smearing a
    systematic brightness offset around.
    """
    def edges(g: np.ndarray) -> np.ndarray:
        return np.hypot(ndimage.sobel(g, axis=0), ndimage.sobel(g, axis=1))

    e1, e2 = edges(g1)[mask], edges(g2)[mask]
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


def ingest_raster(original_path: Path, cog_path: Path) -> dict:
    """Create an 8-bit display COG and return raster metadata."""
    with rasterio.open(original_path) as src:
        if src.crs is None:
            raise ValueError(
                "Raster has no CRS. Upload the matching .tfw AND .prj/.aux.xml "
                "sidecar files, or a GeoTIFF with embedded geo-referencing."
            )
        data = _read_rgb(src).astype(np.float32)
        valid = src.dataset_mask() > 0
        data, _ = _normalize_spectral(data, valid)
        rgb = _stretch_to_uint8(data, valid)

        profile = {
            "driver": "GTiff", "dtype": "uint8", "count": 3,
            "width": src.width, "height": src.height,
            "crs": src.crs, "transform": src.transform, "nodata": 0,
        }
        with MemoryFile() as mem:
            with mem.open(**profile) as tmp:
                tmp.write(rgb)
            with mem.open() as tmp:
                cog_translate(tmp, str(cog_path), cog_profiles.get("deflate"),
                              in_memory=True, quiet=True)

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


def superimpose(path_t1: Path, path_t2: Path) -> AlignedPair:
    """Put both rasters onto one common grid, aligned pixel-to-pixel."""
    with rasterio.open(path_t1) as s1, rasterio.open(path_t2) as s2:
        if s1.crs is None or s2.crs is None:
            raise ValueError("Both rasters need a CRS for alignment.")
        crs = s1.crs

        # T2 footprint + resolution expressed in the T1 CRS
        b2 = transform_bounds(s2.crs, crs, *s2.bounds)
        res2_x = (b2[2] - b2[0]) / s2.width
        res2_y = (b2[3] - b2[1]) / s2.height
        res = max(abs(s1.transform.a), abs(s1.transform.e), res2_x, res2_y)

        # Overlap footprint
        b1 = s1.bounds
        w, s_, e, n = (max(b1[0], b2[0]), max(b1[1], b2[1]),
                       min(b1[2], b2[2]), min(b1[3], b2[3]))
        if w >= e or s_ >= n:
            raise ValueError("The two rasters do not overlap on the ground.")

        # Working grid at the coarser resolution (capped for memory)
        width = math.ceil((e - w) / res)
        height = math.ceil((n - s_) / res)
        scale = max(width / MAX_WORKING_DIM, height / MAX_WORKING_DIM, 1.0)
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

        vrt_opts = dict(crs=crs, transform=transform, width=width, height=height,
                        resampling=Resampling.bilinear)
        arr1 = _read_rgb(s1, vrt_opts).astype(np.float32)
        arr2 = _read_rgb(s2, vrt_opts).astype(np.float32)

    valid1 = arr1.sum(axis=0) > 0
    valid2 = arr2.sum(axis=0) > 0
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
                g2_shifted = ndimage.shift(g2, candidate, order=1,
                                           mode="constant", cval=0)
                overlap = valid1 & valid2 & (g2_shifted > 0)
                if overlap.sum() > 10_000:
                    before = _edge_agreement(g1, g2, overlap)
                    after = _edge_agreement(g1, g2_shifted, overlap)
                    if after > before + MIN_SHIFT_IMPROVEMENT:
                        shift_yx = candidate
                        t2 = np.stack([
                            ndimage.shift(t2[b].astype(np.float32), shift_yx,
                                          order=1, mode="constant", cval=0)
                            for b in range(3)
                        ]).clip(0, 255).astype(np.uint8)
                        valid2 = t2.sum(axis=0) > 0
                        veg2 = ndimage.shift(veg2.astype(np.float32), shift_yx,
                                             order=0, mode="constant", cval=0) > 0.5
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

    valid = valid1 & valid2

    # Radiometric normalization: histogram-match T2 onto T1 (valid area only)
    if valid.any():
        matched = match_histograms(t2.transpose(1, 2, 0).astype(np.float32),
                                   t1.transpose(1, 2, 0).astype(np.float32),
                                   channel_axis=-1)
        t2 = np.clip(matched, 0, 255).astype(np.uint8).transpose(2, 0, 1)
        t2[:, ~valid] = 0

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
