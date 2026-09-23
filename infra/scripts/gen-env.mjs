#!/usr/bin/env node

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INFRA = resolve(HERE, '..');
const REPO = resolve(INFRA, '..');

const BYTES = { password: 24, clientSecret: 24, hmacKey: 32, bearerToken: 32 };

const b64url = (nBytes) => randomBytes(nBytes).toString('base64url');

const SECRET = 'secret', CONFIG = 'config', EXTERNAL = 'external';

const PLACEHOLDER_TOKENS = [
  'changeme', 'change-me', 'change_me', 'CHANGE-THIS', 'replace-me', 'replaceme',
  'placeholder', 'example', 'sample', 'dummy', 'yourpassword', 'your-password',
  'your-secret', 'your-key', 'xxx', 'xxxx', 'todo', 'tbd', 'fixme',
  'password', 'passwd', 'secret', 'admin', 'root', 'test', 'testing',
  'postgres', 'redis', 'keycloak', 'insecure', 'devonly', 'dev-only',
  'notsecret', 'not-secret', 'local', 'localdev', '123456', '12345678',
  'password123', 'admin123', 'letmein', 'generate-me', 'generated',
  'set-me', 'setme', 'unset', 'none', 'null', 'aaaa', '0000',
];

const VARS = [
  { name: 'POSTGRES_USER', cls: CONFIG, def: 'ada',
    desc: 'Superuser role the postgis image creates on first init. Not "postgres": a non-default role name costs nothing and removes the single most-guessed username. compose has no :- default, so this MUST be set.',
    placeholder: 'ada' },
  { name: 'POSTGRES_PASSWORD', cls: SECRET, gen: () => b64url(BYTES.password),
    desc: 'Superuser password. Embedded verbatim in DATABASE_URL / ADA_DATABASE_URL for ada-api, ada-ml, ada-notify, ada-worker and notify-migrate, so it must stay URI-safe.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'POSTGRES_DB', cls: CONFIG, def: 'ada',
    desc: 'Main ADA database (imagery, rasters, detections, ICMS). compose has no :- default.',
    placeholder: 'ada' },
  { name: 'POSTGRES_PORT', cls: CONFIG, def: '5435',
    desc: 'Host port for postgres, bound to 127.0.0.1 only. 5435 rather than 5432 so it does not collide with a PostgreSQL already installed on the host. compose has no :- default.',
    placeholder: '5435' },
  { name: 'POSTGRES_KEYCLOAK_DB', cls: CONFIG, def: 'keycloak',
    desc: "Keycloak's own database, created by infra/postgres/init/init-db.sh on FIRST init only." },
  { name: 'POSTGRES_NOTIFY_DB', cls: CONFIG, def: 'ada_notify',
    desc: 'ada-notify database, created by the same first-init script.' },

  { name: 'KC_DB_USERNAME', cls: CONFIG, def: '',
    desc: 'PostgreSQL role Keycloak connects as. EMPTY means "reuse POSTGRES_USER", which is the shipped arrangement. Set it (with KC_DB_PASSWORD) only via --separate-kc-db-role, and only before the first start: init-db.sh creates the role on an EMPTY data directory and never again.' },
  { name: 'KC_DB_PASSWORD', cls: CONFIG, def: '',
    desc: 'Password for KC_DB_USERNAME. EMPTY means "reuse POSTGRES_PASSWORD". Must be empty whenever KC_DB_USERNAME is empty — a non-empty password against the superuser name is simply a wrong password.' },

  { name: 'DB_POOL_SIZE', cls: CONFIG, def: '20',
    desc: 'SQLAlchemy connections ada-api and ada-ml each keep open. Sized to cover FastAPI\'s threadpool: a tile request holds a session across a blocking GDAL read, so the library default of 5 queues requests on the pool instead of on the event loop. Read by ada_core.config.PoolSettings; SQLite ignores every DB_POOL_* value.' },
  { name: 'DB_MAX_OVERFLOW', cls: CONFIG, def: '20',
    desc: 'Extra connections allowed above DB_POOL_SIZE during a burst, closed again when it passes. DB_POOL_SIZE + DB_MAX_OVERFLOW per service is the real ceiling — keep the total under the server\'s max_connections (100 by default) across ada-api, ada-ml and Keycloak.' },
  { name: 'DB_POOL_TIMEOUT', cls: CONFIG, def: '30',
    desc: 'Seconds a request waits for a free connection before failing. Without a ceiling an exhausted pool hangs the request instead of returning an error anyone can see.' },
  { name: 'DB_POOL_RECYCLE', cls: CONFIG, def: '1800',
    desc: 'Seconds before a pooled connection is reopened. Must stay BELOW any idle timeout in front of PostgreSQL (PgBouncer, a load balancer, a firewall), or the pool hands out sockets the other end has already closed.' },
  { name: 'DB_POOL_PRE_PING', cls: CONFIG, def: 'true',
    desc: 'Tests a pooled connection before handing it out. false turns a connection PostgreSQL closed underneath us into a random OperationalError on an unrelated request.' },

  { name: 'REDIS_PASSWORD', cls: SECRET, gen: () => b64url(BYTES.password),
    desc: 'requirepass for redis. Interpolated into ADA_REDIS_URL as redis://:PASSWORD@redis:6379/0 — the single strongest reason the generated alphabet excludes @ : / and %.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'REDIS_HOST_PORT', cls: CONFIG, def: '6379', desc: 'Host port for redis (127.0.0.1 only).' },
  { name: 'ADA_REDIS_URL', cls: CONFIG, def: '',
    desc: 'Override the Redis URL wholesale. EMPTY is correct: compose builds redis://:${REDIS_PASSWORD}@redis:6379/0 from the two variables above. Set it only if you point at an external Redis.' },

  { name: 'KC_BOOTSTRAP_ADMIN_USERNAME', cls: CONFIG, def: 'ada-admin',
    desc: 'Temporary master-realm bootstrap admin, created on FIRST start only. Not "admin" — the default username is half of the default credential. Keycloak 26 renamed this from KEYCLOAK_ADMIN; the old name is ignored, not rejected.' },
  { name: 'KC_BOOTSTRAP_ADMIN_PASSWORD', cls: SECRET, gen: () => b64url(BYTES.password),
    desc: 'Bootstrap admin password. Read by infra/keycloak/create-icms-roles.sh and infra/scripts/create_users.py to reach the admin API. Replace this account with a named one before this stack is anything but local.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'KC_HTTP_PORT', cls: CONFIG, def: '8090', desc: 'Port Keycloak listens on inside its container.' },
  { name: 'KC_HTTP_HOST_PORT', cls: CONFIG, def: '8090', desc: 'Host port for the Keycloak login page. One of only two ports a person ever types.' },
  { name: 'KC_MANAGEMENT_PORT', cls: CONFIG, def: '9000', desc: 'Health and metrics port. 127.0.0.1 only. Never public.' },
  { name: 'KC_HOSTNAME', cls: CONFIG, def: 'http://localhost:5173/idp',
    desc: 'Public base URL Keycloak builds issuer and redirect URLs from. MUST include the /idp path: given a bare origin, hostname v2 advertises an issuer that 404s and every token is rejected for an issuer mismatch.' },
  { name: 'KC_HTTP_RELATIVE_PATH', cls: CONFIG, def: '/idp',
    desc: '/idp, not /auth: the console already owns /auth/callback and /auth/signed-out.' },
  { name: 'KC_HOSTNAME_STRICT', cls: CONFIG, def: 'false',
    desc: 'Dev only. Production sets true and reaches Keycloak only through the proxy.' },
  { name: 'ADA_REALM', cls: CONFIG, def: 'pcsmcpl', desc: 'Realm name. Must match "realm" in infra/keycloak/realm-ada.json.' },

  { name: 'ADA_NOTIFY_CLIENT_SECRET', cls: SECRET, gen: () => b64url(BYTES.clientSecret),
    desc: 'client_secret for the confidential service-account client "ada-notify". Substituted into realm-ada.json at import, and also handed to ada-worker as ADA_ADMIN_CLIENT_SECRET for recipient lookup.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'ADA_AUTH_CLIENT_SECRET', cls: SECRET, gen: () => b64url(BYTES.clientSecret),
    desc: 'client_secret for "ada-auth" — the only client holding realm-management impersonation, and therefore the highest-value secret in the file.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'ADA_ML_CLIENT_SECRET', cls: SECRET, gen: () => b64url(BYTES.clientSecret),
    desc: 'client_secret for "ada-ml". Used to obtain the token ada-ml presents to ada-notify.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'ADA_API_CLIENT_SECRET', cls: SECRET, gen: () => b64url(BYTES.clientSecret),
    desc: 'client_secret for "ada-api" — the confidential client whose service account holds realm-management view-users, query-users, manage-users and view-realm. It is the credential behind every officer created, amended or disabled through /api/icms/admin/users, and it is deliberately NOT the bootstrap admin, which can administer every realm on the server. Empty is safe: ada-api refuses those six endpoints with a 503 saying so, rather than 401ing against Keycloak one request at a time.',
    placeholder: 'generated-by-gen-env.mjs' },

  { name: 'ADA_GOOGLE_CLIENT_ID', cls: EXTERNAL,
    desc: 'Google OAuth client id. The "google" identity provider in realm-ada.json is enabled:false, so this is only needed if you turn it on. Obtain: Google Cloud console -> APIs & Services -> Credentials -> OAuth 2.0 Client ID (Web application).' },
  { name: 'ADA_GOOGLE_CLIENT_SECRET', cls: EXTERNAL,
    desc: 'Google OAuth client secret, issued alongside ADA_GOOGLE_CLIENT_ID in the same console screen.' },
  { name: 'ADA_GOOGLE_HOSTED_DOMAIN', cls: CONFIG, def: 'pcsmcpl.net',
    desc: 'Restrict Google sign-in to one Workspace domain.' },
  { name: 'ADA_GITHUB_CLIENT_ID', cls: EXTERNAL,
    desc: 'GitHub OAuth app client id. The "github" provider is enabled:false. Obtain: GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App.' },
  { name: 'ADA_GITHUB_CLIENT_SECRET', cls: EXTERNAL,
    desc: 'GitHub OAuth app client secret, generated in the same OAuth App screen.' },

  { name: 'KC_SMTP_HOST', cls: CONFIG, def: 'mailpit', desc: 'Realm SMTP host. mailpit means a clean checkout completes enrolment with no mail account.' },
  { name: 'KC_SMTP_PORT', cls: CONFIG, def: '1025', desc: 'Realm SMTP port. 1025 is mailpit; a real relay is 587.' },
  { name: 'KC_SMTP_FROM', cls: CONFIG, def: 'ada@pcsmcpl.net',
    desc: 'Realm sender. MUST be a syntactically valid address: Keycloak validates it while importing the realm and then refuses to start, so a typo is a crash-looping container.' },
  { name: 'KC_SMTP_FROM_DISPLAY_NAME', cls: CONFIG, def: 'ADA', desc: 'Realm sender display name.' },
  { name: 'KC_SMTP_USERNAME', cls: EXTERNAL,
    desc: 'Realm SMTP username. Empty for mailpit, which requires no auth. Obtain from your mail relay (SES / SendGrid / Postmark / corporate Exchange).' },
  { name: 'KC_SMTP_PASSWORD', cls: EXTERNAL,
    desc: 'Realm SMTP password, issued with KC_SMTP_USERNAME by that same relay. Set KC_SMTP_STARTTLS=true at the same time or it crosses the wire in clear.' },
  { name: 'KC_SMTP_STARTTLS', cls: CONFIG, def: 'false', desc: 'false for mailpit (it refuses STARTTLS). true for any real relay — change together with KC_SMTP_HOST.' },
  { name: 'KC_SMTP_SSL', cls: CONFIG, def: 'false', desc: 'Implicit TLS (port 465). Mutually exclusive with STARTTLS.' },

  { name: 'ADA_ISSUER', cls: CONFIG, def: 'http://localhost:5173/idp/realms/pcsmcpl',
    desc: 'The PUBLIC issuer, compared against the iss claim character for character by ada-api, ada-auth, ada-notify and ada-worker. Must equal KC_HOSTNAME + /realms/ + ADA_REALM exactly.' },
  { name: 'ADA_INTERNAL_ISSUER_URL', cls: CONFIG, def: '',
    desc: 'The address that same issuer actually answers on from inside the compose network. EMPTY is correct: compose derives http://keycloak:${KC_HTTP_PORT}${KC_HTTP_RELATIVE_PATH}/realms/${ADA_REALM}. Conflating this with ADA_ISSUER gives a choice between an unresolvable host and a blanket 401.' },
  { name: 'OIDC_CLIENT_ID', cls: CONFIG, def: 'ada-web', desc: 'Public SPA client (PKCE S256, holds no secret). Must match a clientId in realm-ada.json.' },
  { name: 'ADA_AUTH_CLIENT_ID', cls: CONFIG, def: 'ada-auth', desc: 'Confidential client whose service account holds realm-management impersonation.' },
  { name: 'ADA_ADMIN_CLIENT_ID', cls: CONFIG, def: 'ada-notify', desc: 'Client ada-worker authenticates as to read recipient email addresses from the admin API.' },
  { name: 'ADA_API_CLIENT_ID', cls: CONFIG, def: 'ada-api', desc: 'Confidential client ada-api authenticates as to reach the Keycloak Admin API for officer administration. Must match a clientId in realm-ada.json.' },
  { name: 'NOTIFY_CLIENT_ID', cls: CONFIG, def: 'ada-ml', desc: 'Client ada-ml authenticates as when submitting notifications.' },
  { name: 'ADA_REQUIRED_SCOPE', cls: CONFIG, def: 'notify:send', desc: 'Scope ada-notify demands on an inbound token. The client scope name IS the OAuth scope value.' },

  { name: 'ADA_OTP_HMAC_KEY', cls: SECRET, gen: () => b64url(BYTES.hmacKey),
    desc: 'Keys the HMAC that one-time codes are stored under in Redis. The in-code default is a keyed hash with a KNOWN key, which is not a hash at all — with that default, every pending login code in Redis is trivially reversible. 256 bits to match HMAC-SHA256.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'ADA_SMS_PROVIDER', cls: CONFIG, def: 'console',
    desc: 'console writes the code to the ada-auth container log and sends no SMS, so a clean `up` has a working OTP login with no provider account. Refuses to be constructed when ADA_ENV=production.' },
  { name: 'ADA_TWOFACTOR_API_KEY', cls: EXTERNAL,
    desc: 'API key for the 2Factor.in SMS gateway. Needed only when ADA_SMS_PROVIDER=twofactor. Obtain: 2factor.in dashboard -> API key.' },
  { name: 'ADA_TWOFACTOR_TEMPLATE', cls: CONFIG, def: 'OTP1', desc: 'Approved DLT template name at the SMS gateway.' },
  { name: 'ADA_EMAIL_OTP_PROVIDER', cls: CONFIG, def: 'console', desc: 'Email one-time codes. Its own relay, not ada-notify\'s: a login code must not queue behind a retry ladder measured in minutes.' },
  { name: 'ADA_AUTH_SMTP_HOST', cls: CONFIG, def: 'mailpit', desc: 'SMTP host for ada-auth email codes.' },
  { name: 'ADA_AUTH_SMTP_PORT', cls: CONFIG, def: '1025', desc: 'SMTP port for ada-auth email codes.' },
  { name: 'ADA_AUTH_SMTP_USERNAME', cls: EXTERNAL, desc: 'SMTP username for ada-auth email codes. Empty for mailpit. From your mail relay.' },
  { name: 'ADA_AUTH_SMTP_PASSWORD', cls: EXTERNAL, desc: 'SMTP password for ada-auth email codes. From your mail relay.' },
  { name: 'ADA_AUTH_SMTP_STARTTLS', cls: CONFIG, def: 'false', desc: 'true for any real relay.' },
  { name: 'ADA_AUTH_SMTP_SSL', cls: CONFIG, def: 'false', desc: 'Implicit TLS.' },
  { name: 'ADA_AUTH_EMAIL_FROM', cls: CONFIG, def: 'ada@pcsmcpl.net', desc: 'Sender for ada-auth email codes.' },
  { name: 'ADA_AUTH_EMAIL_FROM_NAME', cls: CONFIG, def: 'ADA', desc: 'Sender display name for ada-auth email codes.' },
  { name: 'ADA_OTP_PHONE_ATTRIBUTE', cls: CONFIG, def: 'phoneNumber', desc: 'Keycloak user attribute holding the phone number. Declared in the realm user profile.' },
  { name: 'ADA_OTP_REVEAL_UNKNOWN_PHONE', cls: CONFIG, def: 'false', desc: 'Keep false. true turns the login form into a phone-number enumeration oracle.' },
  { name: 'ADA_OTP_REVEAL_UNKNOWN_EMAIL', cls: CONFIG, def: 'false', desc: 'Keep false. Same enumeration oracle, for addresses.' },
  { name: 'ADA_DEV_OTP', cls: CONFIG, def: '',
    desc: 'A FIXED one-time code that is accepted for any account when ADA_ALLOW_OTP_DEV_BYPASS=true. Deliberately EMPTY here — the in-code default is a well-known six-digit constant, i.e. a universal password. Leave both this and the bypass flag alone unless you are debugging the OTP path locally.' },
  { name: 'ADA_ALLOW_OTP_DEV_BYPASS', cls: CONFIG, def: 'false',
    desc: 'MUST stay false anywhere a real person can reach the login form. true makes ADA_DEV_OTP a master key to every account in the realm.' },

  { name: 'ADA_EMAIL_PROVIDER', cls: CONFIG, def: 'smtp', desc: 'smtp sends; stub discards; failing_stub refuses everything on purpose, which is how the retry ladder and dead-letter queue are demonstrated.' },
  { name: 'ADA_SMTP_HOST', cls: CONFIG, def: 'mailpit', desc: 'Delivery SMTP host.' },
  { name: 'ADA_SMTP_PORT', cls: CONFIG, def: '1025', desc: 'Delivery SMTP port.' },
  { name: 'ADA_SMTP_USERNAME', cls: EXTERNAL, desc: 'Delivery SMTP username. Empty for mailpit. From your mail relay.' },
  { name: 'ADA_SMTP_PASSWORD', cls: EXTERNAL, desc: 'Delivery SMTP password. From your mail relay. Set ADA_SMTP_STARTTLS=true together with it.' },
  { name: 'ADA_SMTP_STARTTLS', cls: CONFIG, def: 'false', desc: 'Mailpit refuses STARTTLS; a real relay requires it. Change together with ADA_SMTP_HOST or the password crosses the wire in clear.' },
  { name: 'ADA_SMTP_SSL', cls: CONFIG, def: 'false', desc: 'Implicit TLS.' },
  { name: 'ADA_EMAIL_FROM', cls: CONFIG, def: 'ada@pcsmcpl.net', desc: 'Notification sender address.' },
  { name: 'ADA_EMAIL_FROM_NAME', cls: CONFIG, def: 'ADA', desc: 'Notification sender display name.' },
  { name: 'NOTIFY_ENABLED', cls: CONFIG, def: 'true', desc: 'ada-ml posts a notification when an analysis finishes or fails.' },
  { name: 'NOTIFY_URL', cls: CONFIG, def: 'http://ada-notify:8001', desc: 'In-network address of ada-notify.' },

  { name: 'ML_SERVICE_TOKEN', cls: SECRET, gen: () => b64url(BYTES.bearerToken),
    desc: 'Shared bearer token ada-api presents to ada-ml. Both services read THIS SAME variable, so it is consistent by construction. Its in-code default is empty, and empty means the model service — which owns the GPU, the weights and the DDL — accepts unauthenticated job submissions from anything that can reach port 8100. Generating it closes that.',
    placeholder: 'generated-by-gen-env.mjs' },
  { name: 'ML_SERVICE_URL', cls: CONFIG, def: 'http://ada-ml:8100', desc: 'In-network address of ada-ml.' },

  { name: 'APP_ORIGIN', cls: CONFIG, def: 'http://localhost:5173', desc: 'Origin a browser reaches ADA on. Used for CORS and for the link in notification bodies.' },
  { name: 'FRONTEND_PORT', cls: CONFIG, def: '5173', desc: 'Host port for the frontend. The other port a person types.' },
  { name: 'BACKEND_PORT', cls: CONFIG, def: '8000', desc: 'Host port for ada-api (127.0.0.1 only).' },
  { name: 'ADA_NOTIFY_PORT', cls: CONFIG, def: '8001', desc: 'Host port for ada-notify (127.0.0.1 only).' },
  { name: 'ADA_AUTH_PORT', cls: CONFIG, def: '8002', desc: 'Host port for ada-auth (127.0.0.1 only).' },
  { name: 'ML_PORT', cls: CONFIG, def: '8100', desc: 'Host port for ada-ml (127.0.0.1 only).' },
  { name: 'MAILPIT_HTTP_PORT', cls: CONFIG, def: '8025', desc: 'Mailpit web inbox.' },
  { name: 'MAILPIT_SMTP_PORT', cls: CONFIG, def: '1025', desc: 'Mailpit SMTP listener.' },
  { name: 'ADA_DATA_PATH', cls: CONFIG, def: '/app/data',
    desc: 'Mount point for ../data in BOTH ada-api and ada-ml. They must agree: ada-api records an absolute path in a row and ada-ml opens it.' },
  { name: 'HF_CACHE_DIR', cls: CONFIG, def: '~/.cache/huggingface', desc: 'Host HuggingFace cache, shared into ada-ml so a rebuild does not re-download ~1.5 GB.' },
  { name: 'ADA_ENV', cls: CONFIG, def: 'local', desc: 'local | staging | production. Several unsafe defaults refuse to construct when this is production.' },
  { name: 'ADA_LOG_LEVEL', cls: CONFIG, def: 'INFO', desc: 'Log level for ada-auth, ada-notify, ada-worker.' },
  { name: 'LOG_LEVEL', cls: CONFIG, def: 'INFO', desc: 'Log level for ada-api and ada-ml.' },

  { name: 'HF_TOKEN', cls: EXTERNAL,
    desc: 'HuggingFace access token. Needed ONLY to pull the gated facebook/sam3 weights (SAM_BACKEND=sam3); harmless when unset. Obtain: huggingface.co -> Settings -> Access Tokens (read scope), after being granted access to the gated repo.' },
  { name: 'AUTO_FETCH_WEIGHTS', cls: CONFIG, def: 'true', desc: 'First-boot convenience; see services/ml-worker/entrypoint.sh.' },
  { name: 'AUTO_SAMPLE_DATA', cls: CONFIG, def: 'true', desc: 'Seed the demo image pair on first boot.' },
  { name: 'MODEL_MODE', cls: CONFIG, def: 'segdiff', desc: 'Change-detection mode.' },
  { name: 'MODEL_BACKEND', cls: CONFIG, def: 'auto', desc: 'Inference backend selection.' },
  { name: 'SEED_MODE', cls: CONFIG, def: 'encroachment', desc: 'Seeding strategy.' },
  { name: 'SAM_REFINE', cls: CONFIG, def: 'true', desc: 'Refine masks with SAM.' },
  { name: 'CHIP_SIZE', cls: CONFIG, def: '256', desc: 'Tile size in pixels.' },
  { name: 'CHIP_OVERLAP', cls: CONFIG, def: '64', desc: 'Tile overlap in pixels.' },
  { name: 'CHANGE_THRESHOLD', cls: CONFIG, def: '0.5', desc: 'Probability above which a pixel counts as changed.' },
  { name: 'MIN_CHANGE_AREA_M2', cls: CONFIG, def: '15.0', desc: 'Discard detections below this ground area.' },
  { name: 'ML_DEVICE', cls: CONFIG, def: 'auto', desc: 'auto picks CUDA, then Metal, then CPU. Inside this container it can only ever be cuda or cpu.' },
  { name: 'REQUIRE_GPU', cls: CONFIG, def: 'false', desc: 'true turns a silent CPU fallback into a startup error. Pair with docker-compose.gpu.yml.' },
  { name: 'ONNX_CPU_THREADS', cls: CONFIG, def: '4', desc: 'onnxruntime thread count.' },
  { name: 'GPU_MEMORY_LIMIT_GB', cls: CONFIG, def: '4.0', desc: 'GPU memory ceiling.' },
  { name: 'HOST_MEMORY_LIMIT_GB', cls: CONFIG, def: '18.0', desc: 'Host memory ceiling.' },
  { name: 'BUILDING_BACKEND', cls: CONFIG, def: 'changestar', desc: 'changestar (ViT-B, 1024px) | geobase (U-Net, 256px).' },
  { name: 'VEGETATION_MODE', cls: CONFIG, def: 'learned', desc: 'learned (SegFormer-B5) | index (NDVI + excess-green).' },
  { name: 'SUPERIMPOSE_SOURCE', cls: CONFIG, def: 'auto', desc: 'Warp from the COG rather than the originals.' },
  { name: 'SAM_BACKEND', cls: CONFIG, def: 'sam2', desc: 'sam2 | sam3. sam3 needs HF_TOKEN and access to the gated repo.' },
  { name: 'SAM_MODEL_REPO', cls: CONFIG, def: 'facebook/sam2.1-hiera-large', desc: 'HuggingFace repo for SAM weights.' },
  { name: 'SAM_MODEL_LOCAL', cls: CONFIG, def: 'sam2.1-hiera-large', desc: 'Local directory name under data/weights.' },
  { name: 'INSTANCE_DECIDER', cls: CONFIG, def: 'shadow', desc: 'rules | shadow | active.' },
  { name: 'MIN_TRAINING_SAMPLES', cls: CONFIG, def: '150', desc: 'Samples before the learned decider goes active.' },
  { name: 'DETECT_DEMOLITION', cls: CONFIG, def: 'true', desc: 'Report removals as well as additions.' },
  { name: 'REQUEUE_STALE_ON_STARTUP', cls: CONFIG, def: 'true', desc: 'Re-queue jobs left running by a crash.' },

  { name: 'KC_CONTAINER', cls: CONFIG, def: 'ada-keycloak', desc: 'Container name the kcadm helper scripts exec into.' },
  { name: 'KC_ADMIN_URL', cls: CONFIG, def: 'http://localhost:8090/idp',
    desc: 'Base URL infra/scripts/create_users.py talks to the admin API on. Host-side, so KC_HTTP_HOST_PORT + KC_HTTP_RELATIVE_PATH. Local Docker only — never point this at a remote or production Keycloak.' },
];

const BY_NAME = new Map(VARS.map((v) => [v.name, v]));
const isSecret = (v) => v.cls === SECRET;

function parseEnv(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let [, key, val] = m;
    if ((val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
        (val.startsWith("'") && val.endsWith("'") && val.length > 1)) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(' #');
      if (hash !== -1) val = val.slice(0, hash);
      val = val.trim();
    }
    out.set(key, val);
  }
  return out;
}

function serialise(value) {
  if (value === '') return '';
  return /^[A-Za-z0-9_\-./:@+~]*$/.test(value) ? value : JSON.stringify(value);
}

function wrapComment(text, width = 74) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > width) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.map((l) => `# ${l}`);
}

