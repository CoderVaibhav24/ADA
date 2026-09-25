"""Settings for the ADA model service.

Everything here is a property of the pipeline: which network runs, where it
runs, how much memory it may take and where the decision thresholds sit. None
of it is known to ada-api, which is the point of the split — the API process
does not import torch, so it cannot be slowed down or crashed by a model.

Shared settings (DATABASE_URL, DATA_DIR, the GDAL cache) come from
ada_core.CoreSettings. Environment names are unchanged from the single-process
backend, so an existing .env keeps working.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from ada_core import ROOT_DIR, CoreSettings
from ada_core.database import configure_engine
from pydantic import Field, ValidationInfo, field_validator, model_validator

_BACKENDS = {
    "building_backend": ("changestar", "geobase", "ada"),
    "landcover_backend": ("loveda", "ada"),
}


class Settings(CoreSettings):
    # Re-submit work left mid-flight by the previous process on startup. Right
    # in Docker, where a restart is a real event; wrong under `uvicorn
    # --reload`, where it restarts a multi-hour ingest on every file save.
    requeue_stale_on_startup: bool = True

    # Where this service answers. ada-api reaches it at ML_SERVICE_URL.
    ml_port: int = 8100
    service_name: str = "ada-ml"
    log_level: str = "INFO"

    # Production unless said otherwise; compose (local development) sets local.
    ada_env: Literal["local", "staging", "production"] = "production"

    # Shared secret ada-api presents on X-ADA-Service-Token. Empty is accepted
    # only with ADA_ENV=local (a single-user loopback run); anywhere else the
    # settings refuse to load, so the service does not start with an open door.
    ml_service_token: str = ""

    # An empty ADA_ENV (as a copied .env.example has it) means "not said", which
    # is production — never a validation error, never local.
    @field_validator("ada_env", mode="before")
    @classmethod
    def _blank_env_is_production(cls, value: object) -> object:
        return "production" if value is None or str(value).strip() == "" else value

    @model_validator(mode="after")
    def _require_service_token_outside_local(self) -> Settings:
        if not self.ml_service_token and self.ada_env != "local":
            raise ValueError(
                f"ML_SERVICE_TOKEN is empty and ADA_ENV={self.ada_env!r}. Outside local "
                "development ada-ml must authenticate its caller; set ML_SERVICE_TOKEN "
                "(the same value ada-api has) or ADA_ENV=local for a dev stack."
            )
        return self

    # Backend names are matched literally downstream, so a typo must fail at startup.
    @field_validator("building_backend", "landcover_backend", mode="before")
    @classmethod
    def _known_backend(cls, value: object, info: ValidationInfo) -> object:
        allowed = _BACKENDS[info.field_name]
        name = str(value).strip().lower()
        if name not in allowed:
            raise ValueError(f"{info.field_name.upper()}={value!r} is not one of "
                             f"{', '.join(allowed)}")
        return name

    # A blank ADA_BATCH_SIZE (as a copied .env.example has it) means the tier default.
    @field_validator("ada_batch_size", mode="before")
    @classmethod
    def _blank_batch_is_default(cls, value: object) -> object:
        return None if value is None or str(value).strip() == "" else value

    @field_validator("ada_batch_size")
    @classmethod
    def _positive_batch(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("ADA_BATCH_SIZE must be >= 1 (or blank for the tier default)")
        return value

    # new_instance_min_frac for the active building backend; the ADA cut was set on its outputs.
    def effective_new_instance_min_frac(self) -> float:
        if self.building_backend == "ada":
            return self.new_instance_min_frac_ada
        return self.new_instance_min_frac

    # --- notifications -------------------------------------------------------
    #
    # Only this service notifies anyone, because only this service knows when an
    # analysis actually ended. The credential is ada-ml's own Keycloak client;
    # ada-notify matches its client id against the azp claim, and that match is
    # the whole tenancy boundary.
    #
    # Off by default: a deployment without ada-notify running must not have
    # every finished analysis trailed by a warning it cannot act on.
    notify_enabled: bool = False
    notify_url: str = "http://ada-notify:8001"
    # The Keycloak realm URL this process can actually REACH. Inside compose
    # that is http://keycloak:8090/realms/pcsmcpl even though the token says
    # localhost — the token endpoint is fetched, not compared, so the internal
    # address is the correct one here.
    notify_issuer: str = ""
    notify_client_id: str = "ada-ml"
    notify_client_secret: str = ""
    # Used to build the link in the message body. The origin a person's browser
    # reaches ADA on, which is neither container's own address.
    app_origin: str = "http://localhost:5173"

    # Compute placement. The heavy models (ChangeStar ViT-B, SAM) belong on the
    # GPU: on CPU a single 1024 px ViT tile takes ~13 s and pins every core.
    #   auto -> CUDA if an NVIDIA card is present, else Apple Metal (MPS), else
    #           CPU. The right setting for every machine; the explicit names
    #           exist to pin a box, not to configure one.
    #   mps  -> Apple Silicon GPU. Reached through torch's MPS backend and, for
    #           onnxruntime, the CoreML execution provider — there is no Metal
    #           EP. Requires the plain macOS arm64 wheels of both.
    # A pinned value (cuda | mps | metal | cpu) whose probe fails refuses to start.
    ml_device: str = "auto"              # auto | cuda | mps (metal) | cpu
    # Deprecated alias for pinning a GPU: with auto, refuses to start on the CPU tier.
    require_gpu: bool = False

    # --- runtime tiers (doc §4.1) ---------------------------------------------
    # SAM refinement on the CPU tier; off by default because it dominates CPU time.
    ml_cpu_sam_refine: bool = False
    # Working-grid side cap on the CPU tier.
    ml_cpu_grid_cap_px: int = 3072
    # Seconds per working-grid Mpx: CPU from the measured 13 s/tile; CUDA, Metal estimated.
    ml_eta_s_per_mpx_cuda: float = 1.5
    ml_eta_s_per_mpx_metal: float = 6.0
    ml_eta_s_per_mpx_cpu: float = 60.0
    # Re-runs of an analysis that exhausted the OOM degrade ladder ("retryable:").
    ml_oom_retries: int = 3
    # How often retryable analyses are re-queued while the process runs; 0 = only at startup.
    ml_retry_interval_seconds: int = 900
    # Ceiling on ORT CPU threads. Keeps a fallback (or the CPU-side ops) from
    # saturating the machine; 0 would mean "use every core".
    onnx_cpu_threads: int = 4

    # --- resource budget -----------------------------------------------------
    # GPU memory ceiling for one pipeline stage, enforced in both runtimes where
    # they expose a knob: torch via set_per_process_memory_fraction (CUDA and
    # MPS both have one), onnxruntime via the CUDA provider's gpu_mem_limit.
    # Stages run in sequence and release before the next allocates, so this is
    # also the process peak — see ml/gpu.py. Exceeding it raises an OOM rather
    # than quietly filling the card.
    #
    # APPLE SILICON: this and host_memory_limit_gb are shares of ONE unified
    # pool, not two devices, and CoreML takes no limit at all — so the pair must
    # sum below what the machine will actually give a process (ml/gpu.py warns
    # when it does not). On a 24 GB Mac, 6 + 12 leaves the OS its room; the
    # 4 + 18 default below is sized for a discrete 6 GB card beside 32 GB of
    # host RAM and will page on a Mac.
    gpu_memory_limit_gb: float = 4.0
    # host_memory_limit_gb and gdal_cache_fraction are inherited from
    # CoreSettings. The host ceiling SIZES this pipeline — the working grid is
    # derived from it and GDAL's block cache is a share of it — but ada-api
    # reads COGs through the same GDAL, so the cache setting cannot belong to
    # one service alone.

    # Run the classical full-scene image maths (box filter, Sobel, median/MAD,
    # binary dilation) on the GPU instead of scipy. Same arithmetic, ~1-2 orders
    # of magnitude faster on a 6144^2 grid, and on a discrete card it keeps the
    # large float32 temporaries in VRAM instead of host RAM. Falls back to scipy
    # automatically when no GPU backend is available.
    #
    # On unified memory the second benefit does not exist — the temporaries were
    # never anywhere else — but the first is the larger of the two anyway.
    gpu_image_ops: bool = True

    # Free each model's GPU memory once its stage is done. The three networks
    # run in strict sequence and never together, but all three cached at once
    # measured at 6.4/6.4 GB on a 6 GB laptop card — zero headroom. Turn off
    # only where there is room to hold them all, in which case keeping them warm
    # is faster: a 32 GB+ Mac qualifies, a 6 GB card does not.
    release_models_between_stages: bool = True

    # ML pipeline
    model_mode: str = "segdiff"          # segdiff | cd
    model_backend: str = "auto"          # (cd mode) auto | deep | feature_diff
    model_weights: Path = ROOT_DIR / "data" / "weights" / "cd_model.pth"
    chip_size: int = 256
    chip_overlap: int = 64
    # change_threshold is inherited from CoreSettings: ada-api renders the mask
    # against the same cut, so it cannot be declared in only one of them.
    min_change_area_m2: float = 4.0

    # Building segmentation + diff (segdiff mode)
    # ada (default) -> ADA UPerNet/Swin-B footprint. changestar -> ViT-B, 1024 px
    # context, ~395 MB. geobase -> the original 30 MB U-Net at 256 px.
    building_backend: str = "ada"   # ada | changestar | geobase
    # ADA's own UPerNet/Swin weights under data/weights/ (scripts/convert_ada_checkpoint.py).
    ada_footprint_local: str = "ada-footprint-v1"
    ada_landcover_local: str = "ada-landcover7-v3"
    # Tiles per forward pass for the ADA backends; None -> cuda 4, metal 2, cpu 1.
    ada_batch_size: int | None = None
    changestar_model_repo: str = "geobase/changestar-building-segmentation-vitb"
    changestar_model_file: str = "onnx/model.onnx"
    changestar_model_local: str = "changestar-building-segmentation-vitb/onnx/model.onnx"
    # Shape-frozen copy of the above (height/width baked to 1024). Preferred
    # when present, and REQUIRED on Apple Silicon: the CoreML EP compiles shapes
    # ahead of time and cannot carry this graph's symbolic height/width through
    # the ViT's pad, so it binds the graph and then fails at execution. Written
    # by `scripts/fetch_weights.py --freeze`.
    changestar_model_static_local: str = (
        "changestar-building-segmentation-vitb/onnx/model_static_1024.onnx")
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
    landcover_backend: str = "ada"      # ada | loveda
    # Cut on landcover.cleared_ground; quantile-matched to LoveDA barren at 0.5 (docs).
    bare_ground_threshold: float = 0.752
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
    # The same cut when BUILDING_BACKEND=ada; read through effective_new_instance_min_frac().
    new_instance_min_frac_ada: float = 0.513
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

    # --- per-parcel change (app/parcels.py) ---
    parcel_stage_enabled: bool = True
    parcel_tolerance_frac: float = 0.20      # built area may exceed sanctioned by this share
    parcel_vacant_max_frac: float = 0.05     # built share below this reads as vacant
    parcel_min_imagery_frac: float = 0.80    # imaged share below this gets no verdict
    parcel_change_min_sqm: float = 10.0
    parcel_change_min_frac: float = 0.10     # of the parcel area
    parcel_block_px: int = 2048
    # Below this many assessable parcels the median epoch bias is noise, so none is removed.
    parcel_bias_min_parcels: int = 20

    # --- footprint regularisation (app/regularize.py) ---
    regularize_footprints: bool = True
    regularize_simplify_m: float = Field(0.5, ge=0)
    regularize_min_edge_m: float = Field(1.0, ge=0)
    regularize_parcel_snap_m: float = Field(0.5, ge=0)  # overshoot below this is clipped
    regularize_parcel_align_deg: float = Field(10.0, ge=0, le=45)  # parcel axis within this
    regularize_min_iou: float = Field(0.75, ge=0, le=1)  # ortho shape vs traced outline
    regularize_keep_raw: bool = False          # also write the traced outline as raw_geometry


settings = Settings()  # type: ignore[call-arg]
settings.prepare_runtime()
configure_engine(settings.database_url)
