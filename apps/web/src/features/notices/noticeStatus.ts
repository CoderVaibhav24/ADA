/**
 * The notice vocabulary, mapped onto the chips Figma drew.
 *
 * The same adapter problem as `features/inspections/inspectionStatus.ts`.
 * `icms_notice.status` has FIVE values and they are the CHECK constraint, so
 * they are not negotiable:
 *
 *     draft · issued · delivered · failed · withdrawn
 *
 * Figma's Notice register (67:1627) draws FOUR chips: ISSUED, OVERDUE,
 * RESPONDED, CLOSED. Exactly one of those four — ISSUED — is a value the column
 * can hold. `status.ts` transcribes all four as chip STYLES, which is correct
 * for what it is; it is not a mapping, and using it as one would render a real
 * register mostly grey.
 *
 * So each API status keeps its own label, from `noticeStatus.*` in the i18n
 * bundles, and the chip supplies tone and glyph only. Three of the five
 * pairings are a judgement call rather than a transcription and want a
 * designer's confirmation:
 *
 *   - `draft` borrows the `scheduled` chip. Info tone: a drafted notice is a
 *     real row that has not taken effect yet, which is what "scheduled" means
 *     on the inspection register too.
 *   - `failed` borrows `overdue`. Danger tone, and the only danger chip the
 *     design system has.
 *   - `withdrawn` borrows `unknown`, whose tone is neutral. `closed` was the
 *     other candidate and is wrong: its tone is success, and a withdrawn notice
 *     is not an outcome anyone succeeded at.
 *
 * `delivered` maps to `responded`, which is Figma's RESPONDED — the nearest
 * thing it drew, though see the note on OVERDUE below about what that column
 * actually was.
 *
 * ## OVERDUE is derived, not stored
 *
 * There is no `overdue` in the CHECK constraint and there never will be: it is
 * a function of `compliance_due` and today's date, and a column holding it
 * would be wrong every midnight until something wrote to it. `isOverdue` in `noticeModel.ts`
 * derives it from the two fields the row already carries, and the register
 * renders it as a SEPARATE marker beside the status chip rather than instead of
 * it — because the server's status is a fact and this is an inference, and
 * collapsing the two would make the register disagree with the API it came
 * from.
 */

import { NOTICE_STATUSES, type NoticeStatus } from "@/api/icms/notices";
import type { StatusValue } from "@/components/icms/status";

export type NoticeStatusMeta = {
  chip: StatusValue;
  /** False where the pairing is this file's judgement, not a transcription. */
  fromFigma: boolean;
};

export const NOTICE_STATUS_META: Record<NoticeStatus, NoticeStatusMeta> = {
  draft: { chip: "scheduled", fromFigma: false },
  issued: { chip: "issued", fromFigma: true },
  delivered: { chip: "responded", fromFigma: true },
  failed: { chip: "overdue", fromFigma: false },
  withdrawn: { chip: "unknown", fromFigma: false },
};

/** Every status is offered as a filter; the server validates the same five. */
export const NOTICE_STATUS_FACET_VALUES = NOTICE_STATUSES;
