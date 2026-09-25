"""Metrics, accumulated as a confusion matrix on the device.

The headline number is deliberately NOT mIoU. mIoU over 13 FLAIR-1 classes
rewards telling coniferous from deciduous woodland, which ADA's pipeline never
asks and never consumes. What the pipeline consumes is
`landcover.open_land()` -- one minus the probability that a pixel is building,
road or water -- so the number that decides whether a replacement is good
enough is the BUILT versus OPEN IoU after that collapse.

Both are reported. The per-class figures diagnose the model; `built_iou` (land
cover) and `iou` (buildings) select the checkpoint.

For the building segmenter there is a second number that lives outside this
module: BEFORE/AFTER footprint agreement of IoU 0.554 on the Agra pair, which
is what the current ChangeStar checkpoint achieves and the floor a replacement
must clear. It needs both epochs of a real ADA scene, so it belongs in the
evaluation harness, not in the training loop.
"""

from __future__ import annotations

import numpy as np


class ConfusionMatrix:
    """Streaming confusion matrix. Kept on the GPU to avoid a per-batch sync."""

    def __init__(self, n_classes: int, device: str, ignore_index: int = 255) -> None:
        import torch
        self.n = n_classes
        self.ignore_index = ignore_index
        self.mat = torch.zeros((n_classes, n_classes), dtype=torch.int64, device=device)

    def update(self, pred, target) -> None:
        import torch
        valid = target != self.ignore_index
        pred = pred[valid].reshape(-1)
        target = target[valid].reshape(-1).long()
        if target.numel() == 0:
            return
        # bincount over target * n + pred is the standard trick: one kernel,
        # no synchronisation, no host transfer per batch.
        k = target * self.n + pred
        self.mat += torch.bincount(k, minlength=self.n ** 2).reshape(self.n, self.n)

    def numpy(self) -> np.ndarray:
        return self.mat.detach().cpu().numpy()

    def reset(self) -> None:
        self.mat.zero_()


def per_class_iou(mat: np.ndarray) -> np.ndarray:
    inter = np.diag(mat).astype(np.float64)
    union = mat.sum(axis=1) + mat.sum(axis=0) - inter
    with np.errstate(divide="ignore", invalid="ignore"):
        iou = np.where(union > 0, inter / union, np.nan)
    return iou


def per_class_f1(mat: np.ndarray) -> np.ndarray:
    tp = np.diag(mat).astype(np.float64)
    fp = mat.sum(axis=0) - tp
    fn = mat.sum(axis=1) - tp
    denom = 2 * tp + fp + fn
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(denom > 0, 2 * tp / denom, np.nan)


def collapse(mat: np.ndarray, positive_classes: tuple[int, ...]) -> np.ndarray:
    """Fold a multiclass confusion matrix into 2x2 over a class subset.

    This is the confusion matrix of the question ADA actually asks. Collapsing
    the matrix rather than re-running the model is exact: the counts are
    already there.
    """
    pos = np.zeros(mat.shape[0], dtype=bool)
    pos[list(positive_classes)] = True
    out = np.zeros((2, 2), dtype=np.int64)
    out[1, 1] = mat[np.ix_(pos, pos)].sum()
    out[1, 0] = mat[np.ix_(pos, ~pos)].sum()
    out[0, 1] = mat[np.ix_(~pos, pos)].sum()
    out[0, 0] = mat[np.ix_(~pos, ~pos)].sum()
    return out


def summarise(mat: np.ndarray, labels: dict, task: str,
              built_classes: tuple[int, ...] | None = None) -> dict:
    """Turn a confusion matrix into the metric dict the engine logs."""
    iou = per_class_iou(mat)
    f1 = per_class_f1(mat)
    total = mat.sum()

    out = {
        "miou": float(np.nanmean(iou)),
        "mf1": float(np.nanmean(f1)),
        "pixel_acc": float(np.diag(mat).sum() / total) if total else 0.0,
        "per_class_iou": {labels.get(i, str(i)): (None if np.isnan(v) else float(v))
                          for i, v in enumerate(iou)},
    }

    if task == "binary":
        # mat is 2x2 with index 1 = building.
        out["iou"] = None if np.isnan(iou[1]) else float(iou[1])
        out["f1"] = None if np.isnan(f1[1]) else float(f1[1])
        tp, fp = mat[1, 1], mat[0, 1]
        fn = mat[1, 0]
        out["precision"] = float(tp / (tp + fp)) if (tp + fp) else 0.0
        out["recall"] = float(tp / (tp + fn)) if (tp + fn) else 0.0
        out["headline"] = out["iou"] or 0.0
        return out

    if built_classes is not None:
        two = collapse(mat, built_classes)
        b_iou = per_class_iou(two)
        b_f1 = per_class_f1(two)
        out["built_iou"] = float(b_iou[1])
        out["open_iou"] = float(b_iou[0])
        out["built_f1"] = float(b_f1[1])
        # This is the checkpoint-selection number for land cover.
        out["headline"] = float(b_iou[1])
    else:
        out["headline"] = out["miou"]
    return out


def format_summary(metrics: dict, task: str) -> str:
    if task == "binary":
        return (f"IoU {metrics.get('iou') or 0:.4f}  F1 {metrics.get('f1') or 0:.4f}  "
                f"P {metrics.get('precision', 0):.3f}  R {metrics.get('recall', 0):.3f}")
    return (f"built_IoU {metrics.get('built_iou', 0):.4f}  "
            f"mIoU {metrics.get('miou', 0):.4f}  "
            f"pixel_acc {metrics.get('pixel_acc', 0):.4f}")
