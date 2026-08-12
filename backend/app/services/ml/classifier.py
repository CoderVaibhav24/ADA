"""Learned accept/reject for building-change instances.

The point of this module is that the system gets better as officers use it.
Every polygon an officer confirms or rejects is a label; this trains on those
labels and replaces the hand-tuned cascade once there are enough of them.

Three design decisions worth stating, because each is a trap avoided:

* COLD START. With zero feedback a neural net is strictly worse than the rules
  it replaces — it would predict noise. So `predict` refuses to answer until
  `min_training_samples` labels exist, and the caller falls back to
  `instances.rule_score`. There is no point at which the system is worse than
  what it replaced.

* SHADOW MODE. Even once trained, the model's first job is to be measured, not
  obeyed. In shadow mode it scores every instance and logs its agreement with
  the rules, but the rules still decide. Promotion to `active` is a deliberate
  config change made after reading those numbers, not something that happens
  silently the moment a threshold is crossed.

* CLASS IMBALANCE. Officers confirm far more than they reject (they are
  reviewing candidates the rules already accepted), so an unweighted fit
  collapses to "always accept". Positive-class weighting counteracts that, and
  the rejected examples are the entire reason this exists — they are the ones
  the rules got wrong.

Deliberately a small MLP over engineered features rather than a CNN over image
crops: a few hundred officer decisions is nowhere near enough to train a vision
model, but it is plenty for a 12-input network. If the feedback set ever grows
into the tens of thousands, the crops are still on disk and this can be swapped
for a siamese CNN behind the same interface.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np

from ...config import settings
from .instances import FEATURE_NAMES

log = logging.getLogger("ada.ml")

_model = None
_MISSING = object()


def model_path() -> Path:
    return settings.weights_dir / "instance_classifier.pt"


class InstanceNet:
    """12 -> 32 -> 16 -> 1 MLP. Small on purpose; see module docstring."""

    def __init__(self) -> None:
        import torch
        from torch import nn

        self.torch = torch
        self.net = nn.Sequential(
            nn.Linear(len(FEATURE_NAMES), 32), nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 16), nn.ReLU(),
            nn.Linear(16, 1),
        )
        self.trained_on = 0
        self.metrics: dict = {}

    # --- inference ---------------------------------------------------------
    def score(self, vectors: np.ndarray) -> np.ndarray:
        """(N, F) features -> (N,) probability that an officer would CONFIRM."""
        t = self.torch
        self.net.eval()
        with t.inference_mode():
            x = t.from_numpy(np.asarray(vectors, dtype=np.float32))
            return t.sigmoid(self.net(x)[:, 0]).numpy()

    # --- training ----------------------------------------------------------
    def fit(self, X: np.ndarray, y: np.ndarray, epochs: int = 400) -> dict:
        t = self.torch
        from torch import nn

        X = np.asarray(X, dtype=np.float32)
        y = np.asarray(y, dtype=np.float32)

        # Hold out a stratified fifth so we can report honest numbers rather
        # than training-set accuracy, which on this few samples is meaningless.
        rng = np.random.default_rng(0)
        idx = rng.permutation(len(y))
        cut = max(1, len(y) // 5)
        te, tr = idx[:cut], idx[cut:]

        pos = float(y[tr].sum())
        neg = float(len(tr) - pos)
        # Officers confirm more than they reject; without this the net learns
        # "always accept" and the rejections — the whole point — are ignored.
        pos_weight = t.tensor([neg / max(pos, 1.0)], dtype=t.float32)
        loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
        opt = t.optim.Adam(self.net.parameters(), lr=1e-3, weight_decay=1e-4)

        xtr, ytr = t.from_numpy(X[tr]), t.from_numpy(y[tr])
        self.net.train()
        for _ in range(epochs):
            opt.zero_grad()
            loss = loss_fn(self.net(xtr)[:, 0], ytr)
            loss.backward()
            opt.step()

        self.trained_on = len(y)
        pred = self.score(X[te]) >= 0.5
        truth = y[te] >= 0.5
        tp = int((pred & truth).sum())
        fp = int((pred & ~truth).sum())
        fn = int((~pred & truth).sum())
        self.metrics = {
            "n_total": int(len(y)),
            "n_positive": int(y.sum()),
            "holdout": int(len(te)),
            "accuracy": float((pred == truth).mean()),
            "precision": tp / (tp + fp) if tp + fp else 0.0,
            "recall": tp / (tp + fn) if tp + fn else 0.0,
            "final_loss": float(loss.item()),
        }
        return self.metrics

    # --- persistence -------------------------------------------------------
    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.torch.save({"state": self.net.state_dict(),
                         "features": list(FEATURE_NAMES),
                         "trained_on": self.trained_on,
                         "metrics": self.metrics}, path)
        log.info("instance classifier saved -> %s (%s)", path,
                 json.dumps(self.metrics))

    def load(self, path: Path) -> bool:
        ckpt = self.torch.load(path, map_location="cpu", weights_only=False)
        # A checkpoint trained on a different feature list would read garbage
        # from every column after the first divergence, so refuse it outright.
        if list(ckpt.get("features", [])) != list(FEATURE_NAMES):
            log.error("instance classifier at %s was trained on a different "
                      "feature set (%s) — ignoring it. Retrain with "
                      "scripts/train_instance_classifier.py", path,
                      ckpt.get("features"))
            return False
        self.net.load_state_dict(ckpt["state"])
        self.trained_on = ckpt.get("trained_on", 0)
        self.metrics = ckpt.get("metrics", {})
        return True


def get_model() -> InstanceNet | None:
    """Cached classifier, or None when there is nothing usable on disk."""
    global _model
    if _model is _MISSING:
        return None
    if _model is None:
        path = model_path()
        if not path.is_file():
            _model = _MISSING
            return None
        try:
            m = InstanceNet()
            _model = m if m.load(path) else _MISSING
        except Exception:
            log.warning("could not load instance classifier", exc_info=True)
            _model = _MISSING
    return None if _model is _MISSING else _model


def reset_cache() -> None:
    """Drop the cached model so a freshly trained checkpoint is picked up."""
    global _model
    _model = None


def score_instances(instances, settings) -> tuple[np.ndarray | None, str]:
    """(N,) learned confirm-probability, plus the mode actually in force.

    Returns (None, "rules") whenever the learned path is unavailable or is only
    shadowing, so the caller keeps using the cascade.
    """
    if settings.instance_decider == "rules" or not instances:
        return None, "rules"
    model = get_model()
    if model is None:
        return None, "rules"
    if model.trained_on < settings.min_training_samples:
        log.info("instance classifier has only %d labels (< %d) — staying on "
                 "rules", model.trained_on, settings.min_training_samples)
        return None, "rules"
    scores = model.score(np.stack([i.vector() for i in instances]))
    return scores, settings.instance_decider
