"""Losses.

Cross-entropy (or BCE) plus Dice, in both tasks, for the same reason in both:
the pixel distribution is badly imbalanced and a likelihood loss on its own
converges to the majority class. On FLAIR-1 the majority class is agricultural
land; on Open Cities it is background, at roughly nine pixels in ten. Dice is
computed over the class as a set rather than per pixel, so a class covering one
percent of the image still contributes a gradient worth having.

The class weights are inverse-frequency, computed once from a sample of the
training index. This is the same failure mode the existing InstanceNet already
guards against -- officers confirm far more than they reject, so an unweighted
fit collapses to "always accept" -- appearing again one level down.
"""

from __future__ import annotations

import logging

log = logging.getLogger("ada.train")


def build_loss(cfg, class_weights=None):
    import torch
    from torch import nn

    if cfg.task == "multiclass":
        ce = nn.CrossEntropyLoss(
            weight=class_weights,
            ignore_index=cfg.loss.ignore_index,
            label_smoothing=cfg.loss.label_smoothing,
        )
    else:
        ce = nn.BCEWithLogitsLoss(reduction="none")

    def loss_fn(logits, target):
        if cfg.task == "multiclass":
            base = ce(logits, target.long())
            dice = _dice_multiclass(
                logits, target, cfg.model.classes, cfg.loss.ignore_index)
        else:
            valid = target != cfg.loss.ignore_index
            t = torch.where(valid, target, torch.zeros_like(target)).float()
            raw = ce(logits.squeeze(1), t)
            # Ignored pixels (nodata padding) must not contribute. Averaging
            # over the valid count rather than the tensor size matters here:
            # some Open Cities windows are 40% padding.
            denom = valid.sum().clamp(min=1)
            base = (raw * valid.float()).sum() / denom
            dice = _dice_binary(logits.squeeze(1), t, valid)
        return cfg.loss.ce_weight * base + cfg.loss.dice_weight * dice

    return loss_fn


def _dice_multiclass(logits, target, n_classes: int, ignore_index: int,
                     eps: float = 1e-6):
    import torch
    import torch.nn.functional as F

    valid = (target != ignore_index)
    target = torch.where(valid, target, torch.zeros_like(target)).long()
    probs = F.softmax(logits, dim=1)
    onehot = F.one_hot(target, n_classes).permute(0, 3, 1, 2).float()
    mask = valid.unsqueeze(1).float()
    probs, onehot = probs * mask, onehot * mask

    dims = (0, 2, 3)
    inter = (probs * onehot).sum(dims)
    union = probs.sum(dims) + onehot.sum(dims)
    # Classes absent from the batch are dropped rather than scored 1.0, which
    # would otherwise flatter the loss on tiles of uniform farmland.
    present = onehot.sum(dims) > 0
    if present.sum() == 0:
        return logits.sum() * 0.0
    dice = (2 * inter[present] + eps) / (union[present] + eps)
    return 1.0 - dice.mean()


def _dice_binary(logits, target, valid, eps: float = 1e-6):
    import torch

    probs = torch.sigmoid(logits) * valid.float()
    target = target * valid.float()
    inter = (probs * target).sum()
    union = probs.sum() + target.sum()
    return 1.0 - (2 * inter + eps) / (union + eps)


def estimate_class_weights(dataset, n_classes: int, ignore_index: int,
                           sample: int = 400, seed: int = 1337):
    """Inverse-frequency weights from a random sample of tiles.

    A sample, not the whole set: 400 tiles of 512 px is 100 million labelled
    pixels, which pins the frequencies to well under a percent, and reading
    77k tiles to compute a weight vector would cost an hour before training
    starts.
    """
    import numpy as np
    import torch

    rng = np.random.default_rng(seed)
    n = min(sample, len(dataset))
    idx = rng.permutation(len(dataset))[:n]
    counts = np.zeros(n_classes, dtype=np.int64)
    for i in idx:
        _image, mask = dataset[int(i)]
        mask = np.asarray(mask).ravel()
        mask = mask[mask != ignore_index]
        counts += np.bincount(mask, minlength=n_classes)[:n_classes]

    total = counts.sum()
    if total == 0:
        raise RuntimeError("every sampled pixel was the ignore index -- check "
                           "the mask remap and the nodata handling")
    freq = counts / total
    # Clamp so a class that is genuinely near-absent (snow, in France, in the
    # subset) cannot produce a weight that dominates the gradient.
    weights = 1.0 / np.clip(freq, 1e-4, None)
    weights = weights / weights.mean()
    weights = np.clip(weights, 0.1, 20.0)

    for c in range(n_classes):
        log.info("class %2d: %.4f%% of pixels, weight %.2f",
                 c, 100 * freq[c], weights[c])
    return torch.tensor(weights, dtype=torch.float32)