const SECTIONS = [
  ['PostgreSQL', ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT', 'POSTGRES_KEYCLOAK_DB', 'POSTGRES_NOTIFY_DB', 'KC_DB_USERNAME', 'KC_DB_PASSWORD']],
  ['PostgreSQL connection pool (ada-api, ada-ml)', ['DB_POOL_SIZE', 'DB_MAX_OVERFLOW', 'DB_POOL_TIMEOUT', 'DB_POOL_RECYCLE', 'DB_POOL_PRE_PING']],
  ['Redis', ['REDIS_PASSWORD', 'REDIS_HOST_PORT', 'ADA_REDIS_URL']],
  ['Keycloak server', ['KC_BOOTSTRAP_ADMIN_USERNAME', 'KC_BOOTSTRAP_ADMIN_PASSWORD', 'KC_HTTP_PORT', 'KC_HTTP_HOST_PORT', 'KC_MANAGEMENT_PORT', 'KC_HOSTNAME', 'KC_HTTP_RELATIVE_PATH', 'KC_HOSTNAME_STRICT', 'ADA_REALM', 'KC_CONTAINER', 'KC_ADMIN_URL']],
  ['Keycloak realm import — confidential client secrets', ['ADA_NOTIFY_CLIENT_SECRET', 'ADA_AUTH_CLIENT_SECRET', 'ADA_ML_CLIENT_SECRET', 'ADA_API_CLIENT_SECRET']],
  ['Keycloak realm import — external identity providers (disabled by default)', ['ADA_GOOGLE_CLIENT_ID', 'ADA_GOOGLE_CLIENT_SECRET', 'ADA_GOOGLE_HOSTED_DOMAIN', 'ADA_GITHUB_CLIENT_ID', 'ADA_GITHUB_CLIENT_SECRET']],
  ['Keycloak realm mail', ['KC_SMTP_HOST', 'KC_SMTP_PORT', 'KC_SMTP_FROM', 'KC_SMTP_FROM_DISPLAY_NAME', 'KC_SMTP_USERNAME', 'KC_SMTP_PASSWORD', 'KC_SMTP_STARTTLS', 'KC_SMTP_SSL']],
  ['Shared identity configuration', ['ADA_ISSUER', 'ADA_INTERNAL_ISSUER_URL', 'OIDC_CLIENT_ID', 'ADA_AUTH_CLIENT_ID', 'ADA_ADMIN_CLIENT_ID', 'ADA_API_CLIENT_ID', 'NOTIFY_CLIENT_ID', 'ADA_REQUIRED_SCOPE']],
  ['ada-auth — one-time codes', ['ADA_OTP_HMAC_KEY', 'ADA_SMS_PROVIDER', 'ADA_TWOFACTOR_API_KEY', 'ADA_TWOFACTOR_TEMPLATE', 'ADA_EMAIL_OTP_PROVIDER', 'ADA_AUTH_SMTP_HOST', 'ADA_AUTH_SMTP_PORT', 'ADA_AUTH_SMTP_USERNAME', 'ADA_AUTH_SMTP_PASSWORD', 'ADA_AUTH_SMTP_STARTTLS', 'ADA_AUTH_SMTP_SSL', 'ADA_AUTH_EMAIL_FROM', 'ADA_AUTH_EMAIL_FROM_NAME', 'ADA_OTP_PHONE_ATTRIBUTE', 'ADA_OTP_REVEAL_UNKNOWN_PHONE', 'ADA_OTP_REVEAL_UNKNOWN_EMAIL', 'ADA_DEV_OTP', 'ADA_ALLOW_OTP_DEV_BYPASS']],
  ['ada-notify / ada-worker — delivery', ['ADA_EMAIL_PROVIDER', 'ADA_SMTP_HOST', 'ADA_SMTP_PORT', 'ADA_SMTP_USERNAME', 'ADA_SMTP_PASSWORD', 'ADA_SMTP_STARTTLS', 'ADA_SMTP_SSL', 'ADA_EMAIL_FROM', 'ADA_EMAIL_FROM_NAME', 'NOTIFY_ENABLED', 'NOTIFY_URL']],
  ['Service-to-service', ['ML_SERVICE_TOKEN', 'ML_SERVICE_URL']],
  ['Ports, origins, paths', ['APP_ORIGIN', 'FRONTEND_PORT', 'BACKEND_PORT', 'ADA_NOTIFY_PORT', 'ADA_AUTH_PORT', 'ML_PORT', 'MAILPIT_HTTP_PORT', 'MAILPIT_SMTP_PORT', 'ADA_DATA_PATH', 'HF_CACHE_DIR', 'ADA_ENV', 'ADA_LOG_LEVEL', 'LOG_LEVEL']],
  ['ada-ml tunables', ['HF_TOKEN', 'AUTO_FETCH_WEIGHTS', 'AUTO_SAMPLE_DATA', 'MODEL_MODE', 'MODEL_BACKEND', 'SEED_MODE', 'SAM_REFINE', 'CHIP_SIZE', 'CHIP_OVERLAP', 'CHANGE_THRESHOLD', 'MIN_CHANGE_AREA_M2', 'ML_DEVICE', 'REQUIRE_GPU', 'ONNX_CPU_THREADS', 'GPU_MEMORY_LIMIT_GB', 'HOST_MEMORY_LIMIT_GB', 'BUILDING_BACKEND', 'VEGETATION_MODE', 'SUPERIMPOSE_SOURCE', 'SAM_BACKEND', 'SAM_MODEL_REPO', 'SAM_MODEL_LOCAL', 'INSTANCE_DECIDER', 'MIN_TRAINING_SAMPLES', 'DETECT_DEMOLITION', 'REQUEUE_STALE_ON_STARTUP']],
];

function render({ values, forExample, extras }) {
  const L = [];
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (forExample) {
    L.push('# ============ ADA Change Detection — environment TEMPLATE ============');
    L.push('#');
    L.push('# THIS FILE IS COMMITTED. Every value in it is a placeholder. It must');
    L.push('# never contain a real credential.');
    L.push('#');
    L.push('# Do not copy this to .env and edit it by hand — you will miss one.');
    L.push('# Generate the real file instead, which fills every "secret" below with');
    L.push('# fresh randomness and leaves every "external" one empty for you:');
    L.push('#');
    L.push('#     node infra/scripts/gen-env.mjs');
    L.push('#     node infra/scripts/gen-env.mjs --check     # proves nothing generic survived');
    L.push('#');
    L.push('# Regenerate THIS file with:  node infra/scripts/gen-env.mjs --example');
  } else {
    L.push('# ============ ADA Change Detection — environment ============');
    L.push('#');
    L.push('# GENERATED AND MAINTAINED BY infra/scripts/gen-env.mjs.');
    L.push('# NEVER COMMIT THIS FILE. It is covered by .gitignore; keep it that way.');
    L.push('#');
    L.push('# Hand edits are safe: the generator only ever ADDS what is missing and');
    L.push('# never overwrites a value that is already set. To replace one secret:');
    L.push('#');
    L.push('#     node infra/scripts/gen-env.mjs --rotate REDIS_PASSWORD');
    L.push('#');
    L.push('# and then recreate the services that hold it — see infra/README-secrets.md.');
    L.push(`#`);
    L.push(`# Last touched by the generator: ${stamp}`);
  }
  L.push('#');
  L.push('# Classification, shown per variable:');
  L.push('#   [secret]   generated randomly. Present only in this file.');
  L.push('#   [config]   a setting, not a credential. Safe to read aloud.');
  L.push('#   [external] issued by a third party. Empty until you paste one in.');
  L.push('');

  for (const [title, names] of SECTIONS) {
    L.push('# ' + '─'.repeat(72));
    L.push(`# ${title}`);
    L.push('# ' + '─'.repeat(72));
    L.push('');
    for (const name of names) {
      const v = BY_NAME.get(name);
      if (!v) continue;
      L.push(...wrapComment(`[${v.cls}] ${v.desc}`));
      let out;
      if (forExample) {
        out = isSecret(v) ? (v.placeholder ?? 'generated-by-gen-env.mjs')
            : v.cls === EXTERNAL ? ''
            : (v.def ?? '');
      } else {
        out = values.get(name) ?? '';
      }
      L.push(`${name}=${serialise(out)}`);
      L.push('');
    }
  }

  if (extras && extras.size) {
    L.push('# ' + '─'.repeat(72));
    L.push('# Unmanaged — set by hand, not in the generator inventory.');
    L.push('# Preserved verbatim on every run. Add them to VARS in');
    L.push('# infra/scripts/gen-env.mjs if they are meant to be permanent.');
    L.push('# ' + '─'.repeat(72));
    L.push('');
    for (const [k, val] of extras) L.push(`${k}=${serialise(val)}`);
    L.push('');
  }
  return L.join('\n');
}

function looksPlaceholder(value) {
  const v = String(value).trim().toLowerCase();
  if (!v) return false;
  const stripped = v.replace(/[^a-z0-9]/g, '');
  for (const tok of PLACEHOLDER_TOKENS) {
    const t = tok.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!t) continue;
    if (stripped === t) return true;
    if (stripped.length <= 24 && stripped.includes(t) && t.length >= 5) return true;
  }
  if (/^(.)\1*$/.test(stripped) && stripped.length > 2) return true;
  if (/^(0123|1234|abcd|qwert)/.test(stripped)) return true;
  return false;
}

