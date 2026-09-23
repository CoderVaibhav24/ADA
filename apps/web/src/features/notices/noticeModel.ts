/**
 * The decisions the three notice screens make, kept out of the JSX.
 *
 * Two of them are contract properties rather than presentation:
 *
 *   - **OVERDUE is derived here and stored nowhere.** `icms_notice.status` has
 *     no `overdue` value; Figma's register draws one. It is a function of
 *     `compliance_due` and today's date, so a column holding it would be wrong
 *     every midnight until something wrote to it. Deriving it is the only
 *     honest answer, and the register draws it as a marker BESIDE the status
 *     chip rather than instead of it.
 *   - **`printableOf` reads `has_artefact` and never infers it.** A notice can
 *     be `issued` with the PDF render still queued, so gating the print control
 *     on the status string would offer a download that 404s. The contract puts
 *     the boolean on the row precisely so the control can be honest.
 *
 * Every import here is `import type`, and that is load-bearing rather than
 * tidy: `npm test` runs this module under `node --experimental-strip-types`,
 * which erases type imports but cannot resolve the `@/` alias. A value
 * imported from `@/api/icms/notices` would make the whole file untestable.
 */

import type { NoticeDetail, NoticeRow } from "@/api/icms/notices";

/**
 * Whether the compliance period has run out on a notice that is still in force.
 *
 * `compliance_due` is a DATE, so the comparison is on calendar days and both
 * sides must be `YYYY-MM-DD` strings in the SAME timezone — IST, which is what
 * `toIstDateKey` produces and what the server stored. Comparing a date string
 * to `new Date()` directly is how a notice due today reads as overdue between
 * 18:30 and midnight.
 *
 * Only `issued` can be overdue. A draft has not started running, and
 * `delivered`, `failed` and `withdrawn` have each left the compliance window by
 * a route the due date says nothing about.
 */
export function isOverdue(
  row: Pick<NoticeRow, "status" | "compliance_due">,
  todayIsoDate: string,
): boolean {
  if (row.status !== "issued") return false;
  if (!row.compliance_due) return false;
  return row.compliance_due.slice(0, 10) < todayIsoDate;
}

/**
 * Days remaining in the compliance period, negative once it has passed.
 *
 * Whole days on the IST calendar, computed from the two date keys rather than
 * from timestamps: an officer counting "three days left" is counting dates on a
 * wall calendar, not 72 hours. `Z` on both sides makes the subtraction a plain
 * day count with no DST or offset arithmetic in it.
 */
export function daysRemaining(
  complianceDue: string | null | undefined,
  todayIsoDate: string,
): number | null {
  if (!complianceDue) return null;
  const due = Date.parse(`${complianceDue.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayIsoDate}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(today)) return null;
  return Math.round((due - today) / 86_400_000);
}

/** Whether a rendered document exists to open. `has_artefact`, never the status. */
export function printableOf(row: Pick<NoticeRow, "has_artefact">): boolean {
  return row.has_artefact;
}

/**
 * The sections cited, in the order the act numbers them rather than the order
 * the array happens to hold.
 *
 * `28-A` sorts after `28` and before `29`, which a plain string sort gets wrong
 * the moment an act has a section 9 and a section 14: numeric part first, then
 * the suffix.
 */
export function orderedSections(sections: readonly string[] | null | undefined): readonly string[] {
  if (!sections) return [];
  return [...sections].sort((a, b) => {
    const na = Number.parseInt(a, 10);
    const nb = Number.parseInt(b, 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

/**
 * The filename a downloaded notice is saved under.
 *
 * ASCII in both languages and derived from the reference, so a folder of them
 * sorts chronologically and a Hindi session does not produce a file the
 * officer's colleague cannot type.
 */
export function pdfFileName(ref: string): string {
  return `${ref.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
}

/**
 * The parts of `body` worth showing, as label/value pairs.
 *
 * `icms_notice.body` is an untyped JSON object and the template behind it is
 * provisional, so this neither asserts keys nor hides the ones it does not
 * know: every scalar entry is rendered, in insertion order, with its raw key
 * available for the screen to translate or print as-is. An object or array
 * value is skipped rather than stringified — `[object Object]` in a legal
 * document view is worse than a field that is simply not shown.
 */
export function bodyEntries(
  body: NoticeDetail["body"],
): readonly { key: string; value: string }[] {
  if (!body) return [];
  const out: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") out.push({ key, value });
    else if (typeof value === "number" || typeof value === "boolean") {
      out.push({ key, value: String(value) });
    }
  }
  return out;
}
