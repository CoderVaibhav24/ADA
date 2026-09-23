"""Dump the OpenAPI documents of ada-api and ada-notify into libs/ts/api-types.

Both services name their package `app`, so each is imported in its own child
process. Dummy settings stand in for the environment; nothing connects to a
database, Keycloak or Redis at import time. Output is deterministic (sorted keys,
2-space indent, trailing newline) so the CI drift gate can diff it.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "libs" / "ts" / "api-types"

SERVICES = {
    "api": {
        "cwd": ROOT / "services" / "api",
        "out": OUT_DIR / "openapi.json",
        "env": {
            "DATABASE_URL": "sqlite://",
            "OIDC_ISSUER": "https://keycloak.invalid/realms/pcsmcpl",
            "OIDC_CLIENT_ID": "ada-web",
            "ML_SERVICE_URL": "http://ada-ml.invalid:8100",
            "ML_SERVICE_TOKEN": "openapi-dump",
            "ICMS_POLICY_WATCH": "false",
        },
    },
    "notify": {
        "cwd": ROOT / "services" / "notify",
        "out": OUT_DIR / "openapi.notify.json",
        "env": {
            "ADA_ISSUER": "https://keycloak.invalid/realms/pcsmcpl",
            "ADA_DATABASE_URL": "postgresql+asyncpg://openapi:dump@localhost.invalid:5432/notify",
        },
    },
}


def dump_one(name: str) -> None:
    """Runs inside the child: import the service's app and write its spec."""
    service = SERVICES[name]
    sys.path.insert(0, str(service["cwd"]))
    from app.main import app  # type: ignore[import-not-found]

    spec = app.openapi()
    text = json.dumps(spec, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    Path(service["out"]).write_text(text, encoding="utf-8")
    print(f"{name}: {len(spec.get('paths', {}))} paths -> {service['out'].relative_to(ROOT)}")


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--child":
        dump_one(sys.argv[2])
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, service in SERVICES.items():
        env = {**os.environ, **service["env"], "DATA_DIR": tempfile.mkdtemp(prefix="ada-openapi-")}
        # Unset so a developer's real environment cannot leak into the spec.
        env.pop("PYTHONPATH", None)
        subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--child", name],
            cwd=service["cwd"],
            env=env,
            check=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
