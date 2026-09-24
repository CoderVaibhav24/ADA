import { intlLocale } from '@/services/i18n';

/*
 * Areas are stored in square metres; surveyors measure in square feet. The findings
 * read-back shows both. 1 sq ft = 0.09290304 m² (the backend contract's factor).
 */
export const SQM_PER_SQFT = 0.09290304;

export type AreaParts = { readonly sqm: string; readonly sqft: string };

// The two numbers, localised, or null when no area was recorded.
export function areaParts(squareMetres: number | null | undefined): AreaParts | null {
  if (squareMetres === null || squareMetres === undefined || !Number.isFinite(squareMetres)) {
    return null;
  }
  const locale = intlLocale();
  return {
    sqm: squareMetres.toLocaleString(locale, { maximumFractionDigits: 1 }),
    sqft: Math.round(squareMetres / SQM_PER_SQFT).toLocaleString(locale),
  };
}
