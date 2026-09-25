"""Pack an index into flat uint8 memmaps on the SSD.

Why this exists: FLAIR-1 is 77,412 individual TIFFs. Reading them one at a
time from an external USB drive is IOPS-bound, not bandwidth-bound -- the
sequential throughput of the drive is irrelevant when every sample is a
separate file open, a GDAL header parse and a decompress. On a laptop with six
dataloader workers that is usually what starves the GPU, and a starved GPU on a
multi-day run is the difference between two days and four.

Packing rewrites the dataset once into two flat files that a memmap indexes
directly: no file opens, no decode, no GDAL. Cost is disk space -- for the full
FLAIR-1 at three channels and 512 px it is about 81 GB, and a quarter of it is
about 20 GB. Windows Defender should have the directory excluded either way.

This step is optional. Set data.packed in the config to use it, leave it null
to read TIFFs directly.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
from torch.utils.data import Dataset

log = logging.getLogger("ada.train")

IMAGES = "images.u8"
MASKS = "masks.u8"
META = "meta.json"


def pack(entries: list[dict], dataset, out_dir: Path, in_channels: int,
         size: int, progress: bool = True) -> Path:
    """Write `entries` through `dataset` into memmaps under `out_dir`.

    `dataset` is an un-augmented dataset over the same entries, so packing
    reuses exactly the reading and label logic the training path uses. Nothing
    is augmented here -- augmentation stays random per epoch.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    n = len(entries)

    img_path, msk_path = out_dir / IMAGES, out_dir / MASKS
    images = np.lib.format.open_memmap(
        img_path, mode="w+", dtype=np.uint8, shape=(n, in_channels, size, size))
    masks = np.lib.format.open_memmap(
        msk_path, mode="w+", dtype=np.uint8, shape=(n, size, size))

    iterator = range(n)
    if progress:
        from tqdm import tqdm
        iterator = tqdm(iterator, desc=f"packing -> {out_dir}", unit="patch")

    written = 0
    for i in iterator:
        image, mask = dataset[i]
        if image.shape != (in_channels, size, size):
            log.warning("entry %d has shape %s, expected %s -- skipped",
                        i, image.shape, (in_channels, size, size))
            continue
        images[written] = image
        masks[written] = mask
        written += 1

    images.flush()
    masks.flush()
    del images, masks

    meta = {
        "count": written,
        "in_channels": in_channels,
        "size": size,
        # Kept so a packed directory can be traced back to its source, and so
        # the domain-held split still works off the packed data.
        "domains": [e.get("domain", "unknown") for e in entries[:written]],
        "ids": [e.get("id") or f'{Path(e.get("tif", "")).stem}_{e.get("row")}_{e.get("col")}'
                for e in entries[:written]],
    }
    with (out_dir / META).open("w", encoding="utf-8") as fh:
        json.dump(meta, fh)

    gib = (written * in_channels * size * size + written * size * size) / 1024 ** 3
    log.info("packed %d/%d patches into %s (%.1f GiB)", written, n, out_dir, gib)
    return out_dir


class PackedDataset(Dataset):
    """Reads the memmaps. Same output contract as the source datasets."""

    def __init__(self, out_dir: Path, indices: list[int] | None = None,
                 transform=None) -> None:
        out_dir = Path(out_dir)
        with (out_dir / META).open("r", encoding="utf-8") as fh:
            self.meta = json.load(fh)
        self.dir = out_dir
        self.transform = transform
        self.indices = indices if indices is not None else list(range(self.meta["count"]))
        # Opened lazily per worker: a memmap does survive pickling, but each
        # spawned worker should map the file itself rather than inherit a
        # half-initialised object.
        self._images = None
        self._masks = None

    def __len__(self) -> int:
        return len(self.indices)

    def _open(self):
        if self._images is None:
            self._images = np.load(self.dir / IMAGES, mmap_mode="r")
            self._masks = np.load(self.dir / MASKS, mmap_mode="r")

    def __getitem__(self, i: int):
        self._open()
        j = self.indices[i]
        image = np.asarray(self._images[j])
        mask = np.asarray(self._masks[j])

        if self.transform is not None:
            out = self.transform(image=np.transpose(image, (1, 2, 0)), mask=mask)
            image = np.transpose(out["image"], (2, 0, 1))
            mask = out["mask"]

        return np.ascontiguousarray(image), np.ascontiguousarray(mask)


def domains(out_dir: Path) -> list[str]:
    with (Path(out_dir) / META).open("r", encoding="utf-8") as fh:
        return json.load(fh)["domains"]
