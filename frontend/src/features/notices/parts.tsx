/**
 * The pieces the two notice screens are built from.
 *
 * Deliberately a local copy of the three primitives in
 * `features/inspections/detailParts.tsx` rather than an import of them: that
 * module also exports `WriteOutcome`, which is typed to
 * `InspectionDetailLabels` and reads the inspection evidence hooks, so
 * importing from it would drag the whole inspection feature into this one for
 * three `<div>`s. They are small enough that duplication is cheaper than the
 * coupling; the day a fourth screen needs them, they hoist to
 * `components/icms/`.
 */

import type { ReactNode } from "react";
import { cn } from "cn";

/** The card every section of these screens sits in, so the panels match. */
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
 * One label/value pair — caption above, value below.
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

/** References and checksums: fixed width, never a display font. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs break-all", className)}>{children}</span>;
}
