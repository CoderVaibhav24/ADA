# ADA Change Detection — Encroachment Detection POC

End-to-end web application for the Agra Development Authority use-case:
upload two geo-referenced orthophotos of the same area taken at different
times (drone and/or satellite), superimpose them, run grid-based ML change
detection, and inspect every detected change on an interactive map — with
user-defined **red zones** that automatically flag changes inside them as
**illegal encroachment**.

Detection is **not one model** — it is an ensemble of specialised stages
(alignment → per-epoch building segmentation → confirmation gating → SAM 2
full-structure refinement → deterministic zone rules). Run
`backend/scripts/build_documentation.py` to generate a full project
write-up (`ADA_Vision_Project_Documentation.docx`, §6 has the rationale).

## Stack

| Piece | Choice |
|---|---|
| Backend | FastAPI (conda env `torch`: Python 3.12, torch 2.11+cu128, onnxruntime-gpu 1.22) |
| Auth | SuperTokens (core in Docker, EmailPassword + sessions) |
| Database | PostgreSQL 16 + PostGIS (Docker) |
| Raster processing | rasterio, rio-cogeo, scikit-image, scipy |
| Tile serving | rio-tiler dynamic XYZ endpoints (TiTiler's engine) |
| ML | ONNX Runtime (building segmenter, CPU) + PyTorch/CUDA (SAM 2, GPU) |
| Vectorization | rasterio.features + shapely → GeoJSON in PostgreSQL |
| Frontend | React + TypeScript (Vite), MapLibre GL JS |
| Jobs | in-process worker thread (POC stand-in for Celery/Redis) |

## Quick start — Docker (whole stack, nothing else installed)

Everything runs in containers: Postgres/PostGIS, SuperTokens, the FastAPI
backend and the built React app behind nginx. Only Docker with Compose v2 is
required — no Python, Node or venv on the host.

```bash
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
# set POSTGRES_PASSWORD and SUPERTOKENS_API_KEY
# (the API key accepts alphanumerics, '-' and '=' only)
docker compose up -d --build
```

Then open **http://localhost:5173**, sign up with any email/password, and
create a project. API docs are at http://localhost:8000/docs.

The first `up` takes a few minutes: it builds both images, downloads the 261 MB
of model weights into `./data/weights/`, and generates the synthetic Agra demo
pair into `./data/samples/`. Both are skipped on every later boot, and `./data`
is bind-mounted so uploads, COGs, masks and weights survive
`docker compose down`. Set `AUTO_FETCH_WEIGHTS=false` / `AUTO_SAMPLE_DATA=false`
in `.env` to skip either step.

```bash
docker compose ps                       # all four should be healthy
docker compose logs -f backend          # pipeline progress during a run
curl http://localhost:5173/api/health   # -> {"status":"ok"}
docker compose down                     # stop (add -v to wipe the database)
```

If a port is already taken on your machine, change `FRONTEND_PORT`,
`BACKEND_PORT`, `POSTGRES_PORT` or `SUPERTOKENS_PORT` in `.env` — the
containers talk to each other over the compose network, so only the host-side
mapping moves.

Demo walkthrough once you are signed in: create a project, upload
`data/samples/agra_t1_2024.tif` as T1 and `agra_t2_2026.tif` as T2, draw a red
zone over part of the scene, then run a **Diff Mode** analysis (seconds) to see
change polygons and the red-zone `illegal` classification. AI Mode is the
evidence-grade path and is meant for real imagery — on the purely synthetic
demo scene the building segmenter finds nothing to confirm, which is the
weights limitation described under *Accuracy* below, not a broken pipeline.

The container image is CPU-only, so SAM 2 refinement runs without CUDA (slower,
and it falls back to a morphological closing if it cannot load).

## Quick start — native (for development)

Full first-time setup (Windows & Linux) is in **[SETUP.md](SETUP.md)**. Once
that's done once:

```powershell
.\start.ps1      # Windows
```

```bash
./start.sh       # Linux/macOS
```

These start only the Postgres and SuperTokens containers, then run the backend
and the Vite dev server on the host. Then open http://localhost:5173, sign up,
and create a project.

## Model weights (`data/weights/`)

The pipeline ships **no weights in git** (261 MB) — `scripts/fetch_weights.py`
vendors them into the project on first setup, so the app never depends on a
user-level `~/.cache` and can run **fully offline** (verified with
`HF_HUB_OFFLINE=1`). Air-gapped ADA deployment = copy `data/weights/` across.

| Model | Role | Size | Licence |
|---|---|---|---|
| `building-footprint-segmentation/onnx/model.onnx` | per-epoch building footprints (CPU) | 30 MB | Apache-2.0 |
| `sam2.1-hiera-small/` | full-structure refinement (GPU) | 184 MB | Apache-2.0 |
| `resnet18/resnet18-f37072fd.pth` | DCVA backbone (`MODEL_MODE=cd` path) | 47 MB | BSD-3-Clause |

Each backend calls `settings.local_model(...)` first and only falls back to the
HuggingFace/torch cache with a warning, so `stats.models_used` and the backend
name tell you which source was actually used (`…, local` vs `…, hub cache`).

`data/weights/manifest.json` pins the exact upstream commit of each model and
is the one file under `data/` kept in version control —
`THIRD_PARTY_LICENSES.md` (repo root) is regenerated from it.

```powershell
conda run -n torch python scripts\fetch_weights.py --check   # verify, no download
```

Demo data (synthetic Agra scene with 4 new buildings, different
resolutions and a deliberate 3 m georef offset between epochs):

```powershell
cd backend
conda run -n torch python scripts\make_sample_data.py   # writes data\samples\*.tif
conda run -n torch python scripts\e2e_test.py           # full API smoke test
```

## How the ML pipeline works (`backend/app/services/`)

1. **Ingest** (`preprocess.ingest_raster`) — every uploaded `.tif`
   (embedded georef or `.tfw` sidecar) becomes an 8-bit percentile-stretched
   Cloud-Optimized GeoTIFF for map display; metadata (CRS, bounds,
   resolution) goes to PostgreSQL.
2. **Superimpose** (`preprocess.superimpose`) — the T1/T2 pair is
   reprojected onto one common working grid (reference CRS, coarser of the
   two resolutions, capped at 6144 px), residual misalignment is corrected
   with sub-pixel **phase cross-correlation**, and T2 is
   **histogram-matched** to T1 so sensor/lighting differences aren't
   flagged as change. This is the cross-sensor drone↔satellite alignment
   step from the architecture doc (MVP tier).
3. **Building segmentation, per epoch** (`ml/engine.segment_scene`) — each
   epoch is cut into overlapping 256×256 chips and run through the ONNX
   U-Net building-footprint model *independently*; chip scores are stitched
   back with a Hann taper so no seams appear. Segmenting each epoch on its
   own is what makes cross-sensor comparison work: a colour cast or an
   off-nadir angle can't by itself produce a detection, because neither
   epoch's answer depends on the other.
4. **Change reasoning + confirmation gate**
   (`ml/engine.building_change_prob`) — new building = footprint in T2 AND
   not in T1 (T1 dilated by `NEW_BUILDING_DILATE_PX`). Every candidate must
   then be corroborated by independent evidence, otherwise the dominant
   false positive is "segmenter found it in T2, merely missed it in T1":
   - `SEED_MODE=encroachment` (default): the area was **vegetation** in T1
     (NDVI / excess-green) and is built in T2 → green-space encroachment,
     the ADA core case. No pixel comparison needed, so it survives hard
     cross-sensor pairs.
   - `SEED_MODE=all`: also accepts a real **colour change** at that spot.
5. **Full-structure refinement** (`ml/sam_refine.py`, `SAM_REFINE=true`) —
   seg-diff says *where*; SAM 2 (`facebook/sam2.1-hiera-small`, GPU) is
   box-prompted on the T2 crop and returns the **whole building outline**,
   so officers see complete structures rather than fragments. Falls back to
   a morphological closing if SAM 2 is unavailable.
6. **Model backends** (`ml/backends.py`) — alternate bi-temporal CD path
   (`MODEL_MODE=cd`):
   - `feature_diff`: Deep Change Vector Analysis — multi-scale ImageNet
     ResNet-18 features, per-pixel cosine distance. Zero setup, CPU.
   - `deep`: TorchScript slot for any real CD network (BIT, ChangeFormer,
     TinyCD…). Export a checkpoint taking `(t1, t2)` ImageNet-normalized
     tensors → logits to `data/weights/cd_model.pth`, set
     `MODEL_BACKEND=deep` in `.env`.
7. **Vectorize + classify** (`vectorize.py`) — threshold → sieve out
   specks smaller than `MIN_CHANGE_AREA_M2` → polygons → EPSG:4326.
   Each polygon gets: heuristic label (new construction / demolition /
   surface change from the brightness delta), geodesic area, mean-probability
   confidence — and if it intersects a red zone, `status="illegal"` plus
   the overlap percentage.
8. **Serve** — change-heat mask as colormap tiles
   (`/api/tiles/mask/{job}/{z}/{x}/{y}.png`), polygons as GeoJSON
   (`/api/analyses/{job}/features`). Hovering a polygon in the app shows
   its label, area, confidence, red-zone overlap and review state.

Every run records `stats.models_used` — the ordered list of components that
actually executed — which the dashboard shows and the exports carry.

## AI Mode vs Diff Mode

Chosen per run in the Change Analysis panel (`mode` on
`POST /api/projects/{id}/analyses`):

| Mode | Runs | Latency |
|---|---|---|
| **AI Mode** (`ai`, default) | full ensemble: segmentation → gating → SAM 2 → zone rules | minutes |
| **Diff Mode** (`diff`) | co-registration + classical colour and colour-invariant edge difference, vegetation suppressed. No neural inference | seconds |

Diff Mode is biased toward recall (triage); AI Mode toward precision
(evidence). The mode is stored on the job and printed on every export.

## Officer review + feedback loop

Each detection is adjudicated by a human before it counts:

- `PATCH /api/analyses/{job}/polygons/{id}/review` — `confirmed`,
  `rejected`, or back to `pending`; stores who and when. The review queue
  lives under each finished run in the sidebar, and the map fades rejected
  polygons and thickens confirmed ones.
- `GET /api/analyses/{job}/report.csv` — violation register for enforcement.
- `GET /api/analyses/{job}/report.geojson` — full evidence pack with run
  metadata and the model list.
- `GET /api/projects/{id}/feedback-dataset` — every confirmed/rejected
  polygon across the project as labelled GeoJSON (`training_label` 1/0).
  This is the input to the next fine-tuning cycle — the model is **never**
  retrained on its own unverified output.

## Services & ports

| Service | Where | Port |
|---|---|---|
| React app | `frontend/` (Vite dev) | 5173 |
| FastAPI + tiles | `backend/` | 8000 (docs at `/docs`) |
| PostgreSQL + PostGIS | Docker `ada-postgres` | 5433 |
| SuperTokens core | Docker `ada-supertokens` | 3567 |

All secrets and tunables live in **`.env`** (never commit it;
`.env.example` is the template). Auth cookies flow through the Vite
`/api` proxy, so the browser talks to one origin only.

## Accuracy: where this actually stands

The pipeline is complete and every stage runs end to end on real Agra
imagery. The limiter is the **weights**, not the architecture: the building
segmenter is general-purpose open weights trained on aerial imagery from
elsewhere, so on Agra's dense low-contrast rooftops it under-detects, and
because the epochs are segmented independently that inconsistency
propagates into the diff. The confirmation gate suppresses the resulting
false positives well (on the real satellite↔drone pair it cut flagged area
49,000 → 6,500 → ~600 m²) but it cannot recover a building the model never
saw.

The fix is bounded and scheduled: label a few hundred building chips on
ADA's own imagery, fine-tune the segmenter, and gate promotion on measured
F1 ≥ 0.85 against a held-out Agra test set. The officer review loop above
supplies that labelled data continuously once the system is in use.

## Roadmap beyond the POC

- Celery + Redis workers, Kafka events, Kong + Keycloak
- Deep feature matching (LoFTR/RoMa / SuperPoint+LightGlue) + IR-MAD
  radiometric normalization for the extreme drone↔satellite GSD gap
- Fine-tuned segmenter on labeled ADA data (F1 ≥ 0.85 gate)
- RT-DETR change-type labeling, PDF report generation

## Setup & troubleshooting

See **[SETUP.md](SETUP.md)** for full Windows/Linux install steps and fixes
for common setup issues (venv pointing at an uninstalled interpreter, Docker
not running, port conflicts, weight-download network issues).
