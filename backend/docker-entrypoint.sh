#!/usr/bin/env sh
# Container startup: make the POC runnable from a single `docker compose up`.
#
# Both steps below write into /app/data, which is bind-mounted from the host,
# so they run once on a fresh checkout and are skipped on every later boot.
set -e

WEIGHTS_DIR=/app/data/weights
SAMPLES_DIR=/app/data/samples

if [ "${AUTO_FETCH_WEIGHTS:-true}" = "true" ]; then
    if python scripts/fetch_weights.py --check >/dev/null 2>&1; then
        echo "[entrypoint] model weights already vendored in ${WEIGHTS_DIR}"
    else
        echo "[entrypoint] fetching model weights (~261 MB, one time)..."
        if ! python scripts/fetch_weights.py; then
            echo "[entrypoint] WARNING: weight download failed. The pipeline" \
                 "will fall back to the HuggingFace cache and needs network" \
                 "access at analysis time. Re-run later with:" \
                 "docker compose run --rm backend python scripts/fetch_weights.py"
        fi
    fi
fi

if [ "${AUTO_SAMPLE_DATA:-true}" = "true" ] && \
   [ ! -f "${SAMPLES_DIR}/agra_t1_2024.tif" ]; then
    echo "[entrypoint] generating synthetic Agra demo pair..."
    python scripts/make_sample_data.py || \
        echo "[entrypoint] WARNING: demo data generation failed (non-fatal)"
fi

exec "$@"
