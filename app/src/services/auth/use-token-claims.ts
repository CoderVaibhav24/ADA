import { useEffect, useState } from 'react';

import { useSessionStore } from '@/store/session-store';

import { readIdTokenClaims, type IdTokenClaims } from './claims';
import { readTokens } from './tokens';

/*
 * The signed-in officer's name, username and email, read from the access token
 * Keycloak issued (the `profile` and `email` scopes put them there). Display only:
 * authorisation is `/api/icms/me/capabilities`, never a locally-read claim.
 *
 * Read from secure storage on demand rather than held in the query cache, which
 * is persisted to MMKV and is not the place for an officer's email address.
 */
export type TokenClaimsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly claims: IdTokenClaims }
  | { readonly status: 'missing' };

export async function readSignedInClaims(): Promise<IdTokenClaims | null> {
  const tokens = await readTokens();
  if (tokens === null) return null;
  return readIdTokenClaims(tokens.accessToken);
}

// Re-reads whenever the session changes, so a refresh that re-issues claims is picked up.
export function useTokenClaims(): TokenClaimsState {
  const status = useSessionStore((state) => state.status);
  const [state, setState] = useState<TokenClaimsState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void readSignedInClaims().then((claims) => {
      if (!active) return;
      setState(claims === null ? { status: 'missing' } : { status: 'ready', claims });
    });
    return () => {
      active = false;
    };
  }, [status]);

  return state;
}
