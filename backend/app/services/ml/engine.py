"""Grid-based inference engine.

The aligned scene is cut into overlapping CHIP_SIZE x CHIP_SIZE chips
(the "grid" strategy — every part of the map is analyzed at full model
resolution, which is what keeps accuracy up on large orthophotos).
Chip scores are blended back with a smooth taper window so chip seams
do not appear in the change map, then normalized scene-wide.
"""

from __future__ import annotations

import logging
from typing import Callable

import numpy as np

from ...config import settings
from .backends import load_backend, load_seg_backend

log = logging.getLogger("ada.ml")
_BATCH = 8
_backend = None
_seg_backend = None


def get_backend():
    global _backend
    if _backend is None:
        _backend = load_backend(settings.model_backend, settings.model_weights)
    return _backend


def get_seg_backend():
    global _seg_backend
    if _seg_backend is None:
        _seg_backend = load_seg_backend(settings.building_model_repo,
                                        settings.building_model_file)
    return _seg_backend


def _taper(size: int) -> np.ndarray:
    """2-D Hann-like weight window (center-heavy) for seamless stitching."""
    ramp = np.hanning(size).astype(np.float32) + 1e-3
    return np.outer(ramp, ramp)


def _grid_origins(length: int, chip: int, stride: int) -> list[int]:
    if length <= chip:
        return [0]
    starts = list(range(0, length - chip, stride))
    starts.append(length - chip)  # always cover the far edge
    return starts


def suppress_vegetation_changes(prob: np.ndarray, veg1: np.ndarray | None,
                                veg2: np.ndarray | None) -> np.ndarray:
    """Encroachment = built-up change. Down-weight detections that are
    vegetation in the AFTER epoch (canopy/seasonal differences), and
    kill those that are vegetation in BOTH epochs (tree stayed a tree).
    Vegetation in T1 that turns built in T2 is kept at full strength —
    that IS encroachment on green space. Masks come from RAW bands
    (NDVI / excess-green) computed during superimpose."""
    if veg1 is None or veg2 is None:
        return prob
    out = prob.copy()
    out[veg2] *= 0.3
    out[veg1 & veg2] = 0.0
    return out


def predict_change_map(
    t1: np.ndarray,
    t2: np.ndarray,
    valid: np.ndarray,
    on_progress: Callable[[float], None] | None = None,
) -> np.ndarray:
    """(H, W, 3) uint8 pair -> (H, W) float32 change probability in [0, 1]."""
    chip = settings.chip_size
    stride = chip - settings.chip_overlap
    h, w = t1.shape[:2]

    pad_h, pad_w = max(0, chip - h), max(0, chip - w)
    if pad_h or pad_w:
        pad = ((0, pad_h), (0, pad_w), (0, 0))
        t1 = np.pad(t1, pad)
        t2 = np.pad(t2, pad)
    H, W = t1.shape[:2]

    origins = [(y, x) for y in _grid_origins(H, chip, stride)
               for x in _grid_origins(W, chip, stride)]

    score = np.zeros((H, W), dtype=np.float32)
    weight = np.zeros((H, W), dtype=np.float32)
    win = _taper(chip)
    backend = get_backend()

    for i in range(0, len(origins), _BATCH):
        batch = origins[i:i + _BATCH]
        c1 = np.stack([t1[y:y + chip, x:x + chip] for y, x in batch])
        c2 = np.stack([t2[y:y + chip, x:x + chip] for y, x in batch])
        preds = backend.predict(c1, c2)
        for (y, x), p in zip(batch, preds):
            score[y:y + chip, x:x + chip] += p * win
            weight[y:y + chip, x:x + chip] += win
        if on_progress:
            on_progress(min(1.0, (i + len(batch)) / len(origins)))

    score = (score / np.maximum(weight, 1e-6))[:h, :w]

    if getattr(backend, "calibrated", False):
        prob = np.clip(score, 0.0, 1.0)
    else:
        # Robust z-score mapping: a pixel only scores as change if its
        # feature distance is a statistical outlier vs the scene's own
        # background noise (median + MAD). Unlike percentile ranking,
        # a quiet or noisy-but-unchanged scene yields FEW detections
        # instead of always flagging the "top N percent".
        sel = score[valid] if valid.any() else score.ravel()
        med = float(np.median(sel))
        mad = float(np.median(np.abs(sel - med))) * 1.4826
        z = (score - med) / max(mad, 1e-6)
        # z=3 -> prob 0.5 (default threshold), z=6 -> prob 1.0
        prob = np.clip(z / 6.0, 0.0, 1.0)
    prob[~valid] = 0.0
    return prob.astype(np.float32)


