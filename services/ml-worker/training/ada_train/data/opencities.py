"""Open Cities AI Challenge building footprints -- stage two, the replacement
for BOTH current building segmenters.

Layout, as the challenge ships it on source.coop:

    <root>/train_tier_1/<region>/<scene>/<scene>.tif
    <root>/train_tier_1/<region>/<scene>-labels/<scene>.geojson

The imagery is COG drone orthophotos at under 60 cm and under 15 degrees
off-nadir over ten African cities; the labels are OSM building footprints as
vector polygons. That off-nadir figure is the reason this set was chosen over
the higher-volume alternatives: it is the closest public match to ADA's drone
epoch, and off-nadir lean is what makes a footprint model disagree with itself
between two epochs.

Three things this module has to get right, because each one silently poisons
training if it does not:

1. VECTOR LABELS, RASTERISED PER WINDOW. The footprints are polygons in CRS
   coordinates. Rasterising a whole scene up front would need tens of GB; we
   rasterise per read window using that window's affine transform.

2. NODATA. The orthophotos are irregular flight footprints inside a
   rectangular raster, so a large share of any scene is black padding. Padding
   has no buildings, so training on it teaches the model that dark means
   background -- which is exactly the shadowed-roof failure the current
   segmenters already have. Windows below `min_valid_fraction` are dropped at
   index time.

3. EMPTY WINDOWS. Most windows contain no building at all. Some are needed as
   negatives; all of them would drown the positive signal. `empty_keep_ratio`
   caps the proportion.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from torch.utils.data import Dataset

log = logging.getLogger("ada.train")

N_CLASSES = 1          # binary: building probability, matching the serving contract
LABELS = {0: "building"}


def _find_scenes(root: Path) -> list[dict]:
    """Pair each COG with its label GeoJSON, tolerating the tier layouts."""
    root = Path(root)
    scenes = []
    for tif in sorted(root.rglob("*.tif")):
        stem = tif.stem
        candidates = [
            tif.parent.parent / f"{stem}-labels" / f"{stem}.geojson",
            tif.parent / f"{stem}-labels" / f"{stem}.geojson",
            tif.parent / f"{stem}.geojson",
            tif.with_suffix(".geojson"),
        ]
        label = next((c for c in candidates if c.is_file()), None)
        if label is None:
            log.debug("no labels for %s, skipped", tif)
            continue
        # The region folder is the split unit, for the same reason FLAIR-1
        # splits by department: adjacent tiles from one flight are not
        # independent samples.
        try:
            region = tif.relative_to(root).parts[1]
        except (ValueError, IndexError):
            region = tif.parent.name
        scenes.append({"tif": str(tif), "labels": str(label),
                       "scene": stem, "domain": region})
    if not scenes:
        raise FileNotFoundError(
            f"no COG/GeoJSON pairs under {root}. Expected "
            f"<root>/train_tier_1/<region>/<scene>/<scene>.tif alongside "
            f"<scene>-labels/<scene>.geojson"
        )
    log.info("found %d Open Cities scenes across %d regions",
             len(scenes), len({s["domain"] for s in scenes}))
    return scenes


def build_index(root: Path, crop: int = 512, stride: int | None = None,
                min_valid_fraction: float = 0.6,
                empty_keep_ratio: float = 0.15,
                seed: int = 1337) -> list[dict]:
    """Enumerate usable read windows across every scene.

    Runs once and caches, because it reads the alpha/nodata mask of every scene
    and that is the expensive part.
    """
    import rasterio
    from rasterio.windows import Window

    stride = stride or crop
    rng = np.random.default_rng(seed)
    scenes = _find_scenes(root)
    kept: list[dict] = []
    empties: list[dict] = []

    for scene in scenes:
        with rasterio.open(scene["tif"]) as src:
            # Read the validity mask downsampled: full resolution would be as
            # expensive as reading the imagery, and we only need per-window
            # coverage to a few percent.
            factor = max(1, crop // 16)
            small = src.read_masks(
                1,
                out_shape=(max(1, src.height // factor), max(1, src.width // factor)),
            )
            valid_small = small > 0
            sy = valid_small.shape[0] / src.height
            sx = valid_small.shape[1] / src.width

            geoms = _load_geometries(scene["labels"], src.crs)
            index_ok = _spatial_index(geoms)

            for row in range(0, max(1, src.height - crop + 1), stride):
                for col in range(0, max(1, src.width - crop + 1), stride):
                    r0, r1 = int(row * sy), int((row + crop) * sy)
                    c0, c1 = int(col * sx), int((col + crop) * sx)
                    patch = valid_small[r0:max(r1, r0 + 1), c0:max(c1, c0 + 1)]
                    if patch.size == 0 or patch.mean() < min_valid_fraction:
                        continue
                    window = Window(col, row, crop, crop)
                    bounds = rasterio.windows.bounds(window, src.transform)
                    has_building = _window_has_geometry(index_ok, geoms, bounds)
                    entry = {
                        "tif": scene["tif"], "labels": scene["labels"],
                        "domain": scene["domain"],
                        "col": int(col), "row": int(row), "size": int(crop),
                    }
                    (kept if has_building else empties).append(entry)

    # Keep a bounded share of building-free windows as negatives.
    n_empty = int(len(kept) * empty_keep_ratio)
    if empties and n_empty:
        pick = rng.permutation(len(empties))[:n_empty]
        kept.extend(empties[i] for i in sorted(pick))
    rng.shuffle(kept)
    log.info("indexed %d windows (%d with buildings, %d empty negatives kept)",
             len(kept), len(kept) - min(n_empty, len(empties)), min(n_empty, len(empties)))
    return kept


def _load_geometries(path: str, crs) -> list:
    """Load footprints once per scene, reprojected to the raster's CRS."""
    import fiona
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform

    with fiona.open(path) as src:
        src_crs = src.crs
        geoms = [shape(f["geometry"]) for f in src if f["geometry"] is not None]

    if src_crs and crs and str(src_crs) != str(crs):
        from pyproj import Transformer
        tr = Transformer.from_crs(str(src_crs), str(crs), always_xy=True)
        geoms = [shp_transform(tr.transform, g) for g in geoms]
    return [g for g in geoms if not g.is_empty]


