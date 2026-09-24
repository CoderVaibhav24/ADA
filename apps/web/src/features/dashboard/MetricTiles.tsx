import type { ReactNode } from "react";
import { cn } from "cn";
import type { DashboardSummary } from "@/api/icms/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormats } from "@/i18n";
import type { DashboardLabels } from "./labels";
import { requestIdOf } from "./useDashboard";

// The six counter cards of Figma 3:1302. Always drawn; each carries its own pending,
// error and no-permission state, so one failing register never hides the others.

type Tone = "accent" | "success" | "danger";

const VALUE_TONE: Record<Tone, string> = {
  accent: "text-status-accent-fg",
  success: "text-status-success-fg",
  danger: "text-status-danger-fg",
};

/** The slice of a TanStack query result a tile reads. */
export type TileQuery<T> = { data: T | undefined; isPending: boolean; error: Error | null };

type TileProps = {
  label: string;
  tone: Tone;
  allowed: boolean;
  pending: boolean;
  error: Error | null;
  value: number | undefined;
  /** Null while the note's own data is still loading. */
  note: string | null;
  labels: DashboardLabels;
};

// One card; the bracket corners are Figma's flourish (5:1758 / 5:1759), decorative only.
function Tile({ label, tone, allowed, pending, error, value, note, labels }: TileProps) {
  const { number } = useFormats();

  let shown: ReactNode;
  let caption: ReactNode;
  let title: string | undefined;
  if (!allowed) {
    shown = "—";
    caption = labels.tiles.noPermission;
  } else if (error) {
    shown = "—";
    caption = labels.tiles.unavailable;
    title = `${error.message} · ${labels.panel.requestId(requestIdOf(error))}`;
  } else if (pending || value === undefined) {
    shown = <Skeleton className="h-8 w-20" />;
    caption = <Skeleton className="h-3 w-28" />;
  } else {
    shown = number(value);
    caption = note ?? <Skeleton className="h-3 w-28" />;
  }

  const muted = !allowed || Boolean(error);
  return (
    <div
      title={title}
      aria-busy={allowed && !error && (pending || value === undefined)}
      className="relative flex min-h-36 min-w-0 flex-col justify-center gap-1 overflow-hidden rounded-2xl border border-line bg-surface-2 p-6 shadow-md"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute start-3 top-3 size-5 border-s-2 border-t-2 border-line-accent"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute end-3 bottom-3 size-3 border-e-2 border-b-2 border-line-accent"
      />
      <dt className="font-display text-sm font-bold tracking-wider text-balance text-fg-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono text-2xl font-medium tabular-nums",
          muted ? "text-fg-faint" : VALUE_TONE[tone],
        )}
      >
        {shown}
      </dd>
      <dd className="text-xs text-fg-muted text-pretty">{caption}</dd>
    </div>
  );
}

export type MetricTilesProps = {
  summary: TileQuery<DashboardSummary>;
  /** Cases raised in the trend window; undefined while loading, null if it failed. */
  raisedInPeriod: number | null | undefined;
  periodLabel: string;
  newDetections: TileQuery<number>;
  inspectionsScheduled: TileQuery<number>;
  noticesIssued: TileQuery<number>;
  can: { cases: boolean; inspections: boolean; notices: boolean };
  labels: DashboardLabels;
  className?: string;
};

export function MetricTiles({
  summary,
  raisedInPeriod,
  periodLabel,
  newDetections,
  inspectionsScheduled,
  noticesIssued,
  can,
  labels,
  className,
}: MetricTilesProps) {
  const { number } = useFormats();
  const tiles = labels.tiles;
  const data = summary.data;
  const fromSummary = { allowed: true, pending: summary.isPending, error: summary.error };
  const fromCount = (query: TileQuery<number>, allowed: boolean) => ({
    allowed,
    pending: query.isPending,
    error: query.error,
    value: query.data,
  });

  const rows: Omit<TileProps, "labels">[] = [
    {
      label: tiles.total,
      tone: "accent",
      ...fromSummary,
      value: data?.total,
      note:
        raisedInPeriod === undefined
          ? null
          : raisedInPeriod === null
            ? ""
            : tiles.raisedInPeriod(number(raisedInPeriod), periodLabel),
    },
    {
      label: tiles.newDetections,
      tone: "danger",
      ...fromCount(newDetections, can.cases),
      note: tiles.last30Days,
    },
    {
      label: tiles.activeComplaints,
      tone: "success",
      ...fromSummary,
      value: data?.open,
      note: data ? tiles.highPriority(number(data.high_priority)) : null,
    },
    {
      label: tiles.inspectionsScheduled,
      tone: "success",
      ...fromCount(inspectionsScheduled, can.inspections),
      note: tiles.awaitingSubmission,
    },
    {
      label: tiles.noticesIssued,
      tone: "accent",
      ...fromCount(noticesIssued, can.notices),
      note: tiles.allNotices,
    },
    {
      label: tiles.casesClosed,
      tone: "success",
      ...fromSummary,
      value: data?.closed,
      note: data ? tiles.rejected(number(data.rejected)) : null,
    },
  ];

  return (
    <dl className={cn("grid gap-6 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {rows.map((row) => (
        <Tile key={row.label} {...row} labels={labels} />
      ))}
    </dl>
  );
}
