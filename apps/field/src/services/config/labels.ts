import { useCallback } from 'react';

import type { CodeValue } from '@/services/api/types';
import { useLocale, type Locale } from '@/services/i18n';

import { useCodeValues } from './code-values';

/*
 * Labels for codes the API returns.
 *
 * The label is the code-value row's when the authority has seeded one for that
 * domain. When it has not, the code itself is shown, only re-cased — it is the
 * server's value, never a label invented on the handset.
 */

// "under_inspection" -> "Under inspection"; "field-surveyor" -> "Field surveyor".
export function humanizeCode(code: string): string {
  const spaced = code.replace(/[_-]+/g, ' ').trim();
  if (spaced === '') return code;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The seeded label for a code in the locale (Hindi when seeded), falling back to the re-cased code.
export function labelFor(values: readonly CodeValue[] | undefined, code: string, locale: Locale = 'en'): string {
  const row = values?.find((candidate) => candidate.code === code);
  if (locale === 'hi' && row?.label_hi) return row.label_hi;
  return row?.label ?? humanizeCode(code);
}

// A stable labeller for one code-value domain.
export function useCodeLabel(domain: string): (code: string) => string {
  const { data } = useCodeValues(domain);
  const locale = useLocale();
  return useCallback((code: string) => labelFor(data, code, locale), [data, locale]);
}

/*
 * The code-value domains the app asks for labels. `case_status`,
 * `inspection_status` and `resurvey_decision` are seeded with `label` and
 * `label_hi`; the labeller still falls back to the re-cased code for any row
 * or domain the server has not (or not yet) seeded.
 */
export const LABEL_DOMAINS = {
  caseStatus: 'case_status',
  inspectionStatus: 'inspection_status',
  resurveyDecision: 'resurvey_decision',
  areaType: 'area_type',
  propertyType: 'property_type',
} as const;
