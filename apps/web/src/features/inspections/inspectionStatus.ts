/**
 * The inspection workflow's vocabulary, mapped onto the chips Figma drew.
 *
 * The same adapter problem as `features/complaints/caseStatus.ts`, one size
 * smaller. `icms_inspection.status` has FIVE values and they are the CHECK
 * constraint, so they are not negotiable:
 *
 *     scheduled · in_progress · submitted · accepted · rejected
 *
 * Figma's Inspection register (31:2647) draws THREE chips: Scheduled, In
 * Progress, Completed. `status.ts` transcribes exactly those three for this
 * register, which is correct for what it is — a transcription of a frame with
 * five sample rows in it. It is not a mapping, and `toStatusValue` would send
 * `submitted` and `accepted` to `unknown`, rendering a real register mostly
 * grey.
 *
 * So each API status keeps its own label, from `inspectionStatus.*` in the i18n
 * bundles, and the chip supplies tone and glyph only. Two of the five pairings
 * are a judgement call rather than a transcription and want a designer's
 * confirmation:
 *
 *   - `submitted` borrows the `pendingInspection` chip. It is the waiting
 *     state — the surveyor is finished, the nodal officer has not decided — and
 *     warning is the tone this design system already uses for "someone owes
 *     someone an answer". `responded` was the other candidate and is wrong: its
 *     tone is success, and a submission that may still be sent back is not a
 *     success yet.
 *   - `rejected` borrows `overdue`, which is what `caseStatus.ts` already does
 *     with the case's own `rejected`. Danger tone, and the label reads "Sent
 *     Back" rather than "Rejected" because the round is not thrown away — a new
 *     one opens from it.
 *
 * `accepted` maps to the `completed` chip, which IS Figma's COMPLETED. The API
 * has no `completed`; the frame's word for `accepted` is what it drew.
 */

import {
  INSPECTION_PRIORITIES,
  INSPECTION_STATUSES,
  type InspectionStatus,
} from "@/api/icms/inspections";
import type { StatusValue } from "@/components/icms/status";

export type InspectionStatusMeta = {
  chip: StatusValue;
  /** False where the pairing is this file's judgement, not a transcription. */
  fromFigma: boolean;
};

export const INSPECTION_STATUS_META: Record<InspectionStatus, InspectionStatusMeta> = {
  scheduled: { chip: "scheduled", fromFigma: true },
  in_progress: { chip: "inProgress", fromFigma: true },
  submitted: { chip: "pendingInspection", fromFigma: false },
  accepted: { chip: "completed", fromFigma: true },
  rejected: { chip: "overdue", fromFigma: false },
};

/** Every status is offered as a filter; the server validates the same five. */
export const INSPECTION_STATUS_FACET_VALUES = INSPECTION_STATUSES;

/**
 * The priorities the facet offers — the CASE's three, not the round's.
 *
 * The same list the Complaints register filters on, so a link that carries
 * `?priority=high` means the same thing on either screen. Every value is
 * offered; the server validates the same three against `CASE_PRIORITIES`.
 */
export const PRIORITY_FACET_VALUES = INSPECTION_PRIORITIES;

/**
 * The rounds the facet offers.
 *
 * Five, not "however many exist": there is no aggregate endpoint reporting the
 * distinct rounds across a zone's inspections, and inventing one for a filter
 * dropdown is not worth a second query per page load. A case that reaches round
 * six is still findable by its complaint reference, which is the search box
 * directly above the facet.
 */
export const ROUND_FACET_VALUES = [1, 2, 3, 4, 5] as const;
