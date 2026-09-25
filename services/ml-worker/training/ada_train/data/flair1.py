"""FLAIR-1 land cover: the licence-clean replacement for SegFormer-B5 / LoveDA.

Layout on disk, as IGN ships it:

    <root>/flair_aerial_train/D004_2021/Z1_UA/img/IMG_004001.tif
    <root>/flair_labels_train/D004_2021/Z1_UA/msk/MSK_004001.tif

Images are 512x512x5 uint8 -- R, G, B, NIR, elevation. Masks are 512x512 uint8
with classes 1..19.

Two decisions in here are modelling decisions, not plumbing, and section 6 of
the inventory document names the first as the main risk of this work item:

1. THE CLASS COLLAPSE. FLAIR-1 has 19 classes; the IGN baselines train 13, by
   lumping 13..19 into a single "other". We follow the baselines, because
   classes 13..19 (swimming pool, snow, clear cut, mixed, ligneous, greenhouse,
   other) are rare and mostly irrelevant to Agra. The 13 classes are then
   collapsed a second time, at inference, into ADA's built/open distinction --
   see BUILT_CLASSES below and landcover.open_land() in the serving code.

2. THREE CHANNELS, NOT FIVE. FLAIR-1 offers NIR and elevation, and both would
   help. Neither is available at inference: ADA's pipeline hands the land-cover
   model (N, H, W, 3) uint8 RGB. Training on channels we cannot serve would
   produce a model that looks good in validation and degrades silently in
   production. in_channels is configurable for the day that changes; the
   default matches the serving contract.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import numpy as np
from torch.utils.data import Dataset

log = logging.getLogger("ada.train")

# FLAIR-1's published nomenclature, 1-indexed as it appears in the masks.
FLAIR_CLASSES = {
    1: "building", 2: "pervious surface", 3: "impervious surface",
    4: "bare soil", 5: "water", 6: "coniferous", 7: "deciduous",
    8: "brushwood", 9: "vineyard", 10: "herbaceous vegetation",
    11: "agricultural land", 12: "plowed land", 13: "swimming pool",
    14: "snow", 15: "clear cut", 16: "mixed", 17: "ligneous",
    18: "greenhouse", 19: "other",
}

# The 13 training classes, 0-indexed, as the IGN baselines define them.
N_CLASSES = 13
LABELS = {i - 1: FLAIR_CLASSES[i] for i in range(1, 13)}
LABELS[12] = "other"

# ADA's built/open collapse. Roofs, paved surfaces and water are what they are
# in every season and under every sensor; their complement is land that could
# be developed. This mirrors LoveDA's (building, road, water) exactly, which is
# what makes the replacement a drop-in for open_land().
#
# "pervious surface" (gravel, unpaved tracks, bare compacted ground) is
# deliberately NOT built. It is the one genuinely arguable class, and the
# decision matters: in Agra those surfaces are the plots that later get built
# on, so calling them built would suppress the encroachment we are looking for.
BUILT_CLASSES = (0, 2, 4)      # building, impervious surface, water

_ID_RE = re.compile(r"(?:IMG|MSK)_(\d+)\.tif$", re.IGNORECASE)
_DOMAIN_RE = re.compile(r"(D\d{3}_\d{4})")


def build_index(root: Path) -> list[dict]:
    """Pair every IMG_*.tif with its MSK_*.tif and tag it with its domain.

    Globbed once and cached to index.json, because a recursive glob over 77k
    files on an external USB drive takes minutes and is pure IOPS.
    """
    root = Path(root)
    images = sorted(root.rglob("IMG_*.tif"))
    if not images:
        raise FileNotFoundError(
            f"no IMG_*.tif under {root}. Expected the FLAIR-1 layout "
            f"<root>/flair_aerial_train/D0XX_YYYY/ZN_XX/img/IMG_*.tif -- "
            f"check that the archive was extracted and not just downloaded."
        )

    masks: dict[str, Path] = {}
    for path in root.rglob("MSK_*.tif"):
        m = _ID_RE.search(path.name)
        if m:
            masks[m.group(1)] = path

    index, missing = [], 0
    for img in images:
        m = _ID_RE.search(img.name)
        if not m:
            continue
        patch_id = m.group(1)
        msk = masks.get(patch_id)
        if msk is None:
            missing += 1
            continue
        dom = _DOMAIN_RE.search(str(img))
        index.append({
            "id": patch_id,
            "img": str(img),
            "msk": str(msk),
            # The department/year folder. Splits are held by domain so that
            # validation is a different part of France, not the next tile over
            # in the same village -- otherwise val accuracy is memorisation.
            "domain": dom.group(1) if dom else "unknown",
        })

    if missing:
        log.warning("%d images had no matching mask and were skipped", missing)
    log.info("indexed %d FLAIR-1 patches across %d domains",
             len(index), len({e["domain"] for e in index}))
    return index


def load_index(root: Path, cache: Path | None = None) -> list[dict]:
    cache = Path(cache) if cache else Path(root) / "index.json"
    if cache.is_file():
        with cache.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    index = build_index(root)
    cache.parent.mkdir(parents=True, exist_ok=True)
    with cache.open("w", encoding="utf-8") as fh:
        json.dump(index, fh)
    log.info("wrote %s", cache)
    return index


def split_by_domain(index: list[dict], val_fraction: float, seed: int = 1337):
    """Hold out whole domains for validation, not random patches.

    A random patch split on FLAIR-1 inflates validation mIoU by several points,
    because adjacent 512 px patches from the same flight share buildings,
    shadows and sensor calibration. The number this pipeline is held to has to
    survive a change of geography, so the split has to as well.
    """
    domains = sorted({e["domain"] for e in index})
    rng = np.random.default_rng(seed)
    rng.shuffle(domains)
    n_val = max(1, int(round(len(domains) * val_fraction)))
    val_domains = set(domains[:n_val])
    train = [e for e in index if e["domain"] not in val_domains]
    val = [e for e in index if e["domain"] in val_domains]
    log.info("split: %d train patches (%d domains) / %d val patches (%d domains)",
             len(train), len(domains) - n_val, len(val), n_val)
    return train, val


def subsample(entries: list[dict], fraction: float, seed: int = 1337) -> list[dict]:
    """Take a stratified fraction, keeping every domain represented.

    Used for the laptop runs: a quarter of FLAIR-1 is ~19k patches and about
    six hours per 40 epochs rather than two days. Taking the fraction per
    domain rather than globally keeps the geographic and seasonal spread, which
    is the part of FLAIR-1 that is actually doing the work.
    """
    if fraction >= 1.0:
        return entries
    rng = np.random.default_rng(seed)
    by_domain: dict[str, list[dict]] = {}
    for e in entries:
        by_domain.setdefault(e["domain"], []).append(e)
    out = []
    for domain in sorted(by_domain):
        group = by_domain[domain]
        keep = max(1, int(round(len(group) * fraction)))
        idx = rng.permutation(len(group))[:keep]
        out.extend(group[i] for i in sorted(idx))
    log.info("subsampled %d -> %d patches (fraction=%.3f)", len(entries), len(out), fraction)
    return out


def remap_mask(mask: np.ndarray) -> np.ndarray:
    """FLAIR 1..19 -> 0..12, lumping 13..19 into 'other' (12).

    Anything at 0 is unlabelled in FLAIR-1's convention and becomes the ignore
    index, so it contributes to neither the loss nor the metrics.
    """
    out = np.full(mask.shape, 255, dtype=np.uint8)      # 255 = ignore
    valid = mask >= 1
    remapped = np.clip(mask.astype(np.int16), 1, 13) - 1
    out[valid] = remapped[valid].astype(np.uint8)
    return out


class Flair1Dataset(Dataset):
    """Reads the TIFFs directly. Use data.packed for the memmap path instead.

    No file handles or rasterio datasets are opened in __init__, because on
    Windows the dataloader spawns workers and pickles the dataset; an open GDAL
    handle does not survive that.
    """

    def __init__(self, entries: list[dict], transform=None,
                 in_channels: int = 3) -> None:
        self.entries = entries
        self.transform = transform
        self.in_channels = in_channels

    def __len__(self) -> int:
        return len(self.entries)

    def __getitem__(self, i: int):
        import rasterio

        entry = self.entries[i]
        with rasterio.open(entry["img"]) as src:
            # FLAIR bands are R, G, B, NIR, elevation. Take the first N.
            image = src.read(list(range(1, self.in_channels + 1)))
        with rasterio.open(entry["msk"]) as src:
            mask = src.read(1)

        image = np.transpose(image, (1, 2, 0))          # CHW -> HWC for albumentations
        mask = remap_mask(mask)

        if self.transform is not None:
            out = self.transform(image=image, mask=mask)
            image, mask = out["image"], out["mask"]

        image = np.ascontiguousarray(np.transpose(image, (2, 0, 1)))
        return image, np.ascontiguousarray(mask)
