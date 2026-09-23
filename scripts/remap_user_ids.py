"""Re-point ADA's rows from SuperTokens user ids to Keycloak subjects.

## The problem this exists for

`projects.user_id` and `change_polygons.reviewed_by` hold whatever the
authentication system called a person. Under SuperTokens that was a SuperTokens
user id; under Keycloak it is the subject claim, a different UUID for the same
human being. Nothing in the swap rewrites those columns, so after it every
project written beforehand belongs to an id that can no longer sign in. The rows
are intact and the imagery is intact — they are simply invisible, because
`get_owned_project` compares the stored id against the token's subject and they
no longer match.

## How it matches them up

By email address, which is the one thing both systems hold for the same person.
SuperTokens' `emailpassword_users` table gives (user_id, email); Keycloak's
admin API gives (email, id). Anything that does not match on both sides is
reported and left alone — a wrong remap silently hands one officer's projects to
another, which is far worse than a project that needs a manual decision.

## Running it

Read-only by default. It prints the plan and changes nothing until `--apply`.

    python scripts/remap_user_ids.py \\
        --ada-dsn         postgresql://ada_admin:...@localhost:5433/ada \\
        --supertokens-dsn postgresql://ada_admin:...@localhost:5433/supertokens \\
        --keycloak        http://localhost:8090 \\
        --realm           pcsmcpl \\
        --admin-user      admin

The admin password is read from KC_ADMIN_PASSWORD, or prompted for — never
passed as an argument, where it would land in the shell history and in `ps`.

Run it ONCE, against a database you have backed up. It is idempotent in the
sense that a second run finds nothing left to do, because the SuperTokens ids it
looks for are gone by then.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from dataclasses import dataclass

import httpx
import psycopg2


@dataclass(frozen=True)
class Mapping:
    email: str
    supertokens_id: str
    keycloak_sub: str


def supertokens_users(dsn: str) -> dict[str, str]:
    """{user_id: email} for every SuperTokens email/password account."""
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT user_id, email FROM emailpassword_users")
        return {row[0]: row[1].strip().lower() for row in cur.fetchall()}


def keycloak_token(base_url: str, username: str, password: str) -> str:
    response = httpx.post(
        f"{base_url.rstrip('/')}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": username,
            "password": password,
        },
        timeout=15.0,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def keycloak_users(base_url: str, realm: str, token: str) -> dict[str, str]:
    """{email: subject id} for every account in the realm.

    Paged: the admin API caps a listing at 100 by default, and a silent
    truncation here would look exactly like "those officers do not exist".
    """
    found: dict[str, str] = {}
    first, page = 0, 100
    while True:
        response = httpx.get(
            f"{base_url.rstrip('/')}/admin/realms/{realm}/users",
            params={"first": first, "max": page},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )
        response.raise_for_status()
        batch = response.json()
        for user in batch:
            email = (user.get("email") or "").strip().lower()
            if email:
                found[email] = user["id"]
        if len(batch) < page:
            return found
        first += page


def plan(ada_dsn: str, st_users: dict[str, str], kc_users: dict[str, str]):
    """Work out what would change, without changing anything."""
    with psycopg2.connect(ada_dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT user_id FROM projects WHERE user_id IS NOT NULL")
        owners = {row[0] for row in cur.fetchall()}
        cur.execute(
            "SELECT DISTINCT reviewed_by FROM change_polygons WHERE reviewed_by IS NOT NULL"
        )
        reviewers = {row[0] for row in cur.fetchall()}

    known_subs = set(kc_users.values())
    mappings: list[Mapping] = []
    unknown_id: list[str] = []
    unmatched_email: list[str] = []

    for stored in sorted(owners | reviewers):
        # Already a Keycloak subject — a row written after the swap, or a
        # second run of this script.
        if stored in known_subs:
            continue
        email = st_users.get(stored)
        if email is None:
            unknown_id.append(stored)
            continue
        sub = kc_users.get(email)
        if sub is None:
            unmatched_email.append(email)
            continue
        mappings.append(Mapping(email=email, supertokens_id=stored, keycloak_sub=sub))

    return mappings, unknown_id, unmatched_email


def apply_mappings(ada_dsn: str, mappings: list[Mapping]) -> tuple[int, int]:
    """Rewrite both columns, in one transaction."""
    projects = polygons = 0
    with psycopg2.connect(ada_dsn) as conn:
        with conn.cursor() as cur:
            for mapping in mappings:
                cur.execute(
                    "UPDATE projects SET user_id = %s WHERE user_id = %s",
                    (mapping.keycloak_sub, mapping.supertokens_id),
                )
                projects += cur.rowcount
                cur.execute(
                    "UPDATE change_polygons SET reviewed_by = %s WHERE reviewed_by = %s",
                    (mapping.keycloak_sub, mapping.supertokens_id),
                )
                polygons += cur.rowcount
        conn.commit()
    return projects, polygons


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--ada-dsn", required=True, help="ADA's application database")
    parser.add_argument("--supertokens-dsn", required=True,
                        help="the SuperTokens core's database (still in the old volume)")
    parser.add_argument("--keycloak", default="http://localhost:8090")
    parser.add_argument("--realm", default="pcsmcpl")
    parser.add_argument("--admin-user", default="admin")
    parser.add_argument("--apply", action="store_true",
                        help="actually write. Without it, nothing is changed.")
    args = parser.parse_args()

    password = os.environ.get("KC_ADMIN_PASSWORD") or getpass.getpass(
        f"Keycloak password for {args.admin_user}: "
    )

    st_users = supertokens_users(args.supertokens_dsn)
    token = keycloak_token(args.keycloak, args.admin_user, password)
    kc_users = keycloak_users(args.keycloak, args.realm, token)
    print(f"SuperTokens accounts: {len(st_users)}   Keycloak accounts: {len(kc_users)}")

    mappings, unknown_id, unmatched_email = plan(args.ada_dsn, st_users, kc_users)

    for mapping in mappings:
        print(f"  {mapping.email:40s} {mapping.supertokens_id} -> {mapping.keycloak_sub}")
    for stored in unknown_id:
        print(f"  ! no SuperTokens account for stored id {stored} — left alone")
    for email in unmatched_email:
        print(f"  ! no Keycloak account for {email} — left alone; create it and re-run")

    if not mappings:
        print("Nothing to remap.")
        return 0
    if not args.apply:
        print(f"\n{len(mappings)} account(s) would be remapped. Re-run with --apply.")
        return 0

    projects, polygons = apply_mappings(args.ada_dsn, mappings)
    print(f"\nRemapped {projects} project row(s) and {polygons} reviewed polygon(s).")
    # A non-empty unmatched list is not a failure — it is a decision for a
    # person — but it should not exit 0 in a pipeline that assumes completion.
    return 1 if unmatched_email or unknown_id else 0


if __name__ == "__main__":
    sys.exit(main())
