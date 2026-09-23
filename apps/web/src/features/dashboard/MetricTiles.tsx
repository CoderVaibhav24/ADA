import { cn } from "cn";
import type { DashboardSummary } from "@/api/icms/dashboard";
import { useFormats } from "@/i18n";
import type { DashboardLabels } from "./labels";
import { Panel } from "./Panel";

/**
 * The counter cards, from `GET /dashboard/summary`.
 *
 * ## Five tiles, not Figma's six
 *
 * `3:1302` draws six: Total Encroachments, New Detections, Active Complaints,
 * Inspections Scheduled, Notices Issued, Cases Closed. The summary endpoint
 * returns five numbers — `total`, `open`, `closed`, `rejected`,
 * `high_priority` — and no detection, inspection or notice count at all. So
 * five tiles are drawn, each one a field the server actually sent, and the
 * three with nothing behind them are left out rather than filled from a
 * different register's endpoint and labelled as though they came from here.
 *
 * `rejected` and `high_priority` appear in no Figma frame. They are on screen
 * because leaving them off would make `open + closed` look as though it should
 * equal `total`, which it does not: a rejected case is neither.
 *
 * ## The caption under each number is the scope, not decoration
 *
 * `zone_scope` narrows every one of these to the caller's zones, and a field
 * surveyor is narrowed again to the cases assigned to them. None of these
 * numbers is a zone total or a district total, and each caption says so.
 */

type Tone = "accent" | "warning" | "success" | "neutral" | "danger";

const VALUE_TONE: Record<Tone, string> = {
  accent: "text-status-accent-fg",
  warning: "text-status-warning-fg",
  success: "text-status-success-fg",
  neutral: "text-fg-strong",
  danger: "text-status-danger-fg",
};

type TileProps = {
  label: string;
  note: string;
  value: string;
  tone: Tone;
};

// The bracket corners are Figma's tile flourish (5:1758 / 5:1759), decorative only.
function Tile({ label, note, value, tone }: TileProps) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-line-subtle bg-surface-2 p-4 sm:p-5">
      <span
        aria-hidden
        className="pointer-events-none absolute start-2 top-2 size-4 border-s-2 border-t-2 border-line-accent opacity-60"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute end-2 bottom-2 size-4 border-e-2 border-b-2 border-line-accent opacity-60"
      />
      <dt className="text-xs font-bold tracking-wider text-balance text-fg-muted uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-2 font-mono text-3xl font-medium tabular-nums sm:text-4xl",
          VALUE_TONE[tone],
        )}
      >
        {value}
      </dd>
      <dd className="mt-1 text-xs text-fg-faint text-pretty">{note}</dd>
    </div>
  );
}

export type MetricTilesProps = {
  summary: DashboardSummary | undefined;
  pending: boolean;
  error: Error | null;
  labels: DashboardLabels;
  onRetry: () => void;
  className?: string;
};

export function MetricTiles({
  summary,
  pending,
  error,
  labels,
  onRetry,
  className,
}: MetricTilesProps) {
  const { number } = useFormats();
  const tiles = labels.summary.tiles;

  const rows: TileProps[] = [
    { ...tiles.total, value: number(summary?.total ?? 0), tone: "accent" },
    { ...tiles.open, value: number(summary?.open ?? 0), tone: "warning" },
    { ...tiles.closed, value: number(summary?.closed ?? 0), tone: "success" },
    { ...tiles.rejected, value: number(summary?.rejected ?? 0), tone: "neutral" },
    { ...tiles.highPriority, value: number(summary?.high_priority ?? 0), tone: "danger" },
  ];

  return (
    <Panel
      id="dashboard-summary"
      className={className}
      title={labels.summary.title}
      description={labels.summary.description}
      pending={pending}
      error={error}
      empty={summary !== undefined && summary.total === 0}
      emptyText={labels.summary.empty}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {rows.map((row) => (
          <Tile key={row.label} {...row} />
        ))}
      </dl>
    </Panel>
  );
}
