/**
 * The pieces all three policy screens share.
 *
 * The one worth reading is `PolicySaved`. Every write here bumps
 * `icms_policy_revision` and fires `NOTIFY icms_policy` inside the change's own
 * transaction; the worker that served the write reloads synchronously, and
 * every other worker learns on the notify or on its 15-second revision poll. So
 * a save is durable at once but not yet uniform, and a screen that says nothing
 * about that produces "I changed it and it didn't work" reports out of the gap.
 * This banner is that sentence said out loud, with the revision to quote.
 */

import type { ReactNode } from "react";
import { IcmsApiError } from "@/api/icms/http";
import { POLICY_PROPAGATION_SECONDS } from "@/api/icms/policy";
import { ErrorState } from "@/components/icms/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PolicyLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";

/** A code the officer reads down a phone, so it never gets a display font. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-2xs break-all text-fg-base">
      {children}
    </code>
  );
}

// Polite rather than assertive: it follows an action the officer took on purpose.
export function PolicySaved({
  revision,
  labels,
  onDismiss,
}: {
  revision: number | null;
  labels: PolicyLabels;
  onDismiss: () => void;
}) {
  return (
    <Alert
      aria-live="polite"
      className="relative border-status-success-border bg-status-success text-status-success-fg"
    >
      <Icon name="feedback.success" className="size-4" />
      <AlertTitle className="pe-20">{labels.propagation.title(revision)}</AlertTitle>
      <AlertDescription className="pe-20 text-status-success-fg/90">
        <span className="text-pretty">
          {labels.propagation.body(POLICY_PROPAGATION_SECONDS)}
        </span>
      </AlertDescription>
      <Button variant="ghost" size="xs" className="absolute end-2 top-2" onClick={onDismiss}>
        {labels.propagation.dismiss}
      </Button>
    </Alert>
  );
}

/**
 * A refusal the server made on purpose — 409 `policy_lockout`, 409
 * `permission_is_system`. Deliberately not the generic error state: these are
 * guard rails, and reading one as a malfunction is what makes an admin retry.
 */
export function PolicyRefusal({
  title,
  body,
  hint,
  requestId,
  labels,
}: {
  title: ReactNode;
  body: ReactNode;
  hint?: ReactNode;
  requestId?: string | null;
  labels: PolicyLabels;
}) {
  return (
    <Alert role="alert" variant="destructive" className="border-status-danger-border">
      <Icon name="user.password" className="size-4" />
      <AlertTitle className="text-pretty">{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span className="text-pretty">{body}</span>
        {hint && <span className="text-pretty text-fg-muted">{hint}</span>}
        {requestId && (
          <span className="text-2xs text-fg-faint">
            {labels.error.requestId} <Code>{requestId}</Code>
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** A load that failed. The request id is what ties it to the server's log line. */
export function PolicyLoadError({
  error,
  onRetry,
  labels,
}: {
  error: unknown;
  onRetry: () => void;
  labels: PolicyLabels;
}) {
  const api = error instanceof IcmsApiError ? error : null;
  return (
    <ErrorState
      size="compact"
      title={labels.error.title}
      description={api?.message ?? labels.error.body}
      detail={api?.requestId ?? undefined}
      onRetry={onRetry}
      retryLabel={labels.error.retry}
    />
  );
}

/** The card each screen's content sits in, so the three panels match. */
export function PolicyPanel({
  title,
  subtitle,
  aside,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose min-w-0">
          <h2 className="font-display text-lg font-semibold text-fg-strong">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-fg-muted text-pretty">{subtitle}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
