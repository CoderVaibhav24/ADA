# API gateway (Kong OSS, DB-less)

One entry point in front of ADA's HTTP services, on `127.0.0.1:${KONG_PROXY_PORT:-8080}`.
It starts with the infrastructure (`make infra`, or `docker compose up -d` in
`infra/compose/`), and its whole configuration is `kong.yml` in this directory.
There is no Kong database and the Admin API is switched off (`KONG_ADMIN_LISTEN=off`).

| Path | Upstream | Notes |
|---|---|---|
| `/api/health`, `/api/health/ready`, `/api/auth/config`, `/api/docs`, `/api/openapi.json` (GET) | ada-api | no token needed |
| `/api/**` | ada-api | JWT required |
| `POST /api/projects/{id}/rasters` | ada-api | 2048 MB body limit, 30/min per IP, not buffered in Kong |
| `POST /api/projects/{id}/analyses` | ada-api | 30/min per IP |
| `POST /auth-api/v1/auth/refresh` | ada-auth (`/v1/auth/refresh`) | 60/min per IP, its own bucket |
| `/auth-api/**` | ada-auth (`/auth-api` stripped) | 10/min per IP |
| `/idp/realms/**`, `/idp/resources/**` | Keycloak (nothing stripped) | |
| `/idp/admin/**`, `/idp/realms/master/**` | none | always 404 |

Global plugins: `correlation-id` (`X-Request-ID`, a UUID, echoed back to the
client) and `request-size-limiting` (20 MB, overridden on the raster upload
route). Every service adds `Strict-Transport-Security`, `X-Content-Type-Options:
nosniff` and `Referrer-Policy: no-referrer`; ada-api and ada-auth also add
`X-Frame-Options: DENY` (not Keycloak, whose SSO iframes must stay frameable).

## What it does not do

The gateway is a floor, not the authorisation layer. On `/api` it checks only
that the token is signed by a current Keycloak realm key and has not expired.
It does **not** check `iss`, `aud`/`azp`, roles, zones or project membership.
ada-api keeps every one of those checks; nothing may be removed from a service
on the grounds that Kong is in front of it. Services stay reachable directly on
their own 127.0.0.1 ports during development.

Rate limits use `policy: local`, so each Kong node counts on its own. Under
Docker Desktop every client appears as the same gateway IP, so in local dev the
per-IP limits are effectively shared by everyone.

### Behind a load balancer

`limit_by: ip` counts the address Kong sees. Behind a load balancer or reverse
proxy that is the proxy's own address, so every user shares one bucket and ten
OTP requests a minute lock the whole site out. Tell Kong which hops to trust and
where the client address is, in `infra/compose/.env` (the kong service passes
them through; the defaults trust nobody):

```bash
KONG_TRUSTED_IPS=10.0.0.0/8          # the load balancer's CIDRs, comma-separated
KONG_REAL_IP_HEADER=X-Forwarded-For
KONG_REAL_IP_RECURSIVE=on            # take the last untrusted hop, not the first
```

Never set `KONG_TRUSTED_IPS=0.0.0.0/0,::/0`: any client could then choose its
own rate-limit key with a forged `X-Forwarded-For`.

Token refresh has its own route and a 60/min bucket, because a signed-in client
refreshes every few minutes and must not spend the 10/min OTP allowance.

## JWT scheme and key sync

Kong's `jwt` plugin picks the credential by reading the claim named in
`key_claim_name` from the token **payload, then the header**. The config uses
`key_claim_name: kid`: a Keycloak access token has no `kid` in its payload, so
Kong reads the header `kid` and looks up the `jwt_secrets` entry whose `key` is
that kid, then verifies the RS256 signature with its `rsa_public_key`. One
entry per realm signing key, all on the single consumer `keycloak`. (Keying on
`iss` instead would allow only one public key per issuer, which breaks the
moment Keycloak holds two active keys during a rotation.)

`sync-jwks.sh` fills that block from the realm JWKS:

```bash
make gateway-sync                     # = infra/gateway/sync-jwks.sh --restart
infra/gateway/sync-jwks.sh            # rewrite kong.yml only
JWKS_URL=https://.../certs infra/gateway/sync-jwks.sh
```

It tries `$JWKS_URL`, then `${ADA_ISSUER}/protocol/openid-connect/certs`, then
Keycloak directly on `127.0.0.1:${KC_HTTP_HOST_PORT:-8090}`; `ADA_ISSUER` and
the port are read from the environment or `infra/compose/.env`. It keeps only
`kty=RSA`, `use=sig`, `alg=RS256` keys, converts each to PEM with
`cryptography` (from `.venv`), and replaces only the lines between the
`BEGIN/END jwt_secrets` markers. It is idempotent and refuses to write an empty
key set. Until it has run once, every protected `/api` request answers 401.

**Limitation: key rotation is manual.** Kong reads `kong.yml` only at start and
has no JWKS fetching in the OSS jwt plugin. When Keycloak gets a new signing
key (rotation, realm re-import, `make nuke`), tokens signed with it are refused
with 401 until you rerun `make gateway-sync` (which restarts kong). Add the new
key in Keycloak, sync, and only then make it the active key, so both kids are
present in Kong during the overlap.

The synced block is environment-specific (the kids differ per Keycloak). Keep
the committed `kong.yml` with `jwt_secrets: []` unless a deployment decides
otherwise.

## Pointing the upstreams

`kong.yml` holds the native-dev defaults. `docker-start.sh`, the container's
entrypoint, rewrites them from the environment before starting Kong, because
Kong's declarative config has no variable interpolation:

| Variable | Default (native dev) | Containerised stack |
|---|---|---|
| `KONG_UPSTREAM_API` | `http://host.docker.internal:8000` | `http://ada-api:8000` |
| `KONG_UPSTREAM_AUTH` | `http://host.docker.internal:8002` | `http://ada-auth:8002` |
| `KONG_UPSTREAM_IDP` | `http://keycloak:8090` | same |

`make up-full` sets the two container values for you. To do it by hand, put
them in `infra/compose/.env` or prefix the command, then recreate kong:

```bash
cd infra/compose
KONG_UPSTREAM_API=http://ada-api:8000 KONG_UPSTREAM_AUTH=http://ada-auth:8002 \
  docker compose --profile full up -d
```

If a native service listens on a non-default port (for example `BACKEND_PORT`),
set `KONG_UPSTREAM_API=http://host.docker.internal:<port>` to match.
`host.docker.internal` is mapped with `host-gateway`. On Linux that is the
docker bridge address, not loopback, so a native service bound to 127.0.0.1 is
unreachable from Kong: start it with `make api BIND=0.0.0.0` (likewise `auth`,
`ml`, `notify`). Docker Desktop forwards to loopback, so macOS needs nothing.

## Checking a change

```bash
docker run --rm -e KONG_DATABASE=off -v "$PWD/infra/gateway/kong.yml:/kong.yml:ro" \
  kong:3.9.1 kong config parse /kong.yml
docker compose -f infra/compose/docker-compose.yml restart kong
```
