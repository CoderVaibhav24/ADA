import Constants from 'expo-constants';

import type { AdaEnvName, AppVariant } from '../../../ada.config.ts';

/*
 * Build-time configuration: the runtime view of `ada.config.ts`.
 *
 * `ada.config.ts` (ACTIVE_ENV) is resolved once by `app.config.ts` into `extra.ada`,
 * and this file is the only runtime reader of that block. It deliberately does not
 * call `resolveAdaConfig` itself: an OTA update carries the `extra` it was exported
 * with, so reading `extra.ada` keeps the binary, the bundle and the update agreeing.
 *
 * Nothing here can change without a new binary or update, which is why the list is
 * short. Everything the authority can change — statuses, option lists, thresholds,
 * which actions are enabled — is fetched at runtime by the rest of `src/services/config/`.
 */
export type AdaEnv = {
  /** Which ada.config.ts preset this build was made from. */
  readonly name: AdaEnvName;
  readonly appVariant: AppVariant;
  readonly apiBaseUrl: string;
  readonly authClientId: string;
  readonly authIssuerOverride: string | null;
  /** ada-notify origin. Null switches push and the inbox off rather than failing. */
  readonly notifyBaseUrl: string | null;
  readonly apnsEnvironment: 'development' | 'production';
};

// Narrows one string out of the untyped `extra` bag; an absent value is a config bug, not a default.
function requireString(extra: Record<string, unknown>, key: string): string {
  const value = extra[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `app.config.ts is missing extra.ada.${key}. The build cannot reach the API ` +
        'or the identity provider without it.',
    );
  }
  return value;
}

// A non-empty string without trailing slashes, or null.
function optionalUrl(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value.replace(/\/+$/, '') : null;
}

// Reads extra.ada off whichever config object this runtime exposes.
function readEnv(): AdaEnv {
  const config = Constants.expoConfig ?? null;
  const extra: unknown = config?.extra;
  const ada: unknown =
    extra !== null && typeof extra === 'object'
      ? (extra as Record<string, unknown>).ada
      : undefined;

  if (ada === null || typeof ada !== 'object') {
    throw new Error('app.config.ts is missing the extra.ada block.');
  }

  const bag = ada as Record<string, unknown>;
  const issuerOverride = bag.authIssuerOverride;
  const production = bag.appVariant === 'production';

  return {
    name: bag.env === 'dev' || bag.env === 'prod' ? bag.env : 'local',
    appVariant: production ? 'production' : 'development',
    apiBaseUrl: requireString(bag, 'apiBaseUrl').replace(/\/+$/, ''),
    authClientId: requireString(bag, 'authClientId'),
    authIssuerOverride:
      typeof issuerOverride === 'string' && issuerOverride !== '' ? issuerOverride : null,
    notifyBaseUrl: optionalUrl(bag.notifyBaseUrl),
    apnsEnvironment: bag.apnsEnvironment === 'production' ? 'production' : 'development',
  };
}

export const env: AdaEnv = readEnv();
