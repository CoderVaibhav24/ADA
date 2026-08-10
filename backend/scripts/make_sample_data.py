"""Generate a synthetic T1/T2 GeoTIFF pair near Agra for demo/testing.

T2 deliberately differs from T1 by: coarser resolution, a small extent
offset, a global brightness shift, sensor noise, AND a set of new
"buildings" — so it exercises the full superimpose + detection pipeline.
"""

from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from scipy import ndimage

OUT = Path(__file__).resolve().parents[2] / "data" / "samples"
OUT.mkdir(parents=True, exist_ok=True)

CRS = "EPSG:32644"  # UTM 44N (Agra)
to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
ORIGIN_X, ORIGIN_Y = to_utm.transform(78.02, 27.18)  # near Taj Mahal
RES1, RES2 = 0.5, 0.7          # m/px — simulate two different sensors
SIZE = 1200                    # T1 pixels

rng = np.random.default_rng(42)


def base_scene(size: int) -> np.ndarray:
    """Smooth terrain texture + road grid, (3, H, W) float 0..255."""
    terrain = ndimage.gaussian_filter(rng.normal(120, 40, (size, size)), 12)
    r = terrain + rng.normal(0, 4, terrain.shape) + 10
    g = terrain * 1.05 + rng.normal(0, 4, terrain.shape)
    b = terrain * 0.85 + rng.normal(0, 4, terrain.shape) - 10
    img = np.stack([r, g, b])
    for i in range(150, size, 300):        # roads
        img[:, i - 6:i + 6, :] = 70
        img[:, :, i - 6:i + 6] = 70
    return np.clip(img, 0, 255)


def add_buildings(img: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> None:
    for (y, x, h, w) in boxes:
        color = rng.uniform(170, 230)
        img[0, y:y + h, x:x + w] = color
        img[1, y:y + h, x:x + w] = color * 0.97
        img[2, y:y + h, x:x + w] = color * 0.92
        img[:, y:y + 2, x:x + w] *= 0.6     # roof shadow edge


scene = base_scene(SIZE)

# T1: baseline with a few existing buildings
t1 = scene.copy()
add_buildings(t1, [(200, 200, 60, 80), (600, 900, 70, 60), (900, 300, 50, 90)])

# T2: same ground + NEW constructions (the changes to detect)
NEW_BUILDINGS = [(400, 500, 80, 100), (750, 150, 60, 70), (150, 800, 90, 90),
                 (950, 950, 70, 110)]
t2_full = scene.copy()
add_buildings(t2_full, [(200, 200, 60, 80), (600, 900, 70, 60), (900, 300, 50, 90)])
add_buildings(t2_full, NEW_BUILDINGS)

# Different sensor: brightness/contrast shift + noise + coarser grid + offset
t2_full = np.clip(t2_full * 1.12 - 8 + rng.normal(0, 6, t2_full.shape), 0, 255)
zoom = RES1 / RES2
t2 = np.stack([ndimage.zoom(t2_full[b], zoom, order=1) for b in range(3)])
OFFSET_M = 3.0  # deliberate georef offset for the co-registration step to fix


def write_tif(path: Path, img: np.ndarray, res: float, off: float = 0.0) -> None:
    transform = from_origin(ORIGIN_X + off, ORIGIN_Y - off, res, res)
    profile = dict(driver="GTiff", dtype="uint8", count=3,
                   height=img.shape[1], width=img.shape[2],
                   crs=CRS, transform=transform)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(img.astype(np.uint8))
    print(f"wrote {path.name}: {img.shape[2]}x{img.shape[1]} @ {res} m/px")


write_tif(OUT / "agra_t1_2024.tif", t1, RES1)
write_tif(OUT / "agra_t2_2026.tif", t2, RES2, off=OFFSET_M)

# Ground truth (pixel coords of T1 grid) for eyeballing results
print("new buildings (T1 px):", NEW_BUILDINGS)