const MIN_SECRET_CHARS = 24;

function check(path) {
  if (!existsSync(path)) {
    console.error(`FAIL  no env file at ${path}`);
    console.error(`      create it with:  node ${relative(REPO, fileURLToPath(import.meta.url))}`);
    return 1;
  }
  const values = parseEnv(readFileSync(path, 'utf8'));
  const missing = [], weak = [], generic = [], stillTemplate = [], emptyExternal = [];

  for (const v of VARS) {
    const has = values.has(v.name);
    const val = (values.get(v.name) ?? '').trim();
    if (v.cls === EXTERNAL) { if (!has || !val) emptyExternal.push(v.name); continue; }
    if (!has) { missing.push(v.name); continue; }
    if (isSecret(v)) {
      if (!val) { missing.push(v.name); continue; }
      if (v.placeholder && val === v.placeholder) { stillTemplate.push(v.name); continue; }
      if (val.length < MIN_SECRET_CHARS) weak.push(`${v.name} (${val.length} chars, need >= ${MIN_SECRET_CHARS})`);
      if (looksPlaceholder(val)) generic.push(v.name);
    } else if (looksPlaceholder(val) && val !== (v.def ?? '')) {
      generic.push(v.name);
    }
  }

  const consistency = [];
  const kcUser = (values.get('KC_DB_USERNAME') ?? '').trim();
  const kcPass = (values.get('KC_DB_PASSWORD') ?? '').trim();
  if (!kcUser && kcPass) consistency.push('KC_DB_PASSWORD is set but KC_DB_USERNAME is empty — Keycloak will connect as POSTGRES_USER with the wrong password');
  if (kcUser && !kcPass) consistency.push('KC_DB_USERNAME is set but KC_DB_PASSWORD is empty — init-db.sh refuses to create a login role without one');
  if ((values.get('ADA_ALLOW_OTP_DEV_BYPASS') ?? '').trim().toLowerCase() === 'true') {
    consistency.push('ADA_ALLOW_OTP_DEV_BYPASS=true — ADA_DEV_OTP is a master key to every account in the realm');
  }
  const issuer = (values.get('ADA_ISSUER') ?? '').trim();
  const host = (values.get('KC_HOSTNAME') ?? '').trim();
  const realm = (values.get('ADA_REALM') ?? '').trim();
  if (issuer && host && realm && issuer !== `${host.replace(/\/$/, '')}/realms/${realm}`) {
    consistency.push('ADA_ISSUER is not KC_HOSTNAME + /realms/ + ADA_REALM — tokens will be rejected for an issuer mismatch');
  }
  const uniq = new Map();
  for (const v of VARS) {
    if (!isSecret(v)) continue;
    const val = (values.get(v.name) ?? '').trim();
    if (!val) continue;
    if (!uniq.has(val)) uniq.set(val, []);
    uniq.get(val).push(v.name);
  }
  for (const names of uniq.values()) {
    if (names.length > 1) consistency.push(`these secrets share one value, so rotating one does not isolate the others: ${names.join(', ')}`);
  }

  const say = (label, list) => { if (list.length) { console.error(`${label} (${list.length}):`); for (const n of list) console.error(`    ${n}`); } };
  console.error(`checking ${path}`);
  console.error(`  ${VARS.length} variables in the inventory`);
  say('FAIL  missing or empty', missing);
  say('FAIL  still at the .env.example placeholder', stillTemplate);
  say('FAIL  generic / guessable value', generic);
  say('FAIL  too short', weak);
  say('FAIL  inconsistent', consistency);
  if (emptyExternal.length) {
    console.error(`note  ${emptyExternal.length} external credential(s) empty — fine unless you enable the feature:`);
    for (const n of emptyExternal) console.error(`    ${n}`);
  }
  const bad = missing.length + stillTemplate.length + generic.length + weak.length + consistency.length;
  if (bad === 0) { console.error('OK    every managed variable is present and none is generic.'); return 0; }
  console.error(`\n${bad} problem(s). No values were printed.`);
  return 1;
}

