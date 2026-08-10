# Bring up ADA Change Detection for local development (Windows).
#
# Starts PostgreSQL + SuperTokens in Docker, then the FastAPI backend and the
# Vite dev server each in their own window. Run once-only setup first — see
# SETUP.md — before using this script.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path "$root\.env")) {
    Write-Error "Missing .env — copy .env.example to .env and fill in secrets first. See SETUP.md."
    exit 1
}
if (-not (Test-Path "$root\backend\.venv\Scripts\python.exe")) {
    Write-Error "Backend venv not found at backend\.venv — see SETUP.md to create it."
    exit 1
}
if (-not (Test-Path "$root\frontend\node_modules")) {
    Write-Error "frontend\node_modules not found — run 'npm install' in frontend\ first. See SETUP.md."
    exit 1
}

Write-Host "Starting PostgreSQL + SuperTokens (Docker)..."
# Only the infrastructure services: this script runs the backend and frontend
# natively, so starting the containerised ones too would fight them for ports.
# For the fully containerised POC use `docker compose up -d` instead.
docker compose up -d postgres supertokens

Write-Host "Starting backend (FastAPI) in a new window..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location `"$root\backend`"; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000"
)

Write-Host "Starting frontend (Vite) in a new window..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location `"$root\frontend`"; npm run dev"
)

Write-Host ""
Write-Host "ADA is starting up:"
Write-Host "  Frontend : http://localhost:5173"
Write-Host "  API docs : http://localhost:8000/docs"
Write-Host "Close the two new PowerShell windows to stop backend/frontend;"
Write-Host "run 'docker compose down' to stop Postgres/SuperTokens."