def _spatial_index(geoms: list):
    from shapely.strtree import STRtree
    return STRtree(geoms) if geoms else None


def _window_has_geometry(tree, geoms: list, bounds) -> bool:
    from shapely.geometry import box
    if tree is None:
        return False
    return len(tree.query(box(*bounds))) > 0


def split_by_domain(index: list[dict], val_fraction: float, seed: int = 1337):
    """Hold out whole regions -- the same reasoning as FLAIR-1's split."""
    from .flair1 import split_by_domain as _split
    return _split(index, val_fraction, seed)


def subsample(entries: list[dict], fraction: float, seed: int = 1337):
    from .flair1 import subsample as _sub
    return _sub(entries, fraction, seed)


class OpenCitiesDataset(Dataset):
    """Windowed reads with per-window footprint rasterisation.

    Raster handles and the parsed GeoJSON are cached per worker process and
    opened lazily, so nothing unpicklable crosses the spawn boundary on Windows.
    """

    def __init__(self, entries: list[dict], transform=None,
                 in_channels: int = 3) -> None:
        self.entries = entries
        self.transform = transform
        self.in_channels = in_channels
        self._rasters: dict = {}
        self._geoms: dict = {}

    def __len__(self) -> int:
        return len(self.entries)

    def _raster(self, path: str):
        import rasterio
        src = self._rasters.get(path)
        if src is None:
            src = rasterio.open(path)
            self._rasters[path] = src
        return src

    def _geometries(self, labels: str, crs):
        geoms = self._geoms.get(labels)
        if geoms is None:
            geoms = _load_geometries(labels, crs)
            self._geoms[labels] = geoms
        return geoms

    def __getitem__(self, i: int):
        import rasterio
        from rasterio.features import rasterize
        from rasterio.windows import Window

        entry = self.entries[i]
        src = self._raster(entry["tif"])
        size = entry["size"]
        window = Window(entry["col"], entry["row"], size, size)

        image = src.read(
            list(range(1, self.in_channels + 1)), window=window,
            boundless=True, fill_value=0)
        image = np.transpose(image, (1, 2, 0))

        transform = rasterio.windows.transform(window, src.transform)
        bounds = rasterio.windows.bounds(window, src.transform)
        geoms = self._geometries(entry["labels"], src.crs)

        from shapely.geometry import box
        clip = box(*bounds)
        hits = [g for g in geoms if g.intersects(clip)]
        if hits:
            mask = rasterize(
                [(g, 1) for g in hits], out_shape=(size, size),
                transform=transform, fill=0, dtype="uint8",
                all_touched=False)
        else:
            mask = np.zeros((size, size), dtype=np.uint8)

        # Nodata padding is ignored rather than called background: teaching the
        # net that black means "no building" is how the current 256 px U-Net
        # ended up reading shadowed roofs as background.
        valid = src.read_masks(1, window=window, boundless=True, fill_value=0)
        mask = np.where(valid > 0, mask, 255).astype(np.uint8)

        if self.transform is not None:
            out = self.transform(image=image, mask=mask)
            image, mask = out["image"], out["mask"]

        image = np.ascontiguousarray(np.transpose(image, (2, 0, 1)))
        return image, np.ascontiguousarray(mask)
