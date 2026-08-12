"""Train the instance classifier on officer feedback.

Reads every ChangePolygon an officer has confirmed or rejected, pulls the
feature vector stored on it at analysis time, and fits the MLP. Run it whenever
a meaningful batch of new review decisions has accumulated:

    python scripts/train_instance_classifier.py

The features must have been recorded when the analysis ran — polygons produced
before the instance pipeline landed have no `features` key and are skipped.
That is why the count printed here can be lower than the number of reviews.
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np

from app.config import settings
from app.database import SessionLocal
from app.models import ChangePolygon
from app.services.ml.classifier import InstanceNet, model_path
from app.services.ml.instances import FEATURE_NAMES

CONFIRMED, REJECTED = "confirmed", "rejected"

with SessionLocal() as db:
    rows = (db.query(ChangePolygon)
            .filter(ChangePolygon.review_status.in_([CONFIRMED, REJECTED]))
            .all())

X, y, skipped = [], [], 0
for r in rows:
    feats = (r.properties or {}).get("features")
    if not feats:
        skipped += 1
        continue
    X.append([float(feats.get(n, 0.0)) for n in FEATURE_NAMES])
    y.append(1.0 if r.review_status == CONFIRMED else 0.0)

print(f"reviewed polygons: {len(rows)}   usable (have features): {len(X)}   "
      f"skipped (pre-instance-pipeline): {skipped}")
if not X:
    print("Nothing to train on yet. Review some detections in the UI first.")
    raise SystemExit(0)

counts = Counter("confirmed" if v else "rejected" for v in y)
print(f"labels: {dict(counts)}")
if len(X) < settings.min_training_samples:
    print(f"NOTE: {len(X)} < MIN_TRAINING_SAMPLES ({settings.min_training_samples}); "
          "the pipeline will keep using rules until that many labels exist. "
          "Training anyway so you can inspect the metrics.")
if counts["rejected"] == 0:
    print("WARNING: no rejected examples. A classifier trained only on "
          "confirmations learns 'always accept' and is worthless — reject some "
          "false positives in the UI before relying on this.")

net = InstanceNet()
metrics = net.fit(np.array(X, dtype=np.float32), np.array(y, dtype=np.float32))
print("\nheld-out metrics:")
for k, v in metrics.items():
    print(f"  {k:<12} {v}")
net.save(model_path())
print(f"\nsaved -> {model_path()}")
print(f"Set INSTANCE_DECIDER=active in .env to let it decide "
      f"(currently: {settings.instance_decider}).")