function parseArgs(argv) {
  const a = { out: null, check: false, example: false, rotate: [], sepKc: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--check') a.check = true;
    else if (t === '--example') a.example = true;
    else if (t === '--separate-kc-db-role') a.sepKc = true;
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--rotate') a.rotate.push(argv[++i]);
    else if (t === '--help' || t === '-h') a.help = true;
    else { console.error(`unknown argument: ${t}`); process.exit(2); }
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
    return 0;
  }

  const target = resolve(args.out ?? resolve(INFRA, 'compose', '.env'));

  if (args.example) {
    const p = resolve(args.out ?? resolve(INFRA, 'compose', '.env.example'));
    writeFileSync(p, render({ values: new Map(), forExample: true, extras: null }) + '\n', { mode: 0o644 });
    console.error(`wrote ${p} (placeholders only, safe to commit)`);
    return 0;
  }
  if (args.check) return check(target);

  for (const name of args.rotate) {
    const v = BY_NAME.get(name);
    if (!v) { console.error(`--rotate ${name}: not in the inventory`); return 2; }
    if (!isSecret(v)) { console.error(`--rotate ${name}: not a secret; edit it by hand`); return 2; }
  }

  const existed = existsSync(target);
  const before = existed ? readFileSync(target, 'utf8') : '';
  const values = existed ? parseEnv(before) : new Map();

  if (!existed) {
    try { mkdirSync(dirname(target), { recursive: true }); } catch { /* fine */ }
  }

  const added = [], rotated = [], kept = [];
  for (const v of VARS) {
    const cur = values.get(v.name);
    const mustRotate = args.rotate.includes(v.name);
    if (cur !== undefined && cur !== '' && !mustRotate) { kept.push(v.name); continue; }
    if (mustRotate && isSecret(v)) { values.set(v.name, v.gen()); rotated.push(v.name); continue; }
    if (isSecret(v)) { values.set(v.name, v.gen()); added.push(v.name); }
    else if (cur === undefined) { values.set(v.name, v.cls === EXTERNAL ? '' : (v.def ?? '')); added.push(v.name); }
    else { kept.push(v.name); }
  }

  if (args.sepKc) {
    if (!values.get('KC_DB_USERNAME')) { values.set('KC_DB_USERNAME', 'ada_keycloak'); added.push('KC_DB_USERNAME'); }
    if (!values.get('KC_DB_PASSWORD')) { values.set('KC_DB_PASSWORD', b64url(BYTES.password)); added.push('KC_DB_PASSWORD'); }
    console.error('--separate-kc-db-role: KC_DB_USERNAME / KC_DB_PASSWORD set.');
    console.error('  This takes effect ONLY on a first initialisation of an empty');
    console.error('  ada_pgdata volume. Against an existing volume the role does not');
    console.error('  exist and Keycloak will fail to connect.');
  }

  if (!existed || added.includes('ADA_ISSUER')) {
    const host = (values.get('KC_HOSTNAME') || '').replace(/\/$/, '');
    const realm = values.get('ADA_REALM') || 'pcsmcpl';
    if (host) values.set('ADA_ISSUER', `${host}/realms/${realm}`);
  }

  const known = new Set(VARS.map((v) => v.name));
  const extras = new Map([...values].filter(([k]) => !known.has(k)));

  const rendered = render({ values, forExample: false, extras }) + '\n';

  const strip = (s) => s.replace(/^# Last touched by the generator: .*$/m, '');
  if (existed && strip(before) === strip(rendered)) {
    console.error(`no change — ${target} already has every managed variable`);
    console.error(`  ${kept.length} kept, 0 added, 0 rotated`);
    return 0;
  }

  if (existed) {
    const backup = `${target}.backup.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(target, backup);
    console.error(`backup  ${backup}`);
  }

  try {
    writeFileSync(target, rendered, { mode: 0o600 });
  } catch (err) {
    console.error('');
    console.error(`FAILED to write ${target}`);
    console.error(`  ${err.code ?? ''} ${err.message}`);
    console.error('');
    console.error('  If this is a permissions or sandbox refusal, write elsewhere and');
    console.error('  move the file into place yourself:');
    console.error('');
    console.error(`      node infra/scripts/gen-env.mjs --out /tmp/ada.env`);
    console.error(`      mv /tmp/ada.env infra/compose/.env && chmod 600 infra/compose/.env`);
    console.error('');
    return 1;
  }

  console.error(`wrote ${target}  (mode 0600)`);
  console.error(`  ${kept.length} kept, ${added.length} added, ${rotated.length} rotated`);
  if (added.length) { console.error('  added:'); for (const n of added) console.error(`    ${n}`); }
  if (rotated.length) {
    console.error('  ROTATED:'); for (const n of rotated) console.error(`    ${n}`);
    console.error('');
    console.error('  A rotated secret does NOT reach a running container, and for the');
    console.error('  three ADA_*_CLIENT_SECRET variables it does not reach an already-');
    console.error('  imported realm either (--import-realm is IGNORE_EXISTING).');
    console.error('  See infra/README-secrets.md before you restart anything.');
  }
  console.error('');
  console.error('  No secret value was printed. Verify with:');
  console.error('      node infra/scripts/gen-env.mjs --check');
  return 0;
}

process.exit(main());
