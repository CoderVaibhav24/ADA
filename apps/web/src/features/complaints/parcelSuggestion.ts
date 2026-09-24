/**
 * Zone, village LGD code, khasra (or a scheme plot's number) and ULPIN suggested from the
 * imported land record under the pin.
 *
 * No React and no `@/` import, so `npm test` runs it with type stripping alone.
 * Same rules as `locationSuggestion.ts`: a suggestion fills a field only while
 * the officer has not written their own, and a moved pin replaces it.
 */

import { isKhasraValid, type ComplaintField, type ComplaintFormState } from "./complaintForm.ts";
import { fillUntouched, resetSuggested, stillSuggested } from "./locationSuggestion.ts";

export const PARCEL_FIELDS = ["zoneCd", "villageLgdCode", "khasraNo", "ulpin"] as const;

export type ParcelField = (typeof PARCEL_FIELDS)[number];

/**
 * One suggestion, "" where the land record had nothing (or the zone is not the officer's).
 * `plotNo` is true when `khasraNo` holds a scheme plot's number rather than a khasra.
 */
export type ParcelSuggestion = Readonly<Record<ParcelField, string>> & { readonly plotNo: boolean };

/** `GET /geo/parcel`, structurally, so this file needs no `@/` import. */
export type ParcelAnswer = {
  zone_cd: string | null;
  zone_name: string | null;
  village_lgd: string | null;
  khasra_no: string | null;
  plot_no: string | null;
  ulpin: string | null;
  source: string;
};

/** The pin's zone when the officer cannot file in it, for the note under the zone picker. */
export type ForeignZone = { code: string; name: string };

export const EMPTY_PARCEL: ParcelSuggestion = {
  zoneCd: "",
  villageLgdCode: "",
  khasraNo: "",
  ulpin: "",
  plotNo: false,
};

/**
 * The answer as form values. `assignable` is the officer's zone list, or null while it loads;
 * a zone outside it is never filled, since the server would refuse it. A scheme plot has no
 * village LGD code, so its sector is not put in that digits-only box; a khasra wins over a plot.
 */
export function parcelSuggestionFrom(
  answer: ParcelAnswer,
  assignable: ReadonlySet<string> | null,
): ParcelSuggestion {
  if (answer.source !== "kml") return EMPTY_PARCEL;
  const zone = answer.zone_cd ?? "";
  const khasra = answer.khasra_no ?? "";
  // Parcel ID takes the khasra rule, so a named plot such as "CP-1" is not filled in.
  const plotNo = answer.plot_no ?? "";
  const plot = khasra === "" && plotNo !== "" && isKhasraValid(plotNo) ? plotNo : "";
  return {
    zoneCd: assignable !== null && assignable.has(zone) ? zone : "",
    villageLgdCode: answer.village_lgd ?? "",
    khasraNo: khasra !== "" ? khasra : plot,
    ulpin: answer.ulpin ?? "",
    plotNo: plot !== "",
  };
}

/** The land record's zone when it is known and not one the officer is assigned; null otherwise. */
export function foreignZone(
  answer: ParcelAnswer | null,
  assignable: ReadonlySet<string> | null,
): ForeignZone | null {
  if (answer === null || answer.source !== "kml" || assignable === null) return null;
  const code = answer.zone_cd ?? "";
  if (code === "" || assignable.has(code)) return null;
  return { code, name: answer.zone_name ?? "" };
}

/** Fills each land-record field the officer has not written in; what they typed is kept. */
export function applyParcel(
  state: ComplaintFormState,
  previous: ParcelSuggestion | null,
  next: ParcelSuggestion,
): ComplaintFormState {
  return fillUntouched(PARCEL_FIELDS, state, previous, next);
}

/** Fields still holding the land record's value, for the "Suggested from land record" hint. */
export function parcelFields(
  state: ComplaintFormState,
  suggestion: ParcelSuggestion | null,
): ReadonlySet<ComplaintField> {
  return stillSuggested(PARCEL_FIELDS, state, suggestion);
}

/** True while the Parcel ID field still holds a scheme plot's number from the land record. */
export function parcelIsPlot(state: ComplaintFormState, suggestion: ParcelSuggestion | null): boolean {
  return suggestion !== null && suggestion.plotNo && parcelFields(state, suggestion).has("khasraNo");
}

/** The form with untouched land-record values put back to the baseline. */
export function withoutParcel(
  state: ComplaintFormState,
  suggestion: ParcelSuggestion | null,
  baseline: ComplaintFormState,
): ComplaintFormState {
  return resetSuggested(PARCEL_FIELDS, state, suggestion, baseline);
}
