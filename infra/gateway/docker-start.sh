#!/bin/sh
# Container entrypoint for the kong service: point kong.yml's default upstreams
# at KONG_UPSTREAM_* (Kong has no env interpolation in declarative config), then
# hand over to the image's own entrypoint.
set -eu

api="${KONG_UPSTREAM_API:-http://host.docker.internal:8000}"
auth="${KONG_UPSTREAM_AUTH:-http://host.docker.internal:8002}"
idp="${KONG_UPSTREAM_IDP:-http://keycloak:8090}"

mkdir -p /tmp/kong
sed -e "s#url: http://host.docker.internal:8000\$#url: ${api}#" \
    -e "s#url: http://host.docker.internal:8002\$#url: ${auth}#" \
    -e "s#url: http://keycloak:8090\$#url: ${idp}#" \
    /kong/kong.yml > /tmp/kong/kong.yml

echo "[gateway] /api -> ${api}  /auth-api -> ${auth}  /idp -> ${idp}"
exec /docker-entrypoint.sh kong docker-start
