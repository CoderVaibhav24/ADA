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

from ada_core import ROOT_DIR, CoreSettings
from ada_core.database import configure_engine


class Settings(CoreSettings):
    # Re-submit work left mid-flight by the previous process on startup. Right
    # in Docker, where a restart is a real event; wrong under `uvicorn
    # --reload`, where it restarts a multi-hour ingest on every file save.
    requeue_stale_on_startup: bool = True

    # Where this service answers. ada-api reaches it at ML_SERVICE_URL.
    ml_port: int = 8100
    service_name: str = "ada-ml"
    log_level: str = "INFO"

    # Shared secret ada-api presents on X-ADA-Service-Token. Empty disables the
    # check — right for a single-user local run against a loopback port, wrong
    # anywhere the network is shared, so startup warns when it is unset.
    ml_service_token: str = ""

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
    ml_device: str = "auto"              # auto | cuda | mps | cpu
    # Hard-fail instead of silently running a GPU model on the CPU. onnxruntime
    # only WARNS when its provider fails to load, which is how a misconfigured
    # box ends up thermally throttling for minutes with no obvious cause.
    require_gpu: bool = False
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
    # changestar -> ViT-B, 1024 px context, ~395 MB (default: far stronger on
    # dense/low-contrast blocks). geobase -> the original 30 MB U-Net at 256 px.
    building_backend: str = "changestar"   # changestar | geobase
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


settings = Settings()  # type: ignore[call-arg]
settings.prepare_runtime()
configure_engine(settings.database_url)
