import type { ReactNode } from "react";
import { cn } from "cn";
import { EmptyState, ErrorState, LoadingState } from "@/components/icms/states";
import type { DashboardLabels } from "./labels";
import { requestIdOf } from "./useDashboard";

/**
 * The chrome every dashboard panel wears, and the three states it can be in.
 *
 * `children` are only rendered once the panel has data, so a panel cannot
 * accidentally ship without its loading, empty and error states — the shell
 * sequences them and there is no branch a caller can forget. The primitives
 * themselves come from `components/icms/states`; nothing is re-implemented.
 *
 * `error` renders the server's own message plus the correlation id from
 * `IcmsApiError.requestId`, which is the value in the ada-api log line and the
 * difference between "the dashboard broke" and a support call that can be
 * answered. A plain `Error` carries no id and says so rather than showing a gap.
 */

export type PanelProps = {
  /** Used for `aria-labelledby`, so the section is announced by its own title. */
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** A control that belongs to this panel — the trend period select. */
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
  description,
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
        "flex min-w-0 flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-display text-lg font-semibold text-fg-strong">
            {title}
          </h2>
          {description && (
            <p className="mt-1 max-w-prose text-sm text-fg-muted text-pretty">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-end gap-2">{action}</div>}
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
        <p className="max-w-prose text-2xs text-fg-faint text-pretty">{footnote}</p>
      )}
    </section>
  );
}
