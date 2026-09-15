# ada-auth
#
# Two stages so that build tooling and compilers do not ship to production.
# Every dependency here has wheels for linux/amd64 and linux/arm64, so the
# builder normally installs without compiling anything — the build-essential line is there for the case where a
# transitive dependency has no wheel for the platform.

FROM python:3.12-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

# The apt lists are deleted in the same layer that created them. A separate
# RUN would leave them in the layer below, where deleting them frees nothing.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Dependencies resolve from pyproject alone, so this layer is cached across every
# change to application code.
COPY auth/pyproject.toml ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
 && /opt/venv/bin/pip install .


FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# Non-root. This service writes nothing to disk at all — its only state is in
# Redis — so it needs no writable path.
RUN useradd --create-home --uid 10002 ada

COPY --from=builder /opt/venv /opt/venv

WORKDIR /srv/ada-auth
COPY --chown=ada:ada auth/app ./app

USER ada

EXPOSE 8002

# No --reload and no --workers. One process per container: replicas are the
# compose file's business, and an in-process worker pool hides a crashed worker
# from the orchestrator's restart policy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--no-server-header"]
