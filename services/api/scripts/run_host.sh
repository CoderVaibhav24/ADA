#!/usr/bin/env bash
# Run ada-api natively, against the compose infrastructure.
#
# Companion to services/ml-worker/scripts/run_host_mps.sh. Nothing forces ada-api onto
# the host — it has no GPU work — but once ada-ml is native, running the API
# here too keeps one absolute path in the database and one reload loop for the
# code you are actually editing.
#
# Stop the container first, or the two fight over BACKEND_PORT:
#   docker compose -p ada stop ada-api
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

set -a
# shellcheck disable=SC1091
source "$ROOT/infra/compose/.env"
set +a

# Every compose hostname is a container-network name that does not resolve out
# here. DATA_DIR must match what ada-ml uses: ada-api writes an upload and
# records its ABSOLUTE path, ada-ml then opens that exact string.
export DATABASE_URL="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
export DATA_DIR="${ADA_DATA_PATH:-$ROOT/data}"
export ML_SERVICE_URL="http://127.0.0.1:${ML_PORT:-8100}"
# OIDC_ISSUER is the PUBLIC issuer, compared against the 'iss' claim character
# for character, so it stays whatever the realm stamps. Only the address this
# process fetches the JWKS from moves to a host port.
export OIDC_INTERNAL_ISSUER_URL="http://127.0.0.1:${KC_HTTP_HOST_PORT:-8091}${KC_HTTP_RELATIVE_PATH:-/idp}/realms/${ADA_REALM:-pcsmcpl}"
export OIDC_ISSUER="${ADA_ISSUER:?set ADA_ISSUER in infra/compose/.env}"
export WEBSITE_ORIGIN="${APP_ORIGIN:-http://localhost:5173}"

cd "$ROOT/services/api"
exec "$ROOT/.venv/bin/python" -m uvicorn app.main:app \
    --host "${API_HOST:-127.0.0.1}" --port "${BACKEND_PORT:-8010}" "$@"
