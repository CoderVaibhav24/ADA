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
`scripts/build_documentation.py` to generate a full project
write-up (`ADA_Vision_Project_Documentation.docx`, §6 has the rationale).

## Repository layout

```
apps/
  web/            React + TypeScript console (Vite), served by nginx in Docker
  field/          Expo field-survey app
  keycloak-theme/ Keycloakify login theme — a separate npm project, not a workspace
services/         every Python service, one directory each
  api/            browser-facing API (FastAPI). No models, no GPU.
  auth-otp/       phone + one-time code, exchanged for Keycloak tokens
  ml-worker/      the pipeline, the weights and the job worker. Owns the GPU.
  notify/         notification ingestion + the Redis Streams outbox worker
libs/
  python/         libraries every Python service installs from source
    ada-core/       config, models, storage — the shared domain layer
    ada-platform/   the Atrium platform client (distribution ada-platform-sdk)
  ts/shared/      @ada/shared, the TypeScript package both apps build against
scripts/          repo-wide tooling (test runner, docs build, migrations)
docs/
  guides/         run guide and setup walk-throughs
  ba/             the BA pack (BRD/PRD/FRD) as PDFs
  pdf-build/      the toolchain that renders them; build/ output is not tracked
infra/            everything needed to run the estate
  compose/
    docker-compose.yml       the whole stack
    docker-compose.gpu.yml   NVIDIA passthrough overlay
    .env / .env.example      the compose project's environment
  keycloak/                  realm export imported on Keycloak's first boot
  postgres/init/             runs once, on an empty data directory
data/             uploads, COGs, masks, weights, samples — bind-mounted, untracked
.dockerignore     the build context for every image except infra/ota is the repo root
```

Each service directory carries its own `Dockerfile`, `pyproject.toml` and
`tests/`, and the build context for all of them is the repository root — that
is what lets `api` and `ml-worker` install `libs/python/ada-core` from source.

## Stack

