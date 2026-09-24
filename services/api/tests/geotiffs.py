"""Tiny GeoTIFFs written with rasterio, for the upload and validation tests."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin


def geotiff_bytes(tmp: Path, *, crs: str | None = "EPSG:32644", bands: int = 3,
                  size: int = 64, compress: str | None = None) -> bytes:
    path = tmp / f"scene-{bands}-{size}-{crs or 'nocrs'}-{compress or 'raw'}.tif"
    profile = {"driver": "GTiff", "width": size, "height": size, "count": bands,
               "dtype": "uint8", "transform": from_origin(500000, 3000000, 0.5, 0.5)}
    if crs:
        profile["crs"] = crs
    if compress:
        profile["compress"] = compress
    data = np.random.default_rng(7).integers(0, 255, (bands, size, size), dtype="uint8")
    with rasterio.open(path, "w", **profile) as ds:
        ds.write(data)
    return path.read_bytes()


def write_geotiff(path: Path, **kwargs) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(geotiff_bytes(path.parent, **kwargs))
    return path
