"""ADA training pipeline.

Trains the licence-clean replacements for the three encumbered models in
docs/ba/ADA-Model-Inventory-Enterprise-Licensing.pdf. One trainer, two tasks:

  land cover  FLAIR-1 (Open Licence 2.0)  ->  replaces IgorNer/segformer-b5-loveda
  buildings   Open Cities AI (CC BY 4.0)  ->  replaces BOTH geobase segmenters

Every trained artefact is ADA-owned. Every third-party component is Apache-2.0,
MIT or BSD. The licence gate in `licences.py` is what enforces that in code
rather than by convention.
"""

__version__ = "0.1.0"
