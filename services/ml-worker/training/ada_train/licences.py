"""The licence gate. Nothing trains on data we may not ship weights from.

This is the whole point of the enterprise rebuild, so it is enforced in code
rather than left as a convention in a document. Every dataset the pipeline can
read is registered here with its licence and an explicit verdict, and
`assert_trainable` is called by the dataset registry before a single tile is
read. A dataset that is not registered is refused too -- absence of a licence
finding is not a permissive one, exactly as absence of an upstream licence is
not a grant of rights.

`audit()` exists so CI can fail a build that adds a training set without a
verdict. See docs/ADA-Model-Inventory-Enterprise-Licensing.pdf section 4.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Licence:
    name: str
    licence: str
    trainable: bool
    note: str
    attribution: str = ""


# Verified upstream between 2026-08-21 and 2026-09-04. Re-verify before contract:
# the checklist in section 7 of the inventory document is the source of record.
REGISTER: dict[str, Licence] = {
    # --- may train, may ship the resulting weights ---------------------------
    "flair1": Licence(
        name="FLAIR-1 / FLAIR-HUB (IGN France)",
        licence="Open Licence 2.0 (Etalab); code Apache-2.0",
        trainable=True,
        note="0.2 m aerial, 19 classes (13 in the baselines), >20 billion "
             "annotated pixels. Commercial reuse permitted with attribution. "
             "The licence-clean replacement for the LoveDA land-cover model.",
        attribution="Contains data from IGN France, FLAIR-1, Open Licence 2.0 (Etalab).",
    ),
    "opencities": Licence(
        name="Open Cities AI Challenge",
        licence="ODbL-1.0",
        trainable=False,
        note="790k OSM building footprints over ~400 km2 of drone imagery at "
             "<60 cm, <15 degrees off-nadir, 10 African cities. The labels are "
             "OpenStreetMap data under ODbL-1.0 (share-alike database licence, "
             "not CC BY 4.0); not to be trained on (training/README.md).",
        attribution="Open Cities AI Challenge dataset, labels (c) OpenStreetMap "
                    "contributors, ODbL-1.0.",
    ),
    "fotbcd": Licence(
        name="FOTBCD",
        licence="CC BY 4.0",
        trainable=True,
        note="~28,000 before/after pairs at 0.2 m, 28 French departments, "
             "geographically disjoint test split. Released January 2026 -- "
             "confirm the download resolves and read the LICENSE file directly "
             "before any plan depends on it.",
        attribution="FOTBCD (arXiv 2601.22596), CC BY 4.0.",
    ),
    "hrscd": Licence(
        name="HRSCD",
        licence="Open (IGN France)",
        trainable=True,
        note="291 pairs at 0.5 m, land-cover change. FOTBCD's predecessor.",
        attribution="HRSCD, IGN France.",
    ),
    # Share-alike: usable to train, but redistributing derived weights needs a
    # recorded decision. Left trainable and flagged, not silently allowed.
    "spacenet": Licence(
        name="SpaceNet 1/2",
        licence="CC BY-SA 4.0",
        trainable=True,
        note="685k footprints at 50 cm. SHARE-ALIKE. Section 6.1 of the "
             "inventory says it may be cleaner to leave this out than to argue "
             "about the redistribution terms for derived weights. Requires "
             "allow_share_alike: true in the config to be used at all.",
        attribution="SpaceNet 1/2, CC BY-SA 4.0.",
    ),

    # --- benchmark only. Never ship weights trained on these. ----------------
    "levir_cd": Licence(
        name="LEVIR-CD",
        licence="Academic only",
        trainable=False,
        note="Verbatim upstream: 'can only be used for academic purposes, but "
             "are prohibited for any commercial use.' Plus Google Earth terms.",
    ),
    "xbd": Licence(
        name="xBD / xView2",
        licence="CC BY-NC-SA 4.0",
        trainable=False,
        note="ChangeStar's training set -- the reason the current default "
             "building segmenter has to be replaced.",
    ),
    "loveda": Licence(
        name="LoveDA",
        licence="CC BY-NC-SA 4.0",
        trainable=False,
        note="The current land-cover model's training set. The single best "
             "domain match for Agra and the one set that cannot be used.",
    ),
    "openearthmap": Licence(
        name="OpenEarthMap",
        licence="CC BY-NC-SA 4.0 default, mixed per source region",
        trainable=False,
        note="Excellent domain fit at 0.25-0.5 m, unusable terms.",
    ),
    "ramp": Licence(
        name="ramp (Replicable AI for Microplanning)",
        licence="CC BY-NC",
        trainable=False,
        note="Exactly ADA's domain -- dense low-rise LMIC settlement -- and "
             "exactly the same trap as LoveDA.",
    ),
    "whu_cd": Licence(
        name="WHU-CD",
        licence="Academic",
        trainable=False,
        note="0.2 m Christchurch aerial.",
    ),
    "s2looking": Licence(
        name="S2Looking",
        licence="Not stated in the paper",
        trainable=False,
        note="Research-only until the repository LICENSE is actually read. "
             "Not stated is not permissive.",
    ),
}

# Encoder weights are a licence surface too, and the tempting ones are the
# encumbered ones. Refused at model-build time by models.build_model.
ENCODER_VERDICTS: dict[str, tuple[bool, str]] = {
    "imagenet": (True, "torchvision/timm ImageNet weights, BSD-3-Clause / "
                       "Apache-2.0 code. ImageNet's own image terms are "
                       "non-commercial but the entire commercial vision "
                       "industry relies on derived weights being usable; "
                       "one line to counsel for completeness."),
    "satlas": (True, "SatlasPretrain, model card Apache-2.0 over ODC-BY data. "
                     "Reached through torchgeo. Needs more VRAM than 6 GB to "
                     "fine-tune at 512 px."),
    "dinov2": (True, "Apache-2.0."),
    "dinov3": (False, "Custom gated Meta licence, unlike DINOv2's Apache-2.0. "
                      "Needs legal review before it goes near a deliverable."),
    "mit-b0": (False, "NVIDIA SegFormer licence section 3.3 restricts use to "
                      "research or evaluation, and 3.2 propagates that to "
                      "derivative works. Fine-tuning does not lift it."),
    "nvidia": (False, "See mit-b0."),
    None: (True, "Random initialisation. No third-party weights involved."),
}


class LicenceError(RuntimeError):
    """Raised instead of training on something we cannot ship."""


def assert_trainable(dataset_id: str, *, allow_share_alike: bool = False) -> Licence:
    """Gate a dataset before it is read. Raises rather than warns, deliberately."""
    entry = REGISTER.get(dataset_id)
    if entry is None:
        raise LicenceError(
            f"dataset {dataset_id!r} is not in the licence register. Add it to "
            f"ada_train/licences.py with an explicit verdict first. An "
            f"unregistered dataset is refused because 'no licence finding' is "
            f"not the same as 'permissive'."
        )
    if not entry.trainable:
        raise LicenceError(
            f"{entry.name} is BENCHMARK ONLY ({entry.licence}). {entry.note} "
            f"Weights trained on it cannot be shipped. Use it in the evaluation "
            f"harness instead -- benchmarking is not training."
        )
    if "BY-SA" in entry.licence and not allow_share_alike:
        raise LicenceError(
            f"{entry.name} is share-alike ({entry.licence}). Set "
            f"licence.allow_share_alike: true in the config to opt in, and "
            f"record the decision on redistributing derived weights first."
        )
    return entry


def attribution_for(dataset_ids: list[str]) -> list[str]:
    """Attribution lines to carry into the exported model's provenance file."""
    out = []
    for d in dataset_ids:
        entry = REGISTER.get(d)
        if entry and entry.attribution:
            out.append(entry.attribution)
    return out


def audit() -> list[str]:
    """CI hook. Returns problems; empty list means the register is coherent."""
    problems = []
    for key, entry in REGISTER.items():
        if not entry.licence:
            problems.append(f"{key}: no licence recorded")
        if entry.trainable and not entry.attribution:
            problems.append(f"{key}: trainable but no attribution string")
        if entry.trainable and "NC" in entry.licence:
            problems.append(f"{key}: marked trainable but licence looks non-commercial")
    return problems
