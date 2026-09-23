import { useEffect, useState } from 'react';

import { getAccessToken } from '@/services/auth/session';
import { env } from '@/services/config/env';

/*
 * The source an image component needs to show one piece of evidence.
 *
 * `GET /api/icms/evidence/{id}/content` is zone-scoped and authenticated like
 * every other read, so the bytes are fetched with the bearer attached as a
 * header. There is no public URL for evidence and none is built here.
 */
export type AuthenticatedImageSource = {
  readonly uri: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Stable per evidence row, so a token refresh does not refetch the bytes. */
  readonly cacheKey: string;
};

export type EvidenceSourceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly source: AuthenticatedImageSource }
  | { readonly status: 'unavailable' };

// Resolves `content_url` from the evidence payload against the API base, with the bearer.
export async function evidenceImageSource(
  evidenceId: number,
  contentUrl: string,
): Promise<AuthenticatedImageSource | null> {
  const token = await getAccessToken();
  if (token === null) return null;
  const path = contentUrl.startsWith('/') ? contentUrl : `/${contentUrl}`;
  return {
    uri: `${env.apiBaseUrl}${path}`,
    headers: { Authorization: `Bearer ${token}` },
    cacheKey: `icms-evidence-${evidenceId}`,
  };
}

// Hook form of the above. `unavailable` means no usable session, not a missing file.
export function useEvidenceImageSource(evidenceId: number, contentUrl: string): EvidenceSourceState {
  const [state, setState] = useState<EvidenceSourceState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void evidenceImageSource(evidenceId, contentUrl).then((source) => {
      if (!active) return;
      setState(source === null ? { status: 'unavailable' } : { status: 'ready', source });
    });
    return () => {
      active = false;
    };
  }, [evidenceId, contentUrl]);

  return state;
}
