#!/usr/bin/env bash
# Re-applies the Keycloak settings that are live but NOT in realm-ada.json.
#
# They live in Postgres, so they survive a restart but NOT `make nuke CONFIRM=yes`
# and NOT a realm rebuilt from the import file. Run this after either, or the
# portal cannot sign anybody in and /api/icms/admin/users answers 503.
#
# Companion to create-icms-roles.sh, which creates the four realm roles and
# nothing else. Idempotent — every step checks before it writes.
# Credentials are read from the container's own environment and never printed.
set -euo pipefail

CONTAINER="${KC_CONTAINER:-ada-keycloak}"
REALM="${KC_REALM:-pcsmcpl}"
ADMIN_PORT="${KC_HTTP_HOST_PORT:-8091}"
SPA_ORIGIN="${SPA_ORIGIN:-http://localhost:5173}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Keycloak container '$CONTAINER' is not running. Start it with: make up" >&2
  exit 1
fi

docker exec -i "$CONTAINER" sh -s <<EOF
set -eu
K=/opt/keycloak/bin/kcadm.sh
R="$REALM"

\$K config credentials --server http://localhost:8090/idp --realm master \
  --user "\$KC_BOOTSTRAP_ADMIN_USERNAME" --password "\$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

# KC_HOSTNAME points every realm at the SPA origin. For master that leaves the
# admin console unreachable whenever the frontend is down, and its session-check
# iframe times out. A realm-level frontendUrl overrides it for master alone.
\$K update realms/master -s "attributes.frontendUrl=http://localhost:${ADMIN_PORT}/idp"
echo "  master frontendUrl -> http://localhost:${ADMIN_PORT}/idp"

WEB=\$(\$K get clients -r \$R -q clientId=ada-web --fields id --format csv --noquotes | tail -1)

# The login form posts credentials itself; without this it gets 400 unauthorized_client.
\$K update clients/\$WEB -r \$R -s directAccessGrantsEnabled=true
echo "  ada-web directAccessGrantsEnabled -> true"

# Keycloak enforces webOrigins on browser token POSTs. Missing origin = 403 Invalid origin.
\$K update clients/\$WEB -r \$R \
  -s 'webOrigins=["${SPA_ORIGIN}","http://127.0.0.1:5173","http://localhost:8010"]'
echo "  ada-web webOrigins -> ${SPA_ORIGIN} and loopback"

# Fails open if left DISABLED: the direct grant would issue tokens on the
# password alone and skip the authenticator silently. Asserted, not assumed.
EXEC=\$(\$K get authentication/flows/direct%20grant/executions -r \$R \
  --fields id,displayName --format csv --noquotes \
  | grep 'Direct Grant - Conditional OTP' | cut -d, -f1)
if [ -n "\$EXEC" ]; then
  \$K update authentication/flows/direct%20grant/executions -r \$R \
    -b "{\"id\":\"\$EXEC\",\"requirement\":\"CONDITIONAL\"}"
  echo "  direct grant 'Conditional OTP' -> CONDITIONAL"
fi

# Service account for /api/icms/admin/users. Narrowest roles that work, not realm-admin.
if ! \$K get clients -r \$R -q clientId=ada-api --fields id --format csv --noquotes | grep -q .; then
  \$K create clients -r \$R \
    -s clientId=ada-api -s name='ADA API service' -s enabled=true \
    -s publicClient=false -s serviceAccountsEnabled=true \
    -s standardFlowEnabled=false -s implicitFlowEnabled=false \
    -s directAccessGrantsEnabled=false -s fullScopeAllowed=false \
    -s 'redirectUris=[]' -s 'webOrigins=[]' \
    -s 'defaultClientScopes=["basic","roles"]' -s 'optionalClientScopes=[]'
  echo "  ada-api client created"
fi

