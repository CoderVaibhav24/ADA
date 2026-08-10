from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]  # C:/Vaibhav/ADA


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    # Database
    database_url: str

    # SuperTokens
    supertokens_connection_uri: str = "http://localhost:3567"
    supertokens_api_key: str

    # Domains
    api_domain: str = "http://localhost:8000"
    website_domain: str = "http://localhost:5173"

    # Storage
    data_dir: Path = ROOT_DIR / "data"

    # ML pipeline
    model_mode: str = "segdiff"          # segdiff | cd
    model_backend: str = "auto"          # (cd mode) auto | deep | feature_diff
    model_weights: Path = ROOT_DIR / "data" / "weights" / "cd_model.pth"
    chip_size: int = 256
    chip_overlap: int = 64
    change_threshold: float = 0.5
    min_change_area_m2: float = 4.0

    # Building segmentation + diff (segdiff mode)
    building_model_repo: str = "geobase/building-footprint-segmentation"
    building_model_file: str = "onnx/model.onnx"
    # Vendored copies under data/weights/ — used in preference to the HF cache.
    building_model_local: str = "building-footprint-segmentation/onnx/model.onnx"
    sam_model_local: str = "sam2.1-hiera-small"
    resnet18_local: str = "resnet18/resnet18-f37072fd.pth"
    building_threshold: float = 0.5      # per-pixel building prob -> footprint
    new_building_dilate_px: int = 3      # dilate T1 footprints before diff
    # Share of a T2 building instance that must be new ground before it counts
    # as construction. High by design: a structure standing in both epochs —
    # repainted, differently lit, shot from another angle — scores near 0 and
    # is rejected, which is what stops colour change reading as development.
    new_instance_min_frac: float = 0.6
    # Share of the instance that must carry positive change evidence
    # (colour change, when SEED_MODE=all).
    min_evidence_frac: float = 0.15
    # Share of the instance where vegetation was present BEFORE and is gone
    # AFTER. Requiring the canopy to actually disappear — rather than merely
    # "was green once" — is what separates real encroachment from a roof that
    # happens to sit under a tree in both epochs.
    veg_loss_min_frac: float = 0.7
    # A building has a floor area; below this it is segmenter noise, and
    # flagging it as illegal construction destroys officer trust.
    min_new_building_area_m2: float = 50.0
    # Bounding-box fill. Buildings are compact; canopy and shadow blobs ragged.
    min_instance_solidity: float = 0.6
    # If the BEFORE/AFTER footprint maps agree less than this (IoU), the BEFORE
    # segmentation is treated as unreliable — typical for a colour-infrared
    # satellite epoch — and change is judged from imagery evidence instead.
    seg_agreement_min_iou: float = 0.35
    change_gate_mode: str = "structural" # structural (colour-invariant) | pixel
    # seed_mode: which detections seed SAM2.
    #   encroachment -> only building-on-former-vegetation (high precision, the
    #                   ADA green-space case). all -> also colour-change seeds.
    seed_mode: str = "encroachment"
    sam_refine: bool = True              # SAM2 full-structure refinement (GPU)
    sam_model_repo: str = "facebook/sam2.1-hiera-small"
    sam_min_seed_px: int = 40            # ignore detections smaller than this
    sam_box_pad_px: int = 24             # pad seed bbox so SAM2 sees whole bldg
    # Reject a SAM2 mask that balloons beyond this multiple of the detected
    # footprint — a box prompt in dense housing can otherwise latch onto the
    # whole block instead of the one structure.
    sam_max_growth: float = 3.0

    @property
    def weights_dir(self) -> Path:
        """Vendored model weights (populated by scripts/fetch_weights.py)."""
        return self.data_dir / "weights"

    def local_model(self, relative: str) -> Path | None:
        """Return the vendored copy of a model if it has been fetched.

        Every backend calls this before reaching for the HuggingFace/torch
        cache, so a machine with `data/weights/` populated runs fully offline
        and always on the exact revision recorded in manifest.json.
        """
        path = self.weights_dir / relative
        if path.is_file():
            return path
        # a model directory counts as present only if it actually has content
        if path.is_dir() and any(path.iterdir()):
            return path
        return None

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def cogs_dir(self) -> Path:
        return self.data_dir / "cogs"

    @property
    def masks_dir(self) -> Path:
        return self.data_dir / "masks"


settings = Settings()
for d in (settings.uploads_dir, settings.cogs_dir, settings.masks_dir):
    d.mkdir(parents=True, exist_ok=True)
