# ADA Change Detection — FastAPI backend + ML pipeline.
#
# CPU-only image: torch/torchvision come from PyTorch's CPU wheel channel so
# the image stays a few GB instead of pulling the bundled CUDA runtime. SAM 2
# refinement detects the absence of a GPU at runtime and degrades gracefully.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libglib2.0-0 -> opencv-python-headless, libgomp1 -> torch/onnxruntime OpenMP,
# libexpat1 -> pyproj/GDAL XML parsing, curl -> container healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgomp1 \
        libexpat1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Torch first, from the CPU channel, so the requirements resolve below finds it
# already satisfied and never reaches for the default (CUDA) PyPI wheel.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --index-url "${TORCH_INDEX_URL}" torch torchvision

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# settings.data_dir resolves to <repo>/data == /app/data (config.ROOT_DIR is
# two levels up from app/config.py). Bind-mounted from the host by compose.
RUN mkdir -p /app/data

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=600s --retries=40 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
