/**
 * The case workflow's vocabulary, mapped onto the chips Figma drew.
 *
 * These two vocabularies are not the same size, and that is the whole problem
 * this file exists to state honestly.
 *
 * `icms_case.status` has ELEVEN values — the seven-stage workflow plus its two
 * exits — and they are the CHECK constraint, so they are not negotiable:
 *
 *     raised · assigned · under_inspection · inspection_submitted ·
 *     resurvey_requested · verified · handed_over · confirmed ·
 *     notice_issued · closed · rejected
 *
 * Figma's Complaints register draws FOUR chips: Complaint Filed, Pending
 * Inspection, Notice Issued, Closed. `status.ts` transcribes exactly those (and
 * the other registers' six), which is correct for what it is — a transcription.
 * It is not a mapping, and its `toStatusValue` sends eight of the eleven API
 * values to `unknown`, which would render most of a real register as grey pills.
 *
 * So this adapter sits between them. Each API status keeps its own label and
 * its own `i18nKey`, so the TEXT always states the real state; the chip chosen
 * for it supplies tone and glyph only. Several statuses necessarily share a
 * chip — eleven states, six tones — and where they do, the label is what tells
 * them apart, which is exactly the rule `status.ts` sets out ("the glyph, not
 * the hue, is what tells Closed from Completed").
 *
 * FIVE of these pairings are a judgement call rather than a transcription and
 * want a designer's confirmation: `inspection_submitted`, `verified`,
 * `handed_over`, `confirmed` and `rejected` appear in no Figma frame.
 */

import type { StatusValue } from "@/components/icms/status";
import { PRIORITY_VALUES, type PriorityValue } from "@/components/icms/status";
import { CASE_PRIORITIES, CASE_STATUSES, type CaseStatus } from "@/api/icms/cases";

export type CaseStatusMeta = {
  chip: StatusValue;
  i18nKey: string;
  fromFigma: boolean;
};

export const CASE_STATUS_META: Record<CaseStatus, CaseStatusMeta> = {
  raised: { chip: "complaintFiled", i18nKey: "caseStatus.raised", fromFigma: true },
  assigned: { chip: "pendingInspection", i18nKey: "caseStatus.assigned", fromFigma: true },
  under_inspection: {
    chip: "inProgress",
    i18nKey: "caseStatus.underInspection",
    fromFigma: false,
  },
  inspection_submitted: {
    chip: "responded",
    i18nKey: "caseStatus.inspectionSubmitted",
    fromFigma: false,
  },
  resurvey_requested: {
    chip: "pendingInspection",
    i18nKey: "caseStatus.resurveyRequested",
    fromFigma: false,
  },
  verified: { chip: "completed", i18nKey: "caseStatus.verified", fromFigma: false },
  handed_over: { chip: "issued", i18nKey: "caseStatus.handedOver", fromFigma: false },
  confirmed: { chip: "scheduled", i18nKey: "caseStatus.confirmed", fromFigma: false },
  notice_issued: { chip: "noticeIssued", i18nKey: "caseStatus.noticeIssued", fromFigma: true },
  closed: { chip: "closed", i18nKey: "caseStatus.closed", fromFigma: true },
  rejected: { chip: "overdue", i18nKey: "caseStatus.rejected", fromFigma: false },
};

export function toCaseStatus(raw: string | null | undefined): CaseStatus | null {
  if (!raw) return null;
  return (CASE_STATUSES as readonly string[]).includes(raw) ? (raw as CaseStatus) : null;
}

export function toPriority(raw: string | null | undefined): PriorityValue | null {
  if (!raw) return null;
  return (PRIORITY_VALUES as readonly string[]).includes(raw) ? (raw as PriorityValue) : null;
}

export const PRIORITY_FACET_VALUES = CASE_PRIORITIES;

export const STATUS_FACET_VALUES = CASE_STATUSES;