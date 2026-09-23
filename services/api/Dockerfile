# ADA API service — the browser-facing half.
#
# No torch, no onnxruntime, no CUDA. That is the whole reason this image exists
# separately from docker/ml.Dockerfile: the process most exposed to the network
# is also the one that has no business holding several gigabytes of model
# runtime, and an API that does not import torch cannot be made slow by one.
#
# The build context is the REPOSITORY ROOT, not the service directory, because
# this image installs libs/python/ada-core and libs/python/ada-platform from
# source.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libexpat1 -> pyproj/GDAL XML parsing, curl -> container healthcheck. No
# libglib2.0-0 and no libgomp1: this image has neither opencv nor an ML runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libexpat1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY services/api/requirements.txt ./
RUN pip install -r requirements.txt

COPY libs/python/ada-core /app/shared/ada-core
COPY libs/python/ada-platform /app/shared/ada-platform-sdk
RUN pip install /app/shared/ada-core /app/shared/ada-platform-sdk

COPY services/api/app ./app

# Read-only in practice — the tile and preview routes open COGs written by
# ada-ml — but it is the same bind mount, so the path has to agree.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=10 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
