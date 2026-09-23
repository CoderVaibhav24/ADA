#!/usr/bin/env bash
# Every Python suite in the repository, one component at a time.
#
# One pytest run over the whole tree is not possible and will not become
# possible: ada-api, ada-ml, ada-auth and ada-notify each have a top-level
# package called `app`, so a single session imports whichever it reaches first
# and every other suite then tests the wrong service. Running them separately
# is the fix, not a workaround — it is also what keeps each service's
# dependencies its own.
#
#   ./scripts/run_tests.sh              every suite that needs no running stack
#   ./scripts/run_tests.sh --integration  also the ones that need docker compose up
#
# PYTEST override, for a different interpreter:
#   PYTEST="/path/to/python -m pytest" ./scripts/run_tests.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTEST="${PYTEST:-$ROOT/.venv/bin/python -m pytest}"
INTEGRATION=0
[ "${1:-}" = "--integration" ] && INTEGRATION=1

failed=0
declare -a SUMMARY=()

run() {
    local label="$1" directory="$2"
    shift 2
    printf '\n\033[1m=== %s ===\033[0m\n' "$label"
    if ( cd "$directory" && PYTHONPATH="$PWD" $PYTEST "$@" -q -p no:cacheprovider ); then
        SUMMARY+=("  PASS  $label")
    else
        SUMMARY+=("  FAIL  $label")
        failed=1
    fi
}

run "ada-core"          libs/python/ada-core
run "ada-platform-sdk"  libs/python/ada-platform
run "ada-api"           services/api
run "ada-ml"            services/ml-worker
run "ada-auth"          services/auth-otp

# ada-notify's suite is split by what it needs. The unit tests run anywhere;
# the rest are integration tests against a live stack by design — "a real
# machine token is accepted", "project A cannot read project B" are properties
# of the running system, and mocking them would prove none of it.
run "ada-notify (unit)" services/notify tests/test_pipeline_units.py tests/test_import_graph.py

if [ "$INTEGRATION" = "1" ]; then
    run "ada-notify (integration)" services/notify \
        tests/test_ingestion.py tests/test_tenancy.py tests/test_delivery.py
else
    SUMMARY+=("  SKIP  ada-notify (integration) — needs the stack; pass --integration")
fi

printf '\n\033[1m=== summary ===\033[0m\n'
printf '%s\n' "${SUMMARY[@]}"
exit "$failed"
