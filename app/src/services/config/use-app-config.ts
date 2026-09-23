import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from '@/services/api/client';

import { DEFAULT_APP_CONFIG, cacheAppConfig, currentAppConfig, type AppConfig } from './app-config';

/*
 * The served thresholds, behind a hook that always answers.
 *
 * `GET /api/icms/app-config` serves the GPS and timestamp thresholds. A 404
 * (an older server without the route) is taken as "not wired" and answers the
 * values already on disk, which fall back to `DEFAULT_APP_CONFIG`. A caller
 * therefore never sees `undefined`.
 */
export const appConfigQueryKey = ['icms', 'app-config'] as const;

export async function fetchAppConfig(signal?: AbortSignal): Promise<AppConfig> {
  const served = await apiRequest<Partial<AppConfig> | null>('/api/icms/app-config', {
    signal,
    nullOn: [404, 403],
  });
  if (served === null) return currentAppConfig();
  return cacheAppConfig(served);
}

export function useAppConfig(): UseQueryResult<AppConfig, Error> & { config: AppConfig } {
  const query = useQuery({
    queryKey: appConfigQueryKey,
    queryFn: ({ signal }) => fetchAppConfig(signal),
    staleTime: 60 * 60_000,
    // The cached values, so the first render already has a threshold to gate on.
    initialData: currentAppConfig,
    initialDataUpdatedAt: 0,
  });

  /*
   * Assigned onto the result rather than spread into a copy: TanStack tracks which
   * fields a component actually reads, and spreading reads all of them, which turns
   * every background refetch into a re-render.
   */
  return Object.assign(query, { config: query.data ?? DEFAULT_APP_CONFIG });
}
