# Setup guide — Windows & Linux

Step-by-step environment setup for ADA Change Detection. Read `README.md`
first for what the app does; this file is only about getting it running.

macOS follows the Linux instructions (Docker Desktop + Homebrew instead of a
package manager) — the commands are the same.

> **Just want to run it?** Skip this file. `cp .env.example .env` then
> `docker compose up -d --build` brings up the entire stack — database, auth,
> backend and frontend — with no Python or Node installed on the host. See
> *Quick start — Docker* in `README.md`. Everything below is for developing
> against the code with hot reload.

## Prerequisites

| Tool | Version | Windows | Linux |
|---|---|---|---|
| Git | any recent | [git-scm.com](https://git-scm.com/download/win) | `sudo apt install git` (or your distro's package manager) |
| Python | 3.13.x | [python.org](https://www.python.org/downloads/) or `uv python install 3.13` | your distro's package or `uv python install 3.13` |
| Node.js | 20 LTS or newer (tested with 24) | [nodejs.org](https://nodejs.org/) | [nodejs.org](https://nodejs.org/) or `nvm install 22` |
| Docker | with Compose v2 | [Docker Desktop](https://www.docker.com/products/docker-desktop/) | [Docker Engine](https://docs.docker.com/engine/install/) + [Compose plugin](https://docs.docker.com/compose/install/linux/) |
| uv (recommended) | any recent | `winget install astral-sh.uv` or [docs](https://docs.astral.sh/uv/getting-started/installation/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

`uv` is a fast drop-in for `venv`/`pip`; every command below has a plain
`venv`/`pip` fallback if you'd rather not install it.

GPU (optional): SAM 2 full-structure refinement uses CUDA if a compatible
NVIDIA GPU + driver are present, and otherwise falls back automatically to a
morphological-closing step — no GPU is required to run the app.

## 1. Clone

```bash
git clone https://github.com/CoderVaibhav24/ADA.git
cd ADA
```

## 2. Configure secrets

```bash
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Edit `.env` and set real values for `POSTGRES_PASSWORD` and
`SUPERTOKENS_API_KEY` (anything non-trivial works for local dev — these guard
your local Postgres/SuperTokens containers, not a production service). Leave
`DATA_DIR` / `MODEL_WEIGHTS` commented out unless you want data stored outside
the repo — they default to `<repo>/data`. **Never commit `.env`** (it's
already in `.gitignore`).

## 3. Start Postgres + SuperTokens

From the repo root, with Docker running:

```bash
docker compose up -d
```

This starts `ada-postgres` (PostGIS, port 5433) and `ada-supertokens` (port
3567). The backend creates its own tables on first start — no separate
migration step. Check both are healthy:

```bash
docker compose ps
```

## 4. Backend: virtual environment + dependencies

**Windows (PowerShell)**

```powershell
cd backend
uv venv --python 3.13 .venv
.\.venv\Scripts\Activate.ps1
uv pip install -r requirements.txt
cd ..
```

Without `uv`:

```powershell
cd backend
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

**Linux / macOS (bash)**

```bash
cd backend
uv venv --python 3.13 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
cd ..
```

Without `uv`:

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

All of `rasterio`, `psycopg2-binary`, `opencv-python-headless` and
`torch`/`torchvision` install from prebuilt wheels on both platforms — no
system GDAL/PostgreSQL dev headers needed in the common case. If a wheel
isn't available for your architecture, install build tooling and retry:
`sudo apt install build-essential libpq-dev libgdal-dev` (Debian/Ubuntu).

## 5. Download model weights (~261 MB)

The app ships **no weights in git**; this vendors them into `data/weights/`
so the app runs fully offline afterwards (see README § Model weights for what
each one does).

```powershell
# Windows, from repo root
cd backend
.\.venv\Scripts\python.exe scripts\fetch_weights.py
cd ..
```

```bash
# Linux/macOS, from repo root
cd backend
.venv/bin/python scripts/fetch_weights.py
cd ..
```

This needs network access to HuggingFace + `download.pytorch.org` once. It
writes `data/weights/manifest.json` (pinning the exact commit fetched) and
regenerates `THIRD_PARTY_LICENSES.md`. Verify anytime without re-downloading:

```powershell
.\.venv\Scripts\python.exe scripts\fetch_weights.py --check
```

Air-gapped deployment: copy the whole `data/weights/` directory to the target
machine — nothing else is required at runtime.

## 6. Frontend: install dependencies

```bash
cd frontend
npm install
cd ..
```

## 7. Run everything

Convenience scripts do steps below for you, once setup is complete:

```powershell
.\start.ps1      # Windows — opens two new PowerShell windows
```

```bash
./start.sh       # Linux/macOS — runs backend + frontend as background jobs
```

Or run each piece manually in its own terminal:

```powershell
# Terminal 1 — backend (Windows)
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 1 — backend (Linux/macOS)
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 2 — frontend (both platforms)
cd frontend
npm run dev
```

Open **http://localhost:5173**, sign up (any email/password — it's local
SuperTokens), and create a project.

## 8. Verify it works

```bash
curl http://localhost:8000/api/health   # -> {"status":"ok"}
```

Optional: generate a synthetic Agra demo pair and run the full API smoke test
(needs the backend + Docker services already running):

```powershell
cd backend
.\.venv\Scripts\python scripts\make_sample_data.py   # writes data\samples\*.tif
.\.venv\Scripts\python scripts\e2e_test.py            # signs up, uploads, runs an analysis
```

```bash
cd backend
.venv/bin/python scripts/make_sample_data.py
.venv/bin/python scripts/e2e_test.py
```

## 9. Stopping

- `start.ps1` windows: just close them. `start.sh`: `Ctrl+C`.
- Docker services: `docker compose down` (add `-v` to also wipe the Postgres
  volume, i.e. delete all project data).

## Troubleshooting

**Windows — `did not find executable at '...\anaconda3\python.exe'`** — the
venv was created by an interpreter that's since been uninstalled. Repoint it:

```powershell
uv python install 3.13
$base = "$env:APPDATA\uv\python\cpython-3.13.14-windows-x86_64-none"
# rewrite backend\.venv\pyvenv.cfg: home / executable / command -> $base
Copy-Item "$base\python.exe","$base\pythonw.exe","$base\python313.dll",`
          "$base\python3.dll","$base\vcruntime140*.dll" backend\.venv\Scripts\
```

`python3.dll` matters: stable-ABI extensions (`cryptography`, `cv2`) link
against it, and without it they fail with "DLL load failed".

**"Could not connect to PostgreSQL" on backend startup** — Docker services
aren't up yet, or `.env` doesn't match `docker-compose.yml`'s
`POSTGRES_*`/`POSTGRES_PORT` values. Run `docker compose ps` and
`docker compose logs postgres`.

**Port already in use (5173 / 8000 / 5433 / 3567)** — another process is
bound to it. Windows: `Get-NetTCPConnection -LocalPort 8000`. Linux:
`lsof -i :8000`. Stop the conflicting process or change the port in `.env`
and `docker-compose.yml`.

**`fetch_weights.py` hangs or fails** — it needs outbound HTTPS to
`huggingface.co` and `download.pytorch.org`; check a proxy/firewall isn't
blocking those, then re-run (it skips files already downloaded).

**Docker Desktop not running (Windows)** — `docker compose up -d` fails
immediately with a pipe/connection error if the Docker Desktop app itself
isn't started. Launch it from the Start menu and wait for it to report
"running" before retrying.
