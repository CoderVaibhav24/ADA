#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import secrets
import ssl
import string
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
INFRA = HERE.parent
REPO = INFRA.parent

KNOWN_ROLES = ("super-admin", "pcs-nodal-officer", "field-surveyor", "ada-project-lead")

TIMEOUT = 20

_SPECIALS = "!@#$%^&*()-_=+[]{}:,.?"
_LOWER, _UPPER, _DIGITS = string.ascii_lowercase, string.ascii_uppercase, string.digits
_ALPHABET = _LOWER + _UPPER + _DIGITS + _SPECIALS

SECRET_LENGTH = 20


def generate_secret(length: int = SECRET_LENGTH) -> str:
    if length < 12:
        raise ValueError("realm policy requires at least 12 characters")
    chars = [
        secrets.choice(_LOWER),
        secrets.choice(_UPPER),
        secrets.choice(_DIGITS),
        secrets.choice(_SPECIALS),
    ]
    chars += [secrets.choice(_ALPHABET) for _ in range(length - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def _scalar(tok: str) -> Any:
    tok = tok.strip()
    if len(tok) >= 2 and tok[0] == tok[-1] and tok[0] in "\"'":
        return tok[1:-1]
    if tok in ("true", "True", "yes"):
        return True
    if tok in ("false", "False", "no"):
        return False
    if tok in ("null", "~", ""):
        return None
    if tok.startswith("[") and tok.endswith("]"):
        inner = tok[1:-1].strip()
        return [_scalar(p) for p in inner.split(",")] if inner else []
    return tok


def parse_yaml_subset(text: str) -> Any:
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        body = raw.split(" #")[0].rstrip() if " #" in raw else raw.rstrip()
        if not body.strip():
            continue
        lines.append((len(body) - len(body.lstrip()), body.strip()))

    if not lines:
        return None

    def read_map_entry(idx: int, indent: int, into: dict[str, Any]) -> int:
        key, _, inline = lines[idx][1].partition(":")
        if inline.strip():
            into[key.strip()] = _scalar(inline)
            return idx + 1
        idx += 1
        if idx < len(lines) and lines[idx][0] > indent:
            sub, idx = block(idx, lines[idx][0])
            into[key.strip()] = sub
        else:
            into[key.strip()] = None
        return idx

    def block(idx: int, indent: int) -> tuple[Any, int]:
        if idx >= len(lines):
            return None, idx

        if lines[idx][1].startswith("- "):
            items: list[Any] = []
            while idx < len(lines) and lines[idx][0] == indent and lines[idx][1].startswith("- "):
                first = lines[idx][1][2:].strip()
                if ":" in first and first[0] not in "\"'":
                    item: dict[str, Any] = {}
                    child_indent = lines[idx][0] + 2
                    key, _, inline = first.partition(":")
                    if inline.strip():
                        item[key.strip()] = _scalar(inline)
                        idx += 1
                    else:
                        idx += 1
                        if idx < len(lines) and lines[idx][0] >= child_indent:
                            sub, idx = block(idx, lines[idx][0])
                            item[key.strip()] = sub
                        else:
                            item[key.strip()] = None
                    while (idx < len(lines) and lines[idx][0] == child_indent
                           and not lines[idx][1].startswith("- ")):
                        idx = read_map_entry(idx, child_indent, item)
                    items.append(item)
                else:
                    items.append(_scalar(first))
                    idx += 1
            return items, idx

        mapping: dict[str, Any] = {}
        while idx < len(lines) and lines[idx][0] == indent and not lines[idx][1].startswith("- "):
            idx = read_map_entry(idx, indent, mapping)
        return mapping, idx

    value, _ = block(0, lines[0][0])
    return value


def load_users_file(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
    else:
        try:
            import yaml  # type: ignore
            data = yaml.safe_load(text)
        except ImportError:
            data = parse_yaml_subset(text)
    if isinstance(data, dict):
        data = data.get("users", [])
    if not isinstance(data, list):
        raise SystemExit(f"{path}: expected a list of users, or a mapping with a 'users:' key")
    return [u for u in data if isinstance(u, dict)]


class KeycloakError(RuntimeError):
    pass


class Admin:
    def __init__(self, base: str, realm: str, token: str) -> None:
        self.base = base.rstrip("/")
        self.realm = realm
        self._token = token
        self.ctx = ssl.create_default_context()

    @classmethod
    def login(cls, base: str, realm: str, username: str, admin_secret: str) -> "Admin":
        base = base.rstrip("/")
        form = urllib.parse.urlencode({
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": username,
            "password": admin_secret,
        }).encode()
        url = f"{base}/realms/master/protocol/openid-connect/token"
        req = urllib.request.Request(
            url, data=form, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT,
                                        context=ssl.create_default_context()) as r:
                token = json.loads(r.read())["access_token"]
        except urllib.error.HTTPError as e:
            if e.code in (400, 401):
                raise KeycloakError(
                    "Keycloak rejected the admin credentials.\n"
                    "  Check KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD:\n"
                    "      set -a; source infra/.env; set +a"
                ) from None
            raise KeycloakError(f"token endpoint returned HTTP {e.code} at {url}") from None
        except urllib.error.URLError as e:
            raise KeycloakError(
                f"cannot reach Keycloak at {url}\n"
                f"  {e.reason}\n"
                "  Is the stack up, and does KC_ADMIN_URL include the /idp relative path?"
            ) from None
        return cls(base, realm, token)

    def _call(self, method: str, path: str, payload: Any = None) -> Any:
        url = f"{self.base}/admin/realms/{self.realm}{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Authorization": f"Bearer {self._token}"}
        if data:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=self.ctx) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            if e.code == 404 and method == "GET":
                return None
            detail = ""
            try:
                detail = json.loads(e.read()).get("errorMessage", "")
            except Exception:
                pass
            raise KeycloakError(f"{method} {path} -> HTTP {e.code} {detail}".strip()) from None

    def find_user(self, username: str) -> dict[str, Any] | None:
        q = urllib.parse.urlencode({"username": username, "exact": "true"})
        found = self._call("GET", f"/users?{q}") or []
        for u in found:
            if u.get("username", "").lower() == username.lower():
                return u
        return None

    def create_user(self, payload: dict[str, Any]) -> str:
        self._call("POST", "/users", payload)
        u = self.find_user(payload["username"])
        if not u:
            raise KeycloakError(f"created {payload['username']} but cannot read it back")
        return u["id"]

    def update_user(self, uid: str, payload: dict[str, Any]) -> None:
        self._call("PUT", f"/users/{uid}", payload)

    def reset_credential(self, uid: str, value: str, temporary: bool) -> None:
        self._call("PUT", f"/users/{uid}/reset-password",
                   {"type": "password", "value": value, "temporary": temporary})

    def realm_role(self, name: str) -> dict[str, Any] | None:
        return self._call("GET", f"/roles/{urllib.parse.quote(name)}")

    def user_realm_roles(self, uid: str) -> list[str]:
        got = self._call("GET", f"/users/{uid}/role-mappings/realm") or []
        return [r["name"] for r in got]

    def add_realm_roles(self, uid: str, roles: list[dict[str, Any]]) -> None:
        self._call("POST", f"/users/{uid}/role-mappings/realm",
                   [{"id": r["id"], "name": r["name"]} for r in roles])


def validate(users: list[dict[str, Any]]) -> None:
    problems: list[str] = []
    seen: set[str] = set()
    for i, u in enumerate(users, 1):
        who = u.get("username") or f"entry #{i}"
        if not u.get("username"):
            problems.append(f"{who}: no username")
        elif u["username"].lower() in seen:
            problems.append(f"{who}: duplicate username in the file")
        else:
            seen.add(u["username"].lower())

        if not u.get("email"):
            problems.append(f"{who}: no email (the realm sets verifyEmail and requires one)")

        roles = u.get("roles") or []
        if isinstance(roles, str):
            roles = [roles]
        if not roles:
            problems.append(f"{who}: no roles")
        for r in roles:
            if r not in KNOWN_ROLES:
                problems.append(
                    f"{who}: unknown role {r!r}; the realm roles are {', '.join(KNOWN_ROLES)}"
                )

        for banned in ("password", "credential", "credentials", "secret", "token"):
            if banned in u:
                problems.append(
                    f"{who}: has a {banned!r} key. Credentials are generated by this script "
                    "and never read from the users file -- remove it so it cannot reach git."
                )
    if problems:
        print("The users file has problems:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        raise SystemExit(2)


def profile_payload(u: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "username": u["username"],
        "email": u["email"],
        "firstName": u.get("firstName") or u.get("first_name") or "",
        "lastName": u.get("lastName") or u.get("last_name") or "",
        "enabled": bool(u.get("enabled", True)),
        "emailVerified": bool(u.get("emailVerified", False)),
    }
    attrs = u.get("attributes") or {}
    if isinstance(attrs, dict) and attrs:
        payload["attributes"] = {k: [str(v)] for k, v in attrs.items() if v is not None}
    return payload


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Create ADA Keycloak users and assign realm roles. Idempotent.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--users-file", type=Path, default=INFRA / "users.yaml",
                    help="YAML or JSON. Default: infra/users.yaml (gitignored)")
    ap.add_argument("--out", type=Path, default=None,
                    help="Output file for generated credentials. "
                         "Default: infra/secrets/user-credentials-<UTC>.txt")
    ap.add_argument("--dry-run", action="store_true",
                    help="Report what would change. Read-only against Keycloak; "
                         "generates nothing and writes nothing.")
    ap.add_argument("--permanent", action="store_true",
                    help="Do NOT mark credentials temporary. Default is temporary, "
                         "forcing a change at first login.")
    ap.add_argument("--reset-credential", action="store_true",
                    help="Also generate a NEW credential for users that already exist. "
                         "Off by default: it invalidates one somebody may be using.")
    args = ap.parse_args()

    if not args.users_file.exists():
        print(f"No users file at {args.users_file}", file=sys.stderr)
        print("Copy the committed example and edit it:", file=sys.stderr)
        print("    cp infra/users.example.yaml infra/users.yaml", file=sys.stderr)
        return 2

    users = load_users_file(args.users_file)
    if not users:
        print(f"{args.users_file}: no users defined", file=sys.stderr)
        return 2
    validate(users)

    base = os.environ.get("KC_ADMIN_URL", "http://localhost:8090/idp")
    realm = os.environ.get("ADA_REALM") or os.environ.get("KC_REALM") or "pcsmcpl"
    admin_user = os.environ.get("KC_BOOTSTRAP_ADMIN_USERNAME", "")
    admin_secret = os.environ.get("KC_BOOTSTRAP_ADMIN_PASSWORD", "")

    host = (urllib.parse.urlparse(base).hostname or "").lower()
    if host not in ("localhost", "127.0.0.1", "::1", "0.0.0.0",
                    "host.docker.internal", "keycloak"):
        print(f"Refusing to run: KC_ADMIN_URL host {host!r} is not local.", file=sys.stderr)
        print("  This script is for the local Docker stack only.", file=sys.stderr)
        print("  Never point it at a remote or production Keycloak.", file=sys.stderr)
        return 2

    if not admin_user or not admin_secret:
        print("KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD are not set.",
              file=sys.stderr)
        print("  They live in infra/.env:", file=sys.stderr)
        print("      set -a; source infra/.env; set +a", file=sys.stderr)
        return 2

    print(f"realm '{realm}' at {base}")
    print(f"users file: {args.users_file}  ({len(users)} entr{'y' if len(users) == 1 else 'ies'})")
    if args.dry_run:
        print("DRY RUN -- nothing will be created, changed or written.")
    print()

    try:
        admin = Admin.login(base, realm, admin_user, admin_secret)
    except KeycloakError as e:
        print(f"{e}", file=sys.stderr)
        return 1

    wanted = sorted({r for u in users for r in (u.get("roles") or [])})
    roles: dict[str, dict[str, Any]] = {}
    for name in wanted:
        r = admin.realm_role(name)
        if r is None:
            print(f"realm role '{name}' does not exist in realm '{realm}'.", file=sys.stderr)
            print("  Create the four ICMS roles first:", file=sys.stderr)
            print("      ./infra/keycloak/create-icms-roles.sh", file=sys.stderr)
            return 1
        roles[name] = r

    generated: list[tuple[str, str, str]] = []
    created = updated = unchanged = 0
    role_adds = 0

    for u in users:
        name = u["username"]
        desired = profile_payload(u)
        want_roles = u.get("roles") or []
        existing = admin.find_user(name)

        if existing is None:
            if args.dry_run:
                print(f"  CREATE   {name}  roles={','.join(want_roles)}  "
                      "(credential would be generated)")
                created += 1
                continue
            uid = admin.create_user(desired)
            value = generate_secret()
            admin.reset_credential(uid, value, temporary=not args.permanent)
            generated.append((name, desired["email"], value))
            if want_roles:
                admin.add_realm_roles(uid, [roles[r] for r in want_roles])
                role_adds += len(want_roles)
            print(f"  created  {name}  +roles {','.join(want_roles)}")
            created += 1
            continue

        uid = existing["id"]
        have = set(admin.user_realm_roles(uid))
        missing = [r for r in want_roles if r not in have]
        drift = sorted(
            k for k, v in desired.items()
            if k not in ("username", "attributes") and existing.get(k) != v
        )

        changes: list[str] = []
        if drift:
            changes.append("profile:" + ",".join(drift))
        if missing:
            changes.append("+roles:" + ",".join(missing))
        if args.reset_credential:
            changes.append("credential:reset")

        if not changes:
            print(f"  ok       {name}  (exists, roles already correct)")
            unchanged += 1
            continue

        if args.dry_run:
            print(f"  UPDATE   {name}  {' '.join(changes)}")
            updated += 1
            continue

        if drift:
            admin.update_user(uid, {**existing, **desired})
        if missing:
            admin.add_realm_roles(uid, [roles[r] for r in missing])
            role_adds += len(missing)
        if args.reset_credential:
            value = generate_secret()
            admin.reset_credential(uid, value, temporary=not args.permanent)
            generated.append((name, desired["email"], value))
        print(f"  updated  {name}  {' '.join(changes)}")
        updated += 1

    print()
    print(f"  created {created}, updated {updated}, unchanged {unchanged}, "
          f"role assignments added {role_adds}")

    if args.dry_run:
        print("\nDRY RUN -- nothing was changed and no output file was written.")
        return 0

    if not generated:
        print("\nNothing was generated, so no output file was written.")
        print("Existing users keep the credential they already have; "
              "--reset-credential replaces it.")
        return 0

    stamp = datetime.now(timezone.utc)
    out = args.out or (INFRA / "secrets" / f"user-credentials-{stamp:%Y%m%dT%H%M%SZ}.txt")
    out.parent.mkdir(parents=True, exist_ok=True)

    kind = ("TEMPORARY -- Keycloak forces a change at first login"
            if not args.permanent else "PERMANENT -- no change is forced")
    lines = [
        "ADA Keycloak user credentials",
        f"realm      {realm}",
        f"generated  {stamp:%Y-%m-%d %H:%M:%SZ}",
        f"type       {kind}",
        "",
        "Hand each line to its owner over a channel you trust, then DELETE this file.",
        "It is gitignored and mode 0600, but it is still plaintext on disk.",
        "",
    ]
    width = max(len(u) for u, _, _ in generated)
    for user, email, value in generated:
        lines.append(f"{user.ljust(width)}  {email}  {value}")
    lines.append("")

    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    print(f"\n{len(generated)} credential(s) written to:")
    print(f"    {out}")
    print("\nNothing was printed here. Open that file to read them, deliver them,")
    print("then delete it. It is covered by .gitignore.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeycloakError as e:
        print(f"\nKeycloak error: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
