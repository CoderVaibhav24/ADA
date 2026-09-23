/**
 * The pieces every panel on the Complaint detail screen is built from.
 *
 * Deliberately this screen's own rather than imported from the Inspection
 * detail's `detailParts.tsx`: those are typed on `InspectionDetailLabels` and
 * carry that screen's two evidence refusals, and widening them would couple two
 * features that only happen to look alike. The visual language is the same
 * because the tokens are the same.
 *
 * `WriteOutcome` is the one worth reading. Two of the codes `assign_case`
 * answers are about the OFFICER NAMED, not about the request, and the server's
 * own English does not say what to do next:
 *
 *   - `assignee_not_a_surveyor` — the user id is real but does not hold
 *     `field-surveyor`, so every transition the assignment would open refuses
 *     them. Nothing was written.
 *   - `assignee_not_in_zone` — they have no active assignment to this case's
 *     zone, so the case would be invisible to them.
 *
 * Everything else is rendered from `error.message`, which the error contract
 * wrote to be read, and the request id is printed beside all of them: it is the
 * only thing on screen that ties the refusal to a line in the server's log.
 */

import type { ReactNode } from "react";
import { cn } from "cn";
import { IcmsApiError } from "@/api/icms/http";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Icon } from "@/lib/icons";
import type { ComplaintDetailLabels } from "./ComplaintDetailLabels";
import { ASSIGNEE_NOT_A_SURVEYOR, ASSIGNEE_NOT_IN_ZONE } from "./ComplaintDetailModel";

/** A code an officer reads down a phone, so it never gets a display font. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-2xs break-all text-fg-base">
      {children}
    </code>
  );
}

/** The card every section of this screen sits in, so the panels match. */
export function DetailPanel({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-fg-strong">{title}</h2>
          {description && (
            <p className="mt-1 max-w-prose text-2xs text-fg-faint text-pretty">{description}</p>
          )}
        </div>
        {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/**
 * One label/value pair — caption above, value below, a real `<dt>`/`<dd>` so the
 * pairing survives a screen reader. The value is never an empty cell.
 */
export function Field({
  label,
  children,
  wide,
}: {
  label: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2")}>
      <dt className="text-2xs text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg-strong text-pretty">{children}</dd>
    </div>
  );
}

/** A value the record does not have. Faint, and a sentence rather than a dash. */
export function Absent({ children }: { children: ReactNode }) {
  return <span className="text-fg-faint">{children}</span>;
}

/** References, coordinates and identifiers: fixed width, never a display font. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs break-all", className)}>{children}</span>;
}

/** What the server said about a write that failed, and the id to quote about it. */
export function WriteOutcome({
  error,
  saved,
  savedTitle,
  savedBody,
  labels,
}: {
  error: unknown;
  saved: boolean;
  savedTitle?: ReactNode;
  savedBody?: ReactNode;
  labels: ComplaintDetailLabels;
}) {
  const api = error instanceof IcmsApiError ? error : null;

  if (error) {
    const notSurveyor = api?.code === ASSIGNEE_NOT_A_SURVEYOR;
    const notInZone = api?.code === ASSIGNEE_NOT_IN_ZONE;
    // Neither is a malfunction: the request was well formed and the officer
    // named was the wrong one. Warning, not error.
    const expected = notSurveyor || notInZone;

    const title = notSurveyor
      ? labels.assign.notSurveyorTitle
      : notInZone
        ? labels.assign.notInZoneTitle
        : labels.refusedTitle;

    const body = notSurveyor
      ? labels.assign.notSurveyorBody
      : notInZone
        ? labels.assign.notInZoneBody
        : (api?.message ?? labels.errorBody);

    return (
      <Alert role="alert" variant="destructive" className="border-status-danger-border">
        <Icon name={expected ? "feedback.warning" : "feedback.error"} className="size-4" />
        <AlertTitle className="text-pretty">{title}</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span className="text-pretty">{body}</span>
          {api?.requestId && (
            <span className="text-2xs text-fg-faint">
              {labels.requestId} <Code>{api.requestId}</Code>
            </span>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (!saved) return null;

  // Polite rather than assertive: it follows an action the officer took on purpose.
  return (
    <Alert
      aria-live="polite"
      className="border-status-success-border bg-status-success text-status-success-fg"
    >
      <Icon name="feedback.success" className="size-4" />
      <AlertTitle>{savedTitle ?? labels.saved}</AlertTitle>
      {savedBody && <AlertDescription className="text-pretty">{savedBody}</AlertDescription>}
    </Alert>
  );
}
