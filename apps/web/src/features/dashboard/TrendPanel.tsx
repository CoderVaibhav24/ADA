import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { IST_TIME_ZONE } from "@ada/shared/dates";
import type { DashboardTrend, TrendPoint } from "@/api/icms/dashboard";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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
import { axisMax, labelledIndexes, niceTicks, trendTotals, type PeriodId } from "./trendModel";

// `GET /dashboard/trend`: cases raised per IST bucket and the cohort of those since closed.
// The second series is a cohort, not "closed that day"; legend, tooltip and footnote say so.

/* Stable "no points yet", so the memos below do not recompute every render. */
const NO_POINTS: readonly TrendPoint[] = [];

const SERIES = [
  { key: "raised", color: "var(--color-chart-2)" },
  { key: "resolved", color: "var(--color-chart-3)" },
] as const;

export type TrendPanelProps = {
  trend: DashboardTrend | undefined;
  pending: boolean;
  error: Error | null;
  period: PeriodId;
  labels: DashboardLabels;
  onRetry: () => void;
  className?: string;
};

export function TrendPanel({
  trend,
  pending,
  error,
  period,
  labels,
  onRetry,
  className,
}: TrendPanelProps) {
  const { locale, number, date } = useFormats();
  const [tableOpen, setTableOpen] = useState(false);

  const points: readonly TrendPoint[] = trend?.points ?? NO_POINTS;
  const bucket = trend?.bucket ?? "day";
  const totals = trendTotals(points);

  // A month bucket wants "Sep 2026"; a day or a week start wants "12 Sep".
  const tickFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(
        locale,
        bucket === "month"
          ? { month: "short", year: "numeric", timeZone: IST_TIME_ZONE }
          : { day: "2-digit", month: "short", timeZone: IST_TIME_ZONE },
      ),
    [locale, bucket],
  );

  const yTicks = useMemo(
    () => niceTicks(Math.max(0, ...points.map((point) => point.raised))),
    [points],
  );
  const xTicks = useMemo(
    () => labelledIndexes(points.length).map((index) => points[index].period),
    [points],
  );

  const config = {
    raised: { label: labels.trend.series.raised, color: SERIES[0].color },
    resolved: { label: labels.trend.series.resolved, color: SERIES[1].color },
  } satisfies ChartConfig;

  return (
    <Panel
      id="dashboard-trend"
      className={className}
      title={labels.trend.title}
      badge={{ text: labels.trend.periodShort(period), tone: "success" }}
      pending={pending}
      error={error}
      empty={trend !== undefined && points.length === 0}
      emptyText={labels.trend.empty}
      footnote={labels.trend.cohortNote}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/* An all-zero window is a real answer: the server sent every bucket. */}
        {totals.raised === 0 && (
          <p className="text-xs text-fg-muted text-pretty">{labels.trend.allZero}</p>
        )}

        <ChartContainer
          config={config}
          className="aspect-auto h-52 w-full [&_.recharts-cartesian-axis-tick_text]:fill-fg-muted [&_.recharts-cartesian-axis-tick_text]:font-mono [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
        >
          <LineChart
            accessibilityLayer
            data={points}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="4 4" />
            <XAxis
              dataKey="period"
              ticks={xTicks}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={0}
              interval={0}
              tickFormatter={(value: string) => tickFormat.format(new Date(value))}
            />
            <YAxis
              ticks={yTicks}
              domain={[0, axisMax(yTicks)]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={40}
              tickMargin={8}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelFormatter={(_value, payload) => {
                    const point = payload[0]?.payload as TrendPoint | undefined;
                    if (!point) return null;
                    return (
                      <span className="block">
                        <span className="block">{date(point.period)}</span>
                        <span className="mt-1 block max-w-56 font-normal text-pretty text-fg-muted">
                          {labels.trend.point(number(point.raised), number(point.resolved))}
                        </span>
                      </span>
                    );
                  }}
                />
              }
            />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                dataKey={series.key}
                type="monotone"
                stroke={`var(--color-${series.key})`}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ChartContainer>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {SERIES.map((series) => (
              <li key={series.key} className="flex items-center gap-2 text-xs text-fg-muted">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: series.color }}
                />
                {config[series.key].label}
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={tableOpen}
            aria-controls="trend-figures"
            onClick={() => {
              setTableOpen((open) => !open);
            }}
          >
            {tableOpen ? labels.trend.hideTable : labels.trend.showTable}
          </Button>
        </div>

        {/* The chart's text equivalent. */}
        {tableOpen && (
          <div id="trend-figures" className="min-w-0 overflow-x-auto">
            <Table>
              <caption className="caption-bottom pt-2 text-xs text-fg-faint">
                {labels.trend.tableCaption}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{labels.trend.columns.period}</TableHead>
                  <TableHead className="text-end">{labels.trend.columns.raised}</TableHead>
                  <TableHead className="text-end">{labels.trend.columns.resolved}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((point) => (
                  <TableRow key={point.period}>
                    <TableCell className="whitespace-nowrap">{date(point.period)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {number(point.raised)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {number(point.resolved)}
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
