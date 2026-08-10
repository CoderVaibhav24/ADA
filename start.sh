#!/usr/bin/env bash
# Bring up ADA Change Detection for local development (Linux/macOS).
#
# Starts PostgreSQL + SuperTokens in Docker, then the FastAPI backend and the
# Vite dev server as background jobs in this terminal. Run once-only setup
# first — see SETUP.md — before using this script.

set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"

if [ ! -f "$root/.env" ]; then
    echo "Missing .env — copy .env.example to .env and fill in secrets first. See SETUP.md." >&2
    exit 1
fi
if [ ! -f "$root/backend/.venv/bin/python" ]; then
    echo "Backend venv not found at backend/.venv — see SETUP.md to create it." >&2
    exit 1
fi
if [ ! -d "$root/frontend/node_modules" ]; then
    echo "frontend/node_modules not found — run 'npm install' in frontend/ first. See SETUP.md." >&2
    exit 1
fi

echo "Starting PostgreSQL + SuperTokens (Docker)..."
docker compose up -d

cleanup() {
    echo ""
    echo "Stopping backend/frontend..."
    kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend (FastAPI)..."
(cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000) &
backend_pid=$!

echo "Starting frontend (Vite)..."
(cd frontend && npm run dev) &
frontend_pid=$!

echo ""
echo "ADA is starting up:"
echo "  Frontend : http://localhost:5173"
echo "  API docs : http://localhost:8000/docs"
echo "Press Ctrl+C to stop backend/frontend;"
echo "run 'docker compose down' to stop Postgres/SuperTokens."

wait "$backend_pid" "$frontend_pid"
