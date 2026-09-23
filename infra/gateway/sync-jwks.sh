#!/usr/bin/env bash
# Copy Keycloak's RS256 signing keys into kong.yml as jwt_secrets, one per kid.
#
#   infra/gateway/sync-jwks.sh              # rewrite kong.yml
#   infra/gateway/sync-jwks.sh --restart    # ...and restart the kong container
#
# The JWKS is read from, in order: $JWKS_URL; ${ADA_ISSUER}/protocol/openid-connect/certs;
# then Keycloak directly on 127.0.0.1:${KC_HTTP_HOST_PORT:-8090}. ADA_ISSUER and the
# port come from the environment or infra/compose/.env. Idempotent: only the block
# between the BEGIN/END jwt_secrets markers is replaced.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/infra/compose/.env}"
KONG_YML="${KONG_YML:-$HERE/kong.yml}"
PY="${PY:-$ROOT/.venv/bin/python}"
[ -x "$PY" ] || PY="$(command -v python3)"

exec_restart=0
[ "${1:-}" = "--restart" ] && exec_restart=1

ENV_FILE="$ENV_FILE" KONG_YML="$KONG_YML" "$PY" - <<'PY'
import base64, json, os, re, sys, urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers


def env_file_value(name):
    path = Path(os.environ["ENV_FILE"])
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(rf"\s*{name}\s*=\s*(.*)$", line)
        if m:
            return m.group(1).strip().strip("'\"") or None
    return None


def setting(name, default=None):
    return os.environ.get(name) or env_file_value(name) or default


issuer = setting("ADA_ISSUER")
port = setting("KC_HTTP_HOST_PORT", "8090")
realm = setting("ADA_REALM", "pcsmcpl")
candidates = [os.environ.get("JWKS_URL")]
if issuer:
    candidates.append(issuer.rstrip("/") + "/protocol/openid-connect/certs")
candidates.append(f"http://127.0.0.1:{port}/idp/realms/{realm}/protocol/openid-connect/certs")

jwks, errors = None, []
for url in filter(None, candidates):
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            jwks = json.load(resp)
        print(f"[sync-jwks] fetched {url}")
        break
    except Exception as exc:  # noqa: BLE001 - try the next source
        errors.append(f"{url}: {exc}")
if jwks is None:
    sys.exit("[sync-jwks] could not fetch a JWKS:\n  " + "\n  ".join(errors))


def b64int(value):
    return int.from_bytes(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)), "big")


secrets = []
for jwk in jwks.get("keys", []):
    if jwk.get("kty") != "RSA" or jwk.get("use", "sig") != "sig" or jwk.get("alg", "RS256") != "RS256":
        continue
    pem = RSAPublicNumbers(b64int(jwk["e"]), b64int(jwk["n"])).public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    secrets.append((jwk["kid"], pem))
if not secrets:
    sys.exit("[sync-jwks] the JWKS has no RS256 signing key; refusing to empty kong.yml")

lines = ["    jwt_secrets:"]
for kid, pem in sorted(secrets):
    lines += [f"      - key: {json.dumps(kid)}", "        algorithm: RS256", "        rsa_public_key: |"]
    lines += [f"          {row}" for row in pem.strip().splitlines()]
block = "\n".join(lines)

path = Path(os.environ["KONG_YML"])
text = path.read_text(encoding="utf-8")
pattern = re.compile(r"(    # BEGIN jwt_secrets[^\n]*\n).*?(\n    # END jwt_secrets)", re.S)
if not pattern.search(text):
    sys.exit(f"[sync-jwks] no BEGIN/END jwt_secrets markers in {path}")
new = pattern.sub(lambda m: m.group(1) + block + m.group(2), text)
if new == text:
    print(f"[sync-jwks] {path} already current ({len(secrets)} key(s))")
else:
    path.write_text(new, encoding="utf-8")
    print(f"[sync-jwks] wrote {len(secrets)} key(s) to {path}: " + ", ".join(k for k, _ in sorted(secrets)))
PY

if [ "$exec_restart" = 1 ]; then
  docker compose -f "$ROOT/infra/compose/docker-compose.yml" restart kong
else
  echo "[sync-jwks] Kong reads kong.yml only at start: docker compose restart kong (or rerun with --restart)"
fi
