# Third-Party Models & Licences

Every model weight shipped with Project ADA-Vision, its licence, and the exact
upstream revision it was fetched from. All are permissive (Apache 2.0 / BSD),
so ADA retains full rights to operate, modify and redistribute the system with
no per-seat, per-scene or per-inference cost, and no runtime dependency on a
third-party AI service.

Regenerate this file with `backend/scripts/fetch_weights.py`.


## geobase/building-footprint-segmentation

- **Licence:** Apache-2.0
- **Role:** Per-epoch building footprint segmentation (ONNX U-Net, CPU)
- **Revision:** `a291ab4910577f7bd7917fb2b133f9df125e80b0`
- **Vendored at:** `data/weights/building-footprint-segmentation` (29.9 MB)

## facebook/sam2.1-hiera-small

- **Licence:** Apache-2.0
- **Role:** Full-structure refinement of confirmed detections (GPU)
- **Revision:** `ee5bba1d82bb8749febdf90f45e84b687142ba03`
- **Vendored at:** `data/weights/sam2.1-hiera-small` (184.3 MB)

## torchvision/resnet18 (IMAGENET1K_V1)

- **Licence:** BSD-3-Clause
- **Role:** Backbone for the alternate DCVA change-detection path (MODEL_MODE=cd)
- **Revision:** `v1`
- **Vendored at:** `data/weights/resnet18/resnet18-f37072fd.pth` (46.8 MB)
- **SHA-256:** `f37072fd47e89c5e827621c5baffa7500819f7896bbacec160b1a16c560e07ec`
