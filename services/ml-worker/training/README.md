# ADA training pipeline

Trains the licence-clean replacements for the three encumbered models in
`docs/ba/ADA-Model-Inventory-Enterprise-Licensing.pdf`.

Seven models run in production today. Only **two training runs** are needed,
not five:

| Stage | Replaces | Trained on | Status |
|---|---|---|---|
| 1. Land cover | `IgorNer/segformer-b5-loveda` | FLAIR-1 (Open Licence 2.0) | ready to run |
| 2. Building footprints | **both** `geobase/changestar-...-vitb` **and** `geobase/building-footprint-segmentation` | Google Open Buildings V3 (CC BY 4.0) + Microsoft GlobalML Building Footprints (CDLA-Permissive-2.0) over ADA's Lucknow grids | trained (`footprint_v1`) |

**Do not train on Open Cities AI or SpaceNet.** Open Cities AI is ODbL-1.0 (not CC BY 4.0,
as this file used to say) and SpaceNet 1/2 is CC BY-SA 4.0; both are share-alike and
both are rejected for ADA weights. `buildings_opencities.yaml` and `data/opencities.py`
remain only as a harness reference; `ada_train/licences.py` still carries the old
Open Cities verdict and must be corrected before either is run.

`facebook/sam2.1-hiera-large` (Apache-2.0) and torchvision ResNet-18
(BSD-3-Clause) ship unchanged. InstanceNet is in-house and already trained by
`services/ml-worker/scripts/train_instance_classifier.py` on officer labels — a
12→32→16→1 MLP on CPU, not a GPU job. SAM 3 stays off.

**Land cover goes first.** It is the only outright blocking licence item, and
FLAIR-1 gives it the cleanest path. It is also the smaller, simpler task — one
dataset, plain semantic segmentation, no fixed accuracy bar — so it proves the
harness before the high-stakes run. Ship `VEGETATION_MODE=index` until it lands:
legal today, and measurably worse.

One trained artefact replaces **both** building segmenters. A U-Net with a
convolutional encoder is fully convolutional, so the same weights export at
1024 px (the ChangeStar slot) and at 256 px (the CPU/Apple path). The 1024 px
context argument applies to the ViT being replaced, whose positional embeddings
are fixed — not to a U-Net.

## The number the building work is held to

**BEFORE/AFTER footprint agreement of IoU 0.554 on the Agra pair.** That is what
the current ChangeStar checkpoint achieves and what makes the BEFORE epoch
usable at all. Validation IoU on the training labels is a proxy; the Agra figure is the
acceptance test, it needs both epochs of a real ADA scene, and it therefore
lives in the evaluation harness rather than in this training loop. Do not accept
a replacement below 0.554.

## Install

On the training box (Windows, RTX 4050):

```powershell
python -m venv .venv-train
.venv-train\Scripts\activate
# The CUDA wheel. The default PyPI wheel is CPU-only on Windows, and the
# failure is silent: training runs, an epoch takes two days instead of an hour.
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
pip install -r services/ml-worker/training/requirements-train.txt
```

Then, before committing days of wall clock:

```powershell
cd backend\training
python -m ada_train doctor -c configs\landcover_flair1.yaml
```

`doctor` fails loudly on a CPU-only torch, prints VRAM, bf16 support, every
missing package, and whether `data.root` actually exists.

## Windows setup for a multi-day run

```powershell
# long paths -- FLAIR-1 nests deep enough to hit the 260-char limit
reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f
# Defender scans every one of 77k TIFFs on read
Add-MpPreference -ExclusionPath "E:\ada"
# no sleep mid-run
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Also disable automatic restart for updates. On a Windows laptop the things that
end a multi-day run are a forced reboot, a closed lid, a bumped USB cable and an
unplugged charger — not anything numerical. Everything needed to continue
mid-epoch is checkpointed every `train.save_every_steps`, written to a temp file
and renamed, so a yanked cable during a write costs one interval rather than the
run. `python -m ada_train fit` resumes automatically. Run it in overnight chunks.

## Run order

```powershell
# 1. index once (a recursive glob over 77k files on USB takes minutes)
python -m ada_train index -c configs\landcover_flair1.yaml

