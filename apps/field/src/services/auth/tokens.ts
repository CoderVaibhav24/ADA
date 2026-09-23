import { deleteSecret, readSecret, writeSecret } from '@/services/storage/secure';

import type { Profile } from './claims';

/*
 * Token persistence. Four keys in the Keychain / Keystore, never one blob:
 * SecureStore warns above 2048 bytes per value and a Keycloak access token with
 * a long role list gets close on its own.
 */
export type TokenSet = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  readonly scope: string | null;
};

type TokenMeta = {
  readonly expiresAt: number;
  readonly scope: string | null;
};

function isTokenMeta(value: unknown): value is TokenMeta {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { expiresAt?: unknown }).expiresAt === 'number'
  );
}

function isProfile(value: unknown): value is Profile {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { subject?: unknown }).subject === 'string'
  );
}

// Reads the stored token set, or null when this device has never signed in.
export async function readTokens(): Promise<TokenSet | null> {
  const [accessToken, refreshToken, rawMeta] = await Promise.all([
    readSecret('ada.auth.accessToken'),
    readSecret('ada.auth.refreshToken'),
    readSecret('ada.auth.tokenMeta'),
  ]);

  if (accessToken === null) return null;

  let meta: TokenMeta = { expiresAt: 0, scope: null };
  if (rawMeta !== null) {
    try {
      const parsed: unknown = JSON.parse(rawMeta);
      if (isTokenMeta(parsed)) meta = parsed;
    } catch {
      // An unreadable meta blob means "treat the token as expired", not "sign out".
    }
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: meta.expiresAt,
    scope: meta.scope,
  };
}

// Replaces the stored token set. A refresh that returns no new refresh token keeps the old one.
export async function writeTokens(tokens: TokenSet): Promise<void> {
  const meta: TokenMeta = { expiresAt: tokens.expiresAt, scope: tokens.scope };
  await Promise.all([
    writeSecret('ada.auth.accessToken', tokens.accessToken),
    writeSecret('ada.auth.tokenMeta', JSON.stringify(meta)),
    tokens.refreshToken === null
      ? Promise.resolve()
      : writeSecret('ada.auth.refreshToken', tokens.refreshToken),
  ]);
}

// Clears every token. Sign-out only — never a failed refresh (Architecture.md §5).
export async function clearTokens(): Promise<void> {
  await Promise.all([
    deleteSecret('ada.auth.accessToken'),
    deleteSecret('ada.auth.refreshToken'),
    deleteSecret('ada.auth.tokenMeta'),
    deleteSecret('ada.auth.profile'),
  ]);
}

export async function readProfile(): Promise<Profile | null> {
  const raw = await readSecret('ada.auth.profile');
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeProfile(profile: Profile): Promise<void> {
  await writeSecret('ada.auth.profile', JSON.stringify(profile));
}