| Piece | Choice |
|---|---|
| API | FastAPI — `services/api`. No models, no GPU. |
| Models | FastAPI + the pipeline — `services/ml-worker` (torch 2.x+cu128, onnxruntime-gpu 1.22) |
| Auth | Keycloak 26, with `services/auth-otp` for phone + one-time code |
| Notifications | `services/notify` + `ada-worker` (Redis Streams outbox, SMTP) |
| Database | PostgreSQL 16 + PostGIS (Docker) |
| Raster processing | rasterio, rio-cogeo, scikit-image, scipy |
| Tile serving | rio-tiler dynamic XYZ endpoints (TiTiler's engine) |
| ML | ONNX Runtime (building segmenters) + PyTorch (land cover, SAM 2) — GPU via CUDA on NVIDIA, Metal/MPS + CoreML on Apple Silicon |
| Vectorization | rasterio.features + shapely → GeoJSON in PostgreSQL |
| Frontend | React + TypeScript (Vite), MapLibre GL JS |
| Jobs | in-process worker thread inside `ada-ml` (POC stand-in for Celery/Redis) |

### Why it is split

One process used to serve map tiles and run ChangeStar ViT-B inference. A tile
is a blocking GDAL read and an analysis is hundreds of 13-second tiles, so the
map stopped panning whenever an analysis ran, and the image that answered HTTP
requests carried several gigabytes of CUDA wheels it never executed.

    ada-api  ──POST /v1/analyses {job_id}──▶  ada-ml
       │                                        │
       └──────────── one PostgreSQL ────────────┘
                 (ada-ml owns the schema)

ada-api writes the row and returns; ada-ml picks it up, runs the pipeline, and
writes progress back into the same row, which the frontend polls exactly as it
did before. `ada-auth` and `ada-notify` came over from the Atrium platform —
see `services/*/README.md`.

## Quick start — Docker (whole stack, nothing else installed)

Everything runs in containers: Postgres/PostGIS, Redis, Keycloak, mailpit, the
Kong gateway, the four ADA services and the built React app behind nginx. Only
Docker with Compose v2 is required; you do not need Python, Node or a venv on
the host.

The application containers sit behind the compose profile `full`. A plain
`docker compose up -d` starts only the infrastructure (see the native quick
start below), so the whole stack needs `--profile full`. Every compose command
runs from `infra/compose/`, where the compose file and its `.env` live.

```bash
cd infra/compose
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
# Every value marked change-me is REQUIRED — compose refuses to start without
# them rather than booting with a known-weak default:
#   openssl rand -hex 32
# POSTGRES_PASSWORD, REDIS_PASSWORD, KC_BOOTSTRAP_ADMIN_PASSWORD,
# ADA_AUTH_CLIENT_SECRET, ADA_NOTIFY_CLIENT_SECRET, ADA_ML_CLIENT_SECRET,
# ADA_OTP_HMAC_KEY, ML_SERVICE_TOKEN
KONG_UPSTREAM_API=http://ada-api:8000 KONG_UPSTREAM_AUTH=http://ada-auth:8002 \
  docker compose --profile full up -d --build
```

From the repository root, `make up-full` does the same (without `--build`) and
`make down-full` stops it. The two `KONG_UPSTREAM_*` values point the gateway at
the containers instead of the host (see [infra/gateway/README.md](infra/gateway/README.md)).

The client secrets are substituted into the realm on Keycloak's FIRST start
only (`--import-realm` is IGNORE_EXISTING), so a wrong value is baked into the
database and correcting `.env` afterwards changes nothing until
`make nuke CONFIRM=yes`. Get them right before the first `up`.

Start-up order is enforced by compose: `api-migrate` runs `python -m
ada_core.migrate` once against Postgres, and ada-api and ada-ml start only after
it exits 0. ada-api no longer waits for ada-ml to be healthy.

Then open **http://localhost:5173** and press **Sign in** — Keycloak owns the
login screen. Create an account first in the Keycloak admin console at
http://localhost:8090/idp/admin (realm `pcsmcpl`), or sign in with Google/GitHub
if you filled in `ADA_GOOGLE_*` / `ADA_GITHUB_*`. API docs are at
http://localhost:8000/api/docs.

The first `up` takes a few minutes: it builds the images, downloads the 261 MB
of model weights into `data/weights/`, and generates the synthetic Agra demo
pair into `data/samples/`. Both steps are skipped on later boots. `data/` is
bind-mounted, so uploads, COGs, masks and weights survive `docker compose down`.
Set `AUTO_FETCH_WEIGHTS=false` / `AUTO_SAMPLE_DATA=false` in `.env` to skip
either step.

```bash
docker compose --profile full ps              # every service healthy; api-migrate Exited (0)
docker compose logs -f ada-ml                 # pipeline progress during a run
docker compose logs -f ada-auth               # the OTP code, when SMS is 'console'
curl http://localhost:5173/api/health         # -> {"status":"ok"}
curl -i http://localhost:8080/api/health      # the same through the Kong gateway
open http://localhost:8025                    # mailpit: every email the stack sent
docker compose --profile full down            # stop; volumes survive
```

All published ports are bound to 127.0.0.1. If one is already taken on your
machine, change `FRONTEND_PORT`, `BACKEND_PORT`, `ML_PORT`, `POSTGRES_PORT`,
`KC_HTTP_HOST_PORT`, `REDIS_HOST_PORT` or `KONG_PROXY_PORT` in `.env`. The
containers talk to each other over the compose network, so only the host-side
mapping moves. Container logs rotate at 5 × 50 MB per service.

Upgrading an existing installation: the auth swap changed what a user id looks
like, so projects created under SuperTokens belong to an id that can no longer
sign in. They are invisible, not lost — `scripts/remap_user_ids.py` matches the
accounts up by email address and rewrites them. It is read-only until `--apply`.

Demo walkthrough once you are signed in: create a project, upload
`data/samples/agra_t1_2024.tif` as T1 and `agra_t2_2026.tif` as T2, draw a red
zone over part of the scene, then run a **Diff Mode** analysis (seconds) to see
change polygons and the red-zone `illegal` classification. AI Mode is the
evidence-grade path and is meant for real imagery — on the purely synthetic
demo scene the building segmenter finds nothing to confirm, which is the
weights limitation described under *Accuracy* below, not a broken pipeline.

The container image is CPU-only, so SAM 2 refinement runs unaccelerated there
(slower, and it falls back to a morphological closing if it cannot load).

## Quick start — native (for development)

The development model is **infrastructure in Docker, services on the host**.
Full first-time setup is in **[docs/guides/run-guide.md](docs/guides/run-guide.md)**:
it covers the venv, the weights and the per-machine GPU flags. Once per
checkout: one `.venv` for every Python service and library, built by uv from the
workspace lockfile (root `pyproject.toml` / `uv.lock`; ada-ml takes its `cpu` or
`gpu` extra, and the run guide has the exact flags), then the JS workspaces:

```bash
uv sync --all-packages
npm install
cp infra/compose/.env.example infra/compose/.env    # fill in the change-me values
```

Then, from the repository root, one terminal per line:

```bash
make infra      # postgres, redis, keycloak, mailpit, kong; returns when all are healthy
make migrate    # schema to head (ada_core.migrate, advisory-locked)
make auth       # ada-auth   :8002  (reload)
make notify     # ada-notify :8001  (runs its own alembic first)
make worker     # notify delivery worker
make ml         # ada-ml     :8100  (reload)
make api        # ada-api    :8000  (reload)
make web        # Vite       :5173
make gateway-sync   # once Keycloak is up: copy its signing keys into Kong
```

`make infra` is `docker compose up -d --wait` in `infra/compose/`; with no
profile it starts only the infrastructure, so nothing fights the host processes
for ports. The service targets source `infra/compose/.env` and point every
connection string at the 127.0.0.1 ports the containers publish. Start only the
services you are working on; `make help` lists every target, and `make -n
<target>` prints the exact command without running it.

Open http://localhost:5173 and sign in, or go through the gateway on
http://localhost:8080 (it forwards to the host services via
`host.docker.internal`). `make infra-down` stops the containers; the data
volumes survive.

