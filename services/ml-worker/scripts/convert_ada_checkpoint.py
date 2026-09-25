"""Convert an ADA training checkpoint (pickled best.pt) into safetensors + config.json.

The training runs save a pickled dict {model, epoch, val | val_iou, seg_trust,
classes}. Unpickling runs arbitrary code, so it happens once, here, on a file
from ADA's own training disk; the service only ever reads the safetensors copy.

Usage:
    .venv/bin/python services/ml-worker/scripts/convert_ada_checkpoint.py \\
        --kind footprint --src "/Volumes/Extreme SSD/ADA-Train/runs/footprint_v1/best.pt"
    .venv/bin/python services/ml-worker/scripts/convert_ada_checkpoint.py \\
        --kind landcover --src "/Volumes/Extreme SSD/ADA-Train/runs/landcover7_v3/best.pt" \\
        --metric held_out_miou=0.4765

The output directory defaults to data/weights/<ada_footprint_local | ada_landcover_local>.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.ml.ada_backends import (  # noqa: E402
    ADA_CROP,
    ADA_DECODER_CHANNELS,
    ADA_ENCODER,
    ADA_MEAN,
    ADA_STD,
    HEAD_KEY,
    MODEL_FILE,
)
from app.ml.landcover import LABELS  # noqa: E402

LICENCE = (
    "ADA-owned weights. Initialised from IGN FLAIR-HUB LC-A RGB swinbase-upernet "
    "(Licence Ouverte / Etalab 2.0). Labels: Google Open Buildings V3 (CC BY 4.0), "
    "Microsoft GlobalML Building Footprints (CDLA-Permissive-2.0), FLAIR pseudo-labels. "
    "Imagery: Lucknow 2020/2025 grids, provenance unconfirmed."
)
TRAINED_ON = (
    "Lucknow 2020/2025 imagery grids; building labels from Google Open Buildings V3 and "
    "Microsoft GlobalML Building Footprints; land-cover pseudo-labels from FLAIR-HUB."
)

KINDS = {
    "footprint": {"classes": 1, "class_names": ["building"],
                  "local": lambda: settings.ada_footprint_local},
    "landcover": {"classes": 7, "class_names": [LABELS[i] for i in range(7)],
                  "local": lambda: settings.ada_landcover_local},
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _metrics(ck: dict, extra: list[str]) -> dict:
    out: dict = {}
    if "val_iou" in ck:
        out["val_iou"] = float(ck["val_iou"])
    if isinstance(ck.get("val"), dict):
        out["val_miou"] = float(ck["val"]["miou"])
        out["val_per_class_iou"] = [float(v) for v in ck["val"]["per_class_iou"]]
    if "seg_trust" in ck:
        out["seg_trust"] = float(ck["seg_trust"])
    for item in extra:
        key, _, value = item.partition("=")
        if not key or not value:
            raise SystemExit(f"--metric expects key=value, got {item!r}")
        out[key] = float(value)
    return out


def convert(kind: str, src: Path, out_dir: Path, extra_metrics: list[str]) -> Path:
    import torch
    from safetensors.torch import save_file

    spec = KINDS[kind]
    ck = torch.load(src, map_location="cpu", weights_only=False)  # noqa: S614 - trusted ADA disk
    state = ck["model"]
    n_out = state[HEAD_KEY].shape[0]
    if n_out != spec["classes"]:
        raise SystemExit(f"{src} has a {n_out}-class head; --kind {kind} expects "
                         f"{spec['classes']}")
    names = ck.get("classes")
    if names is not None and list(names) != spec["class_names"]:
        raise SystemExit(f"{src} class order {names} differs from {spec['class_names']}")

    out_dir.mkdir(parents=True, exist_ok=True)
    weights = out_dir / MODEL_FILE
    save_file({k: v.detach().contiguous() for k, v in state.items()}, str(weights),
              metadata={"format": "pt"})
    config = {
        "architecture": "smp.UPerNet",
        "encoder": ADA_ENCODER,
        "decoder_channels": ADA_DECODER_CHANNELS,
        "classes": spec["classes"],
        "class_names": spec["class_names"],
        "crop": ADA_CROP,
        "mean": list(ADA_MEAN),
        "std": list(ADA_STD),
        "source_run": src.parent.name,
        "source_sha256": sha256(src),
        "epoch": ck.get("epoch"),
        "metrics": _metrics(ck, extra_metrics),
        "trained_on": TRAINED_ON,
        "licence": LICENCE,
        "sha256": sha256(weights),
        "bytes": weights.stat().st_size,
    }
    (out_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"{kind}: {src} -> {weights} ({config['bytes'] / 1e6:.0f} MB, "
          f"sha256 {config['sha256'][:12]}...)")
    return weights


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kind", choices=sorted(KINDS), required=True)
    ap.add_argument("--src", type=Path, required=True, help="training best.pt")
    ap.add_argument("--out", type=Path, default=None,
                    help="output directory (default data/weights/<local name>)")
    ap.add_argument("--metric", action="append", default=[],
                    help="extra metric to record, key=value (repeatable)")
    args = ap.parse_args()
    out = args.out or settings.weights_dir / KINDS[args.kind]["local"]()
    convert(args.kind, args.src, out, args.metric)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
