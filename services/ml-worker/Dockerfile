# syntax=docker/dockerfile:1.7
# ADA model service - the pipeline, and the GPU.
#
# NOT BUILT OR VERIFIED. Treat this image as unbuildable until the onnxruntime
# pin is decided: the lock carries onnxruntime-gpu==1.22.0 (CUDA 12) against
# torch from the cu128 index, and that pairing is a pending business decision
# (see the `gpu` extra in services/ml-worker/pyproject.toml). The Dockerfile
# follows the same uv pattern as the other services so only the pin has to move.
#
# The NVIDIA *driver* comes from the host through the nvidia container runtime;
# CUDA runtime, cuBLAS and cuDNN arrive as nvidia-* wheels alongside torch.
#
# Build context is the REPOSITORY ROOT (uv.lock and libs/python live there):
#   docker build -f services/ml-worker/Dockerfile -t ada/ml .
# CPU-only instead (much smaller, much slower; torch from the CPU index and the
# plain onnxruntime wheel, both already in uv.lock):
#   docker build -f services/ml-worker/Dockerfile --build-arg ML_EXTRA=cpu -t ada/ml:cpu .
ARG PYTHON_IMAGE=python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.29@sha256:eb2843a1e56fd9e30c7276ce1a52cba86e64c7b385f5e3279a0e08e02dd058fc

FROM ${UV_IMAGE} AS uv

# ---------------------------------------------------------------- builder ---
FROM ${PYTHON_IMAGE} AS builder
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/usr/local/bin/python3.12 \
    UV_PROJECT_ENVIRONMENT=/opt/venv
# gpu (default) or cpu - the mutually exclusive extras of ada-ml.
ARG ML_EXTRA=gpu
WORKDIR /src

COPY pyproject.toml uv.lock ./
COPY libs/python/ada-core/pyproject.toml     libs/python/ada-core/
COPY libs/python/ada-platform/pyproject.toml libs/python/ada-platform/
COPY services/api/pyproject.toml             services/api/
COPY services/auth-otp/pyproject.toml        services/auth-otp/
COPY services/ml-worker/pyproject.toml       services/ml-worker/
COPY services/notify/pyproject.toml          services/notify/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package ada-ml --extra "${ML_EXTRA}" --no-install-workspace

COPY libs/python/ada-core     libs/python/ada-core
COPY libs/python/ada-platform libs/python/ada-platform
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package ada-ml --extra "${ML_EXTRA}" --no-editable

# ---------------------------------------------------------------- runtime ---
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# libglib2.0-0 -> opencv-python-headless, libgomp1 -> torch/onnxruntime OpenMP,
# libexpat1 -> rasterio's bundled GDAL. pip is removed: nothing installs at
# runtime. Fixed UID/GID 10001; the home directory holds the HuggingFace cache.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 libexpat1 \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/bin/pip* /usr/local/lib/python3.12/site-packages/pip* \
 && groupadd --system --gid 10001 ada \
 && useradd --system --uid 10001 --gid 10001 --home-dir /home/ada --create-home \
        --shell /usr/sbin/nologin ada

COPY --from=builder /opt/venv /opt/venv

# onnxruntime-gpu does not bundle CUDA/cuDNN; the only copies in this image are
# the nvidia-* wheels torch pulled in. Register them with the dynamic linker or
# onnxruntime silently runs on the CPU. A no-op for the cpu extra.
RUN python -c "import glob, os; \
sp = '/opt/venv/lib/python3.12/site-packages'; \
libs = sorted(glob.glob(os.path.join(sp, 'nvidia', '*', 'lib'))) + glob.glob(os.path.join(sp, 'torch', 'lib')); \
open('/etc/ld.so.conf.d/nvidia-torch.conf', 'w').write('\n'.join(libs) + '\n'); \
print('registered:', *libs, sep='\n  ')" \
 && ldconfig

# Source stays root-owned: the process can read its code but not rewrite it.
WORKDIR /app
COPY services/ml-worker/app ./app
COPY services/ml-worker/scripts ./scripts
COPY services/ml-worker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip CR before chmod: a Windows checkout with core.autocrlf=true turns the
# shebang into `/usr/bin/env sh\r`, which fails at start with `env: 'sh\r'`.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod 0755 /usr/local/bin/docker-entrypoint.sh

# /app/data is a bind mount of the host's data/ and this service WRITES to it
# (weights, samples, COGs). The mount point is owned by 10001 for the no-mount
# case; with a mount the host directory's ownership wins, so on a Linux host run
# `sudo chown -R 10001:10001 data` once (Docker Desktop maps ownership itself).
# World-writable was rejected: it lets every local user tamper with the data.
ENV DATA_DIR=/app/data
RUN install -d -o 10001 -g 10001 -m 0750 /app/data

USER 10001:10001

EXPOSE 8100
# start-period is generous: first boot downloads ~1.5 GB of model weights.
HEALTHCHECK --interval=15s --timeout=5s --start-period=900s --retries=60 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health/live', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
