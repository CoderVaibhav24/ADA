"""_data_bounds: a stray valid pixel must not drag the grid back to the whole canvas."""

from __future__ import annotations

import rasterio

from tests.rasters import make_tile


def _window(tmp_path, **kwargs):
    from app import preprocess

    path = tmp_path / "tile.tif"
    make_tile(path, **kwargs)
    with rasterio.open(path) as src:
        bounds, window = preprocess._data_bounds(src, src.crs, trim=kwargs.pop("trim", True))
    return bounds, window


def test_a_stray_corner_pixel_is_ignored(tmp_path):
    _, window = _window(tmp_path)
    # Diamond spans rows/cols 425..1623; the stray patch sits at 8..11.
    assert window.col_off > 400 and window.row_off > 400
    assert window.col_off + window.width < 1650 and window.row_off + window.height < 1650


def test_the_ingest_crop_keeps_every_valid_pixel_even_a_stray_one(tmp_path):
    from app import preprocess

    path = tmp_path / "tile.tif"
    make_tile(path)
    with rasterio.open(path) as src:
        _, window = preprocess._data_bounds(src, src.crs, trim=False)
    assert window.col_off <= 8 and window.row_off <= 8          # the stray patch at 8..11
    assert window.col_off + window.width > 1623 and window.row_off + window.height > 1623


def test_the_ingest_crop_keeps_a_small_island_and_a_thin_road(tmp_path):
    """H1: a 30 px island and a 3 px full-width road are real data, not artefacts."""
    import numpy as np

    from app import preprocess

    extra = np.zeros((2048, 2048), dtype=bool)
    extra[1950:1980, 1950:1980] = True
    extra[100:103, :] = True
    path = tmp_path / "tile.tif"
    valid = make_tile(path, radius=500, stray=False, extra_valid=extra)
    with rasterio.open(path) as src:
        _, crop = preprocess._data_bounds(src, src.crs, trim=False)
    rows, cols = valid.nonzero()
    assert crop.row_off <= rows.min() and crop.row_off + crop.height > rows.max()
    assert crop.col_off <= cols.min() and crop.col_off + crop.width > cols.max()


def test_the_grid_keeps_two_similar_blocks_split_by_a_seam(tmp_path):
    """M6: a seam must not halve the analysis area."""
    import numpy as np

    from app import preprocess

    blocks = np.zeros((2048, 2048), dtype=bool)
    blocks[400:1600, 300:1000] = True
    blocks[400:1600, 1010:1700] = True
    path = tmp_path / "tile.tif"
    make_tile(path, radius=0, extra_valid=blocks)
    with rasterio.open(path) as src:
        _, grid = preprocess._data_bounds(src, src.crs, trim=True)
    assert grid.col_off < 320 and grid.col_off + grid.width > 1680
    assert grid.row_off > 380                     # the stray corner patch is still ignored


def test_an_all_nodata_upload_is_rejected_for_the_ingest_crop(tmp_path):
    """M5."""
    import pytest

    from app import preprocess

    path = tmp_path / "tile.tif"
    make_tile(path, size=512, radius=0, stray=False)
    with rasterio.open(path) as src, pytest.raises(preprocess.IngestRejected, match="no valid"):
        preprocess._data_bounds(src, src.crs, trim=False)


def test_bounds_are_in_the_requested_crs_and_logged_in_km(tmp_path, caplog):
    from rasterio.crs import CRS

    from app import preprocess

    path = tmp_path / "tile.tif"
    make_tile(path)
    with rasterio.open(path) as src, caplog.at_level("INFO", "ada.preprocess"):
        bounds, _ = preprocess._data_bounds(src, CRS.from_epsg(4326))
    w, s, e, n = bounds
    assert 80 < w < e < 82 and 26 < s < n < 28
    assert any("km at 0.500 m/px" in r.getMessage() for r in caplog.records)


def test_a_raster_without_padding_keeps_its_full_extent(tmp_path):
    from app import preprocess

    path = tmp_path / "tile.tif"
    make_tile(path, size=512, radius=2000, stray=False)
    with rasterio.open(path) as src:
        _, window = preprocess._data_bounds(src, src.crs)
    assert (window.col_off, window.row_off, window.width, window.height) == (0, 0, 512, 512)