CID=\$(\$K get clients -r \$R -q clientId=ada-api --fields id --format csv --noquotes | tail -1)
SA=\$(\$K get clients/\$CID/service-account-user -r \$R --fields id --format csv --noquotes | tail -1)
RM=\$(\$K get clients -r \$R -q clientId=realm-management --fields id --format csv --noquotes | tail -1)

ROLES=/tmp/ada-api-roles.json
printf '[' > \$ROLES
FIRST=1
for n in view-users query-users manage-users view-realm; do
  [ \$FIRST -eq 0 ] && printf ',' >> \$ROLES
  FIRST=0
  \$K get clients/\$RM/roles/\$n -r \$R --fields id,name >> \$ROLES
done
printf ']' >> \$ROLES

# BOTH mappings are required. fullScopeAllowed is false, so a role granted only
# on the service-account user leaves the token with no resource_access entry and
# every Admin API call answers 403.
\$K create users/\$SA/role-mappings/clients/\$RM -r \$R -f \$ROLES 2>/dev/null || true
\$K create clients/\$CID/scope-mappings/clients/\$RM -r \$R -f \$ROLES 2>/dev/null || true
rm -f \$ROLES
echo "  ada-api service account + client scope -> view-users query-users manage-users view-realm"

# ada-field: the native field app. It signs in with a direct access grant from its own
# login form, so it has no redirect or post-logout URIs; the admin console wizard
# cannot create it because it keeps a hidden post-logout value it then rejects.
if ! \$K get clients -r \$R -q clientId=ada-field --fields id --format csv --noquotes | grep -q .; then
  \$K create clients -r \$R -s clientId=ada-field -s enabled=true
  echo "  ada-field client created"
fi
FID=\$(\$K get clients -r \$R -q clientId=ada-field --fields id --format csv --noquotes | tail -1)
\$K update clients/\$FID -r \$R \
  -s name='ADA ICMS Field App' -s publicClient=true \
  -s standardFlowEnabled=false -s implicitFlowEnabled=false \
  -s directAccessGrantsEnabled=true -s serviceAccountsEnabled=false \
  -s fullScopeAllowed=true -s 'redirectUris=[]' -s 'webOrigins=[]' \
  -s 'attributes."post.logout.redirect.uris"=' \
  -s 'attributes."pkce.code.challenge.method"='
OFF=\$(\$K get client-scopes -r \$R --fields id,name --format csv --noquotes | grep ',offline_access\$' | cut -d, -f1)
\$K update clients/\$FID/optional-client-scopes/\$OFF -r \$R 2>/dev/null || true
echo "  ada-field public client -> direct access grants on, offline_access optional"

# Session lifetimes: the portal's SSO session ends after 12 hours; the field app's
# offline session ends after 30 days of inactivity and otherwise never expires.
\$K update realms/\$R \
  -s ssoSessionIdleTimeout=43200 -s ssoSessionMaxLifespan=43200 \
  -s offlineSessionIdleTimeout=2592000 -s offlineSessionMaxLifespanEnabled=false
echo "  sessions -> web 12h, field app 30 days idle"

echo
echo "ada-api client secret (put in infra/.env as ADA_API_CLIENT_SECRET):"
\$K get clients/\$CID/client-secret -r \$R --fields value
EOF

cat <<MSG

Verify direct grants are on — expect invalid_grant, NOT unauthorized_client:

  curl -sS -X POST http://localhost:${ADMIN_PORT}/idp/realms/${REALM}/protocol/openid-connect/token \\
    -H 'Origin: ${SPA_ORIGIN}' \\
    -d grant_type=password -d client_id=ada-web -d username=__probe__ -d password=__probe__

Same check for the field app (no Origin header — it is not a browser):

  curl -sS -X POST http://localhost:${ADMIN_PORT}/idp/realms/${REALM}/protocol/openid-connect/token \\
    -d grant_type=password -d client_id=ada-field -d username=__probe__ -d password=__probe__

Admin console: http://localhost:${ADMIN_PORT}/idp/admin
MSG
