import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from '@/services/api/client';
import type { WorkflowTransition } from '@/services/api/types';

import { hasPermission, useCapabilities } from './capabilities';

/*
 * The case state machine, as the database holds it.
 *
 * A Field Surveyor does not normally hold `policy.read`, so this is fetched only
 * when the capabilities say so and degrades silently on a 403 — the app is fully
 * usable without it. `useCapabilities()` already carries the transitions this
 * officer holds; this is the whole table, which is useful for showing what a case
 * will do next rather than only what this officer may do to it.
 */
export const transitionsQueryKey = ['icms', 'policy', 'transitions'] as const;

// Answers null rather than throwing when the role does not hold `policy.read`.
export function fetchTransitions(signal?: AbortSignal): Promise<WorkflowTransition[] | null> {
  return apiRequest<WorkflowTransition[] | null>('/api/icms/admin/policy/transitions', {
    signal,
    nullOn: [403],
  });
}

export function useWorkflowTransitions(): UseQueryResult<WorkflowTransition[] | null, Error> {
  const capabilities = useCapabilities();
  const allowed = hasPermission(capabilities.data, 'policy.read');

  return useQuery({
    queryKey: transitionsQueryKey,
    queryFn: ({ signal }) => fetchTransitions(signal),
    enabled: allowed,
    staleTime: 60 * 60_000,
  });
}