### Apple Silicon

The host path above is the **only** way to use the GPU on a Mac: Docker Desktop
does not pass a Mac GPU through to its Linux VM, so a containerised `ada-ml` on
macOS is CPU-only no matter what `ML_DEVICE` says. Only that one service needs
to move to the host; the rest of the stack can stay in compose. Running natively, the
pipeline reaches the Apple GPU through two different routes and needs the right
wheel for each:

```bash
pip install torch torchvision        # default PyPI wheel — carries MPS (Metal)
pip install "onnxruntime>=1.20"      # macOS arm64 wheel — carries the CoreML EP
```

Not `onnxruntime-gpu`: it is CUDA-only, has no arm64 macOS build, and there is
no Metal execution provider for ONNX Runtime at all — the Apple GPU and ANE are
reached via CoreML. A `torch` wheel from the CUDA index reports
`torch.backends.mps.is_built() == False` and lands the whole pipeline on the CPU
silently. (Watch the shell: zsh does not treat `#` as a comment by default, so a
pasted trailing comment becomes a package name and the install fails.)

Then vendor the weights — the same command also writes the **shape-frozen**
ChangeStar graph, which CoreML requires:

```bash
python services/ml-worker/scripts/fetch_weights.py   # --freeze redoes just that step
```

The export leaves height/width symbolic. CoreML resolves shapes at compile
time, so it claims 1075 of the graph's 1147 nodes and then dies at execution
inside the ViT's pad (`Invalid shape for output feature …_vit_blocks_0_Pad…`).
Baking both dims to the one tile size the backend uses (1024) fixes it.

Finally set the memory budgets, which on Apple Silicon are two shares of **one**
unified pool rather than two devices. torch reports the recommended working set
(17.8 GiB on a 24 GB M4 Pro); the two must sum under it:

```ini
ML_DEVICE=auto
GPU_MEMORY_LIMIT_GB=6.0
HOST_MEMORY_LIMIT_GB=10.0
```

Keep `RELEASE_MODELS_BETWEEN_STAGES=true` here — it is load-bearing, not a
tuning knob. torch's MPS watermark counts *every* Metal allocation the process
holds, CoreML's included, so a resident onnxruntime session (~9 GB for
ChangeStar) is subtracted from the torch budget and the next stage OOMs at its
first tensor. Releasing gives that 9 GB back.

Verify:

```bash
python services/ml-worker/scripts/gpu_smoke_test.py
```

It prints which backend bound, whether the CoreML EP actually took the graph or
handed it back to the CPU, whether the pool comes back when the session is
released, and whether every Metal kernel `ml/imageops` needs exists. The
failures this stack has are silent ones, so the smoke test is not optional.

