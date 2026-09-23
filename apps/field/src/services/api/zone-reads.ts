import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from './client';
import type { Schemas } from './types';

/*
 * The zones this officer covers. `GET /api/icms/zones` is scoped to the caller's
 * zone assignments server-side (`repository.list_zones` applies `zone_scope`), and a
 * Field Surveyor holds `zone.read`, so the answer is the surveyor's own zones.
 */
export type Zone = Schemas['ZoneOut'];
export type ZonePage = Schemas['Page_ZoneOut_'];

// The largest page the server accepts; an officer covers a handful of zones.
const ZONES_PAGE_SIZE = 200;

export const zoneKeys = {
  mine: ['icms', 'zones', 'mine'] as const,
};

export function useMyZones(enabled = true): UseQueryResult<ZonePage, Error> {
  return useQuery({
    queryKey: zoneKeys.mine,
    queryFn: ({ signal }) =>
      apiRequest<ZonePage>('/api/icms/zones', {
        query: { size: ZONES_PAGE_SIZE, sort: 'name' },
        signal,
      }),
    enabled,
    staleTime: 10 * 60_000,
  });
}
