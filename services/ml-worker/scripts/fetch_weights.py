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
    .venv/bin/python scripts/fetch_weights.py --freeze          # re-do the
                                                # shape-freeze step only
    .venv/bin/python scripts/fetch_weights.py --local-only      # register ADA's
                                                # own weights, no download

Entries marked `local_only` are ADA's own checkpoints. They are never
downloaded: scripts/convert_ada_checkpoint.py writes them from the training
disk, and this script only checks they are present, sizes and hashes them, and
records them in the manifest. A missing one fails --check only when its backend
is selected (both are by default), with exit code 3: nothing to download, so the
entrypoint must not fall through to a full fetch.

The freeze step exists for Apple Silicon. The ChangeStar export leaves its
height/width symbolic, and the CoreML execution provider resolves shapes at
compile time: it claims 1075 of the graph's 1147 nodes and then fails at
execution inside the ViT's pad. Baking the dims to the one tile size the
backend ever uses (1024) makes the graph compile. A frozen graph is equally
valid on CUDA and CPU, so this runs everywhere rather than being gated on the
host — `--freeze` is only for redoing it against weights already on disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ada_core.datetimes import now_ist  # noqa: E402

from app.config import settings  # noqa: E402

WEIGHTS = settings.weights_dir

ADA_LICENCE = (
    "ADA-owned weights. Initialised from IGN FLAIR-HUB LC-A RGB swinbase-upernet "
    "(Licence Ouverte / Etalab 2.0). Labels: Google Open Buildings V3 (CC BY 4.0), "
    "Microsoft GlobalML Building Footprints (CDLA-Permissive-2.0), FLAIR pseudo-labels. "
    "Imagery: Lucknow 2020/2025 grids, provenance unconfirmed."
)

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
        # Verified on the model card 2026-08-21: NONE declared. Upstream
        # geoai.js is MIT and the research code Apache-2.0, but neither covers
        # these re-exported weights.
        "license": "none declared upstream",
        "role": "Per-epoch building footprint segmentation (ONNX U-Net, CPU)",
    },
    {
        "key": "changestar",
        "repo": "geobase/changestar-building-segmentation-vitb",
        "revision": "main",
        "kind": "hf_files",
        "files": ["onnx/model.onnx"],
        "local": "changestar-building-segmentation-vitb",
        # Bake the symbolic height/width to the backend's fixed 1024 px tile.
        "freeze": {
            "src": "onnx/model.onnx",
            "dst": "onnx/model_static_1024.onnx",
            "dims": {"height": 1024, "width": 1024},
        },
        # Verified 2026-08-21: NONE declared upstream. ChangeStar's published
        # training set is xBD (CC BY-NC-SA 4.0), so a clean re-export would
        # still be non-commercial.
        "license": "none declared upstream (training data xBD: CC BY-NC-SA 4.0)",
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
        # BLOCKING for commercial use, verified 2026-08-21. No model card at
        # all. Backbone is NVIDIA's SegFormer licence — §3.3 research or
        # evaluation only, §3.2 propagating to derivatives — and the training
        # data is LoveDA, CC BY-NC-SA 4.0. Fine-tuning does not lift either.
        # Mitigation in the code today: VEGETATION_MODE=index.
        "license": "NON-COMMERCIAL (NVIDIA SegFormer §3.3 + LoveDA CC BY-NC-SA 4.0)",
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
        "key": "ada_footprint",
        "repo": "ADA training run footprint_v1",
        "revision": "footprint_v1",
        "kind": "local_only",
        "local": settings.ada_footprint_local,
        "file": "model.safetensors",
        "requires": ("building_backend", "ada"),
        "convert": ("footprint", "/Volumes/Extreme SSD/ADA-Train/runs/footprint_v1/best.pt"),
        "license": ADA_LICENCE,
        "role": ("Per-epoch building footprints (ADA UPerNet Swin-B, 384 px, GPU). "
                 "Default; BUILDING_BACKEND=changestar reverts"),
    },
    {
        "key": "ada_landcover",
        "repo": "ADA training run landcover7_v3",
        "revision": "landcover7_v3",
        "kind": "local_only",
        "local": settings.ada_landcover_local,
        "file": "model.safetensors",
        "requires": ("landcover_backend", "ada"),
        "convert": ("landcover",
                    "/Volumes/Extreme SSD/ADA-Train/runs/landcover7_v3/best.pt"),
        "license": ADA_LICENCE,
        "role": ("Land cover, 7 classes in LoveDA order (ADA UPerNet Swin-B, 384 px, "
                 "GPU). Default; LANDCOVER_BACKEND=loveda reverts"),
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


def freeze_shapes(model: dict) -> Path | None:
    """Write a copy of an ONNX model with its symbolic dims baked to constants.

    Uses onnxruntime's own graph utilities rather than editing the proto by
    hand: `make_dim_param_fixed` rewrites every use of the named dim_param, and
    `fix_output_shapes` then re-runs inference so the outputs agree with the
    inputs. Doing only the first leaves an output still declared symbolic, which
    CoreML rejects for the same reason as the input.
    """
    spec = model.get("freeze")
    if not spec:
        return None
    target = WEIGHTS / model["local"]
    src, dst = target / spec["src"], target / spec["dst"]
    if not src.is_file():
        print(f"    freeze skipped: {src.name} not on disk")
        return None
    if dst.is_file() and dst.stat().st_mtime >= src.stat().st_mtime:
        print(f"    freeze up to date: {dst.name}")
        return dst

    import onnx
    from onnxruntime.tools.onnx_model_utils import fix_output_shapes, make_dim_param_fixed

    graph = onnx.load(str(src))
    for name, value in spec["dims"].items():
        make_dim_param_fixed(graph.graph, name, value)
    fix_output_shapes(graph)
    onnx.save(graph, str(dst))
    print(f"    froze {spec['dims']} -> {dst.name} "
          f"({dst.stat().st_size / 1e6:.0f} MB)")
    return dst


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


# Exit code of --check when only ADA's local-only weights are missing or corrupt.
LOCAL_ONLY_MISSING = 3


def _convert_hint(model: dict) -> str:
    kind, src = model.get("convert", ("?", "?"))
    return (f"convert it with services/ml-worker/scripts/convert_ada_checkpoint.py "
            f"--kind {kind} --src \"{src}\"")


def _read_manifest() -> dict[str, dict]:
    path = WEIGHTS / "manifest.json"
    if not path.is_file():
        return {}
    return {e["key"]: e for e in json.loads(path.read_text(encoding="utf-8"))["models"]}


def merge_entries(fresh: dict[str, dict | None], previous: dict[str, dict]) -> list[dict]:
    """Manifest entries in MODELS order; an absent local-only model keeps its previous entry."""
    out = []
    for model in MODELS:
        entry = fresh.get(model["key"])
        if entry is None and model["kind"] == "local_only":
            entry = previous.get(model["key"])
        if entry is not None:
            out.append(entry)
    return out


def _required(model: dict) -> bool:
    """True when the backend this local-only entry serves is the one configured."""
    field, value = model.get("requires", (None, None))
    return field is not None and getattr(settings, field) == value


def register_local(model: dict) -> dict | None:
    """Manifest entry for a local-only model; None (with the fix) when it is absent."""
    target = WEIGHTS / model["local"]
    weights = target / model["file"]
    print(f"\n--- {model['key']}: {model['repo']} (local only)")
    if not weights.is_file():
        print(f"    absent: {weights} - {_convert_hint(model)}")
        return None
    digest = _sha256(weights)
    config_path = target / "config.json"
    config = (json.loads(config_path.read_text(encoding="utf-8"))
              if config_path.is_file() else {})
    if config.get("sha256") and config["sha256"] != digest:
        raise SystemExit(f"{weights} sha256 {digest} does not match {config_path} "
                         f"({config['sha256']}); re-run the conversion")
    entry = {
        "key": model["key"],
        "source": model["repo"],
        "requested_revision": model["revision"],
        "resolved_commit": f"{config.get('source_run', model['revision'])}"
                           f"@epoch{config.get('epoch')}",
        "local_path": str(weights.relative_to(settings.data_dir.parent)).replace("\\", "/"),
        "local_only": True,
        "bytes": weights.stat().st_size,
        "sha256": digest,
        "license": model["license"],
        "role": model["role"],
    }
    print(f"    {entry['bytes'] / 1e6:.1f} MB  sha256={digest[:12]}...")
    return entry


def fetch(model: dict) -> dict | None:
    if model["kind"] == "local_only":
        return register_local(model)

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
            urllib.request.urlretrieve(model["url"], target)  # noqa: S310 - pinned https
    else:
        raise ValueError(f"unknown kind {model['kind']}")

    freeze_shapes(model)

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
upstream revision it was fetched from. There is no runtime dependency on a
third-party AI service and no per-seat, per-scene or per-inference cost.

The licence column is NOT all permissive, and this file used to claim it was.
Read it before any commercial deployment: the land-cover default is
non-commercial by two independent routes, and both building segmenters declare
no licence upstream at all. See `docs/ADA-Backend-Workflow-Models-Licensing.pdf`
§7 for the analysis and the per-model options. The `ADA training run` entries
are ADA-owned weights, kept local only; they are the default backends
(BUILDING_BACKEND=ada / LANDCOVER_BACKEND=ada).

Regenerate this file with `services/ml-worker/scripts/fetch_weights.py`.

"""


def write_manifest(entries: list[dict]) -> None:
    manifest = {
        "generated_at": now_ist().isoformat(),
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
    manifest = _read_manifest()

    missing = local_missing = 0
    for model in MODELS:
        if model["kind"] == "local_only":
            local_missing += _check_local(model, manifest.get(model["key"]))
            continue
        path = WEIGHTS / model["local"]
        ok = path.exists() and _dir_size(path) > 0
        stale = ok and model["key"] not in manifest
        flag = "OK  " if ok and not stale else ("STALE" if stale else "MISS")
        print(f"{flag:5s} {model['key']:14s} {model['local']}")
        missing += 0 if ok else 1
        # A present-but-unfrozen ChangeStar is a working CUDA deployment and a
        # broken Apple one, so report it rather than folding it into `missing`.
        spec = model.get("freeze")
        if ok and spec and not (path / spec["dst"]).is_file():
            print(f"NOFRZ {model['key']:14s} {spec['dst']} missing — required "
                  f"on Apple Silicon (CoreML); run with --freeze")
    if missing:
        print(f"{missing} model(s) missing — run without --check to fetch")
    if local_missing:
        print(f"{local_missing} ADA model(s) missing or corrupt; there is nothing to "
              f"download. Convert them from the training disk (see the MISS lines), "
              f"or set BUILDING_BACKEND=changestar / LANDCOVER_BACKEND=loveda")
    if missing:
        return 1
    return LOCAL_ONLY_MISSING if local_missing else 0


def _check_local(model: dict, recorded: dict | None) -> int:
    """1 when a local-only model is missing or corrupt AND its backend is selected, else 0."""
    weights = WEIGHTS / model["local"] / model["file"]
    needed = _required(model)
    if not weights.is_file():
        flag = "MISS" if needed else "ABSNT"
        note = f": {_convert_hint(model)}" if needed else " (backend not selected)"
        print(f"{flag:5s} {model['key']:14s} {model['local']}{note}")
        return 1 if needed else 0
    size = weights.stat().st_size
    bad = recorded is not None and (recorded.get("bytes") != size
                                    or recorded.get("sha256") != _sha256(weights))
    if bad:
        print(f"HASH  {model['key']:14s} {model['local']} differs from manifest.json; "
              f"re-run convert_ada_checkpoint.py, then --local-only")
        return 1 if needed else 0
    print(f"OK    {model['key']:14s} {model['local']} (local only)")
    return 0


def register_local_only() -> int:
    """Hash every local-only model and merge the entries into the existing manifest."""
    manifest_path = WEIGHTS / "manifest.json"
    previous = _read_manifest()
    local = {m["key"]: register_local(m) for m in MODELS if m["kind"] == "local_only"}
    known = {m["key"] for m in MODELS}
    extra = [e for k, e in previous.items() if k not in known]
    write_manifest(merge_entries({**previous, **local}, previous) + extra)
    added = sum(e is not None for e in local.values())
    print(f"\nRegistered {added} local-only model(s) in {manifest_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="verify vendored weights without downloading")
    ap.add_argument("--freeze", action="store_true",
                    help="only (re)write shape-frozen ONNX copies from weights "
                         "already on disk")
    ap.add_argument("--local-only", action="store_true",
                    help="only hash and register ADA's own local-only weights "
                         "(no download)")
    args = ap.parse_args()
    if args.check:
        return check()
    if args.local_only:
        return register_local_only()
    if args.freeze:
        for model in MODELS:
            if model.get("freeze"):
                print(f"\n--- {model['key']}")
                freeze_shapes(model)
        return 0

    WEIGHTS.mkdir(parents=True, exist_ok=True)
    previous = _read_manifest()
    entries = merge_entries({m["key"]: fetch(m) for m in MODELS}, previous)
    write_manifest(entries)
    total = sum(e["bytes"] for e in entries)
    print(f"\nVendored {len(entries)} models, {total / 1e6:.0f} MB total")
    print(f"  weights   : {WEIGHTS}")
    print(f"  manifest  : {WEIGHTS / 'manifest.json'}")
    print(f"  licences  : {settings.data_dir.parent / 'THIRD_PARTY_LICENSES.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
