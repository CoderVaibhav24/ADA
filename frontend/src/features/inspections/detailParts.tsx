/**
 * The pieces every panel on the Inspection detail screen is built from.
 *
 * `WriteOutcome` is the one worth reading. Every write on this screen can be
 * refused by the workflow for a reason the officer could not have known —
 * someone else moved the case, a grant changed, the fix was too poor — and the
 * only useful thing a screen can do with that is say what the server said and
 * print the request id beside it. A generic "something went wrong" costs a
 * support call that cannot be answered, because nothing on screen ties the
 * failure to a line in the server's log.
 */

import type { ReactNode } from "react";
import { cn } from "cn";
import { IcmsApiError } from "@/api/icms/http";
import { POOR_ACCURACY } from "@/api/icms/inspections";

/**
 * Contract amendment 7: a photograph with any capture field missing is refused
 * outright rather than stored flagged, and `allowed` names the fields that were
 * absent. Not exported from the client, so it is named here rather than typed
 * as a bare string at the one place it is compared.
 */
const GEOTAG_REQUIRED = "geotag_required";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useInspectionEvidenceLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import type { InspectionDetailLabels } from "./detailLabels";

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
            <p className="mt-1 max-w-prose text-2xs text-fg-faint text-pretty">
              {description}
            </p>
          )}
        </div>
        {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

/**
 * One label/value pair, as Figma 60:641 draws them — caption above, value below.
 *
 * A real `<dt>`/`<dd>`, so the pairing survives a screen reader; the panels put
 * them in a `<dl>`. The value is never an empty cell: a null is the `Absent`
 * sentence for that field, because a blank box reads as "not loaded".
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

/** References, coordinates and checksums: fixed width, never a display font. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs break-all", className)}>{children}</span>;
}

/**
 * What the server said about a write that failed.
 *
 * Two of the eighteen codes in contract §6 get their own sentence, because
 * neither is a malfunction and the server's own English does not say what to do
 * next:
 *
 *   - `poor_accuracy` — the fix was worse than this authority's threshold and
 *     nothing was stored. The officer waits for a better fix (§4.1).
 *   - `geotag_required` — a photograph arrived without its capture fields and
 *     was refused rather than flagged. `allowed` names the missing fields, and
 *     they are read out, because "it failed" and "it needed a position and a
 *     time" send an officer to two different places (amendment 7).
 *
 * Everything else is rendered from `error.message`, which §6 wrote to be read.
 * The request id is printed beside all of them: it is the only thing on screen
 * that ties the refusal to a line in the server's log.
 */
export function WriteOutcome({
  error,
  saved,
  labels,
}: {
  error: unknown;
  saved: boolean;
  labels: InspectionDetailLabels;
}) {
  const evidenceLabels = useInspectionEvidenceLabels();
  const api = error instanceof IcmsApiError ? error : null;

  if (error) {
    const poorAccuracy = api?.code === POOR_ACCURACY;
    const geotagRequired = api?.code === GEOTAG_REQUIRED;
    const expected = poorAccuracy || geotagRequired;

    const title = poorAccuracy
      ? evidenceLabels.poorAccuracyTitle
      : geotagRequired
        ? labels.upload.geotagRequiredTitle
        : labels.refusedTitle;

    const body = poorAccuracy
      ? evidenceLabels.poorAccuracyBody
      : geotagRequired
        ? labels.upload.geotagRequiredBody((api?.allowed ?? []).join(", "))
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
      <AlertTitle>{labels.saved}</AlertTitle>
    </Alert>
  );
}
