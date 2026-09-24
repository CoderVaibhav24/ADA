"""Synthetic survey tiles: a rotated data footprint inside a nodata collar."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

ORIGIN = (500000.0, 3000000.0)
RES = 0.5


def footprint(size: int, radius: int, center: tuple[int, int] | None = None) -> np.ndarray:
    """A diamond (a square rotated 45 degrees) of valid pixels."""
    cy, cx = center or (size // 2, size // 2)
    yy, xx = np.mgrid[0:size, 0:size]
    return (np.abs(yy - cy) + np.abs(xx - cx)) < radius


def make_tile(path: Path, *, size: int = 2048, radius: int = 600, max_dn: int = 200,
              nodata: float | None = 65535, stray: bool = True, crs: str | None = "EPSG:32644",
              extra_valid: np.ndarray | None = None, seed: int = 0,
              dtype: str = "uint16") -> np.ndarray:
    """Write a 3-band GeoTIFF (uint16 by default); returns its valid mask."""
    rng = np.random.default_rng(seed)
    valid = footprint(size, radius)
    if extra_valid is not None:
        valid |= extra_valid
    if stray:
        valid[8:12, 8:12] = True               # a collar artefact in the far corner
    data = rng.integers(0, max_dn + 1, (3, size, size)).astype(dtype)
    data[0, size // 2, size // 2] = max_dn     # the real maximum is present
    data[:, ~valid] = nodata if nodata is not None else 0
    profile = {"driver": "GTiff", "dtype": dtype, "count": 3, "width": size,
               "height": size, "transform": from_origin(*ORIGIN, RES, RES),
               "nodata": nodata, "tiled": True, "blockxsize": 256, "blockysize": 256}
    if crs:
        profile["crs"] = crs
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data)
    return valid
