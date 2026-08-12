"""Existence checks for the imagery files the database points at.

Rows outlive the files they name. A raster ingested inside the container
records `/app/data/...`, which does not resolve when the same database is
served by a local run reading `./data` — and files can simply be deleted
out from under a row. Both cases used to surface as a rasterio stack trace
(a 500 with no usable message on the tile routes, a `RasterioIOError` in
the job's error column), so every read path checks here first and fails
with something an operator can act on.
"""

from __future__ import annotations

from pathlib import Path

HINT = ("It was recorded by a different deployment or has since been "
        "deleted; re-upload the imagery and re-run the analysis.")


class MissingImageryError(FileNotFoundError):
    """A path stored in the database no longer resolves to a file."""


def require_file(path: str | Path | None, what: str) -> Path:
    """Return `path` as a Path, or raise `MissingImageryError`.

    `what` names the file from the user's point of view — it is shown in
    the API response and written to the job's error column.
    """
    if not path:
        raise MissingImageryError(f"{what} has not been written yet.")
    resolved = Path(path)
    if not resolved.is_file():
        raise MissingImageryError(f"{what} is missing on disk ({resolved}). {HINT}")
    return resolved
