import type { ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { Icon, type IconKey } from "@/lib/icons";

/**
 * Empty / loading / error states for the registers.
 *
 * Figma designs NONE of these for any of the three grids — the audit is
 * explicit about it ("Empty / loading states: NOT DESIGNED", three times).
 * Every grid needs all three, so all three are designed here.
 *
 * Shared rules:
 *   - one icon, one heading, one line of explanation, at most two actions;
 *   - the icon is decorative and the heading carries the meaning, so a screen
 *     reader gets the state from text alone;
 *   - nothing is centred with a fixed width — the copy block is max-w-prose so
 *     a longer Hindi string wraps instead of overflowing;
 *   - no English: every string is a prop.
 */

type BaseStateProps = {
  icon?: IconKey;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  /** `compact` fits inside a table body; `default` is a full panel. */
  size?: "compact" | "default";
};

function StateShell({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = "default",
  tone = "muted",
  slot,
}: BaseStateProps & { tone?: "muted" | "danger"; slot: string }) {
  return (
    <div
      data-slot={slot}
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        size === "compact" ? "px-4 py-10" : "px-6 py-16",
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            "flex items-center justify-center rounded-full border",
            size === "compact" ? "size-10" : "size-14",
            tone === "danger"
              ? "border-status-danger-border bg-status-danger text-status-danger-fg"
              : "border-line-subtle bg-surface-2 text-fg-faint",
          )}
        >
          <Icon name={icon} className={size === "compact" ? "size-5" : "size-6"} />
        </span>
      )}

      <div className="flex max-w-prose flex-col gap-1">
        <p
          className={cn(
            "font-display font-semibold text-balance",
            size === "compact" ? "text-base" : "text-lg",
            tone === "danger" ? "text-status-danger-fg" : "text-fg-strong",
          )}
        >
          {title}
        </p>
        {description && (
          <p className="text-sm text-fg-muted text-pretty">{description}</p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/** Nothing exists yet — offer the action that creates the first record. */
export function EmptyState({ icon = "feedback.empty", ...props }: BaseStateProps) {
  return <StateShell slot="empty-state" icon={icon} {...props} />;
}

/**
 * Records exist but the filters exclude them all. Distinct from EmptyState on
 * purpose: the useful action here is "clear filters", not "create a record",
 * and conflating the two is why users delete their filters by creating junk.
 */
export function NoResultsState({
  icon = "feedback.noResults",
  ...props
}: BaseStateProps) {
  return <StateShell slot="no-results-state" icon={icon} {...props} />;
}

export function ErrorState({
  icon = "feedback.error",
  onRetry,
  retryLabel,
  /** Correlation id / HTTP status. Monospace so it can be read over a phone. */
  detail,
  ...props
}: BaseStateProps & {
  onRetry?: () => void;
  retryLabel?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <StateShell
      slot="error-state"
      icon={icon}
      tone="danger"
      action={
        onRetry && retryLabel ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <Icon name="action.retry" className="size-4" />
            {retryLabel}
          </Button>
        ) : undefined
      }
      {...props}
      description={
        <>
          {props.description}
          {detail && (
            <span className="mt-2 block font-mono text-2xs text-fg-faint break-all">
              {detail}
            </span>
          )}
        </>
      }
    />
  );
}

/**
 * Skeleton rows for a table body.
 *
 * Renders real <tr>/<td> so the column widths do not jump when the data lands —
 * a spinner in a colspan cell collapses the grid and then re-expands it, which
 * is the single most common register loading bug.
 *
 * `columns` should be the live column count. Widths vary per column index so
 * the placeholder reads as tabular data rather than as a striped block.
 */
export function TableLoadingRows({
  rows = 8,
  columns,
  className,
}: {
  rows?: number;
  columns: number;
  className?: string;
}) {
  const widths = ["w-24", "w-20", "w-40", "w-28", "w-24", "w-16", "w-20", "w-24"];
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r} className={className} aria-hidden>
          {Array.from({ length: columns }, (_, c) => (
            <TableCell key={c}>
              <Skeleton className={cn("h-4", widths[c % widths.length])} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * Non-table loading placeholder — cards, detail panels, the dashboard tiles.
 * `label` is announced; the bars are hidden from assistive tech.
 */
export function LoadingState({
  label,
  lines = 3,
  className,
}: {
  /** Translated, announced via aria-live. */
  label: ReactNode;
  lines?: number;
  className?: string;
}) {
  return (
    <div
      data-slot="loading-state"
      className={cn("flex w-full flex-col gap-3 p-6", className)}
      aria-busy
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-5 w-1/3" />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-4", i % 2 ? "w-full" : "w-4/5")} />
        ))}
      </div>
    </div>
  );
}

/** Inline spinner for a button or a toolbar. */
export function InlineSpinner({
  label,
  className,
}: {
  label: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-live="polite">
      <Icon name="feedback.loading" className="size-4" spin />
      <span className="text-sm text-fg-muted">{label}</span>
    </span>
  );
}
