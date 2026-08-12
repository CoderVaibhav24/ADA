"""Download every model the pipeline uses into `data/weights/`.

By default the backends pull their weights from the HuggingFace / torch user
cache (`~/.cache/...`), which means the weights live outside the project: a
fresh checkout, a different machine, or an air-gapped ADA server has nothing to
run. This script vendors them into the repo's own `data/weights/` tree, records
the exact resolved commit of each one in `manifest.json`, and regenerates
`THIRD_PARTY_LICENSES.md`.

After running this the app loads weights from disk and never needs the network.

Usage:
    .venv\\Scripts\\python.exe scripts\\fetch_weights.py           # fetch all
    .venv\\Scripts\\python.exe scripts\\fetch_weights.py --check   # verify only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402

WEIGHTS = settings.weights_dir

# Each entry pins one model. `revision` is the git ref requested; the exact
# commit it resolved to is written into manifest.json, which is what makes a
# later deployment reproducible.
MODELS = [
    {
        "key": "building_seg",
        "repo": "geobase/building-footprint-segmentation",
        "revision": "main",
        "kind": "hf_files",
        "files": ["onnx/model.onnx"],
        "local": "building-footprint-segmentation",
        "license": "Apache-2.0",
        "role": "Per-epoch building footprint segmentation (ONNX U-Net, CPU)",
    },
    {
        "key": "changestar",
        "repo": "geobase/changestar-building-segmentation-vitb",
        "revision": "main",
        "kind": "hf_files",
        "files": ["onnx/model.onnx"],
        "local": "changestar-building-segmentation-vitb",
        "license": "Apache-2.0",
        "role": ("Per-epoch building footprints (ChangeStar ViT-B, 1024 px, GPU). "
                 "Default: raised BEFORE/AFTER agreement on the Agra pair from "
                 "IoU 0.112 to 0.554, which is what makes the BEFORE epoch usable"),
    },
    {
        "key": "landcover",
        "repo": "IgorNer/segformer-b5-loveda",
        "revision": "main",
        "kind": "hf_snapshot",
        "ignore": ["*.msgpack", "*.h5", "*.onnx", "trainer_state.json", "scaler.pt"],
        "local": "segformer-b5-loveda",
        "license": "Apache-2.0",
        "role": ("Land cover / vegetation without a colour rule (SegFormer-B5, "
                 "LoveDA 7-class, GPU)"),
    },
    {
        "key": "sam2",
        "repo": "facebook/sam2.1-hiera-large",
        "revision": "main",
        "kind": "hf_snapshot",
        # weights + processor/model config; skip the duplicate formats
        "ignore": ["*.msgpack", "*.h5", "*.onnx", "*.pt"],
        "local": "sam2.1-hiera-large",
        "license": "Apache-2.0",
        "role": ("Full-structure refinement of confirmed detections (GPU). "
                 "hiera-large, not -small: this decides the reported OUTLINE. "
                 "For SAM 3 set SAM_BACKEND=sam3 — facebook/sam3 is GATED, so "
                 "request access on the model page and log in first"),
    },
    {
        "key": "resnet18",
        "repo": "torchvision/resnet18 (IMAGENET1K_V1)",
        "revision": "v1",
        "kind": "url",
        "url": "https://download.pytorch.org/models/resnet18-f37072fd.pth",
        "local": "resnet18/resnet18-f37072fd.pth",
        "license": "BSD-3-Clause",
        "role": "Backbone for the alternate DCVA change-detection path (MODEL_MODE=cd)",
    },
]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _dir_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def _resolved_commit(repo: str, revision: str) -> str | None:
    try:
        from huggingface_hub import HfApi
        return HfApi().model_info(repo, revision=revision).sha
    except Exception:
        return None


def fetch(model: dict) -> dict:
    from huggingface_hub import hf_hub_download, snapshot_download

    target = WEIGHTS / model["local"]
    print(f"\n--- {model['key']}: {model['repo']}")

    if model["kind"] == "hf_files":
        target.mkdir(parents=True, exist_ok=True)
        for rel in model["files"]:
            hf_hub_download(model["repo"], rel, revision=model["revision"],
                            local_dir=target)
            print(f"    {rel}")
    elif model["kind"] == "hf_snapshot":
        snapshot_download(model["repo"], revision=model["revision"],
                          local_dir=target, ignore_patterns=model.get("ignore"))
        print(f"    snapshot -> {target.name}")
    elif model["kind"] == "url":
        import urllib.request
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            print(f"    already present: {target.name}")
        else:
            print(f"    downloading {model['url']}")
            urllib.request.urlretrieve(model["url"], target)
    else:
        raise ValueError(f"unknown kind {model['kind']}")

    size = _dir_size(target)
    entry = {
        "key": model["key"],
        "source": model["repo"],
        "requested_revision": model["revision"],
        "resolved_commit": (_resolved_commit(model["repo"], model["revision"])
                            if model["kind"].startswith("hf") else model["revision"]),
        "local_path": str(target.relative_to(settings.data_dir.parent)).replace("\\", "/"),
        "bytes": size,
        "license": model["license"],
        "role": model["role"],
    }
    if target.is_file():
        entry["sha256"] = _sha256(target)
    print(f"    {size / 1e6:.1f} MB  commit={entry['resolved_commit']}")
    return entry


LICENSE_HEADER = """# Third-Party Models & Licences

