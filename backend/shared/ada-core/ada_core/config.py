"""Settings every ADA service needs: the database, and where the data lives.

Each service subclasses `CoreSettings` and adds its own fields. That keeps one
definition of DATABASE_URL and DATA_DIR — the two settings a misconfiguration of
which makes every service wrong in the same way — while letting the ML service
carry its fifty model tunables without the API process having to know them.

Environment names are unprefixed (DATABASE_URL, DATA_DIR) because that is what
this repository's .env and every existing document already use. The vendored
auth and notification services keep their own ADA_AUTH_ / ADA_NOTIFY_ prefixes:
they hold a different database and a different issuer, and a shared name would
be a shared mistake.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def repo_root() -> Path:
    """The repository root, found by walking up for infra/docker-compose.yml.

    This used to be `parents[2]` from a single backend/app/config.py. With the
    code split across backend/api, backend/ml and backend/shared/ada-core,
    the number of levels differs per caller, so the root is located by a marker
    rather than counted. The marker is the compose file in infra/ — inside a
    container the tree is flattened to /app and no marker exists, which is why
    the fallback is the current directory.
    """
    here = Path(__file__).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "infra" / "docker-compose.yml").is_file():
            return candidate
    return Path.cwd()


ROOT_DIR = repo_root()


class CoreSettings(BaseSettings):
    # Two candidates, in load order: the compose project's env file is the
    # real one (infra/.env, beside the compose file that reads it), and a root
    # .env is still honoured for a checkout that predates the move. Later
    # entries win, so infra/.env overrides.
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", ROOT_DIR / "infra" / ".env"),
        extra="ignore",
    )

    # Database. No default: a service that silently connects to localhost is
    # worse than one that refuses to start.
    database_url: str

    # Uploads, COGs, masks and vendored weights. Bind-mounted into every
    # container that touches imagery, so ada-api and ada-ml see the same paths.
    data_dir: Path = ROOT_DIR / "data"

    # Share of the host budget handed to GDAL's block cache. Every block held
    # here is a block not re-read from disk during warping and COG building.
    # Read by both services: ada-api's tile routes go through GDAL too.
    host_memory_limit_gb: float = 18.0
    gdal_cache_fraction: float = 0.15

    # Per-pixel probability at or above which a pixel counts as changed.
    #
    # Shared, and one of the very few ML numbers that has to be: ada-ml writes
    # the probability raster against this cut, and ada-api's mask colormap
    # renders everything below it fully transparent (routers/tiles.py). Two
    # copies that drift would paint change the pipeline had already rejected,
    # or hide change it reported — and the map is what an officer acts on.
    change_threshold: float = 0.5

    @property
    def host_memory_limit_bytes(self) -> int:
        return int(self.host_memory_limit_gb * (1 << 30))

    @property
    def gdal_cache_mb(self) -> int:
        """GDAL block cache, in MB, as a share of the host budget."""
        return max(64, int(self.host_memory_limit_gb * self.gdal_cache_fraction * 1024))

    @property
    def weights_dir(self) -> Path:
        """Vendored model weights (populated by ada-ml's fetch_weights.py)."""
        return self.data_dir / "weights"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def cogs_dir(self) -> Path:
        return self.data_dir / "cogs"

    @property
    def masks_dir(self) -> Path:
        return self.data_dir / "masks"

    def local_model(self, relative: str) -> Path | None:
        """Return the vendored copy of a model if it has been fetched.

        Every backend calls this before reaching for the HuggingFace/torch
        cache, so a machine with `data/weights/` populated runs fully offline
        and always on the exact revision recorded in manifest.json.
        """
        path = self.weights_dir / relative
        if path.is_file():
            return path
        # a model directory counts as present only if it actually has content
        if path.is_dir() and any(path.iterdir()):
            return path
        return None

    def prepare_runtime(self) -> None:
        """Create the data directories and set the GDAL environment.

        GDAL reads GDAL_CACHEMAX once, when it first needs the block cache —
        which happens inside the first warp, long after any import we control.
        Setting it as early as the settings object exists is what makes it
        stick; the heavy functions also pass it explicitly via rasterio.Env so
        a differently-ordered import cannot silently leave the cache at GDAL's
        5% default.
        """
        for directory in (self.uploads_dir, self.cogs_dir, self.masks_dir):
            directory.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("GDAL_CACHEMAX", str(self.gdal_cache_mb))
        # Overviews and COG building are the two places GDAL will happily
        # re-read the same blocks; letting it use every core shortens that.
        os.environ.setdefault("GDAL_NUM_THREADS", "ALL_CPUS")