# 2. smoke it -- ten minutes, catches every path and shape problem
python -m ada_train fit -c configs\landcover_flair1.yaml `
    -o name=smoke data.fraction=0.01 train.epochs=2 train.warmup_steps=20

# 3. the real run (auto-resumes if interrupted)
python -m ada_train fit -c configs\landcover_flair1.yaml

# 4. export: ONNX at each tile size, plus provenance.json and labels.json
python -m ada_train export -c configs\landcover_flair1.yaml
```

Optional, if the dataloader turns out to be IOPS-bound on the USB drive —
77k separate file opens, GDAL header parses and decompressions is usually what
starves the GPU:

```powershell
python -m ada_train pack -c configs\landcover_flair1.yaml -o data.packed=E:/ada/packed/flair1
```

Full FLAIR-1 packs to ~81 GB at three channels and 512 px; a quarter to ~20 GB.
Train and val are packed into separate directories so the domain-held split
survives packing.

## Wall clock on a Lenovo LOQ (RTX 4050 Laptop, 6 GB VRAM, Ryzen 7, 24 GB RAM)

| Run | Wall clock |
|---|---|
| Smoke, `data.fraction=0.01`, 2 epochs | ~10 min |
| Land cover, `data.fraction=0.25` (~19k patches), 40 epochs | ~15-20 h |
| Land cover, full FLAIR-1 (77k patches), 40 epochs | ~1.5-2 days |
| Buildings, one full run | ~3-6 days |

Those figures already include thermal throttling: sustained load puts the GPU at
80-87°C and the CPU at 85-95°C, and clocks drop 15-30% after the first twenty
minutes. That is throttling, not failure. The PDF's 4-6 week building estimate
is several runs, not one — that is where it goes on this box.

### What 6 GB of VRAM costs

`batch_size: 4` with `grad_accum: 4` gives an effective batch of 16 at 512 px in
bf16, which fits. What does **not** fit for training is SegFormer-B5 or
SatlasPretrain Swin-v2-B, so the encoder ceiling is ResNet-34 / ConvNeXt-Tiny
tier. **That is an accuracy ceiling, not just a speed one**, and it is the one
thing more hardware would buy. Say so to whoever signs off.

On a CUDA OOM the engine prints the fixes in the order that costs least:
`grad_checkpoint` first, then `crop`, then the batch size — lowering the batch
below 4 makes the BatchNorm statistics noisy, which hurts accuracy in a way slow
steps do not.

## Splitting work across the two machines

Do **not** split one model across both. DDP needs a fast interconnect; over WiFi
or USB-Ethernet the gradient sync costs more than the compute saves. Split by
work item instead:

| Machine | Job |
|---|---|
| LOQ (CUDA) | land-cover training, then building training. Sequential — 6 GB holds one run |
| MacBook | dataset fetch and licence verification, `index`, `pack`, the evaluation harness on the 12 Agra pairs, baseline metrics |
| MacBook, later | domain adaptation on the 12 pairs (tiny; MPS is fine at that size) |

That gives real parallelism: while the LOQ trains land cover, the MacBook
prepares the building labels so stage 2 starts the hour stage 1 finishes.

## The licence gate

`ada_train/licences.py` is the point of the whole rebuild, so it is enforced in
code rather than left as a convention:

```
python -m ada_train licences        # prints the register; exit 1 if incoherent
```

Every dataset the pipeline can read has an explicit verdict. Unregistered
datasets are refused, because "no licence finding" is not "permissive" — the
same argument that rules out keeping the geobase weights. LEVIR-CD, xBD, LoveDA,
OpenEarthMap, ramp, WHU-CD and S2Looking all raise `LicenceError` before a
single tile is read. SpaceNet (CC BY-SA 4.0) and Open Cities AI (ODbL-1.0) are
share-alike and are NOT to be trained on; do not set `licence.allow_share_alike`
to get past the gate. Encoder weights are gated too: `nvidia/mit-b*` and DINOv3 are
refused by name.

Wire `python -m ada_train licences` into CI. It is the check the PDF's
verification checklist asks for.

## What the metrics mean

The headline number is deliberately **not** mIoU. mIoU over 13 FLAIR-1 classes
rewards telling coniferous from deciduous woodland, which ADA never asks and
never consumes. What the pipeline consumes is `landcover.open_land()` — one
minus the probability that a pixel is building, road or water — so the
checkpoint-selection metric is **built-vs-open IoU** after that collapse
(`built_iou`). Per-class figures are still logged; they diagnose the model, they
do not select it.

