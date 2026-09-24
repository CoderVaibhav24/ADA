import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { MAX_GROUPS, type ZoneCount } from "@/api/icms/dashboard";
import { Button } from "@/components/ui/button";
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

// `GET /dashboard/by-zone`: lifetime counts per zone in the caller's scope. One zone is one
// bar and that is correct; many zones scroll sideways rather than squeeze.

/** Below this a bar is too narrow for its own label. */
const MIN_BAR_SLOT_PX = 72;
const MIN_PLOT_PX = 320;

export type ZonePanelProps = {
  rows: ZoneCount[] | undefined;
  pending: boolean;
  error: Error | null;
  labels: DashboardLabels;
  onRetry: () => void;
  className?: string;
};

export function ZonePanel({ rows, pending, error, labels, onRetry, className }: ZonePanelProps) {
  const { number } = useFormats();
  const [tableOpen, setTableOpen] = useState(false);
  const data = rows ?? [];

  const ticks = niceTicks(Math.max(0, ...data.map((row) => row.total)));
  const plotWidth = Math.max(MIN_PLOT_PX, data.length * MIN_BAR_SLOT_PX);

  const config = {
    total: { label: labels.byZone.columns.total, color: "var(--color-accent-solid)" },
  } satisfies ChartConfig;

  return (
    <Panel
      id="dashboard-by-zone"
      className={className}
      title={labels.byZone.title}
      badge={{ text: labels.byZone.badge, tone: "neutral" }}
      pending={pending}
      error={error}
      empty={rows !== undefined && data.length === 0}
      emptyText={labels.byZone.empty}
      footnote={labels.byZone.cap(number(MAX_GROUPS))}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/* Decorative: every figure in it is in the table, named. */}
        <div aria-hidden className="min-w-0 overflow-x-auto">
          <div style={{ minWidth: plotWidth }}>
            <ChartContainer
              config={config}
              className="aspect-auto h-[230px] w-full [&_.recharts-cartesian-axis-tick_text]:fill-fg-muted [&_.recharts-cartesian-axis-tick_text]:font-mono [&_.recharts-cartesian-axis-tick_text]:text-[13px]"
            >
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="4 4" />
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
                  width={44}
                  tickMargin={8}
                />
                <Bar
                  dataKey="total"
                  fill="var(--color-accent-solid)"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={80}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-2xs text-fg-faint text-pretty">
            {data.length > 4 ? labels.byZone.scrollHint : ""}
          </p>
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={tableOpen}
            aria-controls="zone-figures"
            onClick={() => {
              setTableOpen((open) => !open);
            }}
          >
            {tableOpen ? labels.trend.hideTable : labels.trend.showTable}
          </Button>
        </div>

        {tableOpen && (
          <div id="zone-figures" className="min-w-0 overflow-x-auto">
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
        )}
      </div>
    </Panel>
  );
}
