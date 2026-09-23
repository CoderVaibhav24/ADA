# Keycloak realm `pcsmcpl`

| file | what it does |
|---|---|
| `realm-ada.json` | The realm. Imported by compose's `--import-realm`. `${VAR}` substitutions only, never a literal secret. |
| `apply-realm-config.sh` | Brings a live realm up to what the JSON declares, and sets the three things the JSON cannot hold. |
| `create-icms-roles.sh` | Creates the four ICMS realm roles on a live realm. |

## How the realm gets in

Compose starts Keycloak with `start-dev --import-realm --features=token-exchange:v1`.
The import runs on every start but its strategy is **IGNORE_EXISTING**. The file is
read only when the realm is not already in Postgres, which means first boot,
`make nuke CONFIRM=yes`, or a fresh volume. After that, editing the JSON changes
nothing about the running realm.

Run `apply-realm-config.sh` in each of these cases:

- after `make nuke` or any fresh import, for the three items below that only the script sets
- after restoring the Keycloak database from a backup older than the current JSON
- after changing `realm-ada.json`, so an existing estate gets the change

```bash
set -a; source infra/compose/.env; set +a      # KC_HTTP_HOST_PORT, APP_ORIGIN
./infra/keycloak/apply-realm-config.sh
```

It is idempotent. Only the script can set these:

| setting | why the JSON cannot |
|---|---|
| master realm `frontendUrl` | master is never imported |
| ada-web `webOrigins` / `redirectUris` for `APP_ORIGIN` | compose does not pass `APP_ORIGIN` to Keycloak; the JSON carries only loopback origins |
| the ada-api client secret | Keycloak generates it on import. The script writes it to `infra/secrets/keycloak/ada-api-client-secret` (mode 0600, gitignored) and prints the last four characters. Copy it to `.env` as `ADA_API_CLIENT_SECRET`, then delete the file. |

Everything else it does is already declared in the JSON (ada-web direct grants,
ada-api, ada-field, lifetimes, the Conditional OTP assertion, ada-auth's role scope and
exchange permission). The script re-applies those for estates imported before the JSON
had them.

## Clients

| client | type | notes |
|---|---|---|
| `ada-web` | public | Portal. Direct grant from the login form; standard flow with PKCE S256. Fixed `id` `5a1d7e2c-…-0ada00000001` because the token-exchange permission is keyed by it. |
| `ada-field` | public | Native app. The app signs in with a **direct grant** (`apps/field/src/services/auth/session.ts`: `grant_type=password`, no redirect), so direct grants stay on. The standard flow is also on, S256 enforced, redirect `adaicms://*`, ready for the system-browser login in B8. `offline_access` is optional only. The `phoneNumber` mapper goes into the id token and userinfo, not the access token. |
| `ada-auth` | confidential | auth-otp. Service account holds `view-users` and `impersonation`. Its realm scope is `pcs-nodal-officer`, `field-surveyor` and `ada-project-lead`. Without that scope an exchanged token has no `realm_access`. `super-admin` is left out of the scope on purpose. |
| `ada-api` | confidential | Admin API for `/api/icms/admin/users`: `view-users`, `query-users`, `manage-users`, `view-realm`. |
| `ada-notify`, `ada-ml` | confidential | Service accounts. |

Realm roles: `super-admin`, `pcs-nodal-officer`, `field-surveyor`, `ada-project-lead`.
`public` is a workflow actor in `services/api`, not a sign-in role. Permissions such
as `imagery.read` and `imagery.write` are PBAC rows in Postgres
(`services/api/app/icms/policy.py`), not Keycloak roles.

## Lifetimes (S-08)

| setting | value | reason |
|---|---|---|
| access token | 15 min | Clients refresh. A leaked token is short-lived. |
| SSO idle / max | 1 h / 12 h | Portal: a shift, not a week. |
| offline idle / max | 30 d / 90 d | Field app (`offline_access`). A surveyor out of signal keeps working, and the 90-day cap forces a fresh sign-in at least once a quarter. |
| revoke refresh token | on, reuse 0 | Rotation. The field app already serialises refreshes. |

`ada-field` gets no client-level session override. Keycloak caps a client's online
session at the realm SSO values, so the longer field session comes from the offline
session rather than a client setting.

## OTP token exchange

auth-otp exchanges its service token for a user token (`requested_subject`, token
exchange v1). Measured on Keycloak 26.7.2:

| exchange | result | `azp` | `aud` | `realm_access` |
|---|---|---|---|---|
| no `audience` | 200 | `ada-auth` | none | ada-auth's scoped roles |
| `audience=ada-web` | **403** "Client not allowed to exchange", unless Keycloak also runs `admin-fine-grained-authz:v1` | `ada-auth` | `account`, `ada-web` | all of the user's realm roles |

`azp` is **always `ada-auth`**, so ada-api must list `ada-auth` in `OIDC_ALLOWED_AZP`.
Compose does that. `reject_service_accounts` still refuses ada-auth's own
client-credentials token.

The permission that lets ada-auth exchange **to** ada-web is declared in the JSON
(`realm-management` authorization settings, resource `client.resource.<ada-web id>`,
scope `token-exchange`, client policy `ada-auth may exchange`). It takes effect only
when Keycloak runs `--features=token-exchange:v1,admin-fine-grained-authz:v1`. Without
that flag, choose one of these:

- add `admin-fine-grained-authz:v1` to the compose command (a deprecated feature), or
- run auth-otp with `EXCHANGE_AUDIENCE=` (empty). This is the simpler option: the token is the same apart from `aud`, which ada-api does not check.

Smoke test (replace `<user-id>` with a test user's id):

```bash
KC=http://localhost:${KC_HTTP_HOST_PORT:-8090}/idp/realms/pcsmcpl/protocol/openid-connect/token
SVC=$(curl -s -d grant_type=client_credentials -d client_id=ada-auth \
  --data-urlencode client_secret="$ADA_AUTH_CLIENT_SECRET" "$KC" | jq -r .access_token)
curl -s -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d client_id=ada-auth --data-urlencode client_secret="$ADA_AUTH_CLIENT_SECRET" \
  -d subject_token="$SVC" -d subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  -d requested_subject=<user-id> -d audience=ada-web "$KC" \
  | jq -r .access_token | cut -d. -f2 | base64 -d 2>/dev/null | jq '{typ,azp,aud,realm_access}'
```

## Identity providers

Google: `enabled: false`, `trustEmail: false`, `hostedDomain` from
`ADA_GOOGLE_HOSTED_DOMAIN` (compose default `pcsmcpl.net`). GitHub: `enabled: false`.
GitHub has no hosted-domain restriction, so enabling it lets any GitHub account
reach first-broker-login. Before enabling it, restrict it with a first-login flow
or `linkOnly`.

## Signing keys and Kong

A realm re-import or `make nuke` creates new signing keys. Kong's jwt plugin does
not fetch JWKS, so every `/api` call answers 401 until you run `make gateway-sync`.
See [`infra/gateway/README.md`](../gateway/README.md) ("key rotation is manual").
