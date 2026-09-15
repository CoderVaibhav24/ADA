#!/usr/bin/env sh
# Container startup: make the POC runnable from a single `docker compose up`.
#
# Both steps below write into /app/data, which is bind-mounted from the host,
# so they run once on a fresh checkout and are skipped on every later boot.
set -e

WEIGHTS_DIR=/app/data/weights
SAMPLES_DIR=/app/data/samples

# Report the compute placement up front. A CPU fallback inside a container is
# otherwise invisible: nothing errors, analyses just take minutes per tile and
# saturate the host's cores. If this prints CPU when you expected CUDA, the
# usual cause is a missing `--gpus`/deploy.devices reservation or an
# onnxruntime-gpu build that does not match torch's CUDA major version.
python - <<'PY' || true
import torch
try:
    import onnxruntime as ort
    ep = ort.get_available_providers()
except Exception as e:                      # noqa: BLE001
    ep = [f"<onnxruntime import failed: {e}>"]
print(f"[entrypoint] torch CUDA: {torch.cuda.is_available()}"
      f" ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no device'})")
print(f"[entrypoint] onnxruntime providers: {ep}")
if not torch.cuda.is_available() or "CUDAExecutionProvider" not in ep:
    print("[entrypoint] WARNING: running WITHOUT full GPU acceleration — the "
          "ChangeStar ViT-B costs ~13 s per tile on CPU. Set REQUIRE_GPU=true "
          "to make this a hard failure instead of a slow run.")
PY

if [ "${AUTO_FETCH_WEIGHTS:-true}" = "true" ]; then
    if python scripts/fetch_weights.py --check >/dev/null 2>&1; then
        echo "[entrypoint] model weights already vendored in ${WEIGHTS_DIR}"
    else
        echo "[entrypoint] fetching model weights (~1.5 GB, one time)..."
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
