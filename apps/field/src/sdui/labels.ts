import { useQueries } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { CodeValue } from '@/services/api/types';
import { codeValuesQueryKey, fetchCodeValues } from '@/services/config';
import { labelFor } from '@/services/config/labels';
import { useLocale } from '@/services/i18n';

import type { Labeller } from './template';

/*
 * The `label:<domain>` formatter. Every domain a definition names is fetched up
 * front through the same cached code-values query the coded screens use, so a
 * status reads as the authority's label, or the re-cased code until one is seeded.
 */
export function useLabeller(domains: readonly string[]): Labeller {
  // The locale is a dependency so a language change hands the renderer a new labeller and it re-renders.
  const locale = useLocale();
  const combine = useCallback(
    (results: { data?: CodeValue[] }[]): Labeller => {
      const byDomain = new Map<string, CodeValue[] | undefined>();
      domains.forEach((domain, index) => byDomain.set(domain, results[index]?.data));
      return (domain, code) => labelFor(byDomain.get(domain), code, locale);
    },
    [domains, locale],
  );

  return useQueries({
    queries: domains.map((domain) => ({
      queryKey: codeValuesQueryKey(domain),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchCodeValues(domain, signal),
      staleTime: 60 * 60_000,
    })),
    combine,
  });
}
