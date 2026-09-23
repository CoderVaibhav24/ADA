import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";

/**
 * Small presentational helpers shared by the showcase sections.
 * Showcase-only — nothing here is part of the design system itself, and none
 * of it ships: design-system.html is only an entry when ICMS_DESIGN_SYSTEM=1.
 */

export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line-subtle pt-8">
      <h2 className="font-display text-xl font-bold text-fg-strong">{title}</h2>
      {note && <p className="mt-1 max-w-prose text-sm text-fg-muted">{note}</p>}
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-sm font-semibold text-fg-base">{label}</h3>
        {hint && <p className="text-xs text-fg-faint">{hint}</p>}
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-start gap-3 overflow-x-auto rounded-lg border border-line-subtle bg-surface-1 p-4">
        {children}
      </div>
    </div>
  );
}

function useComputedVar<T extends HTMLElement>(name: string) {
  const ref = useRef<T>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      setValue(getComputedStyle(el).getPropertyValue(name).trim());
    });
    return () => cancelAnimationFrame(raf);
  });
  return { ref, value };
}

export function Swatch({
  name,
  label,
  note,
  wide,
}: {
  name: string;
  label?: string;
  note?: string;
  wide?: boolean;
}) {
  const { ref, value } = useComputedVar<HTMLDivElement>(name);
  return (
    <div ref={ref} className={cn("flex flex-col gap-1", wide ? "w-44" : "w-32")}>
      <div
        className="h-12 w-full rounded-md border border-line-subtle"
        style={{ background: `var(${name})` }}
      />
      <code className="font-mono text-2xs break-all text-fg-base">{label ?? name}</code>
      <code className="font-mono text-2xs break-all text-fg-faint">
        {value || "—"}
      </code>
      {note && <span className="text-2xs text-fg-faint">{note}</span>}
    </div>
  );
}

export function TokenTable({
  rows,
}: {
  rows: ReadonlyArray<{ token: string; value?: string; note: string }>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line-subtle bg-surface-1">
      <table className="w-full text-sm">
        <thead className="bg-surface-sunken">
          <tr>
            <th className="px-3 py-2 text-start text-xs font-semibold tracking-wider text-fg-muted uppercase">
              Token
            </th>
            <th className="px-3 py-2 text-start text-xs font-semibold tracking-wider text-fg-muted uppercase">
              Value
            </th>
            <th className="px-3 py-2 text-start text-xs font-semibold tracking-wider text-fg-muted uppercase">
              Rationale
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <TokenRow key={r.token} {...r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TokenRow({
  token,
  value,
  note,
}: {
  token: string;
  value?: string;
  note: string;
}) {
  const { ref, value: computed } = useComputedVar<HTMLTableRowElement>(token);
  return (
    <tr ref={ref} className="border-t border-line-subtle align-top">
      <td className="px-3 py-2">
        <code className="font-mono text-2xs text-fg-base">{token}</code>
      </td>
      <td className="px-3 py-2">
        <code className="font-mono text-2xs text-fg-muted">
          {value ?? computed ?? "—"}
        </code>
      </td>
      <td className="px-3 py-2 text-xs text-fg-muted">{note}</td>
    </tr>
  );
}
