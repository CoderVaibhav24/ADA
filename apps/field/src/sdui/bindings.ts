import { useQuery, type Query, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { apiRequest } from '@/services/api/client';
import { t } from '@/services/i18n';

import { resolvePath, resolveQuery } from './paths';
import type { Scope } from './template';
import type { SduiBinding } from './types';

/*
 * The binding resolver. A node's `data` becomes one TanStack query against an
 * `/api/icms/` path, through the same client, cache and offline rules as every
 * coded screen.
 *
 * The key starts with the API path's own segments (`['icms', 'cases', ...]`), so a
 * coded screen that invalidates `caseKeys.all` after a write refreshes the SDUI
 * blocks showing the same cases, with no extra wiring.
 */
export const SDUI_BINDING = 'sdui-binding';

export type BindingState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: Error }
  | { readonly status: 'ready'; readonly value: unknown };

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

// `select: "items.0.case_ref"` over own properties; array indices are plain numbers.
export function selectPath(value: unknown, select: string | undefined): unknown {
  if (select === undefined || select === '') return value;
  let current: unknown = value;
  for (const segment of select.split('.')) {
    if (FORBIDDEN.has(segment) || current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// True for every query a binding made, so a screen refresh can reach all of them.
export function isBindingQuery(query: Query): boolean {
  return query.queryKey.includes(SDUI_BINDING);
}

export function refreshBindings(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: isBindingQuery });
}

export function useBinding(binding: SduiBinding | null, scope: Scope): BindingState {
  const path = binding === null ? null : resolvePath(binding.path, scope, 'data');
  const query = binding === null ? {} : resolveQuery(binding.query, scope);
  const selector = binding?.select;
  // A missing field is null, not undefined: undefined is how TanStack says "no data yet".
  const select = useCallback((raw: unknown) => selectPath(raw, selector) ?? null, [selector]);

  const result = useQuery({
    queryKey:
      path === null
        ? [SDUI_BINDING, 'disabled']
        : [...path.slice('/api/'.length).split('/'), SDUI_BINDING, query],
    queryFn: ({ signal }) => apiRequest<unknown>(path ?? '', { query, signal }),
    enabled: path !== null,
    select,
  });

  if (binding === null) return { status: 'idle' };
  if (path === null) return { status: 'error', error: new Error(t('sdui.blockNotAllowed')) };
  if (result.data !== undefined) return { status: 'ready', value: result.data };
  if (result.error !== null) return { status: 'error', error: result.error };
  return { status: 'loading' };
}
