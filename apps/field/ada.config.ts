/*
 * ADA ICMS field app: which deployment it talks to. The one environment switch.
 *
 * HOW TO SWITCH: change ACTIVE_ENV below to 'local', 'dev' or 'prod', then rebuild
 * the binary (or restart `expo start`). CI may instead set EXPO_PUBLIC_ADA_ENV.
 *
 * No other file may hard-code a host or a port. `app.config.ts` (Node, build time)
 * resolves this file into `extra.ada` and `updates.url`, the runtime reads `extra.ada`
 * through `src/services/config/env.ts`, and `scripts/*.mjs` import it directly.
 * That is why this file must not import React Native or anything else.
 *
 * OTA WARNING: `runtimeVersion` uses the fingerprint policy, and the fingerprint
 * hashes the resolved app config. Switching ACTIVE_ENV (or any override below)
 * produces a different fingerprint, so an update is only offered to binaries built
 * with the same env. Always publish updates with the env the binary was built with.
 */

export type AdaEnvName = 'local' | 'dev' | 'prod';
export type AppVariant = 'development' | 'production';

// THE LINE TO CHANGE. Overridden only by EXPO_PUBLIC_ADA_ENV (for CI).
export const ACTIVE_ENV: AdaEnvName = 'local';

export type AdaEnvPreset = {
  /** ada-api origin, no trailing slash. */
  readonly apiBaseUrl: string;
  /** ada-notify origin, no trailing slash. */
  readonly notifyBaseUrl: string;
  /** Manifest URL of the self-hosted update server (infra/ota). */
  readonly otaUrl: string;
  /**
   * Keycloak issuer override. Null means "ask ada-api's /api/auth/config at runtime",
   * which is the normal case: the portal reads the same endpoint, so they cannot drift.
   */
  readonly authIssuer: string | null;
  /** Keycloak public client for the native app (realm `pcsmcpl`). */
  readonly authClientId: string;
  /** APNs environment and default OTA channel. APP_VARIANT overrides it. */
  readonly appVariant: AppVariant;
};

/*
 * The machine running `infra/compose/docker-compose.yml`, as seen from the handset:
 *   - Android emulator: '10.0.2.2' (the emulator's alias for the host's loopback).
 *   - iOS simulator:    'localhost' (the simulator shares the Mac's network stack).
 *   - Physical device:  the Mac's LAN IP, e.g. '192.168.1.20' (System Settings > Wi-Fi > Details).
 *     Compose publishes ada-api and ada-notify on 127.0.0.1 only, so a device on the LAN
 *     cannot reach them. For an Android device on USB, use 'localhost' here and run
 *     `adb reverse tcp:8010 tcp:8010` (and 8011, 8020) instead. ada-ota can be exposed
 *     on the LAN with ADA_OTA_BIND=0.0.0.0.
 */
const LAN_HOST = 'localhost';

/*
 * Host ports as actually published. Compose falls back to 8000/8001 when infra/compose/.env
 * leaves BACKEND_PORT/ADA_NOTIFY_PORT blank, but infra/compose/.env sets 8010/8011, as do the
 * portal's Vite proxy, services/api/scripts/run_host.sh and the Keycloak redirect URIs.
 */
export const LOCAL_PORTS = {
  api: 8010, // ada-api:    BACKEND_PORT
  notify: 8011, // ada-notify: ADA_NOTIFY_PORT
  ota: 8020, // ada-ota:    ADA_OTA_PORT (compose profile `ota`)
  keycloak: 8091, // keycloak: KC_HTTP_HOST_PORT in infra/compose/.env (compose default 8090)
} as const;

/*
 * The native public client in realm `pcsmcpl`. Sign-in is a direct access grant
 * (username and password posted to the token endpoint), as the portal's form does;
 * no redirect URI is involved. Required client settings are in `README.md` §Keycloak;
 * until the client exists, sign-in reports `invalid_client` / `unauthorized_client`.
 */
const AUTH_CLIENT_ID = 'ada-field';

// Marker for values nobody has decided yet; a release build refuses to start with one.
const PLACEHOLDER = 'REPLACE-ME';

