import type { IconKey } from "@/lib/icons";

/**
 * Status vocabulary, transcribed from the Figma registers.
 *
 * The three registers use three disjoint sets of chip labels; Figma draws
 * eleven, but "Closed" appears in both the Complaints register and the Notices
 * register with identical styling, so there are TEN distinct values. `unknown`
 * is an eleventh, added here: the API is not frozen and a chip must degrade to
 * a neutral pill rather than crash or render blank when the backend sends a
 * value this table has not seen.
 *
 * Tone maps a status onto one of the six status token families. `icon` is what
 * makes the chip legible without colour (WCAG 1.4.1 Use of Color) — every tone
 * is shared by at least two statuses, so the glyph, not the hue, is what tells
 * "Closed" from "Completed" and "Responded".
 */
export const STATUS_VALUES = [
  "pendingInspection",
  "noticeIssued",
  "complaintFiled",
  "closed",
  "completed",
  "scheduled",
  "inProgress",
  "issued",
  "overdue",
  "responded",
  "unknown",
] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];

export type StatusTone =
  | "neutral"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type StatusMeta = {
  tone: StatusTone;
  icon: IconKey;
  /** Which register(s) the value appears on, per the Figma transcription. */
  registers: ReadonlyArray<"complaints" | "inspection" | "notices">;
  /** Key the i18n layer will resolve. The component never renders English. */
  i18nKey: string;
};

export const STATUS_META: Record<StatusValue, StatusMeta> = {
  pendingInspection: {
    tone: "warning",
    icon: "status.pendingInspection",
    registers: ["complaints"],
    i18nKey: "status.pendingInspection",
  },
  noticeIssued: {
    tone: "accent",
    icon: "status.noticeIssued",
    registers: ["complaints"],
    i18nKey: "status.noticeIssued",
  },
  complaintFiled: {
    tone: "info",
    icon: "status.complaintFiled",
    registers: ["complaints"],
    i18nKey: "status.complaintFiled",
  },
  closed: {
    tone: "success",
    icon: "status.closed",
    registers: ["complaints", "notices"],
    i18nKey: "status.closed",
  },
  completed: {
    tone: "success",
    icon: "status.completed",
    registers: ["inspection"],
    i18nKey: "status.completed",
  },
  scheduled: {
    tone: "info",
    icon: "status.scheduled",
    registers: ["inspection"],
    i18nKey: "status.scheduled",
  },
  inProgress: {
    tone: "accent",
    icon: "status.inProgress",
    registers: ["inspection"],
    i18nKey: "status.inProgress",
  },
  issued: {
    tone: "accent",
    icon: "status.issued",
    registers: ["notices"],
    i18nKey: "status.issued",
  },
  overdue: {
    tone: "danger",
    icon: "status.overdue",
    registers: ["notices"],
    i18nKey: "status.overdue",
  },
  responded: {
    tone: "success",
    icon: "status.responded",
    registers: ["notices"],
    i18nKey: "status.responded",
  },
  unknown: {
    tone: "neutral",
    icon: "status.neutral",
    registers: [],
    i18nKey: "status.unknown",
  },
};

/** Narrows an arbitrary API string, falling back to `unknown`. */
export function toStatusValue(raw: string | null | undefined): StatusValue {
  if (!raw) return "unknown";
  const direct = STATUS_VALUES.find((v) => v === raw);
  if (direct) return direct;
  // Tolerates the shapes the API is likely to send: PENDING_INSPECTION,
  // "Pending Inspection", pending-inspection.
  const camel = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
  return (STATUS_VALUES.find((v) => v === camel) as StatusValue) ?? "unknown";
}

/* ---- Priority. Figma draws High / Medium / Low as bare coloured text, not
   chips; rendering them as chips makes them scannable and gives the value a
   shape, which bare red text does not. --------------------------------- */

export const PRIORITY_VALUES = ["high", "medium", "low"] as const;
export type PriorityValue = (typeof PRIORITY_VALUES)[number];

export const PRIORITY_META: Record<
  PriorityValue,
  { tone: StatusTone; icon: IconKey; i18nKey: string }
> = {
  high: { tone: "danger", icon: "priority.high", i18nKey: "priority.high" },
  medium: { tone: "warning", icon: "priority.medium", i18nKey: "priority.medium" },
  low: { tone: "success", icon: "priority.low", i18nKey: "priority.low" },
};
