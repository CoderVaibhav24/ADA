/**
 * The `Parcel ID` column's rendering. THE ONE PLACE IT IS DECIDED.
 *
 * ## The problem
 *
 * Figma renders `RJ-JPR-1007` in every row of this column. That string is not a
 * ULPIN (a Bhu-Aadhaar is 14 characters), it is not a Khasra number, and it is
 * not an LGD code. `RJ` is Rajasthan and `JPR` is Jaipur — this is the **Agra**
 * Development Authority, in Uttar Pradesh. It is placeholder text from another
 * state, repeated eight times beside a complaint reference that is also
 * repeated eight times. There is nothing to transcribe.
 *
 * ## The decision
 *
 * Render the parcel's real land-records identity, preferring the national one:
 *
 *   1. **ULPIN** when the parcel has one. It is the Bhu-Aadhaar — nationally
 *      unique, stable across mutations, and the identifier a link to Bhulekh
 *      would be built from.
 *   2. **`village_lgd_code`/`khasra_no`** otherwise. A Khasra number is unique
 *      only within its village, so showing it bare would be ambiguous across
 *      zones; the LGD village code is what disambiguates it, and it is the code
 *      the revenue record is filed under. ULPIN rollout in UP is partial, so
 *      this is the common case today rather than the fallback.
 *   3. **Khasra alone** when the village code is missing.
 *   4. **Nothing.** An em dash, and `kind: "none"` — a case filed by telephone
 *      about "the building behind the bus stand" genuinely has no parcel, and
 *      inventing one would be worse than admitting it.
 *
 * The server already composes exactly this into `CaseRow.parcel_id` (a computed
 * field on the response model, so it cannot drift from the columns it is made
 * of). This module does NOT recompute it — it reads it, and adds the one thing
 * the server does not: a caption saying WHICH identifier is on screen, because
 * `UP1234567890AB` and `123456/142B` are different kinds of number and a column
 * that silently alternates between them without saying so is unreadable.
 *
 * ## NEEDS CONFIRMATION
 *
 * Whether this column should show the land-records identity at all is a product
 * question nobody has answered. The other reading of the Figma string is that
 * ADA wants its own internal parcel reference — a scheme that does not exist in
 * the schema and would have to be added. Changing the answer means changing
 * this function and nothing else.
 */

import type { CaseRow } from "@/api/icms/cases";

export type ParcelIdKind = "ulpin" | "khasra" | "none";

export type ParcelIdentity = {
  kind: ParcelIdKind;
  /** The identifier itself, or null when the parcel has none. */
  value: string | null;
  /** i18n key for the "which kind of number is this" caption. */
  kindKey: string;
};

export function resolveParcelId(row: CaseRow): ParcelIdentity {
  if (row.ulpin) {
    return { kind: "ulpin", value: row.ulpin, kindKey: "parcel.ulpin" };
  }
  if (row.khasra_no) {
    return {
      kind: "khasra",
      // Prefer the server's composition so the two can never disagree; compose
      // it here only if `parcel_id` is somehow absent.
      value:
        row.parcel_id ?? `${row.village_lgd_code ?? ""}/${row.khasra_no}`.replace(/^\//, ""),
      kindKey: "parcel.khasra",
    };
  }
  return { kind: "none", value: null, kindKey: "parcel.none" };
}

/** The plain-text projection for an export. Empty, not an em dash. */
export function parcelIdForExport(row: CaseRow): string {
  return resolveParcelId(row).value ?? "";
}
