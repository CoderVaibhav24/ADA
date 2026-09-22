import type { ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import { Icon } from "@/lib/icons";
import {
  PRIORITY_META,
  STATUS_META,
  type PriorityValue,
  type StatusValue,
} from "./status";

/**
 * One chip for every status the three registers use.
 *
 * Colour never carries the meaning on its own: six tones are shared across ten
 * statuses, so the icon is load-bearing, not decoration (WCAG 1.4.1). The
 * colour pair for each tone comes from the --status-*-{fg,bg,border} tokens,
 * which are contrast-checked against their own tint rather than against the
 * card, because a chip sits on its own background.
 *
 * No English in here. The label is `children`, supplied by the caller from the
 * i18n layer — see status.ts `i18nKey` and status-labels.en.ts for the seed.
 */
const chip = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border font-medium " +
    "whitespace-nowrap transition-colors duration-fast ease-standard " +
    // min-w-0 + normal word-break: a Devanagari status label is longer than its
    // English counterpart and must be allowed to size the chip, never be clipped.
    "max-w-full [overflow-wrap:anywhere]",
  {
    variants: {
      tone: {
        neutral:
          "bg-status-neutral text-status-neutral-fg border-status-neutral-border",
        accent:
          "bg-status-accent text-status-accent-fg border-status-accent-border",
        info: "bg-status-info text-status-info-fg border-status-info-border",
        success:
          "bg-status-success text-status-success-fg border-status-success-border",
        warning:
          "bg-status-warning text-status-warning-fg border-status-warning-border",
        danger:
          "bg-status-danger text-status-danger-fg border-status-danger-border",
      },
      size: {
        sm: "px-2 py-0.5 text-2xs gap-1",
        md: "px-2.5 py-1 text-xs",
        lg: "px-3 py-1.5 text-sm",
      },
      uppercase: {
        true: "uppercase tracking-wider",
        false: "",
      },
    },
    defaultVariants: { tone: "neutral", size: "md", uppercase: false },
  },
);

const ICON_SIZE = { sm: "size-3", md: "size-3.5", lg: "size-4" } as const;

export type StatusChipProps = {
  status: StatusValue;
  /** Translated label. Required — the primitive ships no English. */
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Figma renders register chips uppercase; detail headers render them as-is. */
  uppercase?: boolean;
  /** Hide the glyph. Only for a context that already conveys state otherwise. */
  hideIcon?: boolean;
};

export function StatusChip({
  status,
  children,
  className,
  size = "md",
  uppercase = false,
  hideIcon = false,
}: StatusChipProps) {
  const meta = STATUS_META[status];
  return (
    <span
      data-status={status}
      data-tone={meta.tone}
      className={cn(chip({ tone: meta.tone, size, uppercase }), className)}
    >
      {!hideIcon && (
        <Icon
          name={meta.icon}
          className={cn(ICON_SIZE[size], "shrink-0")}
          spin={status === "inProgress"}
        />
      )}
      {children}
    </span>
  );
}

export type PriorityChipProps = {
  priority: PriorityValue;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  uppercase?: boolean;
  hideIcon?: boolean;
};

/**
 * Figma draws priority as bare coloured text (`HIGH` in red-orange, `LOW` in
 * green) with no shape and no icon — colour-only, which fails 1.4.1. Same chip
 * treatment, same reason.
 */
export function PriorityChip({
  priority,
  children,
  className,
  size = "sm",
  uppercase = true,
  hideIcon = false,
}: PriorityChipProps) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      data-priority={priority}
      data-tone={meta.tone}
      className={cn(chip({ tone: meta.tone, size, uppercase }), className)}
    >
      {!hideIcon && <Icon name={meta.icon} className={cn(ICON_SIZE[size], "shrink-0")} />}
      {children}
    </span>
  );
}
