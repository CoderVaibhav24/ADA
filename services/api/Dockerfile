# syntax=docker/dockerfile:1.7
# ADA API service - the browser-facing half. No torch, no onnxruntime, no CUDA.
#
# Build context is the REPOSITORY ROOT (uv.lock and libs/python live there):
#   docker build -f services/api/Dockerfile -t ada/api .
#
# Dependencies come only from /uv.lock (`uv sync --frozen`); there is no pip and
# no unpinned resolve anywhere in the build. Base images are pinned by digest -
# bump them deliberately (docker buildx imagetools inspect <tag>).
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
WORKDIR /src

# Third-party dependencies first, from the manifests alone, so this layer is
# cached across every source change. uv needs every workspace member's manifest
# to read the workspace, not just this service's.
COPY pyproject.toml uv.lock ./
COPY libs/python/ada-core/pyproject.toml     libs/python/ada-core/
COPY libs/python/ada-platform/pyproject.toml libs/python/ada-platform/
COPY services/api/pyproject.toml             services/api/
COPY services/auth-otp/pyproject.toml        services/auth-otp/
COPY services/ml-worker/pyproject.toml       services/ml-worker/
COPY services/notify/pyproject.toml          services/notify/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package ada-api --no-install-workspace

# Then ada-core and ada-platform-sdk, as real (non-editable) installs so the
# runtime stage needs no copy of libs/. The service itself is not installed
# (package = false); its source is copied below.
COPY libs/python/ada-core     libs/python/ada-core
COPY libs/python/ada-platform libs/python/ada-platform
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package ada-api --no-editable

# ---------------------------------------------------------------- runtime ---
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# libexpat1: rasterio's bundled GDAL links it and slim does not ship it. pip is
# removed: nothing installs at runtime, and it is the base image's main CVE
# surface. Fixed UID/GID 10001 so host bind mounts and k8s runAsUser can name it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libexpat1 \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/bin/pip* /usr/local/lib/python3.12/site-packages/pip* \
 && groupadd --system --gid 10001 ada \
 && useradd --system --uid 10001 --gid 10001 --home-dir /home/ada --create-home \
        --shell /usr/sbin/nologin ada

COPY --from=builder /opt/venv /opt/venv

# Source stays root-owned: the process can read its code but not rewrite it.
WORKDIR /app
COPY services/api/app ./app

# /app/data is a bind mount of the host's data/ (infra/compose). The mount point
# is owned by 10001 for the no-mount case; WITH a mount the host directory's own
# ownership wins, so on a Linux host run `sudo chown -R 10001:10001 data` once.
# (Docker Desktop on macOS/Windows maps bind-mount ownership itself.) World-
# writable was rejected: it lets every local user tamper with imagery and COGs.
ENV DATA_DIR=/app/data
RUN install -d -o 10001 -g 10001 -m 0750 /app/data

USER 10001:10001

EXPOSE 8000
# Python, not curl: one less binary in the image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=10 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