Every model weight shipped with Project ADA-Vision, its licence, and the exact
upstream revision it was fetched from. All are permissive (Apache 2.0 / BSD),
so ADA retains full rights to operate, modify and redistribute the system with
no per-seat, per-scene or per-inference cost, and no runtime dependency on a
third-party AI service.

Regenerate this file with `backend/scripts/fetch_weights.py`.

"""


def write_manifest(entries: list[dict]) -> None:
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": "Vendored model weights. The app loads these from disk; no "
                "network access is required at runtime.",
        "models": entries,
    }
    (WEIGHTS / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")

    lines = [LICENSE_HEADER]
    for e in entries:
        lines.append(f"## {e['source']}\n")
        lines.append(f"- **Licence:** {e['license']}")
        lines.append(f"- **Role:** {e['role']}")
        lines.append(f"- **Revision:** `{e['resolved_commit']}`")
        lines.append(f"- **Vendored at:** `{e['local_path']}` "
                     f"({e['bytes'] / 1e6:.1f} MB)")
        if "sha256" in e:
            lines.append(f"- **SHA-256:** `{e['sha256']}`")
        lines.append("")
    (settings.data_dir.parent / "THIRD_PARTY_LICENSES.md").write_text(
        "\n".join(lines), encoding="utf-8")


def check() -> int:
    """Verify every model the CODE currently needs is on disk.

    Deliberately driven by MODELS, not by manifest.json. The manifest records
    what was fetched last time, so checking against it means adding a model to
    this file can never make the check fail — the entrypoint reported "weights
    already vendored" while ChangeStar and the land-cover model had never been
    downloaded, and the pipeline silently ran from the HuggingFace cache
    instead. A check that cannot detect the thing it exists to detect is worse
    than no check, because it is trusted.
    """
    manifest_path = WEIGHTS / "manifest.json"
    manifest = {}
    if manifest_path.is_file():
        manifest = {e["key"]: e for e in
                    json.loads(manifest_path.read_text(encoding="utf-8"))["models"]}

    missing = 0
    for model in MODELS:
        path = WEIGHTS / model["local"]
        ok = path.exists() and _dir_size(path) > 0
        stale = ok and model["key"] not in manifest
        flag = "OK  " if ok and not stale else ("STALE" if stale else "MISS")
        print(f"{flag:5s} {model['key']:14s} {model['local']}")
        missing += 0 if ok else 1
    if missing:
        print(f"{missing} model(s) missing — run without --check to fetch")
    return 1 if missing else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="verify vendored weights without downloading")
    args = ap.parse_args()
    if args.check:
        return check()

    WEIGHTS.mkdir(parents=True, exist_ok=True)
    entries = [fetch(m) for m in MODELS]
    write_manifest(entries)
    total = sum(e["bytes"] for e in entries)
    print(f"\nVendored {len(entries)} models, {total / 1e6:.0f} MB total")
    print(f"  weights   : {WEIGHTS}")
    print(f"  manifest  : {WEIGHTS / 'manifest.json'}")
    print(f"  licences  : {settings.data_dir.parent / 'THIRD_PARTY_LICENSES.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
