/**
 * The Change Detection screen's own small primitives.
 *
 * Three of the frame's repeated shapes live here — the right column's card with
 * its uppercase rule, the 10px layer swatch, and the confidence reading — plus
 * a failure block, because this screen has four independent things that can
 * fail and every one of them has to show the `X-Request-ID`.
 *
 * No English: every string is a prop, as in components/icms/states.tsx.
 */

import type { ReactNode } from "react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Icon, type IconKey } from "@/lib/icons";

import { BAND_TEXT } from "./bands";
import type { ConfidenceBand } from "./model";

/**
 * A card in the 280px right column: Layer Controls, Detected Changes, Legend.
 *
 * The heading is Inter Medium, uppercase and letter-spaced over a hairline rule
 * in the accent — measured on 17:4836. It is a real heading element so the
 * three cards are three landmarks to a screen reader rather than three divs.
 */
export function PanelSection({
  title,
  headingId,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  headingId?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-h-0 flex-col border-b border-line px-3.5 py-3", className)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-accent-soft-border pb-2">
        <h2
          id={headingId}
          className="truncate text-sm font-medium tracking-wider text-ochre-500 uppercase"
        >
          {title}
        </h2>
        {action}
      </div>
      <div className={cn("min-h-0 pt-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * The 10px colour chip beside a layer or a legend entry.
 *
 * `aria-hidden` without exception: the colour never carries meaning on its own
 * here — the label beside it always says the same thing in words.
 */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color }}
      className={cn("size-2.5 shrink-0 rounded-[2px]", className)}
    />
  );
}

/**
 * A confidence reading: the number, then the band as a word.
 *
 * The word is not decoration. The frame distinguishes 94% from 78% by colour
 * alone, which fails WCAG 1.4.1 and disappears entirely on a sunlit tablet.
 */
export function ConfidenceReading({
  band,
  percentText,
  bandText,
  srText,
  className,
}: {
  band: ConfidenceBand;
  percentText: string;
  bandText: string;
  /** The whole reading as one sentence, for assistive tech. */
  srText: string;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-baseline gap-1.5", className)}>
      <span className="sr-only">{srText}</span>
      <span aria-hidden className={cn("text-sm font-medium tabular", BAND_TEXT[band])}>
        {percentText}
      </span>
      <span aria-hidden className="text-2xs text-fg-faint">
        {bandText}
      </span>
    </span>
  );
}

const REVIEW_CHIP = {
  pending: {
    icon: "feedback.info" as IconKey,
    tone: "bg-status-info text-status-info-fg border-status-info-border",
  },
  confirmed: {
    icon: "feedback.success" as IconKey,
    tone: "bg-status-danger text-status-danger-fg border-status-danger-border",
  },
  rejected: {
    icon: "action.hide" as IconKey,
    tone: "bg-status-neutral text-status-neutral-fg border-status-neutral-border",
  },
} as const;

/**
 * The officer's verdict on a detection.
 *
 * `confirmed` is styled danger rather than success on purpose: a confirmed
 * detection is a confirmed VIOLATION, and a green tick against one reads as
 * "resolved" to the next person who opens the screen.
 */
export function ReviewChip({
  status,
  children,
  className,
}: {
  status: "pending" | "confirmed" | "rejected";
  children: ReactNode;
  className?: string;
}) {
  const meta = REVIEW_CHIP[status];
  return (
    <span
      data-review={status}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium",
        meta.tone,
        className,
      )}
    >
      <Icon name={meta.icon} className="size-3 shrink-0" />
      {children}
    </span>
  );
}

/** One row of the detail panel's key/value table. */
export function Field({
  label,
  children,
  mono = false,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-end text-sm text-fg-strong",
          mono && "font-mono tabular",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * Anything that failed, with the correlation id spelled out.
 *
 * The id is selectable monospace on its own line because it gets read down a
 * phone to a support desk, and `requestIdMissingText` is shown rather than a
 * blank where the request never reached the server — "there is no id" and "I
 * forgot to look" are different answers.
 */
export function Failure({
  title,
  message,
  requestId,
  requestIdText,
  requestIdMissingText,
  onRetry,
  retryLabel,
  className,
  compact = false,
}: {
  title: ReactNode;
  message: string;
  requestId: string | null;
  requestIdText: (id: string) => string;
  requestIdMissingText: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-2 rounded-md border border-status-danger-border bg-status-danger",
        compact ? "p-3" : "p-4",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-status-danger-fg">
        <Icon name="feedback.error" className="size-4 shrink-0" />
        {title}
      </p>
      <p className="text-sm text-pretty text-fg-muted">{message}</p>
      <p className="font-mono text-2xs break-all text-fg-faint select-all">
        {requestId ? requestIdText(requestId) : requestIdMissingText}
      </p>
      {onRetry && retryLabel && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <Icon name="action.retry" className="size-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
