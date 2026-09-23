/**
 * The pieces every section of the Reports screen is built from.
 *
 * A local copy of the panel shape `features/notices/parts.tsx` uses rather than
 * an import of it: that module's primitives are typed to the notice screens'
 * labels. What is NOT duplicated is the empty/loading/error vocabulary —
 * `components/icms/states.tsx` already owns those and every section here uses
 * it, so a report's error state looks like a register's.
 *
 * `SectionError` prints whatever `describeError` (in `errors.ts`) pulled off
 * the failure: this screen talks to both transports, and the correlation id is
 * in the body of one and the header of the other.
 */

import type { ReactNode } from "react";
import { cn } from "cn";
import { ErrorState } from "@/components/icms/states";
import { Icon, type IconKey } from "@/lib/icons";
import { describeError } from "./errors";

/** The card every section sits in, so the panels match down the page. */
export function ReportSection({
  icon,
  title,
  description,
  actions,
  children,
  className,
}: {
  icon: IconKey;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-muted"
          >
            <Icon name={icon} className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-fg-strong">{title}</h2>
            {description && (
              <p className="mt-1 max-w-prose text-sm text-fg-muted text-pretty">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/**
 * A stated caveat about a number, not a decoration.
 *
 * `warning` is for the cohort note, which is the one misreading on this screen
 * that turns into a figure somebody quotes in a meeting.
 */
export function ReportNote({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning";
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "warning"
          ? "border-status-warning-border bg-status-warning text-status-warning-fg"
          : "border-line-subtle bg-surface-2 text-fg-muted",
      )}
    >
      <Icon
        aria-hidden
        name={tone === "warning" ? "feedback.warning" : "feedback.info"}
        className="mt-0.5 size-4 shrink-0"
      />
      <div className="min-w-0 max-w-prose text-pretty">
        {title && <p className="font-semibold">{title}</p>}
        <p>{children}</p>
      </div>
    </div>
  );
}

/** A section's failure: what the server said, and the id in its log line. */
export function SectionError({
  title,
  body,
  cause,
  onRetry,
  retryLabel,
}: {
  title: ReactNode;
  body: ReactNode;
  cause: unknown;
  onRetry?: () => void;
  retryLabel?: ReactNode;
}) {
  const described = describeError(cause);
  return (
    <ErrorState
      title={title}
      description={described.message ?? body}
      detail={described.requestId ?? undefined}
      onRetry={onRetry}
      retryLabel={retryLabel}
      size="compact"
    />
  );
}

/**
 * The proportional bar beside a share figure.
 *
 * Decorative and hidden from assistive tech: the percentage is printed beside
 * it as text, which is what a screen reader and a printed report both need.
 */
export function ShareBar({ percent }: { percent: number | null }) {
  return (
    <span aria-hidden className="flex items-center">
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-3">
        <span
          className="block h-full rounded-full bg-accent-solid"
          style={{ width: `${String(Math.max(0, Math.min(100, percent ?? 0)))}%` }}
        />
      </span>
    </span>
  );
}

/** A label above a control in the filter rows. Always tied to its control. */
export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-2xs font-medium tracking-wide text-fg-muted uppercase"
    >
      {children}
    </label>
  );
}
