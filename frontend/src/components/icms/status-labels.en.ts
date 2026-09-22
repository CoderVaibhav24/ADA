import type { PriorityValue, StatusValue } from "./status";

/**
 * SEED DICTIONARY — not imported by any primitive.
 *
 * StatusChip takes its label as children precisely so no English lives inside
 * it. This file exists so the i18n layer has the exact Figma strings to seed
 * `en.json` from, and so the design-system showcase has something to render.
 * Strings are verbatim from the registers, including Figma's own casing.
 *
 * When i18n lands, move these into the EN resource bundle under the `i18nKey`
 * in status.ts and delete this file. The Hindi column is left to translation;
 * do not machine-translate legal status vocabulary.
 */
export const STATUS_LABELS_EN: Record<StatusValue, string> = {
  pendingInspection: "Pending Inspection",
  noticeIssued: "Notice Issued",
  complaintFiled: "Complaint Filed",
  closed: "Closed",
  completed: "Completed",
  scheduled: "Scheduled",
  inProgress: "In Progress",
  issued: "Issued",
  overdue: "Overdue",
  responded: "Responded",
  unknown: "Unknown",
};

export const PRIORITY_LABELS_EN: Record<PriorityValue, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
