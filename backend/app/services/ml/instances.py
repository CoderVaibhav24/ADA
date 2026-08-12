"""Per-building-instance analysis: features, change type, and the decision.

This replaces the hand-tuned rule cascade that used to live in
`engine.building_change_prob`. The cascade worked like this:

    if area < min: drop
    if solidity < min: drop
    if new_frac < min: drop
    if not (veg_loss or colour_evidence): drop

Every one of those constants was fitted by eye to one pair of images, and the
cascade is a chain of hard ANDs — a single threshold missing by a little drops
a real detection outright, with no way for strong evidence elsewhere to
compensate. Worse, it cannot improve: an officer rejecting the same kind of
false positive for the hundredth time changes nothing.

So the cascade is refactored into two separable halves:

  1. DESCRIBE — turn each candidate structure into a fixed feature vector.
     Cheap, deterministic, and identical whichever decision rule follows.
  2. DECIDE — score that vector. A learned classifier does this once enough
     officer feedback exists (see classifier.py); until then the original rule
     logic runs as the fallback, so behaviour on day one is unchanged.

The features are deliberately the same quantities the rules used, plus the
land-cover context. That is what lets the learned model start from parity and
then discover the interactions the cascade could not express — e.g. that a low
`new_frac` is forgivable when `b1_mean` is low because the BEFORE epoch was
simply unreadable there.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from . import imageops

log = logging.getLogger("ada.ml")

# Order is the model's input contract. Append only — never reorder or remove,
# or every previously-trained checkpoint silently starts reading noise.
FEATURE_NAMES = (
    "log_area_m2",       # size, log-compressed (a 40 m2 shed vs a 4000 m2 block)
    "solidity",          # area / convex hull — compact structure vs ragged blob
    "new_frac",          # share not already a building in T1  <- strongest cue
    "b1_mean",           # BEFORE segmenter confidence under this footprint
    "b2_mean",           # AFTER segmenter confidence
    "t1_iou",            # overlap with the best-matching T1 instance
    "area_ratio",        # T2 area / matched T1 area (>1 => it grew)
    "veg_loss_frac",     # was vegetation, no longer is
    "open_t1_frac",      # share that was undeveloped land in T1
    "colour_frac",       # share carrying a colour change
    "structure_frac",    # share carrying an edge/structure change
    "seg_trust",         # scene-level BEFORE/AFTER agreement (context, not local)
)

# Change types, decided geometrically from T1<->T2 instance matching.
NEW_CONSTRUCTION = "new_construction"
EXTENSION = "extension"
UNCHANGED = "unchanged"
DEMOLITION = "demolition"


@dataclass
class Instance:
    """One candidate structure in the AFTER epoch."""

    idx: int
    sl: tuple                     # bounding slices into the full scene
    mask: np.ndarray              # boolean, local to `sl`
    area_px: int
    area_m2: float
    features: dict = field(default_factory=dict)
    change_type: str = NEW_CONSTRUCTION
    confidence: float = 0.0

    def vector(self) -> np.ndarray:
        return np.array([self.features.get(n, 0.0) for n in FEATURE_NAMES],
                        dtype=np.float32)


def _solidity(comp: np.ndarray) -> float:
    """Area / convex-hull area — rotation-invariant compactness.

    Not bounding-box fill: that measures the building's angle to north as much
    as its shape, and a rectangular block at 45 degrees fills only half its
    bounding box. Agra's street grid runs diagonally, so bbox fill rejected the
    real detections and kept the axis-aligned ones.
    """
    import cv2

    contours, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0.0
    c = max(contours, key=cv2.contourArea)
    hull = cv2.contourArea(cv2.convexHull(c))
    return min(float(cv2.contourArea(c) / hull), 1.0) if hull > 1e-6 else 0.0


def _binarize(prob: np.ndarray, thr: float, valid: np.ndarray) -> np.ndarray:
    """Threshold a footprint map into clean, hole-free blobs.

    The closing goes to the GPU; `binary_fill_holes` stays on the host because
    it is a morphological reconstruction — an iterate-to-convergence flood from
    the border — with no fixed-cost tensor equivalent.
    """
    m = (prob >= thr) & valid
    m = imageops.binary_closing(m, 2)
    return ndimage.binary_fill_holes(m) & valid


def extract(b1: np.ndarray, b2: np.ndarray, valid: np.ndarray, settings,
            resolution_m: float, lc1: np.ndarray | None = None,
            lc2: np.ndarray | None = None, t1: np.ndarray | None = None,
            t2: np.ndarray | None = None, veg1: np.ndarray | None = None,
            veg2: np.ndarray | None = None) -> tuple[list[Instance], float]:
    """Find every candidate structure in T2 and describe it.

    Returns (instances, seg_trust). No filtering happens here beyond dropping
    sub-minimum specks — rejection is the decider's job, so that a learned model
    can see the same candidates the rules would have thrown away.
    """
    from .engine import _pixel_change, _structural_change

    thr = settings.building_threshold
    b1_bin = _binarize(b1, thr, valid)
    b2_bin = _binarize(b2, thr, valid)

    # Scene-level trust in the BEFORE segmentation. Most structures persist
    # between two epochs, so agreement between the footprint maps is a usable
    # proxy: when it collapses, the BEFORE epoch was read badly (a colour-
    # infrared frame is far outside the segmenter's training distribution) and
    # `new_frac` means nothing.
    inter = float((b1_bin & b2_bin).sum())
    union = float((b1_bin | b2_bin).sum())
    seg_trust = inter / union if union else 0.0

    dil = settings.new_building_dilate_px
    # Scene-wide morphology on the GPU where there is one — bit-identical to
    # scipy's cross structuring element, ~18x faster, and the boolean scratch
    # arrays stay off the host heap.
    b1_dil = imageops.binary_dilation(b1_bin, dil) if dil > 0 else b1_bin

    veg_loss = None
    if veg1 is not None and veg2 is not None:
        veg_loss = (imageops.binary_dilation(veg1, 2)
                    & ~imageops.binary_dilation(veg2, 2))

    open_t1 = None
    if lc1 is not None:
        from .landcover import open_land
        open_t1 = open_land(lc1) >= 0.5

    colour = (_pixel_change(t1, t2, valid) >= settings.change_threshold
              if t1 is not None and t2 is not None else None)
    structure = (_structural_change(t1, t2, valid) >= settings.change_threshold
                 if t1 is not None and t2 is not None else None)

    # T1 instances, for matching (extension vs new build) and demolition.
    t1_labels, n_t1 = ndimage.label(b1_bin)
    # Area of every T1 instance, computed ONCE. The matching loop below needs
    # each candidate's T1 counterpart area; looking that up per candidate with
    # `(t1_labels == best).sum()` costs a full-scene pass EACH TIME, which is
    # what made this stage quadratic — see the note at the IoU computation.
    t1_areas = np.bincount(t1_labels.ravel(), minlength=n_t1 + 1).astype(np.float64)

    labels, n = ndimage.label(b2_bin)
    px_area = max(resolution_m * resolution_m, 1e-6)
    min_px = max(4, int(settings.min_new_building_area_m2 / px_area))

    out: list[Instance] = []
    for idx, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        comp = labels[sl] == idx
        area_px = int(comp.sum())
        if area_px < min_px:
            continue                       # segmenter speck, not a structure

        def frac(mask):
            return float((comp & mask[sl]).sum()) / area_px if mask is not None else 0.0

        # Best-matching T1 instance: the one covering most of this footprint.
        #
        # Everything here stays inside `sl`, the candidate's bounding box. The
        # first version built full-scene boolean arrays per candidate
        # (`t1_labels == best`, `np.zeros_like(t1_labels)`, then a scene-wide OR
        # and AND) — five passes over the whole grid for every candidate. On the
        # 2079x2981 test pair with 240 candidates that was a few seconds and
        # went unnoticed; on a real 4899x4545 grid with thousands of candidates
        # it is ~22 Mpx x 5 x N element-operations and the stage appears to hang
        # at 66%.
        #
        # The intersection cannot extend outside `sl` — it is bounded by `comp`
        # — so it is computable locally, and the union follows from the two
        # areas by inclusion-exclusion rather than from another scene-wide pass.
        # Identical arithmetic, O(bbox) instead of O(scene).
        overlap = t1_labels[sl][comp]
        overlap = overlap[overlap > 0]
        t1_iou, area_ratio = 0.0, 0.0
        if overlap.size:
            best = int(np.bincount(overlap).argmax())
            t1_area = float(t1_areas[best])
            inter = float((t1_labels[sl] == best)[comp].sum())
            union = area_px + t1_area - inter
            t1_iou = inter / union if union > 0 else 0.0
            area_ratio = area_px / t1_area if t1_area else 0.0

        inst = Instance(idx=idx, sl=sl, mask=comp, area_px=area_px,
                        area_m2=area_px * px_area)
        inst.features = {
            "log_area_m2": float(np.log10(max(inst.area_m2, 1.0)) / 4.0),
            "solidity": _solidity(comp),
            "new_frac": float((comp & ~b1_dil[sl]).sum()) / area_px,
            "b1_mean": float(b1[sl][comp].mean()),
            "b2_mean": float(b2[sl][comp].mean()),
            "t1_iou": t1_iou,
            "area_ratio": min(area_ratio, 4.0) / 4.0,
            "veg_loss_frac": frac(veg_loss),
            "open_t1_frac": frac(open_t1),
            "colour_frac": frac(colour),
            "structure_frac": frac(structure),
            "seg_trust": seg_trust,
        }
        inst.change_type = _change_type(inst, settings)
        out.append(inst)

    log.info("instances: %d candidates in T2 (>= %.0f m2), BEFORE-seg trust "
             "IoU=%.3f", len(out), settings.min_new_building_area_m2, seg_trust)
    return out, seg_trust


def _change_type(inst: Instance, settings) -> str:
    """Geometric change type — what KIND of change this is, not whether to report it.

    Decided from T1<->T2 instance geometry rather than from pixels, because the
    distinction an officer needs is structural: a plot that had no building and
    now has one is a different enforcement case from a house that grew a floor
    plate, even when both show the same colour difference.
    """
    f = inst.features
    if f["new_frac"] >= settings.new_instance_min_frac:
        return NEW_CONSTRUCTION
    # Overlaps something that was already built. Did it grow appreciably?
    if f["area_ratio"] * 4.0 >= (1.0 + settings.extension_min_growth):
        return EXTENSION
    return UNCHANGED


def find_demolitions(b1: np.ndarray, b2: np.ndarray, valid: np.ndarray,
                     settings, resolution_m: float) -> list[Instance]:
    """T1 structures with no T2 counterpart — the mirror of new construction.

    Reported separately because the pipeline is otherwise T2-driven and would
    never see a building that simply stopped existing.
    """
    thr = settings.building_threshold
    b1_bin = _binarize(b1, thr, valid)
    b2_bin = _binarize(b2, thr, valid)
    dil = settings.new_building_dilate_px
    b2_dil = imageops.binary_dilation(b2_bin, dil) if dil > 0 else b2_bin

    labels, _ = ndimage.label(b1_bin)
    px_area = max(resolution_m * resolution_m, 1e-6)
    min_px = max(4, int(settings.min_new_building_area_m2 / px_area))

    out = []
    for idx, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        comp = labels[sl] == idx
        area_px = int(comp.sum())
        if area_px < min_px:
            continue
        gone = float((comp & ~b2_dil[sl]).sum()) / area_px
        if gone < settings.new_instance_min_frac:
            continue
        inst = Instance(idx=idx, sl=sl, mask=comp, area_px=area_px,
                        area_m2=area_px * px_area, change_type=DEMOLITION,
                        confidence=float(b1[sl][comp].mean()))
        inst.features = {"log_area_m2": float(np.log10(max(inst.area_m2, 1.0)) / 4.0),
                         "solidity": _solidity(comp), "new_frac": gone,
                         "b1_mean": inst.confidence}
        out.append(inst)
    log.info("instances: %d demolition candidates", len(out))
    return out


def rule_score(inst: Instance, settings) -> float:
    """The original cascade, kept as the cold-start decider and the fallback.

    Returns 0.0 for reject, else the instance's own segmenter confidence. The
    thresholds are unchanged from the version this replaced, so a fresh install
    with no officer feedback behaves exactly as before — with one deliberate
    change: the vegetation/colour confirmation is only REQUIRED when the BEFORE
    segmentation is untrustworthy. Measured on the Agra pair, that confirmation
    was carrying the whole decision because `new_frac` was unusable at seg
    trust 0.11; with a segmenter that reaches 0.55 the direct evidence — this
    was not a building, now it is — is the stronger signal, and forcing a
    seasonal vegetation test on top of it only adds false negatives.
    """
    f = inst.features
    if f["solidity"] < settings.min_instance_solidity:
        return 0.0
    trust = f["seg_trust"] >= settings.seg_agreement_min_iou
    if trust:
        if f["new_frac"] < settings.new_instance_min_frac:
            return 0.0
    else:
        # BEFORE map unusable — fall back to imagery evidence, as before.
        confirmed = (f["veg_loss_frac"] >= settings.veg_loss_min_frac
                     or (settings.seed_mode != "encroachment"
                         and f["colour_frac"] >= settings.min_evidence_frac))
        if not confirmed:
            return 0.0
    return max(f["b2_mean"], settings.change_threshold + 1e-3)
