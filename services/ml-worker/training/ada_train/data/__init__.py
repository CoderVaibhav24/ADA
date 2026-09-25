"""Dataset registry. Every path into training data goes through the licence gate.

`build` is the only way the engine gets a dataset, and it calls
`licences.assert_trainable` before any dataset module is even imported. That is
deliberate: it means adding a new training set without a recorded licence
verdict fails at config-load time, not at review time.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .. import licences
from .transforms import train_transform, val_transform

log = logging.getLogger("ada.train")

# dataset id -> (module attribute name, task)
REGISTRY = {
    "flair1": ("flair1", "multiclass"),
    "opencities": ("opencities", "binary"),
}


def module_for(dataset_id: str):
    if dataset_id not in REGISTRY:
        raise ValueError(
            f"unknown dataset {dataset_id!r}. Registered: {sorted(REGISTRY)}. "
            f"A new dataset needs a module here AND a verdict in "
            f"ada_train/licences.py."
        )
    name, _task = REGISTRY[dataset_id]
    if name == "flair1":
        from . import flair1
        return flair1
    from . import opencities
    return opencities


def index_for(cfg):
    """Build or load the index, apply the domain-held split and the subsample."""
    entry = licences.assert_trainable(
        cfg.data.dataset, allow_share_alike=cfg.licence.allow_share_alike)
    log.info("licence gate passed: %s (%s)", entry.name, entry.licence)

    mod = module_for(cfg.data.dataset)
    root = Path(cfg.data.root)

    if cfg.data.dataset == "flair1":
        index = mod.load_index(root)
    else:
        index = _cached_index(mod, root, cfg)

    train, val = mod.split_by_domain(index, cfg.data.val_fraction, cfg.train.seed)
    train = mod.subsample(train, cfg.data.fraction, cfg.train.seed)
    # Validation is subsampled harder: it only has to be a stable yardstick,
    # and a full validation pass every epoch on a laptop is a real tax.
    val = mod.subsample(val, min(1.0, cfg.data.fraction), cfg.train.seed)
    return train, val


def _cached_index(mod, root: Path, cfg):
    import json
    cache = root / f"index_{cfg.data.crop}.json"
    if cache.is_file():
        with cache.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    index = mod.build_index(root, crop=cfg.data.crop, seed=cfg.train.seed)
    with cache.open("w", encoding="utf-8") as fh:
        json.dump(index, fh)
    log.info("wrote %s", cache)
    return index


def build(cfg):
    """Return (train_dataset, val_dataset, label_info)."""
    mod = module_for(cfg.data.dataset)
    train_entries, val_entries = index_for(cfg)

    t_train = train_transform(cfg.data.crop, cfg.model.in_channels)
    t_val = val_transform(cfg.data.crop, cfg.model.in_channels)

    if cfg.data.packed:
        from .pack import PackedDataset
        base = Path(cfg.data.packed)
        # `ada_train pack` writes <packed>/train and <packed>/val as separate
        # directories, so the domain-held split survives packing. A flat
        # directory is refused rather than silently validating on training
        # tiles, which would report an inflated number for the rest of the run.
        train_dir, val_dir = base / "train", base / "val"
        if not (train_dir.is_dir() and val_dir.is_dir()):
            raise FileNotFoundError(
                f"data.packed is {base} but {train_dir.name}/ and "
                f"{val_dir.name}/ are not both there. Run `ada_train pack` "
                f"with the same config first -- it writes the two splits "
                f"separately so validation stays on held-out domains."
            )
        train_ds = PackedDataset(train_dir, transform=t_train)
        val_ds = PackedDataset(val_dir, transform=t_val)
        log.info("reading packed memmaps: %d train / %d val patches",
                 len(train_ds), len(val_ds))
    else:
        cls = _dataset_class(cfg.data.dataset)
        train_ds = cls(train_entries, transform=t_train,
                       in_channels=cfg.model.in_channels)
        val_ds = cls(val_entries, transform=t_val,
                     in_channels=cfg.model.in_channels)

    info = {
        "labels": mod.LABELS,
        "n_classes": mod.N_CLASSES,
        "built_classes": getattr(mod, "BUILT_CLASSES", None),
        "dataset": cfg.data.dataset,
    }
    return train_ds, val_ds, info


def _dataset_class(dataset_id: str):
    if dataset_id == "flair1":
        from .flair1 import Flair1Dataset
        return Flair1Dataset
    from .opencities import OpenCitiesDataset
    return OpenCitiesDataset
