import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiRequest } from '@/services/api/client';
import type { CodeValue, CodeValuePage } from '@/services/api/types';

/*
 * Every option list in the app.
 *
 * `complaint_type`, `property_type`, `area_type`, `delivery_mode` and whatever
 * the authority adds next. No screen holds a literal option: a select renders
 * what this returns, in the order the `sort_order` column gives, with the
 * Hindi label the row carries.
 *
 * Readable by every ICMS role, and cached — a surveyor whose app cannot load its
 * complaint types has no usable form, and that must not depend on coverage.
 */
export const codeValuesQueryKey = (domain: string) => ['icms', 'code-values', domain] as const;

// One page is enough: no domain in this vocabulary runs to hundreds of values.
const PAGE_SIZE = 200;

export async function fetchCodeValues(domain: string, signal?: AbortSignal): Promise<CodeValue[]> {
  const page = await apiRequest<CodeValuePage>('/api/icms/code-values', {
    query: { domain: [domain], size: PAGE_SIZE, sort: 'sort_order' },
    signal,
  });
  return page.items;
}

export function useCodeValues(domain: string): UseQueryResult<CodeValue[], Error> {
  return useQuery({
    queryKey: codeValuesQueryKey(domain),
    queryFn: ({ signal }) => fetchCodeValues(domain, signal),
    // A vocabulary changes when an administrator edits it; an hour is generous.
    staleTime: 60 * 60_000,
  });
}
