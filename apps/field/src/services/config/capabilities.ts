import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from '@/services/api/client';
import type { Capabilities, CapabilityAction } from '@/services/api/types';

/*
 * What this officer may do, decided by the server.
 *
 * `/api/icms/me/capabilities` answers the caller's roles, resolved permissions,
 * zones and the transitions those roles hold. The app renders from it and
 * hard-codes none of it: an action the authority disables in the policy table
 * disappears from the app without a release.
 *
 * It is advisory, exactly as the endpoint's own summary says — every answer is
 * decided again server-side. A tampered response buys nothing, so this is safe to
 * cache and read offline.
 */
export const capabilitiesQueryKey = ['icms', 'capabilities'] as const;

export function fetchCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  return apiRequest<Capabilities>('/api/icms/me/capabilities', { signal });
}

export function useCapabilities(): UseQueryResult<Capabilities, Error> {
  return useQuery({
    queryKey: capabilitiesQueryKey,
    queryFn: ({ signal }) => fetchCapabilities(signal),
    // Capabilities change when an administrator changes policy, not minute to minute.
    staleTime: 10 * 60_000,
  });
}

// True when the signed-in officer holds a named permission. Absent capabilities answer false.
export function hasPermission(
  capabilities: Capabilities | undefined,
  permission: string,
): boolean {
  return capabilities?.permissions.includes(permission) ?? false;
}

// The transition behind a named action, or null when this officer does not hold it.
export function actionFor(
  capabilities: Capabilities | undefined,
  action: string,
): CapabilityAction | null {
  return capabilities?.actions.find((candidate) => candidate.action === action) ?? null;
}
