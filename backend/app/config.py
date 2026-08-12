import os
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

    # Compute placement. The heavy models (ChangeStar ViT-B, SAM) belong on the
    # GPU: on CPU a single 1024 px ViT tile takes ~13 s and pins every core.
    ml_device: str = "cuda"              # cuda | cpu
    # Hard-fail instead of silently running a GPU model on the CPU. onnxruntime
    # only WARNS when CUDA fails to load, which is how a misconfigured box ends
    # up thermally throttling for minutes with no obvious cause.
    require_gpu: bool = False
    # Ceiling on ORT CPU threads. Keeps a fallback (or the CPU-side ops) from
    # saturating the machine; 0 would mean "use every core".
    onnx_cpu_threads: int = 4
    # Re-submit work left mid-flight by the previous process on startup. Right
    # in Docker, where a restart is a real event; wrong under `uvicorn
    # --reload`, where it restarts a multi-hour ingest on every file save.
    requeue_stale_on_startup: bool = True

    # --- resource budget -----------------------------------------------------
    # VRAM ceiling for one pipeline stage, enforced in both runtimes: torch via
    # set_per_process_memory_fraction, onnxruntime via the CUDA provider's
    # gpu_mem_limit. Stages run in sequence and release before the next
    # allocates, so this is also the process peak — see ml/gpu.py. Exceeding it
    # raises a CUDA OOM rather than quietly filling the card.
    gpu_memory_limit_gb: float = 4.0
    # Host working-set ceiling. Not an enforced rlimit (there is no portable
    # one on Windows); it SIZES the pipeline — the working grid is derived from
    # it, and GDAL's block cache is a share of it. Raising this buys a larger
    # working grid and less re-reading from disk; lowering it does the reverse.
    host_memory_limit_gb: float = 18.0
    # Share of the host budget handed to GDAL's block cache. Every block held
    # here is a block not re-read from disk during warping and COG building,
    # which is where nearly all of this pipeline's disk traffic comes from.
    gdal_cache_fraction: float = 0.15
    # Run the classical full-scene image maths (box filter, Sobel, median/MAD,
    # binary dilation) on the GPU instead of scipy. Same arithmetic, ~1-2 orders
    # of magnitude faster on a 6144^2 grid, and it keeps the large float32
    # temporaries in VRAM instead of host RAM. Falls back to scipy automatically
    # when CUDA is unavailable.
    gpu_image_ops: bool = True

    # Free each model's VRAM once its stage is done. The three networks run in
    # strict sequence and never together, but all three cached at once measured
    # at 6.4/6.4 GB on a 6 GB laptop card — zero headroom. Turn off only on a
    # card big enough to hold them all, where keeping them warm is faster.
    release_models_between_stages: bool = True

    # ML pipeline
    model_mode: str = "segdiff"          # segdiff | cd
    model_backend: str = "auto"          # (cd mode) auto | deep | feature_diff
    model_weights: Path = ROOT_DIR / "data" / "weights" / "cd_model.pth"
    chip_size: int = 256
    chip_overlap: int = 64
    change_threshold: float = 0.5
    min_change_area_m2: float = 4.0

    # Building segmentation + diff (segdiff mode)
    # changestar -> ViT-B, 1024 px context, ~395 MB (default: far stronger on
    # dense/low-contrast blocks). geobase -> the original 30 MB U-Net at 256 px.
    building_backend: str = "changestar"   # changestar | geobase
    changestar_model_repo: str = "geobase/changestar-building-segmentation-vitb"
    changestar_model_file: str = "onnx/model.onnx"
    changestar_model_local: str = "changestar-building-segmentation-vitb/onnx/model.onnx"
    building_model_repo: str = "geobase/building-footprint-segmentation"
    building_model_file: str = "onnx/model.onnx"
    # Vendored copies under data/weights/ — used in preference to the HF cache.
    building_model_local: str = "building-footprint-segmentation/onnx/model.onnx"
    sam_model_local: str = "sam2.1-hiera-large"
    resnet18_local: str = "resnet18/resnet18-f37072fd.pth"
    # Land cover / vegetation. A learned segmenter replaces NDVI + excess-green:
    # colour indices assume vegetation is identifiable by channel ratio, which
    # fails across sensors (green in RGB, red in CIR, brown when dry) and marked
    # 8.5% of the Agra scene as spurious vegetation LOSS.
    landcover_model_repo: str = "IgorNer/segformer-b5-loveda"
    landcover_model_local: str = "segformer-b5-loveda"
    vegetation_threshold: float = 0.5
    # Fall back to the old NDVI / excess-green indices if the model is missing.
    vegetation_mode: str = "learned"     # learned | index
    # Which file superimpose warps from to build the common grid.
    #   auto     -> the ingested COG when vegetation is learned (the COG has
    #               overviews; the originals do not, so warping them reads every
    #               pixel of a multi-GB upload), otherwise the original.
    #   cog      -> always the COG. Fastest; drops raw-band NDVI.
    #   original -> always the original. Slowest, preserves raw bands.
    superimpose_source: str = "auto"     # auto | cog | original

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
    # Convex solidity (area / convex-hull area). Buildings are compact; canopy
    # and shadow blobs are ragged. Deliberately NOT bounding-box fill: that
    # measures the building's angle to north as much as its shape, and a
    # rectangle at 45° fills only half its bounding box.
    min_instance_solidity: float = 0.6
    # If the BEFORE/AFTER footprint maps agree less than this (IoU), the BEFORE
    # segmentation is treated as unreliable — typical for a colour-infrared
    # satellite epoch — and change is judged from imagery evidence instead.
    seg_agreement_min_iou: float = 0.35
    change_gate_mode: str = "structural" # structural (colour-invariant) | pixel

    # --- instance decision (learned accept/reject) ---
    # rules   -> the original hand-tuned cascade only.
    # shadow  -> the net scores every instance and its agreement with the rules
    #            is logged, but the rules still decide. Start here.
    # active  -> the net decides. Promote only after reading shadow numbers.
    instance_decider: str = "shadow"     # rules | shadow | active
    # Below this many officer-labelled polygons the net is ignored entirely: on
    # a handful of labels it is strictly worse than the cascade it replaces.
    min_training_samples: int = 150
    # Report structures that vanished between epochs, not just new ones.
    detect_demolition: bool = True
    # Growth over the matched T1 footprint before it counts as an extension
    # rather than the same building re-segmented slightly differently.
    extension_min_growth: float = 0.25
    # seed_mode: which detections seed SAM2.
    #   encroachment -> only building-on-former-vegetation (high precision, the
    #                   ADA green-space case). all -> also colour-change seeds.
    seed_mode: str = "encroachment"
    sam_refine: bool = True              # full-structure refinement (GPU)
    # sam2 -> transformers Sam2Model. sam3 -> Sam3Model (needs transformers>=5
    # AND access to the GATED facebook/sam3 repo: request it on the model page,
    # then `huggingface-cli login`).
    sam_backend: str = "sam2"            # sam2 | sam3
    sam3_model_repo: str = "facebook/sam3"
    sam3_model_local: str = "sam3"
    # hiera-large, not -small: refinement decides the OUTLINE of every reported
    # structure, and the small variant was fragmenting shadowed and low-contrast
    # roofs. ~2x the VRAM of small, still comfortable on 6 GB.
    sam_model_repo: str = "facebook/sam2.1-hiera-large"
    sam_min_seed_px: int = 40            # ignore detections smaller than this
    sam_box_pad_px: int = 24             # pad seed bbox so SAM2 sees whole bldg
    # Reject a SAM2 mask that balloons beyond this multiple of the detected
    # footprint — a box prompt in dense housing can otherwise latch onto the
    # whole block instead of the one structure.
    sam_max_growth: float = 3.0

    @property
    def host_memory_limit_bytes(self) -> int:
        return int(self.host_memory_limit_gb * (1 << 30))

    @property
    def gdal_cache_mb(self) -> int:
        """GDAL block cache, in MB, as a share of the host budget."""
        return max(64, int(self.host_memory_limit_gb * self.gdal_cache_fraction * 1024))

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

# GDAL reads this once, when it first needs the block cache — which happens
# inside the first warp, long after any import we control. Setting it here (the
# earliest module every entry point loads) is what makes it stick; the heavy
# functions also pass it explicitly via rasterio.Env so a differently-ordered
# import cannot silently leave the cache at GDAL's 5% default.
os.environ.setdefault("GDAL_CACHEMAX", str(settings.gdal_cache_mb))
# Overviews and COG building are the two places GDAL will happily re-read the
# same blocks; letting it use every core shortens the window in which it does.
os.environ.setdefault("GDAL_NUM_THREADS", "ALL_CPUS")
