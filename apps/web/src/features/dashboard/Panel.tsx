import type { ReactNode } from "react";
import { cn } from "cn";
import { EmptyState, ErrorState, LoadingState } from "@/components/icms/states";
import type { DashboardLabels } from "./labels";
import { requestIdOf } from "./useDashboard";

// Chrome for every dashboard panel. `children` render only once data has settled, so no
// panel can ship without its loading, empty and error states; errors carry the request id.

export type PanelBadge = { text: ReactNode; tone: "success" | "neutral" };

const BADGE_TONE: Record<PanelBadge["tone"], string> = {
  success: "bg-status-success border-status-success-border text-status-success-fg",
  neutral: "bg-status-neutral border-status-neutral-border text-status-neutral-fg",
};

export type PanelProps = {
  /** Used for `aria-labelledby`, so the section is announced by its own title. */
  id: string;
  title: ReactNode;
  titleClassName?: string;
  badge?: PanelBadge;
  action?: ReactNode;
  /** Qualifications that must survive the data: caps, rounding, scope. */
  footnote?: ReactNode;
  className?: string;

  pending: boolean;
  error: Error | null;
  empty: boolean;
  emptyText: ReactNode;
  labels: DashboardLabels["panel"];
  onRetry?: () => void;

  children: ReactNode;
};

export function Panel({
  id,
  title,
  titleClassName,
  badge,
  action,
  footnote,
  className,
  pending,
  error,
  empty,
  emptyText,
  labels,
  onRetry,
  children,
}: PanelProps) {
  const settled = !pending && !error;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex min-h-[338px] min-w-0 flex-col gap-3 rounded-xl border border-line-subtle bg-gradient-to-b from-surface-1 to-surface-sunken p-5",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`${id}-title`}
          className={cn("font-display text-[15px] font-bold text-fg-strong", titleClassName)}
        >
          {title}
        </h2>
        {(badge || action) && (
          <div className="flex shrink-0 items-center gap-2">
            {badge && (
              <span
                className={cn(
                  "rounded-sm border px-2 py-0.5 font-mono text-xs font-semibold tracking-wider uppercase",
                  BADGE_TONE[badge.tone],
                )}
              >
                {badge.text}
              </span>
            )}
            {action}
          </div>
        )}
      </header>

      {error ? (
        <ErrorState
          size="compact"
          title={labels.errorTitle}
          description={error.message}
          detail={labels.requestId(requestIdOf(error))}
          onRetry={onRetry}
          retryLabel={onRetry ? labels.retry : undefined}
        />
      ) : pending ? (
        <LoadingState label={labels.loading} lines={4} className="p-0" />
      ) : empty ? (
        <EmptyState size="compact" title={emptyText} />
      ) : (
        children
      )}

      {footnote && settled && !empty && (
        <p className="mt-auto max-w-prose text-2xs text-fg-faint text-pretty">{footnote}</p>
      )}
    </section>
  );
}
