# syntax=docker/dockerfile:1.7
# ada-auth - phone/email OTP as a first factor. No database; its only state is
# in Redis, so the container writes nothing to disk.
#
# Build context is the REPOSITORY ROOT (uv.lock lives there):
#   docker build -f services/auth-otp/Dockerfile -t ada/auth .
#
# Dependencies come only from /uv.lock (`uv sync --frozen`); no pip anywhere.
# Base images are pinned by digest - bump them deliberately.
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
    uv sync --frozen --no-dev --package ada-auth --no-install-workspace --no-editable

# No workspace libraries to add: this service imports neither ada_core nor
# ada_platform. The service itself is not installed (package = false); its
# source is copied into the runtime stage below.

# ---------------------------------------------------------------- runtime ---
FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# pip is removed: nothing installs at runtime, and it is the base image's main
# CVE surface. Fixed UID/GID 10001 so k8s runAsUser / runAsNonRoot can name it.
RUN rm -rf /usr/local/bin/pip* /usr/local/lib/python3.12/site-packages/pip* \
 && groupadd --system --gid 10001 ada \
 && useradd --system --uid 10001 --gid 10001 --home-dir /home/ada --create-home \
        --shell /usr/sbin/nologin ada

COPY --from=builder /opt/venv /opt/venv

# Source stays root-owned: the process can read its code but not rewrite it.
WORKDIR /app
COPY services/auth-otp/app ./app

USER 10001:10001

EXPOSE 8002
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8002/health/live', timeout=3).status == 200 else 1)"]

# No --reload and no --workers. One process per container: replicas are the
# orchestrator's business, and an in-process worker pool hides a crashed worker
# from its restart policy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--no-server-header"]
