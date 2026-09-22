#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${KC_CONTAINER:-ada-keycloak}"
REALM="${KC_REALM:-pcsmcpl}"
PORT="${KC_HTTP_PORT:-8090}"
ADMIN_USER="${KC_BOOTSTRAP_ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${KC_BOOTSTRAP_ADMIN_PASSWORD:-}"

RELATIVE_PATH="${KC_HTTP_RELATIVE_PATH:-/idp}"
[ "$RELATIVE_PATH" = "/" ] && RELATIVE_PATH=""
SERVER_URL="http://localhost:${PORT}${RELATIVE_PATH%/}"

missing=""
[ -z "$ADMIN_USER" ] && missing="KC_BOOTSTRAP_ADMIN_USERNAME"
[ -z "$ADMIN_PASSWORD" ] && missing="${missing:+$missing and }KC_BOOTSTRAP_ADMIN_PASSWORD"
if [ -n "$missing" ]; then
  echo "${missing} is not set. Both are in infra/.env:" >&2
  echo "    set -a; source infra/.env; set +a" >&2
  echo >&2
  echo "If infra/.env does not exist yet, generate it first:" >&2
  echo "    node infra/scripts/gen-env.mjs" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container '$CONTAINER' is not running. Start the stack first." >&2
  exit 1
fi

kcadm() {
  docker exec "$CONTAINER" /opt/keycloak/bin/kcadm.sh "$@"
}

kcadm config credentials \
  --server "$SERVER_URL" \
  --realm master \
  --user "$ADMIN_USER" \
  --password "$ADMIN_PASSWORD" >/dev/null

create_role() {
  local name="$1" description="$2"
  if kcadm get "roles/${name}" -r "$REALM" >/dev/null 2>&1; then
    echo "  exists   ${name}"
    return
  fi
  kcadm create roles -r "$REALM" -s "name=${name}" -s "description=${description}" >/dev/null
  echo "  created  ${name}"
}

echo "Realm '${REALM}' on container '${CONTAINER}':"
create_role "super-admin" \
  "Administration: users, zones, lookup values. Holds no ICMS case transition."
create_role "pcs-nodal-officer" \
  "ICMS: assigns cases, verifies inspections, decides re-surveys, hands over."
create_role "field-surveyor" \
  "ICMS: checks in, captures evidence, records findings and submits."
create_role "ada-project-lead" \
  "ICMS: confirms a handover, issues a notice, closes a case."

echo
echo "Roles now in the realm:"
kcadm get roles -r "$REALM" --fields name --format csv 2>/dev/null | sed 's/^/  /'
echo
echo "Assign one to a person with:"
echo "  docker exec ${CONTAINER} /opt/keycloak/bin/kcadm.sh add-roles -r ${REALM} \\"
echo "      --uusername <username> --rolename field-surveyor"
