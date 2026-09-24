"""Load the authority's boundary KML/KMZ into the database named by DATABASE_URL.

The same importer as POST /api/icms/admin/geo/import; see docs/icms/kml-import.md.

    DATABASE_URL=postgresql+psycopg2://... \\
        .venv/bin/python scripts/geo/import_boundaries.py agra.kml --dry-run

Exit status: 0 loaded (or validated), 1 the file was refused, 2 loaded with rejections.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "api"))

from ada_core.database import SessionLocal, configure_engine
from app.icms.boundary_import import (
    MAX_FILE_BYTES,
    KmlRejected,
    run_import,
    safe_filename,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("file", type=Path, help="a .kml or .kmz")
    parser.add_argument("--dry-run", action="store_true", help="validate and count; write nothing")
    parser.add_argument("--actor", default=f"cli:{getpass.getuser()}"[:64],
                        help="recorded as imported_by (default cli:<login>)")
    args = parser.parse_args()

    url = os.environ.get("DATABASE_URL")
    if not url:
        parser.error("DATABASE_URL is not set")
    if args.file.stat().st_size > MAX_FILE_BYTES:
        parser.error(f"{args.file} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB")

    configure_engine(url)
    db = SessionLocal()
    try:
        result = run_import(db, args.file.read_bytes(), safe_filename(args.file.name),
                            actor=args.actor, dry_run=args.dry_run)
    except KmlRejected as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()

    print(json.dumps(asdict(result), indent=2, ensure_ascii=False))
    return 2 if result.rejected else 0


if __name__ == "__main__":
    sys.exit(main())
