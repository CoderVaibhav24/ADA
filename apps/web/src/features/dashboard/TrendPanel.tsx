import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { IST_TIME_ZONE } from "@ada/shared/dates";
import type { DashboardTrend, TrendPoint } from "@/api/icms/dashboard";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  PERIODS,
  axisMax,
  labelledIndexes,
  niceTicks,
  trendTotals,
  type PeriodId,
} from "./trendModel";

/**
 * `GET /dashboard/trend` — cases raised per IST bucket, and the cohort of those
 * that have since closed.
 *
 * ## The second series is the thing this panel exists to get right
 *
 * `resolved` is not "cases closed on that date". It is: of the cases RAISED in
 * this bucket, how many have since reached `closed` or `rejected`. Four
 * surfaces say so, because a chart is read faster than it is read carefully:
 *
 *   1. the legend names it "Of those, since closed or rejected";
 *   2. the sentence above the plot totals the window in words;
 *   3. the note under the plot states the cohort rule outright;
 *   4. the tooltip spells the whole sentence per bucket, above the two figures.
 *
 * The bare word "resolved" reaches no user-facing string in either language.
 *
 * ## The period control is here, not in a page-level filter row
 *
 * Figma puts three dropdowns in a toolbar above the tiles (`134:2338`). Only
 * this endpoint takes a parameter — summary, by-type and by-zone take none — so
 * a page-level filter row would imply it filtered panels it cannot reach. It
 * sits on the panel it actually governs.
 *
 * ## Nothing is re-bucketed
 *
 * The server returns every bucket in the window, empty ones as zeroes, already
 * floored to IST days / Mondays / month starts. The series is plotted exactly
 * as it arrived; `labelledIndexes` only chooses which of those buckets carry an
 * x-axis label, and the y-axis top tick is the domain top, so no mark and no
 * label falls outside the plot.
 */

/* A stable identity for "no points yet". `trend?.points ?? []` would mint a
   fresh array on every render and defeat every useMemo below it. */
const NO_POINTS: readonly TrendPoint[] = [];

export type TrendPanelProps = {
  trend: DashboardTrend | undefined;
  pending: boolean;
  error: Error | null;
  period: PeriodId;
  onPeriodChange: (next: PeriodId) => void;
  labels: DashboardLabels;
  onRetry: () => void;
  className?: string;
};

export function TrendPanel({
  trend,
  pending,
  error,
  period,
  onPeriodChange,
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
    raised: { label: labels.trend.series.raised, color: "var(--color-chart-1)" },
    resolved: { label: labels.trend.series.resolved, color: "var(--color-chart-3)" },
  } satisfies ChartConfig;

  const periodSelect = (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor="trend-period">{labels.trend.periodLabel}</Label>
      <Select
        value={period}
        onValueChange={(next) => {
          onPeriodChange(next as PeriodId);
        }}
      >
        <SelectTrigger id="trend-period" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIODS.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {labels.trend.period(option.id)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Panel
      id="dashboard-trend"
      className={className}
      title={labels.trend.title}
      action={periodSelect}
      pending={pending}
      error={error}
      empty={trend !== undefined && points.length === 0}
      emptyText={labels.trend.empty}
      footnote={labels.trend.bucketNote(bucket)}
      labels={labels.panel}
      onRetry={onRetry}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-fg-muted text-pretty">
          {trend ? `${labels.trend.window(date(trend.start), date(trend.end))} ` : ""}
          {labels.trend.totals(number(totals.raised), number(totals.resolved))}
        </p>

        {/* An all-zero window is a real answer, not a missing one — and the
            server sent every bucket, so nothing here is a gap. */}
        {totals.raised === 0 && (
          <p className="rounded-md border border-line-subtle bg-surface-2 px-3 py-2 text-sm text-fg-muted text-pretty">
            {labels.trend.allZero}
          </p>
        )}

        <p className="text-2xs text-fg-faint">{labels.trend.axis}</p>
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <LineChart
            accessibilityLayer
            data={points}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} />
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
              width={48}
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
            <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
            <Line
              dataKey="raised"
              type="monotone"
              stroke="var(--color-raised)"
              strokeWidth={2}
              dot={points.length <= 14}
            />
            <Line
              dataKey="resolved"
              type="monotone"
              stroke="var(--color-resolved)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={points.length <= 14}
            />
          </LineChart>
        </ChartContainer>

        <p className="max-w-prose text-xs text-fg-muted text-pretty">
          {labels.trend.cohortNote}
        </p>

        <div>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={tableOpen}
            aria-controls="trend-figures"
            onClick={() => {
              setTableOpen((open) => !open);
            }}
          >
            {tableOpen ? labels.trend.hideTable : labels.trend.showTable}
          </Button>
        </div>

        {/* The chart's text equivalent: for anyone who cannot read the plot, and
            for anyone who wants the figure rather than the shape. */}
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
