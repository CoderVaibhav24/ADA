/**
 * State, district, district LGD code and pin code suggested from the complaint pin.
 *
 * No React and no `@/` import, so `npm test` runs it with type stripping alone.
 * A suggestion fills a field only while the officer has not written their own.
 */

import { parseCoordinate, type ComplaintField, type ComplaintFormState } from "./complaintForm.ts";

/** The form fields the locator suggests; zone, village, khasra and ULPIN come from `parcelSuggestion.ts`. */
export const SUGGESTED_FIELDS = ["state", "district", "districtLgdCode", "pinCode"] as const;

export type SuggestedField = (typeof SUGGESTED_FIELDS)[number];

/** One suggestion, "" where the locator had nothing for that field. */
export type LocationSuggestion = Readonly<Record<SuggestedField, string>>;

/** `LocateOut`, structurally, so this file needs no generated import. */
export type LocatedAnswer = {
  state: string | null;
  district: string | null;
  district_lgd: string | null;
  pincode: string | null;
  source: string;
};

/** Debounce before a moved pin is looked up. */
export const LOCATE_DEBOUNCE_MS = 400;

/** The pin as numbers, rounded to ~11 m like the server's cache, or null when there is none. */
export function pinPoint(latitude: string, longitude: string): { lat: number; lon: number } | null {
  const lat = parseCoordinate(latitude);
  const lon = parseCoordinate(longitude);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

/** The answer as form values; null when the lookup failed and nothing should be shown. */
export function suggestionFrom(answer: LocatedAnswer): LocationSuggestion | null {
  if (answer.source === "unavailable") return null;
  return {
    state: answer.state ?? "",
    district: answer.district ?? "",
    districtLgdCode: answer.district_lgd ?? "",
    pinCode: answer.pincode ?? "",
  };
}

// Blank, or still exactly what the last suggestion put there.
function untouched<F extends ComplaintField>(
  state: ComplaintFormState,
  previous: Readonly<Record<F, string>> | null,
  field: F,
): boolean {
  const current = state[field];
  return current.trim() === "" || (previous !== null && current === previous[field]);
}

/** Fills each of `fields` the officer has not written in from `next`; what they typed is kept. */
export function fillUntouched<F extends ComplaintField>(
  fields: readonly F[],
  state: ComplaintFormState,
  previous: Readonly<Record<F, string>> | null,
  next: Readonly<Record<F, string>>,
): ComplaintFormState {
  let result = state;
  for (const field of fields) {
    if (untouched(state, previous, field) && state[field] !== next[field]) {
      result = { ...result, [field]: next[field] };
    }
  }
  return result;
}

/** Which of `fields` still hold a non-blank suggested value. */
export function stillSuggested<F extends ComplaintField>(
  fields: readonly F[],
  state: ComplaintFormState,
  suggestion: Readonly<Record<F, string>> | null,
): ReadonlySet<ComplaintField> {
  const result = new Set<ComplaintField>();
  if (suggestion === null) return result;
  for (const field of fields) {
    if (suggestion[field] !== "" && state[field] === suggestion[field]) result.add(field);
  }
  return result;
}

/** Suggested values in `fields` put back to the baseline, so a suggestion alone is not "unsaved". */
export function resetSuggested<F extends ComplaintField>(
  fields: readonly F[],
  state: ComplaintFormState,
  suggestion: Readonly<Record<F, string>> | null,
  baseline: ComplaintFormState,
): ComplaintFormState {
  let result = state;
  for (const field of stillSuggested(fields, state, suggestion)) {
    result = { ...result, [field]: baseline[field] };
  }
  return result;
}

/** Fills each suggested field the officer has not written in; what they typed is kept. */
export function applySuggestion(
  state: ComplaintFormState,
  previous: LocationSuggestion | null,
  next: LocationSuggestion,
): ComplaintFormState {
  return fillUntouched(SUGGESTED_FIELDS, state, previous, next);
}

/** Fields whose value is still the suggestion, for the "Suggested from location" hint. */
export function suggestedFields(
  state: ComplaintFormState,
  suggestion: LocationSuggestion | null,
): ReadonlySet<ComplaintField> {
  return stillSuggested(SUGGESTED_FIELDS, state, suggestion);
}

/** The form with untouched suggestions put back to the baseline, so a suggestion alone is not "unsaved". */
export function withoutSuggestion(
  state: ComplaintFormState,
  suggestion: LocationSuggestion | null,
  baseline: ComplaintFormState,
): ComplaintFormState {
  return resetSuggested(SUGGESTED_FIELDS, state, suggestion, baseline);
}
