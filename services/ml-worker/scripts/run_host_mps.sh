#!/usr/bin/env bash
# Run ada-ml natively on macOS so the pipeline reaches the Apple GPU.
#
# Docker Desktop passes no Metal device into its Linux VM, so the containerised
# ada-ml is CPU-only whatever ML_DEVICE says. This runs the same service from
# the host venv, against the compose Postgres, with the container's ada-ml
# stopped (it owns port 8100 otherwise).
#
# Stop the container first:
#   docker compose -p ada stop ada-ml
# and point the API at the host: ML_SERVICE_URL=http://host.docker.internal:8100
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

set -a
# shellcheck disable=SC1091
source "$ROOT/infra/compose/.env"
set +a

# Overrides for a host process: every compose hostname is a container-network
# name that does not resolve out here, and DATA_DIR must be the real path
# because it is what gets written into rasters.cog_path.
export DATABASE_URL="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
export DATA_DIR="$ROOT/data"
export NOTIFY_URL="http://127.0.0.1:${NOTIFY_PORT:-8011}"
export NOTIFY_ISSUER="http://127.0.0.1:${KC_HTTP_HOST_PORT:-8091}${KC_HTTP_RELATIVE_PATH:-/idp}/realms/${ADA_REALM:-pcsmcpl}"

# The point of running here at all. REQUIRE_GPU turns a silent CPU fallback
# into a startup error — in a long analysis the only other symptom is "slow".
export ML_DEVICE="${ML_DEVICE_HOST:-mps}"
export REQUIRE_GPU="${REQUIRE_GPU_HOST:-true}"
# Two shares of ONE unified memory pool, so they must sum under torch's
# recommended working set — see README, Apple Silicon.
export GPU_MEMORY_LIMIT_GB="${GPU_MEMORY_LIMIT_GB:-6.0}"
export HOST_MEMORY_LIMIT_GB="${HOST_MEMORY_LIMIT_GB:-10.0}"
# No --reload here, but a restart still must not resurrect interrupted work.
export REQUEUE_STALE_ON_STARTUP=false

cd "$ROOT/services/ml-worker"
# 0.0.0.0, not the uvicorn default of 127.0.0.1: the caller is ada-api inside
# compose, reaching this process through host.docker.internal, and a loopback
# bind is invisible from there. ML_SERVICE_TOKEN guards the port — the service
# warns at startup when it is unset, and .env sets it.
exec "$ROOT/.venv/bin/python" -m uvicorn app.main:app \
    --host "${ML_HOST:-0.0.0.0}" --port "${ML_PORT:-8100}"
