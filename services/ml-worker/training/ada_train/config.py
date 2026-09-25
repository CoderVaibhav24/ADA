"""Config objects, loaded from YAML.

One config file per training campaign, checked into configs/. The file is
copied verbatim into the run directory and into the exported model's
provenance, so "which weights, trained on what, under which licence" stays
answerable at any time -- which the inventory document lists as a deliverable,
not a nicety.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

import yaml


@dataclass
class ModelCfg:
    # smp architecture name: unet | unetplusplus | deeplabv3plus | fpn | segformer
    arch: str = "unet"
    # Encoder. On 6 GB of VRAM at 512 px this is the ceiling: resnet34 and
    # convnext_tiny fit, swin-v2-b and mit-b5 do not. That is an accuracy
    # ceiling as much as a speed one, and it is the thing more hardware buys.
    encoder: str = "resnet34"
    # Keyed into licences.ENCODER_VERDICTS. null means random init.
    encoder_weights: str | None = "imagenet"
    in_channels: int = 3
    classes: int = 13
    # Trade ~30% throughput for roughly half the activation memory. Off by
    # default at 6 GB with batch 4; turn it on before lowering the batch size,
    # because a smaller batch hurts BatchNorm more than slow steps hurt anything.
    grad_checkpoint: bool = False


@dataclass
class DataCfg:
    # Key into licences.REGISTER, and the dataset module to use.
    dataset: str = "flair1"
    # Root of the dataset on the external SSD, e.g. E:/ada/datasets/flair1.
    root: str = ""
    # Optional packed memmap directory produced by `ada_train pack`. Reading
    # 77k small TIFFs over USB is IOPS-bound; a packed shard is one sequential
    # file. Leave null to read the TIFFs directly.
    packed: str | None = None
    crop: int = 512
    # Fraction of the index to use. 0.25 on FLAIR-1 is ~19k patches, which is
    # the sensible first real run on a laptop.
    fraction: float = 1.0
    # FLAIR-1 ships an official test split; this is the train/val cut inside
    # the train split, held by department so val is not the same neighbourhood.
    val_fraction: float = 0.1
    # Windows uses spawn, so each worker re-imports and re-opens handles.
    # persistent_workers below is what makes 6 workers affordable there.
    workers: int = 6
    persistent_workers: bool = True
    pin_memory: bool = True
    prefetch_factor: int = 2


@dataclass
class TrainCfg:
    epochs: int = 40
    # Effective batch is batch_size * grad_accum. 4 * 4 = 16 at 512 px fits in
    # 6 GB with bf16 and channels_last.
    batch_size: int = 4
    grad_accum: int = 4
    lr: float = 3e-4
    encoder_lr_scale: float = 0.1     # pretrained encoder wants a smaller step
    weight_decay: float = 1e-2
    warmup_steps: int = 500
    # bf16 on Ada. fp16 needs a GradScaler and gains nothing here; fp32 is for
    # debugging a suspected precision problem only.
    precision: str = "bf16"           # bf16 | fp16 | fp32
    channels_last: bool = True
    clip_grad_norm: float = 1.0
    # Multi-day runs on a laptop end from Windows updates, a bumped USB cable
    # or a closed lid far more often than from anything numerical. Checkpoint
    # often enough that losing one interval does not hurt.
    save_every_steps: int = 500
    val_every_epochs: int = 1
    # Stop if the headline metric has not improved in this many validations.
    early_stop_patience: int = 8
    seed: int = 1337
    # cudnn.benchmark pays off because every tile is the same size.
    cudnn_benchmark: bool = True


@dataclass
class LossCfg:
    # Cross-entropy plus Dice for multiclass, BCE plus Dice for binary. Dice
    # carries the small classes; CE/BCE alone collapses onto whatever covers
    # most pixels, which for land cover is agricultural land.
    ce_weight: float = 1.0
    dice_weight: float = 1.0
    # Inverse-frequency class weights, computed once by `ada_train index` and
    # cached. Officers confirm far more than they reject and land cover is just
    # as imbalanced; unweighted fits collapse to the majority class.
    class_weights: str = "auto"       # auto | none | comma-separated floats
    label_smoothing: float = 0.0
    ignore_index: int = 255


@dataclass
class LicenceCfg:
    # Opt-in, per the register. SpaceNet is the only share-alike set in play.
    allow_share_alike: bool = False


@dataclass
class ExportCfg:
    # Tile sizes to export. Land cover serves at 512. The building segmenter
    # has to cover BOTH current models, so it exports at 1024 (the ChangeStar
    # slot) and 256 (the CPU/Apple path) from one set of weights.
    tile_sizes: list[int] = field(default_factory=lambda: [512])
    # 18, not 17: the U-Net decoder's upsample becomes a Resize node that
    # torch's exporter only emits at opset 18, and onnx's version converter
    # has no downgrade adapter for it. Asking for 17 produced an 18 graph
    # anyway -- verified, and now checked rather than assumed.
    opset: int = 18
    # Verify the ONNX graph against the torch model before writing provenance.
    verify: bool = True
    verify_tolerance: float = 2e-3


@dataclass
class Config:
    # Free-text name for the run directory.
    name: str = "landcover-flair1"
    # Where checkpoints, logs and exports go. Put this on the SSD too.
    out_dir: str = "runs"
    task: str = "multiclass"          # multiclass | binary
    model: ModelCfg = field(default_factory=ModelCfg)
    data: DataCfg = field(default_factory=DataCfg)
    train: TrainCfg = field(default_factory=TrainCfg)
    loss: LossCfg = field(default_factory=LossCfg)
    licence: LicenceCfg = field(default_factory=LicenceCfg)
    export: ExportCfg = field(default_factory=ExportCfg)
    # Auto-resume from out_dir/name/last.pt when present.
    resume: bool = True
    device: str = "auto"              # auto | cuda | mps | cpu

    @property
    def run_dir(self) -> Path:
        return Path(self.out_dir) / self.name

    @property
    def raw(self) -> dict[str, Any]:
        return copy.deepcopy(getattr(self, "_raw", {}))


def load(path: str | Path, overrides: list[str] | None = None) -> Config:
    """Load a YAML config, applying `section.key=value` overrides from the CLI."""
    path = Path(path)
    with path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}

    for item in overrides or []:
        if "=" not in item:
            raise ValueError(f"override {item!r} is not of the form key=value")
        dotted, value = item.split("=", 1)
        node = raw
        parts = dotted.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = yaml.safe_load(value)

    # Resolve the nested dataclass types by name, since `from __future__ import
    # annotations` makes field.type a string.
    resolved = _resolve(Config, raw)
    resolved._raw = raw
    return resolved


_TYPES = {
    "ModelCfg": ModelCfg, "DataCfg": DataCfg, "TrainCfg": TrainCfg,
    "LossCfg": LossCfg, "LicenceCfg": LicenceCfg, "ExportCfg": ExportCfg,
}


def _resolve(cls, data: dict[str, Any]):
    kwargs = {}
    known = {f.name: f for f in fields(cls)}
    unknown = set(data) - set(known)
    if unknown:
        raise ValueError(
            f"unknown key(s) {sorted(unknown)} in the {cls.__name__} section. "
            f"Valid keys: {sorted(known)}"
        )
    for key, value in data.items():
        type_name = known[key].type
        if isinstance(type_name, str):
            type_name = type_name.split("|")[0].strip()
        sub = _TYPES.get(type_name)
        if sub is not None and isinstance(value, dict):
            kwargs[key] = _resolve(sub, value)
        else:
            kwargs[key] = value
    return cls(**kwargs)
