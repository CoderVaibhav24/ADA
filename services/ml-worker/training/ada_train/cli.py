"""Command line entry point.

    python -m ada_train doctor                            check the box before a 2-day run
    python -m ada_train licences                          print the register / audit it
    python -m ada_train index    -c configs/x.yaml        build and cache the dataset index
    python -m ada_train pack     -c configs/x.yaml        rewrite tiles as memmaps on the SSD
    python -m ada_train fit      -c configs/x.yaml        train (auto-resumes)
    python -m ada_train val      -c configs/x.yaml        validate a checkpoint
    python -m ada_train export   -c configs/x.yaml        ONNX + provenance

Any config value can be overridden inline, which is how the smoke run works
without a second config file:

    python -m ada_train fit -c configs/landcover_flair1.yaml \
        -o data.fraction=0.01 train.epochs=2 name=smoke
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path


def _setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def _load(args):
    from . import config
    return config.load(args.config, args.override)


def cmd_doctor(args) -> int:
    """Everything worth knowing before committing days of wall clock."""
    import platform

    from . import device as dev

    print(f"platform     : {platform.system()} {platform.release()} "
          f"({platform.machine()})")
    print(f"python       : {sys.version.split()[0]}")

    try:
        import torch
    except ImportError:
        print("torch        : NOT INSTALLED")
        return 1

    chosen = dev.detect("auto")
    print(f"torch        : {torch.__version__} (CUDA build: {torch.version.cuda})")
    print(f"device       : {dev.describe(chosen)}")

    if chosen == "cpu":
        print("\nFAIL: no GPU visible. Training on CPU is not viable for this "
              "workload.")
        if platform.system() == "Windows":
            print("On Windows the default PyPI torch wheel is CPU-only. Install:")
            print("  pip install torch torchvision "
                  "--index-url https://download.pytorch.org/whl/cu126")
        return 1

    if chosen == "cuda":
        print(f"bf16 support : {torch.cuda.is_bf16_supported()}")
        free = dev.vram_free_gib()
        props = torch.cuda.get_device_properties(0)
        total = props.total_memory / 1024 ** 3
        print(f"VRAM free    : {free:.2f} / {total:.2f} GiB")
        if total < 5.0:
            print("NOTE: under 5 GiB of VRAM. Use train.batch_size 2 with "
                  "train.grad_accum 8, and turn on model.grad_checkpoint.")
        elif total < 7.0:
            print("NOTE: 6 GiB class. batch_size 4 + grad_accum 4 at crop 512 "
                  "fits. SegFormer-B5 and Swin-v2-B do not -- that is an "
                  "accuracy ceiling, not just a speed one.")

    for module in ("segmentation_models_pytorch", "timm", "rasterio",
                   "albumentations", "onnx", "onnxruntime", "fiona"):
        try:
            mod = __import__(module)
            print(f"{module:<30}: {getattr(mod, '__version__', 'ok')}")
        except ImportError:
            print(f"{module:<30}: MISSING  (pip install -r requirements-train.txt)")

    if args.config:
        cfg = _load(args)
        root = Path(cfg.data.root)
        print(f"\ndata.root    : {root} "
              f"({'exists' if root.exists() else 'MISSING'})")
        out = Path(cfg.out_dir)
        print(f"out_dir      : {out.resolve() if out.exists() else out} "
              f"({'exists' if out.exists() else 'will be created'})")
        if platform.system() == "Windows":
            print("\nWindows reminders for a multi-day run:")
            print("  powercfg /change standby-timeout-ac 0")
            print(f'  Add-MpPreference -ExclusionPath "{root}"')
            print("  disable automatic restart for updates")
    return 0


def cmd_licences(args) -> int:
    from . import licences

    problems = licences.audit()
    print("TRAINABLE -- may train and ship the resulting weights")
    for key, entry in sorted(licences.REGISTER.items()):
        if entry.trainable:
            print(f"  {key:<14} {entry.licence}")
            print(f"                 {entry.name}")
    print("\nBENCHMARK ONLY -- never ship weights trained on these")
    for key, entry in sorted(licences.REGISTER.items()):
        if not entry.trainable:
            print(f"  {key:<14} {entry.licence}")
            print(f"                 {entry.name}")
    if problems:
        print("\nAUDIT PROBLEMS:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\naudit: register is coherent")
    return 0


def cmd_index(args) -> int:
    from . import data as data_mod

    cfg = _load(args)
    train, val = data_mod.index_for(cfg)
    print(f"train patches: {len(train)}")
    print(f"val patches  : {len(val)}")
    return 0


def cmd_pack(args) -> int:
    from . import data as data_mod
    from .data import pack as pack_mod

    cfg = _load(args)
    if not cfg.data.packed:
        print("set data.packed to the target directory on the SSD first, e.g.")
        print("  -o data.packed=E:/ada/packed/flair1")
        return 1

    train_entries, val_entries = data_mod.index_for(cfg)
    cls = data_mod._dataset_class(cfg.data.dataset)
    base = Path(cfg.data.packed)
    for split, entries in (("train", train_entries), ("val", val_entries)):
        # Train and val are packed into separate directories so the
        # domain-held split survives packing.
        dataset = cls(entries, transform=None, in_channels=cfg.model.in_channels)
        pack_mod.pack(entries, dataset, base / split,
                      cfg.model.in_channels, cfg.data.crop)
    print(f"packed into {base}/train and {base}/val")
    return 0


def cmd_fit(args) -> int:
    from . import data as data_mod
    from .engine import Trainer

    cfg = _load(args)
    train_ds, val_ds, info = data_mod.build(cfg)
    if cfg.task == "multiclass":
        cfg.model.classes = info["n_classes"]
    trainer = Trainer(cfg, train_ds, val_ds, info)
    result = trainer.fit()
    print(f"best {result['best']:.4f}, checkpoints in {result['run_dir']}")
    return 0


def cmd_val(args) -> int:
    import torch

    from . import data as data_mod
    from . import metrics as metrics_mod
    from .engine import Trainer

    cfg = _load(args)
    cfg.resume = False
    train_ds, val_ds, info = data_mod.build(cfg)
    if cfg.task == "multiclass":
        cfg.model.classes = info["n_classes"]
    trainer = Trainer(cfg, train_ds, val_ds, info)

    path = Path(args.checkpoint or (cfg.run_dir / "best.pt"))
    state = torch.load(path, map_location=trainer.device, weights_only=False)
    trainer.model.load_state_dict(state["model"])
    result = trainer.validate()
    print(metrics_mod.format_summary(result, cfg.task))
    for name, value in result["per_class_iou"].items():
        print(f"  {name:<24} {('n/a' if value is None else f'{value:.4f}')}")
    return 0


def cmd_export(args) -> int:
    from . import export as export_mod

    cfg = _load(args)
    result = export_mod.export(cfg, args.checkpoint, args.out)
    for path in result["onnx"]:
        print(path)
    print(result["provenance"])
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ada_train", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_config(p, required=True):
        p.add_argument("-c", "--config", required=required)
        p.add_argument("-o", "--override", nargs="*", default=[],
                       metavar="key=value",
                       help="dotted config overrides, e.g. train.epochs=2")

    p = sub.add_parser("doctor", help="check the machine before a long run")
    add_config(p, required=False)
    p.set_defaults(func=cmd_doctor)

    p = sub.add_parser("licences", help="print and audit the licence register")
    p.set_defaults(func=cmd_licences)

    p = sub.add_parser("index", help="build and cache the dataset index")
    add_config(p)
    p.set_defaults(func=cmd_index)

    p = sub.add_parser("pack", help="rewrite tiles as flat memmaps")
    add_config(p)
    p.set_defaults(func=cmd_pack)

    p = sub.add_parser("fit", help="train, resuming automatically")
    add_config(p)
    p.set_defaults(func=cmd_fit)

    p = sub.add_parser("val", help="validate a checkpoint")
    add_config(p)
    p.add_argument("--checkpoint")
    p.set_defaults(func=cmd_val)

    p = sub.add_parser("export", help="ONNX export plus provenance")
    add_config(p)
    p.add_argument("--checkpoint")
    p.add_argument("--out")
    p.set_defaults(func=cmd_export)

    args = parser.parse_args(argv)
    _setup_logging(args.verbose)
    return args.func(args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
