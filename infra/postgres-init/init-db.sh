#!/bin/sh
# Creates the databases ADA needs beyond POSTGRES_DB, on one PostgreSQL
# instance: Keycloak's, and the notification service's.
#
# This runs ONCE, on first initialisation of an empty data directory. Editing it
# against a populated volume does nothing — remove the `ada_pgdata` volume for a
# change here to take effect.
#
# The official image creates POSTGRES_DB and POSTGRES_USER before this runs, so
# the main ADA database already exists by now. It replaced init-db.sql, which
# created a `supertokens` database for the authentication system Keycloak has
# since replaced.

set -eu

KEYCLOAK_DB="${POSTGRES_KEYCLOAK_DB:-keycloak}"
NOTIFY_DB="${POSTGRES_NOTIFY_DB:-ada_notify}"
# The role Keycloak will connect as. Defaults to the superuser the image made.
KEYCLOAK_ROLE="${KC_DB_USERNAME:-$POSTGRES_USER}"

su_psql() {
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres "$@"
}

exists() {
    # $1 is a catalog column filter that returns exactly '1' or nothing.
    [ "$(su_psql -tAc "$1")" = "1" ]
}

# Giving Keycloak its own role is what stops its database credential from also
# reading imagery metadata and notification history — datastores with unrelated
# threat models, on one instance. It is optional because .env.example ships the
# simpler shared-superuser arrangement: set KC_DB_USERNAME to something other
# than POSTGRES_USER and this branch takes effect.
if [ "$KEYCLOAK_ROLE" != "$POSTGRES_USER" ]; then
    if [ -z "${KC_DB_PASSWORD:-}" ]; then
        echo "init-db: KC_DB_USERNAME is not the superuser but KC_DB_PASSWORD is empty;" >&2
        echo "init-db: refusing to create a login role without a password" >&2
        exit 1
    fi
    if ! exists "SELECT 1 FROM pg_roles WHERE rolname = '$KEYCLOAK_ROLE'"; then
        # :"name" quotes as an identifier and :'name' as a literal, both using
        # PostgreSQL's own rules. Substituting a password into SQL by hand
        # breaks on the first one containing a quote.
        su_psql -v role="$KEYCLOAK_ROLE" -v password="$KC_DB_PASSWORD" <<'EOSQL'
CREATE ROLE :"role" LOGIN PASSWORD :'password';
EOSQL
        echo "init-db: created role '$KEYCLOAK_ROLE'"
    fi
fi

create_database() {
    database="$1"
    owner="$2"
    if exists "SELECT 1 FROM pg_database WHERE datname = '$database'"; then
        echo "init-db: database '$database' already exists"
        return
    fi
    su_psql -v database="$database" -v owner="$owner" <<'EOSQL'
CREATE DATABASE :"database" OWNER :"owner";
EOSQL
    # PUBLIC may connect to any database by default, so separate roles isolate
    # nothing until this is revoked. The owner keeps its own access.
    su_psql -v database="$database" -v owner="$owner" <<'EOSQL'
REVOKE CONNECT ON DATABASE :"database" FROM PUBLIC;
GRANT  CONNECT ON DATABASE :"database" TO :"owner";
EOSQL
    echo "init-db: created database '$database' owned by '$owner'"
}

create_database "$KEYCLOAK_DB" "$KEYCLOAK_ROLE"
create_database "$NOTIFY_DB"   "$POSTGRES_USER"
