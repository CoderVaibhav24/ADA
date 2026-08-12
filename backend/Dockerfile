# ADA Change Detection — FastAPI backend + ML pipeline.
#
# GPU image. The seg-diff pipeline runs three networks per analysis — ChangeStar
# ViT-B (1024 px tiles), SegFormer-B5 land cover, and SAM for refinement — and
# on CPU the ChangeStar tiles alone cost ~13 s each with every core saturated.
# That is minutes of full-load CPU per analysis, so the GPU is not an
# optimisation here; it is the difference between usable and not.
#
# The NVIDIA *driver* comes from the host through the nvidia container runtime;
# everything above it (CUDA runtime, cuBLAS, cuDNN) arrives as pip wheels
# alongside torch. That keeps this on the same python:3.13 base as before and
# keeps the CUDA versions consistent by construction.
#
# Build CPU-only instead (much smaller, much slower):
#   docker compose build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu \
#                        --build-arg ONNXRUNTIME_PKG=onnxruntime
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

# Torch first so the requirements resolve below finds it already satisfied.
# cu128 pulls the CUDA 12.8 runtime + cuDNN 9 as nvidia-* wheels.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
RUN pip install --index-url "${TORCH_INDEX_URL}" torch torchvision

# MUST match the CUDA major version torch was built against — see the long note
# in requirements.txt. 1.22.x is the CUDA 12 line; 1.28+ requires CUDA 13.
ARG ONNXRUNTIME_PKG=onnxruntime-gpu==1.22.0
RUN pip install "${ONNXRUNTIME_PKG}"

COPY requirements.txt ./
RUN pip install -r requirements.txt

# onnxruntime-gpu does not bundle CUDA/cuDNN; the only copies in this image are
# the nvidia-* wheels torch pulled in. Register them with the dynamic linker so
# onnxruntime can actually load CUDAExecutionProvider. Without this it silently
# runs on the CPU — the exact failure this image exists to avoid.
RUN python -c "import site, glob, os; \
libs = sorted(glob.glob(os.path.join(site.getsitepackages()[0], 'nvidia', '*', 'lib'))) \
     + glob.glob(os.path.join(site.getsitepackages()[0], 'torch', 'lib')); \
open('/etc/ld.so.conf.d/nvidia-torch.conf', 'w').write('\n'.join(libs) + '\n'); \
print('registered:', *libs, sep='\n  ')" \
    && ldconfig

COPY app ./app
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip CR before chmod. This repo is developed on Windows with
# core.autocrlf=true, so a checkout rewrites the script to CRLF and the shebang
# becomes `/usr/bin/env sh\r`, which fails at container start with the unhelpful
#   env: 'sh\r': No such file or directory
# .gitattributes pins eol=lf for tracked clones; this covers everyone else.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# settings.data_dir resolves to <repo>/data == /app/data (config.ROOT_DIR is
# two levels up from app/config.py). Bind-mounted from the host by compose.
RUN mkdir -p /app/data

EXPOSE 8000
# start-period is generous: first boot downloads ~1.5 GB of model weights
# (ChangeStar 395 MB, SegFormer-B5 339 MB, SAM 2.1 large ~900 MB).
HEALTHCHECK --interval=15s --timeout=5s --start-period=900s --retries=60 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
