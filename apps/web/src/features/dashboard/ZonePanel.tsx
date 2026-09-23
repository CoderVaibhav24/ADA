import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { MAX_GROUPS, type ZoneCount } from "@/api/icms/dashboard";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFormats } from "@/i18n";
import type { DashboardLabels } from "./labels";
import { Panel } from "./Panel";
import { axisMax, niceTicks } from "./trendModel";

/**
 * `GET /dashboard/by-zone` — one row per zone the caller can see.
 *
 * ## An officer with one zone gets one bar, and that is correct
 *
 * The endpoint's own docstring says so: "that is not a degraded chart; it is
 * the authority the register is read under, drawn." And for a field surveyor
 * narrowed to their own cases, the bar over a zone is THEIR caseload in it, not
 * the zone's total — which is why no label on this panel says "zone total".
 *
 * ## Many zones scroll sideways rather than squeezing
 *
 * `MAX_GROUPS` is 100. A district holds a handful, but the cap is a cap, and
 * forty bars compressed into panel width is an unreadable chart pretending to
 * be a readable one. The plot gets a minimum width per bar and its container
 * scrolls — the same rule the registers follow — and the table underneath is
 * the authoritative reading either way.
 *
 * ## No period badge
 *
 * Figma badges this panel "FY 2025-26" (`23:2487`). The endpoint takes no
 * parameters: these are lifetime-to-date counts, and the description says so
 * rather than wearing a badge for a window nothing here applies.
 */

/** Below this a bar is too narrow for its own label; above it, nothing is gained. */
const MIN_BAR_SLOT_PX = 72;
const MIN_PLOT_PX = 320;

export type ZonePanelProps = {
  rows: ZoneCount[] | undefined;
  pending: boolean;
  error: Error | null;
  labels: DashboardLabels;
  onRetry: () => void;
};

export function ZonePanel({ rows, pending, error, labels, onRetry }: ZonePanelProps) {
  const { number } = useFormats();
  const data = rows ?? [];

  const ticks = niceTicks(Math.max(0, ...data.map((row) => row.total)));
  const plotWidth = Math.max(MIN_PLOT_PX, data.length * MIN_BAR_SLOT_PX);

  const config = {
    total: { label: labels.byZone.columns.total, color: "var(--color-chart-1)" },
  } satisfies ChartConfig;

  return (
    <Panel
      id="dashboard-by-zone"
      title={labels.byZone.title}
      description={labels.byZone.description}
      pending={pending}
      error={error}
      empty={rows !== undefined && data.length === 0}
      emptyText={labels.byZone.empty}
      footnote={labels.byZone.cap(number(MAX_GROUPS))}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-2xs text-fg-faint">{labels.byZone.axis}</p>

        {/* Decorative: every figure in it is in the table below, named. */}
        <div aria-hidden className="min-w-0 overflow-x-auto">
          <div style={{ minWidth: plotWidth }}>
            <ChartContainer config={config} className="aspect-auto h-56 w-full">
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="zone_name"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                />
                <YAxis
                  ticks={ticks}
                  domain={[0, axisMax(ticks)]}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickMargin={8}
                />
                <Bar
                  dataKey="total"
                  fill="var(--color-total)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        {data.length > 4 && (
          <p className="text-2xs text-fg-faint text-pretty">{labels.byZone.scrollHint}</p>
        )}

        <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.byZone.columns.zone}</TableHead>
                <TableHead className="text-end">{labels.byZone.columns.total}</TableHead>
                <TableHead className="text-end">{labels.byZone.columns.open}</TableHead>
                <TableHead className="text-end">{labels.byZone.columns.resolved}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.zone_cd}>
                  <TableCell className="min-w-40">
                    <span className="block break-words">{row.zone_name}</span>
                    <span className="block font-mono text-2xs text-fg-faint">
                      {row.zone_cd}
                    </span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{number(row.total)}</TableCell>
                  <TableCell className="text-end tabular-nums">{number(row.open)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {number(row.resolved)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </Panel>
  );
}
