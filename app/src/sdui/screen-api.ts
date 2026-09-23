import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from '@/services/api/client';
import { AdaApiError } from '@/services/api/errors';

import { forgetCachedScreen, readCachedScreen, writeCachedScreen } from './cache';
import { SDUI_RUNTIME, SUPPORTED_SCHEMA_VERSIONS } from './contract';
import { asEnvelope, asIndexItems, type ScreenEnvelope, type ScreenIndexItem } from './types';

/*
 * Reads over `/api/app/screens`. The definition is fetched with this binary's
 * runtime, so the server never serves a component the binary lacks, and with the
 * cached version, so an unchanged screen costs a 304 and no body.
 *
 * `have_version` stands in for If-None-Match because `apiRequest` does not take
 * request headers; the server honours both.
 */
export const sduiKeys = {
  all: ['sdui'] as const,
  screen: (screenId: string) => ['sdui', 'screen', screenId] as const,
  index: ['sdui', 'index'] as const,
};

// A refusal after which the cached copy must not be shown: access revoked, or no such screen.
export function isRefusal(error: unknown): boolean {
  return error instanceof AdaApiError && (error.status === 403 || error.status === 404);
}

export async function fetchScreen(screenId: string, signal?: AbortSignal): Promise<ScreenEnvelope> {
  const cached = readCachedScreen(screenId);
  try {
    const served = await apiRequest<unknown>(`/api/app/screens/${encodeURIComponent(screenId)}`, {
      query: { runtime: SDUI_RUNTIME, have_version: cached?.version },
      signal,
      nullOn: [304],
    });
    if (served === null) {
      if (cached !== null) return cached;
      throw new Error('The server said this screen is unchanged, but no copy is saved.');
    }
    const envelope = asEnvelope(served);
    if (envelope === null) throw new Error('The server sent a screen this app cannot read.');
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(envelope.schema_version)) {
      throw new Error('This screen needs a newer version of the app.');
    }
    writeCachedScreen(envelope);
    return envelope;
  } catch (error) {
    if (isRefusal(error)) forgetCachedScreen(screenId);
    throw error;
  }
}

export type ScreenDefinitionState = {
  /** What to render: the served screen, or the saved copy when the server cannot be reached. */
  readonly envelope: ScreenEnvelope | null;
  /** True when the envelope is the saved copy because the latest fetch failed. */
  readonly showingSavedCopy: boolean;
  readonly error: Error | null;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly refetch: () => void;
};

export function useScreenDefinition(screenId: string): ScreenDefinitionState {
  const query = useQuery({
    queryKey: sduiKeys.screen(screenId),
    queryFn: ({ signal }) => fetchScreen(screenId, signal),
    initialData: () => readCachedScreen(screenId) ?? undefined,
    // Always revalidate a saved copy on open; the 304 makes that nearly free.
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    enabled: screenId !== '',
  });

  const refused = isRefusal(query.error);
  const envelope = refused ? null : (query.data ?? null);
  return {
    envelope,
    showingSavedCopy: envelope !== null && query.error !== null,
    error: query.error,
    isPending: query.isPending,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

// The published screens this officer may open, for server-driven menus.
export function useScreenIndex(): UseQueryResult<ScreenIndexItem[], Error> {
  return useQuery({
    queryKey: sduiKeys.index,
    queryFn: async ({ signal }) =>
      asIndexItems(await apiRequest<unknown>('/api/app/screens', { query: { runtime: SDUI_RUNTIME }, signal })),
    staleTime: 5 * 60_000,
  });
}
