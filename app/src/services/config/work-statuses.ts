import { useMemo } from 'react';

import type { Capabilities } from '@/services/api/types';

import { useCapabilities } from './capabilities';

/*
 * Which case statuses are this officer's field work, read off the transitions the
 * server says they hold (`/api/icms/me/capabilities`). No status is named here: a
 * change to the workflow table moves the tabs and counts without a release.
 *
 *   toStart   statuses from which the officer may open a round
 *   underway  statuses at which only the assignee may act — the round is running
 *   handedIn  statuses an assignee-only action moves a case into — work handed back
 */
export type WorkStatuses = {
  readonly toStart: readonly string[];
  readonly underway: readonly string[];
  readonly handedIn: readonly string[];
  /** toStart and underway together: the work still in the officer's hands. */
  readonly active: readonly string[];
};

export type WorkPhase = 'to_start' | 'underway' | 'handed_in' | 'other';

// Unique, in first-seen order, so a filter built from it caches as one key.
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function deriveWorkStatuses(capabilities: Capabilities): WorkStatuses {
  const toStart = unique(
    capabilities.actions
      .filter((action) => action.opens_round && action.source_status !== null)
      .map((action) => action.source_status as string),
  );
  const underway = unique(
    capabilities.actions
      .filter((action) => action.assignee_only && !action.opens_round && action.source_status !== null)
      .map((action) => action.source_status as string),
  ).filter((status) => !toStart.includes(status));
  const handedIn = unique(
    capabilities.actions
      .filter((action) => action.assignee_only && action.target_status !== action.source_status)
      .map((action) => action.target_status),
  ).filter((status) => !toStart.includes(status) && !underway.includes(status));

  return { toStart, underway, handedIn, active: unique([...toStart, ...underway]) };
}

// Where a case status sits in this officer's work.
export function phaseOf(statuses: WorkStatuses | undefined, status: string): WorkPhase {
  if (statuses === undefined) return 'other';
  if (statuses.toStart.includes(status)) return 'to_start';
  if (statuses.underway.includes(status)) return 'underway';
  if (statuses.handedIn.includes(status)) return 'handed_in';
  return 'other';
}

export type WorkStatusesState = {
  readonly data: WorkStatuses | undefined;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
};

export function useWorkStatuses(): WorkStatusesState {
  const capabilities = useCapabilities();
  const data = useMemo(
    () => (capabilities.data === undefined ? undefined : deriveWorkStatuses(capabilities.data)),
    [capabilities.data],
  );
  return {
    data,
    isPending: capabilities.isPending,
    error: capabilities.error,
    refetch: () => void capabilities.refetch(),
  };
}

/*
 * The action on a case that starts or resumes the field round, if this caller
 * holds one. `allowedActions` is the case's own `allowed_actions`, already decided
 * for this caller and this status by the server; capabilities say which of those
 * opens a round and which only the assignee may take.
 */
export type FieldEntry = { readonly kind: 'start' | 'resume'; readonly action: string };

export function fieldEntryFor(
  capabilities: Capabilities | undefined,
  allowedActions: readonly string[] | undefined,
  status: string,
): FieldEntry | null {
  if (capabilities === undefined || allowedActions === undefined) return null;
  const held = capabilities.actions.filter(
    (action) => action.source_status === status && allowedActions.includes(action.action),
  );
  const opener = held.find((action) => action.opens_round);
  if (opener !== undefined) return { kind: 'start', action: opener.action };
  const field = held.find((action) => action.assignee_only);
  if (field !== undefined) return { kind: 'resume', action: field.action };
  return null;
}