# --- Segmentation-diff engine (building-footprint change) --------------------

def segment_scene(
    img: np.ndarray,
    valid: np.ndarray,
    on_progress: Callable[[float], None] | None = None,
) -> np.ndarray:
    """(H, W, 3) uint8 -> (H, W) float32 building probability in [0, 1].

    Grid-tiles one epoch through the building segmenter (same overlapping
    chips + Hann taper as the CD engine) so full-resolution footprints are
    recovered on large orthophotos without chip seams."""
    chip = settings.chip_size
    stride = chip - settings.chip_overlap
    h, w = img.shape[:2]

    pad_h, pad_w = max(0, chip - h), max(0, chip - w)
    if pad_h or pad_w:
        img = np.pad(img, ((0, pad_h), (0, pad_w), (0, 0)))
    H, W = img.shape[:2]

    origins = [(y, x) for y in _grid_origins(H, chip, stride)
               for x in _grid_origins(W, chip, stride)]
    score = np.zeros((H, W), dtype=np.float32)
    weight = np.zeros((H, W), dtype=np.float32)
    win = _taper(chip)
    backend = get_seg_backend()

    for i in range(0, len(origins), _BATCH):
        batch = origins[i:i + _BATCH]
        chips = np.stack([img[y:y + chip, x:x + chip] for y, x in batch])
        preds = backend.segment(chips)
        for (y, x), p in zip(batch, preds):
            score[y:y + chip, x:x + chip] += p * win
            weight[y:y + chip, x:x + chip] += win
        if on_progress:
            on_progress(min(1.0, (i + len(batch)) / len(origins)))

    prob = (score / np.maximum(weight, 1e-6))[:h, :w]
    prob[~valid] = 0.0
    return prob.astype(np.float32)