Measured on an M4 Pro (24 GB), ChangeStar at 1024 px: **1.53 s/tile** on the CPU
EP, **0.93 s/tile** on CoreML. Real but modest — the graph splits into 29
partitions and the round trips eat most of the win, so do not expect the ~10x a
discrete card gives.

## Model weights (`data/weights/`)

The pipeline ships **no weights in git** (261 MB) — `services/ml-worker/scripts/fetch_weights.py`
vendors them into the project on first setup, so the app never depends on a
user-level `~/.cache` and can run **fully offline** (verified with
`HF_HUB_OFFLINE=1`). Air-gapped ADA deployment = copy `data/weights/` across.

| Model | Role | Size | Licence |
|---|---|---|---|
| `changestar-building-segmentation-vitb/onnx/model.onnx` | per-epoch building footprints, 1024 px (default) | 395 MB | **none declared upstream** |
| `building-footprint-segmentation/onnx/model.onnx` | per-epoch building footprints, 256 px U-Net | 30 MB | **none declared upstream** |
| `segformer-b5-loveda/` | land cover / open land (`VEGETATION_MODE=learned`) | 320 MB | **non-commercial only** (NVIDIA SegFormer §3.3 + LoveDA CC BY-NC-SA 4.0) |
| `sam2.1-hiera-large/` | full-structure refinement | 900 MB | Apache-2.0 |
| `resnet18/resnet18-f37072fd.pth` | DCVA backbone (`MODEL_MODE=cd` path) | 47 MB | BSD-3-Clause |

The licence column is the upstream reality, verified on the model cards — **not**
the `license` field in `services/ml-worker/scripts/fetch_weights.py`, which claims Apache-2.0 for
the first three and is wrong. Two of them are the pipeline defaults, so an
enterprise deployment cannot ship as configured; the full analysis, and the
per-model options (drop in, fine-tune, or retrain), are in
[`docs/ADA-Backend-Workflow-Models-Licensing.pdf`](docs/ADA-Backend-Workflow-Models-Licensing.pdf) §7.

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
cd services\ml-worker
conda run -n torch python scripts\make_sample_data.py   # writes data\samples\*.tif
cd ..\..
conda run -n torch python scripts\e2e_test.py           # full API smoke test
```

`e2e_test.py` signs in through ada-auth's phone + one-time code, which needs a
realm account carrying `ADA_E2E_PHONE` on its `phoneNumber` attribute. With
`ADA_ENV=local` the code is always `ADA_DEV_OTP`, so no SMS provider is
involved. Set `ADA_ACCESS_TOKEN` instead to use a token you already have.

## How the ML pipeline works (`services/ml-worker/app/`)

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
| React app | `apps/web/` (Vite dev) | 5173 |
| API + tiles | `services/api` | 8000 (docs at `/api/docs`) |
| Model service | `services/ml-worker` | 8100 (docs at `/docs`) |
| Notifications | `services/notify` (+ `ada-worker`) | 8001 |
| Phone + OTP sign-in | `services/auth-otp` | 8002 |
| Keycloak | Docker `ada-keycloak` | 8090 |
| PostgreSQL + PostGIS | Docker `ada-postgres` | 5433 |
| Redis | Docker `ada-redis` | 6379 |
| Mailpit (local inbox) | Docker `ada-mailpit` | 8025 |

Everything except the frontend and Keycloak binds to 127.0.0.1 — the two a
person's browser must reach are the only two published wider.

All secrets and tunables live in **`infra/compose/.env`** (never commit it;
`infra/compose/.env.example` is the template). Auth cookies flow through the Vite
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

See **[docs/guides/run-guide.md](docs/guides/run-guide.md)** for full install steps and fixes for
common setup issues (venv pointing at an uninstalled interpreter, Docker not
running, port conflicts, weight-download network issues), plus the ones the
service split and the Keycloak swap introduced: a realm that will not re-import
because `--import-realm` is IGNORE_EXISTING, a blanket 401 from a trailing
slash on the issuer, a 503 from `ML_SERVICE_TOKEN` disagreeing between
ada-api and ada-ml, and projects that vanished with their SuperTokens user id.
