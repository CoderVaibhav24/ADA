# Third-Party Models & Licences

Every model weight shipped with Project ADA-Vision, its licence, and the exact
upstream revision it was fetched from. There is no runtime dependency on a
third-party AI service and no per-seat, per-scene or per-inference cost.

The licence column is NOT all permissive, and this file used to claim it was.
Read it before any commercial deployment: the land-cover default is
non-commercial by two independent routes, and both building segmenters declare
no licence upstream at all. See `docs/ADA-Backend-Workflow-Models-Licensing.pdf`
§7 for the analysis and the per-model options. The `ADA training run` entries
are ADA-owned weights, kept local only; they are the default backends
(BUILDING_BACKEND=ada / LANDCOVER_BACKEND=ada).

Regenerate this file with `services/ml-worker/scripts/fetch_weights.py`.


## geobase/building-footprint-segmentation

- **Licence:** none declared upstream
- **Role:** Per-epoch building footprint segmentation (ONNX U-Net, CPU)
- **Revision:** `a291ab4910577f7bd7917fb2b133f9df125e80b0`
- **Vendored at:** `data/weights/building-footprint-segmentation` (29.9 MB)

## geobase/changestar-building-segmentation-vitb

- **Licence:** none declared upstream (training data xBD: CC BY-NC-SA 4.0)
- **Role:** Per-epoch building footprints (ChangeStar ViT-B, 1024 px, GPU). Default: raised BEFORE/AFTER agreement on the Agra pair from IoU 0.112 to 0.554, which is what makes the BEFORE epoch usable
- **Revision:** `8a6d7676d2fc9ea787b8786f2f05a65989c2606c`
- **Vendored at:** `data/weights/changestar-building-segmentation-vitb` (791.4 MB)

## IgorNer/segformer-b5-loveda

- **Licence:** NON-COMMERCIAL (NVIDIA SegFormer §3.3 + LoveDA CC BY-NC-SA 4.0)
- **Role:** Land cover / vegetation without a colour rule (SegFormer-B5, LoveDA 7-class, GPU)
- **Revision:** `6139163b1cf8e953a27ca4960950d6d4c067d72c`
- **Vendored at:** `data/weights/segformer-b5-loveda` (338.5 MB)

## facebook/sam2.1-hiera-large

- **Licence:** Apache-2.0
- **Role:** Full-structure refinement of confirmed detections (GPU). hiera-large, not -small: this decides the reported OUTLINE. For SAM 3 set SAM_BACKEND=sam3 — facebook/sam3 is GATED, so request access on the model page and log in first
- **Revision:** `665f8e2ad61cf5f53d65644ff27c8ee525124610`
- **Vendored at:** `data/weights/sam2.1-hiera-large` (897.9 MB)

## ADA training run footprint_v1

- **Licence:** ADA-owned weights. Initialised from IGN FLAIR-HUB LC-A RGB swinbase-upernet (Licence Ouverte / Etalab 2.0). Labels: Google Open Buildings V3 (CC BY 4.0), Microsoft GlobalML Building Footprints (CDLA-Permissive-2.0), FLAIR pseudo-labels. Imagery: Lucknow 2020/2025 grids, provenance unconfirmed.
- **Role:** Per-epoch building footprints (ADA UPerNet Swin-B, 384 px, GPU). Default; BUILDING_BACKEND=changestar reverts
- **Revision:** `footprint_v1@epoch2`
- **Vendored at:** `data/weights/ada-footprint-v1/model.safetensors` (357.8 MB)
- **SHA-256:** `1403c6f304c8517aa3051ad08ae20517d90e3b8e436ad71ab8bad66d75d5c4ae`

## ADA training run landcover7_v3

- **Licence:** ADA-owned weights. Initialised from IGN FLAIR-HUB LC-A RGB swinbase-upernet (Licence Ouverte / Etalab 2.0). Labels: Google Open Buildings V3 (CC BY 4.0), Microsoft GlobalML Building Footprints (CDLA-Permissive-2.0), FLAIR pseudo-labels. Imagery: Lucknow 2020/2025 grids, provenance unconfirmed.
- **Role:** Land cover, 7 classes in LoveDA order (ADA UPerNet Swin-B, 384 px, GPU). Default; LANDCOVER_BACKEND=loveda reverts
- **Revision:** `landcover7_v3@epoch14`
- **Vendored at:** `data/weights/ada-landcover7-v3/model.safetensors` (357.8 MB)
- **SHA-256:** `d82a45e684aea7fa46e35d8d87061c5b49201d1c428e82d2795930ad57a05c11`

## torchvision/resnet18 (IMAGENET1K_V1)

- **Licence:** BSD-3-Clause
- **Role:** Backbone for the alternate DCVA change-detection path (MODEL_MODE=cd)
- **Revision:** `v1`
- **Vendored at:** `data/weights/resnet18/resnet18-f37072fd.pth` (46.8 MB)
- **SHA-256:** `f37072fd47e89c5e827621c5baffa7500819f7896bbacec160b1a16c560e07ec`