export const ADA_ENVS: Readonly<Record<AdaEnvName, AdaEnvPreset>> = {
  local: {
    apiBaseUrl: `http://${LAN_HOST}:${LOCAL_PORTS.api}`,
    notifyBaseUrl: `http://${LAN_HOST}:${LOCAL_PORTS.notify}`,
    otaUrl: `http://${LAN_HOST}:${LOCAL_PORTS.ota}/api/manifest`,
    // The token endpoint the handset can reach; tokens still carry KC_HOSTNAME's issuer, which ada-api validates.
    authIssuer: `http://${LAN_HOST}:${LOCAL_PORTS.keycloak}/idp/realms/pcsmcpl`,
    authClientId: AUTH_CLIENT_ID,
    appVariant: 'development',
  },
  // No ADA dev deployment exists yet. Replace every REPLACE-ME before using this preset.
  dev: {
    apiBaseUrl: `https://dev.ada.${PLACEHOLDER}`,
    notifyBaseUrl: `https://notify.dev.ada.${PLACEHOLDER}`,
    otaUrl: `https://ota.dev.ada.${PLACEHOLDER}/api/manifest`,
    authIssuer: null,
    authClientId: AUTH_CLIENT_ID,
    appVariant: 'development',
  },
  // No ADA production domain exists yet. A production build fails until these are real.
  prod: {
    apiBaseUrl: `https://ada.${PLACEHOLDER}`,
    notifyBaseUrl: `https://notify.ada.${PLACEHOLDER}`,
    otaUrl: `https://ota.ada.${PLACEHOLDER}/api/manifest`,
    authIssuer: null,
    authClientId: AUTH_CLIENT_ID,
    appVariant: 'production',
  },
};

export type ResolvedAdaConfig = AdaEnvPreset & { readonly env: AdaEnvName };

function isEnvName(value: string): value is AdaEnvName {
  return value === 'local' || value === 'dev' || value === 'prod';
}

// A set, non-empty environment variable, or null.
function given(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// Throws at config time when a production build would ship a cleartext or placeholder URL.
function assertReleaseSafe(config: ResolvedAdaConfig): void {
  const urls: [string, string | null][] = [
    ['apiBaseUrl', config.apiBaseUrl],
    ['notifyBaseUrl', config.notifyBaseUrl],
    ['otaUrl', config.otaUrl],
    ['authIssuer', config.authIssuer],
  ];
  const problems: string[] = [];
  for (const [name, url] of urls) {
    if (url === null) continue;
    if (url.includes(PLACEHOLDER)) problems.push(`${name} is still a placeholder (${url})`);
    else if (!url.startsWith('https://')) problems.push(`${name} is not https:// (${url})`);
  }
  if (config.appVariant === 'production' && problems.length > 0) {
    throw new Error(
      `ada.config.ts: refusing a production build (APP_VARIANT=production) for env '${config.env}':\n  - ` +
        problems.join('\n  - ') +
        '\nSet the real URLs in ADA_ENVS in apps/field/ada.config.ts. Release builds refuse ' +
        'cleartext, and a placeholder host never connects.',
    );
  }
  const placeholders = problems.filter((problem) => problem.includes(PLACEHOLDER));
  if (placeholders.length > 0) {
    console.warn(`ada.config.ts: env '${config.env}' has unresolved values:\n  - ${placeholders.join('\n  - ')}`);
  }
}

/*
 * ACTIVE_ENV plus the documented overrides, resolved once at build time. The runtime
 * reads the result from `extra.ada` and never calls this. Variables are read by literal
 * name, so Metro could inline them if this ever ran inside a bundle.
 */
export function resolveAdaConfig(): ResolvedAdaConfig {
  const requested = given(process.env.EXPO_PUBLIC_ADA_ENV);
  if (requested !== null && !isEnvName(requested)) {
    throw new Error(`EXPO_PUBLIC_ADA_ENV must be 'local', 'dev' or 'prod', got '${requested}'.`);
  }
  const env: AdaEnvName = requested ?? ACTIVE_ENV;
  const preset = ADA_ENVS[env];

  const variant = given(process.env.APP_VARIANT);
  if (variant !== null && variant !== 'development' && variant !== 'production') {
    throw new Error(`APP_VARIANT must be 'development' or 'production', got '${variant}'.`);
  }

  const resolved: ResolvedAdaConfig = {
    env,
    apiBaseUrl: stripSlash(given(process.env.EXPO_PUBLIC_ADA_API_URL) ?? preset.apiBaseUrl),
    notifyBaseUrl: stripSlash(given(process.env.EXPO_PUBLIC_ADA_NOTIFY_URL) ?? preset.notifyBaseUrl),
    otaUrl: given(process.env.ADA_OTA_URL) ?? preset.otaUrl,
    authIssuer: given(process.env.EXPO_PUBLIC_ADA_AUTH_ISSUER) ?? preset.authIssuer,
    authClientId: given(process.env.EXPO_PUBLIC_ADA_AUTH_CLIENT_ID) ?? preset.authClientId,
    appVariant: variant ?? preset.appVariant,
  };
  assertReleaseSafe(resolved);
  return resolved;
}

// ada-api as reached from the Mac running compose (for scripts), not from a handset.
export function hostSideApiUrl(config: ResolvedAdaConfig): string {
  return config.env === 'local' ? `http://127.0.0.1:${LOCAL_PORTS.api}` : config.apiBaseUrl;
}