For buildings the headline is plain building IoU, with precision and recall
alongside.

## Two modelling decisions, stated because they are decisions

1. **The class collapse.** FLAIR-1 has 19 classes; the IGN baselines train 13 by
   lumping 13-19 into "other", and we follow them. Those 13 then collapse to
   ADA's built/open at inference: `BUILT_CLASSES = (building, impervious
   surface, water)`, which maps onto LoveDA's `(building, road, water)` exactly
   and makes the replacement a drop-in for `open_land()`. "Pervious surface"
   (gravel, unpaved tracks, bare compacted ground) is deliberately **not** built
   — in Agra those are the plots that later get built on, so calling them built
   would suppress the encroachment we are looking for. Section 6 of the PDF names
   this collapse as the main risk of the work item, and it is a modelling
   decision, not a rename.

2. **Three channels, not five.** FLAIR-1 ships NIR and elevation and both would
   help. Neither is available at inference — ADA's pipeline hands the land-cover
   model `(N, H, W, 3)` uint8 RGB. Training on channels we cannot serve produces
   a model that validates well and degrades silently in production.
   `model.in_channels` is configurable for the day that changes.

## Integrating an export into the serving pipeline

The exported ONNX takes `(N, H, W, C)` float32 in 0..255 and does the
divide-by-255 and mean/std normalisation **inside the graph**. Preprocessing
drift between the training script and the serving module is the most common
cause of a model that validates well and performs badly in production, and it is
silent — baking it in makes it impossible.

Output shapes match the existing contracts exactly, verified against the torch
model at export time to under 3e-5:

| Task | ONNX input | ONNX output | Serving consumer |
|---|---|---|---|
| Land cover | `(batch, 512, 512, 3)` | `(batch, 13, 512, 512)` probabilities | `ml/landcover.py`, then `open_land()` |
| Buildings | `(batch, 1024\|256, ..., 3)` | `(batch, H, W)` building probability | `ml/backends.py: BuildingSegBackend.segment` |

Batch is dynamic; height and width are fixed per exported file. That is
deliberate: a convolutional encoder tolerates any size, but pinning the spatial
dims lets onnxruntime plan the graph, which is the difference between the CoreML
provider taking the graph and refusing it — the same reason
`scripts/fetch_weights.py --freeze` exists for the current ChangeStar export.

Land-cover integration also needs `LABELS`/`BUILT_CLASSES` in `ml/landcover.py`
to be read from the export's `labels.json` rather than hardcoded to LoveDA's
seven classes. That is a small follow-up, not part of this pipeline.

## Not built here, on purpose

- **Domain adaptation on ADA's 12 Agra pairs** — stage 3. Twelve pairs is a
  validation set, not a training set, and overfitting is the default outcome
  without care.
- **The FOTBCD native change model** — stage 4, and an accuracy ceiling raise
  rather than a licence fix. It lands in the existing
  `ml/backends.py: TorchScriptBackend` slot with the `model(t1, t2) -> logits`
  signature the backend already expects. Confirm the download resolves first;
  FOTBCD was released January 2026.
- **The evaluation harness** — where the Agra IoU 0.554 acceptance test belongs,
  and where the benchmark-only datasets stay usable. Benchmarking is not
  training.

## Layout

```
ada_train/
  licences.py     the gate: dataset and encoder-weight verdicts, CI audit
  config.py       YAML config, strict keys, dotted CLI overrides
  device.py       device/precision choice; fails loudly on a CPU-only torch
  models.py       smp head + timm/torchvision encoder, licence-checked
  losses.py       CE/BCE + Dice, inverse-frequency class weights
  metrics.py      confusion matrix on device; the built/open collapse
  engine.py       the loop: AMP, accumulation, checkpoint/resume, early stop
  export.py       ONNX at N tile sizes, verified against torch, + provenance
  cli.py          doctor | licences | index | pack | fit | val | export
  data/
    flair1.py     land cover: index, domain-held split, 19->13 remap
    opencities.py buildings harness reference only (Open Cities AI is ODbL-1.0; do not train)
    pack.py       optional flat memmaps, for when USB IOPS starve the GPU
    transforms.py augmentation aimed at the satellite/drone domain gap
configs/
  landcover_flair1.yaml       stage 1, tuned for the 6 GB box
  buildings_opencities.yaml   harness reference only; do not run (ODbL-1.0 data)
```
