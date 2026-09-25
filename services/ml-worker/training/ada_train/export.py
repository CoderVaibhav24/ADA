"""Export a trained checkpoint to ONNX, with its provenance file.

Two decisions here exist to remove whole classes of bug rather than to be tidy:

1. PREPROCESSING IS BAKED INTO THE GRAPH. The exported model takes
   (N, H, W, C) float32 in 0..255 -- exactly what the serving code already
   hands its backends -- and does the divide-by-255 and the mean/std
   normalisation inside the graph. Preprocessing drift between the training
   script and the serving module is the single most common cause of a model
   that validates well and performs badly in production, and it is silent.
   Baking it in makes it impossible.

2. THE BUILDING MODEL EXPORTS AT TWO TILE SIZES FROM ONE SET OF WEIGHTS.
   The current pipeline has two separate building segmenters -- ChangeStar
   ViT-B at 1024 px and the geobase U-Net at 256 px -- with different vendors
   and neither carrying a licence. A U-Net with a convolutional encoder is
   fully convolutional, so the same weights export at both sizes and one
   trained artefact replaces both models. Removing a second vendor dependency
   is the side benefit; the licence fix is the point.

The provenance file answers "which weights, which commit, trained on what,
under which licence" without anyone having to remember. The inventory document
lists that as a contract deliverable.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

import numpy as np

from . import licences
from . import models as models_mod

log = logging.getLogger("ada.train")

# ImageNet statistics, matching what the serving land-cover backend already
# applies. Kept identical on purpose: if the encoder was pretrained on
# ImageNet, these are the statistics its features expect.
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def _wrapper(model, task: str, in_channels: int):
    """NHWC 0..255 in, probabilities out. Normalisation inside the graph."""
    import torch
    from torch import nn

    class Exported(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.net = model
            mean = list(IMAGENET_MEAN)[:in_channels]
            std = list(IMAGENET_STD)[:in_channels]
            while len(mean) < in_channels:      # extra bands (NIR, elevation)
                mean.append(0.5)
                std.append(0.25)
            self.register_buffer(
                "mean", torch.tensor(mean).view(1, in_channels, 1, 1))
            self.register_buffer(
                "std", torch.tensor(std).view(1, in_channels, 1, 1))
            self.task = task

        def forward(self, chips):
            # (N, H, W, C) float32 0..255 -> (N, C, H, W) normalised
            x = chips.permute(0, 3, 1, 2) / 255.0
            x = (x - self.mean) / self.std
            logits = self.net(x)
            if self.task == "multiclass":
                # (N, classes, H, W) probabilities -- the shape
                # landcover.open_land() consumes directly.
                return torch.softmax(logits, dim=1)
            # (N, H, W) building probability -- the shape both current
            # building backends return.
            return torch.sigmoid(logits).squeeze(1)

    exported = Exported().eval()
    for param in exported.parameters():
        param.requires_grad_(False)
    return exported


def _git_commit() -> str:
    try:
        return subprocess.run(
            # git from PATH on purpose: provenance only, and a failure is tolerated below.
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True,  # noqa: S607
            check=True, timeout=10).stdout.strip()
    except Exception:
        return "unknown"


def export(cfg, checkpoint: Path | None = None, out_dir: Path | None = None) -> dict:
    import torch

    checkpoint = Path(checkpoint or (cfg.run_dir / "best.pt"))
    if not checkpoint.is_file():
        raise FileNotFoundError(
            f"no checkpoint at {checkpoint}. Train first, or pass "
            f"--checkpoint explicitly.")
    out_dir = Path(out_dir or (cfg.run_dir / "export"))
    out_dir.mkdir(parents=True, exist_ok=True)

    state = torch.load(checkpoint, map_location="cpu", weights_only=False)
    model = models_mod.build_model(cfg)
    model.load_state_dict(state["model"])
    model.eval()

    wrapped = _wrapper(model, cfg.task, cfg.model.in_channels)

    written = []
    for size in cfg.export.tile_sizes:
        path = out_dir / f"{cfg.name}_{size}.onnx"
        # Batch 2, not 1: a dynamic batch dimension traced from a single
        # sample gives torch.export a range of [2, inf) against an example of
        # 1 and it refuses with "Invalid ranges [2:1]".
        dummy = torch.randint(
            0, 255, (2, size, size, cfg.model.in_channels), dtype=torch.uint8
        ).float()
        torch.onnx.export(
            wrapped, (dummy,), str(path),
            input_names=["chips"], output_names=["probs"],
            # Batch stays dynamic so the serving engine can pick its own batch
            # size per device. Height and width are FIXED per exported file:
            # a convolutional encoder tolerates any size, but pinning them
            # means onnxruntime can plan the graph, which is the difference
            # between the CoreML provider taking the graph and refusing it.
            #
            # dynamic_shapes, not dynamic_axes: torch routes this through the
            # dynamo exporter, where dynamic_axes is legacy and warns that it
            # may raise a constraint violation instead of exporting.
            dynamic_shapes={"chips": {0: torch.export.Dim.DYNAMIC}},
            opset_version=cfg.export.opset,
            do_constant_folding=True,
        )
        log.info("wrote %s (%.1f MB)", path, path.stat().st_size / 1e6)
        _assert_opset(path, cfg.export.opset)
        if cfg.export.verify:
            _verify(wrapped, path, size, cfg)
        written.append(str(path))

    provenance = _provenance(cfg, state, checkpoint, written)
    prov_path = out_dir / "provenance.json"
    with prov_path.open("w", encoding="utf-8") as fh:
        json.dump(provenance, fh, indent=2)
    log.info("wrote %s", prov_path)

    labels_path = out_dir / "labels.json"
    with labels_path.open("w", encoding="utf-8") as fh:
        json.dump({
            "labels": state.get("labels", {}),
            "built_classes": state.get("info", {}).get("built_classes"),
            "task": cfg.task,
        }, fh, indent=2)
    log.info("wrote %s", labels_path)

    return {"onnx": written, "provenance": str(prov_path)}


def _assert_opset(path: Path, requested: int) -> None:
    """Check the file's opset is the one that was asked for.

    torch's exporter picks an opset for the ops it emits and then tries to
    convert down to the requested one. When that conversion has no adapter --
    Resize below opset 18, which is exactly what a U-Net decoder produces --
    the attempt fails and the higher opset is written anyway, with the failure
    only visible as noise in the log. The serving side then loads a graph at an
    opset nobody chose, and whether its execution provider supports it is
    found out in production.
    """
    import onnx

    model = onnx.load(str(path), load_external_data=False)
    actual = {o.version for o in model.opset_import if o.domain in ("", "ai.onnx")}
    if requested not in actual:
        raise RuntimeError(
            f"{path.name} was written at opset {sorted(actual)} but "
            f"export.opset is {requested}. Set export.opset to "
            f"{max(actual)} and re-export, rather than shipping a graph at an "
            f"opset the config does not name."
        )


def _verify(wrapped, path: Path, size: int, cfg) -> None:
    """Run the same input through torch and onnxruntime and compare.

    Worth the seconds it costs: an ONNX export that diverges from the torch
    model does not raise, it just returns different numbers, and the place that
    gets discovered is production.
    """
    import onnxruntime as ort
    import torch

    rng = np.random.default_rng(0)
    chips = rng.integers(0, 256, (2, size, size, cfg.model.in_channels)).astype(np.float32)

    with torch.inference_mode():
        expected = wrapped(torch.from_numpy(chips)).numpy()

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    actual = sess.run(["probs"], {"chips": chips})[0]

    if expected.shape != actual.shape:
        raise RuntimeError(
            f"ONNX output shape {actual.shape} != torch {expected.shape}")
    delta = float(np.abs(expected - actual).max())
    if delta > cfg.export.verify_tolerance:
        raise RuntimeError(
            f"ONNX output differs from torch by {delta:.2e}, tolerance "
            f"{cfg.export.verify_tolerance:.0e}. Do not ship this export.")
    log.info("verified %s against torch (max delta %.2e)", path.name, delta)


def _provenance(cfg, state, checkpoint: Path, written: list[str]) -> dict:
    dataset_id = cfg.data.dataset
    entry = licences.REGISTER.get(dataset_id)
    best_val = None
    metrics_file = cfg.run_dir / "metrics.jsonl"
    if metrics_file.is_file():
        with metrics_file.open("r", encoding="utf-8") as fh:
            records = [json.loads(line) for line in fh if line.strip()]
        vals = [r for r in records if "val" in r]
        if vals:
            best_val = max(vals, key=lambda r: r["val"].get("headline", -1))["val"]

    return {
        "model_name": cfg.name,
        "task": cfg.task,
        "architecture": f"{cfg.model.arch}+{cfg.model.encoder}",
        "architecture_licence": "segmentation-models-pytorch MIT; timm Apache-2.0",
        "encoder_weights": cfg.model.encoder_weights,
        "encoder_weights_note": licences.ENCODER_VERDICTS.get(
            str(cfg.model.encoder_weights).lower(), (None, ""))[1],
        "in_channels": cfg.model.in_channels,
        "classes": cfg.model.classes if cfg.task == "multiclass" else 1,
        "trained_on": {
            "dataset": dataset_id,
            "dataset_name": entry.name if entry else "unregistered",
            "dataset_licence": entry.licence if entry else "unknown",
            "fraction_used": cfg.data.fraction,
            "crop": cfg.data.crop,
        },
        "attribution": licences.attribution_for([dataset_id]),
        "weights_licence": "ADA-owned. Trained by PCSMCPL on licence-clean data.",
        "epochs_completed": state.get("epoch"),
        "best_headline_metric": state.get("best"),
        "best_validation": best_val,
        "checkpoint": str(checkpoint),
        "onnx": written,
        "ada_commit": _git_commit(),
        "notes": [
            "Preprocessing is inside the ONNX graph: input is (N, H, W, C) "
            "float32 in 0..255, no host-side normalisation required.",
            "Height and width are fixed per exported file; batch is dynamic.",
        ],
    }
