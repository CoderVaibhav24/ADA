"""Shared foundation for the ADA services.

`ada-api` and `ada-ml` are separate processes against ONE PostgreSQL database:
the API owns the request path and writes the row that represents a piece of
work, the ML service picks that row up and writes progress back into it. Two
copies of the table definitions would drift the first time a column was added
on one side only, and the symptom would be a worker writing to a column the API
does not know about. So the mapped classes, the engine that talks to them and
the additive migrations live here, once, and both services install this package.

Nothing in here imports FastAPI, torch or rasterio. It is the intersection of
what the services share, not a place to put code that has nowhere else to go.
"""

import os

# Before anything imports rasterio or pyproj.
#
# A PROJ_LIB or PROJ_DATA left in the environment by a system GDAL points the
# wheel-bundled PROJ at a foreign proj.db, and the failure is not an import
# error — it is a transform that silently produces wrong coordinates, or a
# "Cannot find proj.db" raised in the middle of a warp. Every ADA process
# imports this package before it imports anything geospatial, which makes here
# the earliest point that is guaranteed to run in all of them.
for _key in [k for k in os.environ if k.startswith("PROJ_")]:
    del os.environ[_key]

from .config import ROOT_DIR, CoreSettings  # noqa: E402 - must follow the purge above

__all__ = ["ROOT_DIR", "CoreSettings"]