def _robust01(diff: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Map a raw change field to [0, 1] by the scene's own median+MAD, so it
    means "changed vs the background noise" rather than a fixed distance."""
    sel = diff[valid] if valid.any() else diff.ravel()
    med = float(np.median(sel))
    mad = float(np.median(np.abs(sel - med))) * 1.4826
    z = (diff - med) / max(mad, 1e-6)
    return np.clip(z / 6.0, 0.0, 1.0).astype(np.float32)


def _pixel_change(t1: np.ndarray, t2: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """COLOUR change: mean |ΔRGB| on the aligned, histogram-matched pair.
    Sensitive to cross-sensor colour differences (can pass "same building,
    different sensor")."""
    from scipy import ndimage
    diff = np.abs(t1.astype(np.float32) - t2.astype(np.float32)).mean(axis=2)
    return _robust01(ndimage.uniform_filter(diff, size=5), valid)


def _structural_change(t1: np.ndarray, t2: np.ndarray,
                       valid: np.ndarray) -> np.ndarray:
    """COLOUR-INVARIANT change: compares local *structure* (edges/gradients),
    not colour. A building present in both epochs has the same edges in both,
    even if the satellite renders it grey and the drone renders it red -> ~no
    change. A new building where there was bare ground introduces new edges ->
    change. This is the 'ignore the colour, keep the shape' idea, and it is
    far less fooled by satellite↔drone colour shifts than |ΔRGB|."""
    from scipy import ndimage

    g1 = t1.astype(np.float32).mean(axis=2)
    g2 = t2.astype(np.float32).mean(axis=2)
    # Local contrast normalization removes brightness/gain differences per patch
    def _norm(g):
        mu = ndimage.uniform_filter(g, size=15)
        sd = np.sqrt(np.maximum(
            ndimage.uniform_filter(g * g, size=15) - mu * mu, 0.0)) + 1e-3
        return (g - mu) / sd
    n1, n2 = _norm(g1), _norm(g2)
    # Gradient (edge) magnitude of each locally-normalized epoch
    def _grad(n):
        gx = ndimage.sobel(n, axis=1)
        gy = ndimage.sobel(n, axis=0)
        return np.hypot(gx, gy)
    e1, e2 = _grad(n1), _grad(n2)
    diff = ndimage.uniform_filter(np.abs(e1 - e2), size=5)
    return _robust01(diff, valid)


def classical_change_prob(t1: np.ndarray, t2: np.ndarray,
                          valid: np.ndarray) -> np.ndarray:
    """Diff Mode: model-free change probability.

    Combines the two classical signals — colour difference (|ΔRGB|, catches
    anything repainted/rebuilt/cleared) and colour-INVARIANT structure
    difference (edge/gradient change, survives satellite↔drone colour shifts).
    Taking the max keeps a change that either signal sees, which is the right
    trade for a triage pass: recall matters more than precision here, because
    AI Mode is what produces the evidence-grade output.
    """
    colour = _pixel_change(t1, t2, valid)
    structure = _structural_change(t1, t2, valid)
    prob = np.maximum(colour, structure)
    prob[~valid] = 0.0
    return prob.astype(np.float32)


def _convex_solidity(comp: np.ndarray) -> float:
    """Area / convex-hull area for one connected component, in [0, 1].

    Rotation-invariant compactness: a rectangle scores ~1.0 at any orientation,
    an L-shape or courtyard block somewhat less, a ragged canopy or shadow blob
    with deep concavities much less. This is what the instance filter wants —
    "is this shaped like a structure" — as opposed to bounding-box fill, which
    conflates shape with the building's angle to the compass.
    """
    import cv2

    contours, _ = cv2.findContours(comp.astype(np.uint8), cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0.0
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    hull_area = cv2.contourArea(cv2.convexHull(contour))
    if hull_area <= 1e-6:
        # Degenerate (a line or a handful of pixels); the area filter upstream
        # has already dealt with anything this small.
        return 0.0
    return min(float(area / hull_area), 1.0)


def _change_gate(t1: np.ndarray, t2: np.ndarray, valid: np.ndarray) -> np.ndarray:
    if settings.change_gate_mode == "structural":
        return _structural_change(t1, t2, valid)
    return _pixel_change(t1, t2, valid)


def building_change_prob(b1: np.ndarray, b2: np.ndarray, valid: np.ndarray,
                         t1: np.ndarray | None = None,
                         t2: np.ndarray | None = None,
                         veg1: np.ndarray | None = None,
                         veg2: np.ndarray | None = None,
                         resolution_m: float = 0.5) -> np.ndarray:
    """New-construction probability, decided per BUILDING INSTANCE.

    The earlier version thresholded a per-pixel difference, which produced
    fragments: half a roof here, a sliver along a wall there. Two problems with
    that, both visible on real Agra data:
      * a detection covered part of a structure instead of the whole thing, so
        an officer could not see what was actually being flagged;
      * any residual misregistration painted thin crescents down every existing
        wall, and a repainted roof lit up as "new construction" because the
        pixels under it changed.

    So the unit of decision here is a whole building, not a pixel:
      1. Threshold T2's footprint map and label CONNECTED COMPONENTS — each one
         is a candidate structure.
      2. For each candidate measure `new_frac`, the share of it that was not
         already a building in T1 (T1 dilated, so wall-edge jitter can't count).
         A structure present in both epochs — however differently it is
         coloured, lit or angled — scores ~0 and is dropped. That is what makes
         a repaint or a sensor change impossible to report as construction.
      3. Require independent CONFIRMATION that the ground really changed:
         (a) it was VEGETATION in T1 -> green space is now built. This is the
             ADA core case and needs no pixel comparison, so it survives even
             when the two epochs are hard to compare across sensors.
         (b) with SEED_MODE=all, a genuine colour change also confirms, which
             catches bare-ground -> building.
      4. Paint the ENTIRE accepted instance at its own confidence, so
         thresholding downstream recovers whole structures edge to edge rather
         than whatever subset of pixels crossed a per-pixel bar.

    Deliberately NOT used as a gate: the edge/structural difference. Trees and
    buildings are both edge-rich, so it sees ~no change for vegetation ->
    building and silently drops exactly the encroachment ADA cares about.
    """
    from scipy import ndimage

    bthr = settings.building_threshold
    b1_bin = b1 >= bthr
    b2_bin = (b2 >= bthr) & valid

    # Close pinholes so one building is one component, not a colander.
    b2_bin = ndimage.binary_closing(b2_bin, iterations=2)
    b2_bin = ndimage.binary_fill_holes(b2_bin) & valid

    b1_dil = (ndimage.binary_dilation(b1_bin, iterations=settings.new_building_dilate_px)
              if settings.new_building_dilate_px > 0 else b1_bin)

    # How much can we trust the BEFORE segmentation? On a cross-sensor pair the
    # segmenter may read one epoch well and the other badly (a colour-infrared
    # satellite frame is far outside its training distribution, and it starts
    # calling tree canopy "building"). Since most structures persist between two
    # epochs, agreement between the two footprint maps is a usable proxy for
    # that trust. When it collapses, the BEFORE segmentation is noise and using
    # it as a veto would reject real detections, so we fall back to judging the
    # ground from imagery evidence alone.
    inter = float((b1_bin & b2_bin).sum())
    union = float((b1_bin | b2_bin).sum())
    seg_iou = inter / union if union > 0 else 0.0
    trust_before = seg_iou >= settings.seg_agreement_min_iou
    if not trust_before:
        log.warning("seg-diff: BEFORE/AFTER footprint agreement is only "
                    "IoU=%.3f (< %.2f) — the BEFORE segmentation is unreliable "
                    "on this pair, judging change from vegetation evidence "
                    "instead", seg_iou, settings.seg_agreement_min_iou)

    # Vegetation LOSS, not merely "was vegetation": the canopy has to be gone in
    # the AFTER epoch. A tree still standing in both epochs proves nothing was
    # built under it, and that single condition removes most of the residue.
    veg_loss = None
    if veg1 is not None and veg2 is not None:
        veg_loss = (ndimage.binary_dilation(veg1, iterations=2)
                    & ~ndimage.binary_dilation(veg2, iterations=2))
    colour_evidence = None
    if settings.seed_mode != "encroachment" and t1 is not None and t2 is not None:
        colour_evidence = _pixel_change(t1, t2, valid) >= settings.change_threshold

    labels, n = ndimage.label(b2_bin)
    if n == 0:
        return np.zeros_like(b2, dtype=np.float32)

    px_area = max(resolution_m * resolution_m, 1e-6)
    min_px = max(4, int(settings.min_new_building_area_m2 / px_area))
    out = np.zeros_like(b2, dtype=np.float32)
    kept = 0
    rejected = {"small": 0, "ragged": 0, "existed": 0, "unconfirmed": 0}

    for idx, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        comp = labels[sl] == idx
        area_px = int(comp.sum())

        # A building has a floor area. Specks are segmenter noise, and claiming
        # "illegal construction" over 4 m² of roof texture destroys trust.
        if area_px < min_px:
            rejected["small"] += 1
            continue

        # Buildings are compact; canopy blobs and shadow fragments are ragged.
        # Measured against the convex hull, NOT the axis-aligned bounding box:
        # bbox fill answers "how is this shaped *relative to north*", which is
        # not a property of the building at all. A perfectly rectangular block
        # lying at 45° to the grid fills exactly half its bounding box and was
        # thrown out as "ragged", so on any scene whose street grid runs
        # diagonally — Agra's does — this rejected the real detections and kept
        # the axis-aligned ones. Convex solidity is rotation-invariant, so the
        # same building scores the same however the imagery happens to be
        # oriented, and genuinely concave canopy/shadow blobs still fail.
        if _convex_solidity(comp) < settings.min_instance_solidity:
            rejected["ragged"] += 1
            continue

        # Did this structure already stand here? Only trustworthy when the
        # BEFORE segmentation is itself trustworthy (see above).
        if trust_before:
            new_frac = float((comp & ~b1_dil[sl]).sum()) / area_px
            if new_frac < settings.new_instance_min_frac:
                rejected["existed"] += 1
                continue

        # Independent evidence that the ground actually changed.
        confirmed = veg_loss is None and colour_evidence is None
        if veg_loss is not None:
            confirmed |= (float((comp & veg_loss[sl]).sum()) / area_px
                          >= settings.veg_loss_min_frac)
        if colour_evidence is not None:
            confirmed |= (float((comp & colour_evidence[sl]).sum()) / area_px
                          >= settings.min_evidence_frac)
        if not confirmed:
            rejected["unconfirmed"] += 1
            continue

        confidence = float(b2[sl][comp].mean())
        out[sl][comp] = max(confidence, settings.change_threshold + 1e-3)
        kept += 1

    log.info("seg-diff: %d instances -> %d new-construction "
             "(rejected: %d too small, %d ragged, %d already existed, "
             "%d unconfirmed; BEFORE-seg IoU %.3f, trusted=%s)",
             n, kept, rejected["small"], rejected["ragged"],
             rejected["existed"], rejected["unconfirmed"], seg_iou, trust_before)
    return out.astype(np.float32)


def refine_full_structures(prob: np.ndarray, t2: np.ndarray,
                           valid: np.ndarray) -> np.ndarray:
    """Expand each seeded detection to the building's FULL footprint with SAM2
    (robust to angle/shadow/low light), so we highlight whole structures rather
    than fragments. Returns a probability map; falls back to `prob` unchanged if
    SAM2 is unavailable."""
    from scipy import ndimage

    seed = prob >= settings.change_threshold
    if not seed.any():
        return prob
    try:
        from .sam_refine import get_refiner
        mask = get_refiner().refine(seed, t2, valid)
    except Exception:
        log.warning("SAM2 refinement unavailable, using morphological fallback",
                    exc_info=True)
        # keep the seed but fill each detection's convex-ish hull so the whole
        # flagged structure is highlighted even without SAM2
        mask = ndimage.binary_closing(seed, iterations=3) & valid

    # Carry each detection's OWN confidence onto its completed footprint.
    #
    # Overwriting with a constant here (the previous `max(prob, 0.9)`) made
    # every polygon score ~0.87 no matter what the segmenter actually thought,
    # so officers triaging by confidence were sorting noise. SAM 2 changes the
    # SHAPE of a detection, not how sure we are that it is a building — the
    # confidence has to survive refinement unchanged.
    out = np.zeros_like(prob, dtype=np.float32)
    refined, n = ndimage.label(mask)
    for idx, sl in enumerate(ndimage.find_objects(refined), start=1):
        if sl is None:
            continue
        comp = refined[sl] == idx
        seeded = comp & seed[sl]
        if not seeded.any():
            continue                     # refined blob with no detection in it
        out[sl][comp] = float(prob[sl][seeded].mean())
    log.info("SAM2 refinement: %d detections -> %d completed structures",
             int(ndimage.label(seed)[1]), n)
    return out
