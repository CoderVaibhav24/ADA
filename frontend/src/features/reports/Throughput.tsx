/**
 * Case throughput — `GET /api/icms/dashboard/trend`.
 *
 * The window is the server's. `days` and `bucket` go out, bucketed points come
 * back, and they are rendered in the order they arrive: the buckets are IST
 * calendar days, weeks from Monday and months from the 1st, all computed in
 * `app/icms/dashboard.py`, and re-bucketing them here would produce a second,
 * quietly different series.
 *
 * The cohort caveat is on the panel rather than in a tooltip because this is a
 * report: a misread of `resolved` here becomes a number somebody quotes.
 */

import { useMemo, useState } from "react";
import { toIstDateKey } from "@ada/shared/dates";
import type { TrendPoint } from "@/api/icms/dashboard";
import { saveCsv, toCsv, type ExportColumn } from "@/components/data-table/export-rows";
import { EmptyState, LoadingState } from "@/components/icms/states";
import { Button } from "@/components/ui/button";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFormats } from "@/i18n";
import { Icon } from "@/lib/icons";
import { FieldLabel, ReportNote, ReportSection, SectionError } from "./parts";
import {
  BUCKETS,
  PERIOD_IDS,
  hasPartialBuckets,
  periodDays,
  resolutionRate,
  totalsOf,
  type Bucket,
  type PeriodId,
} from "./period";
import { useThroughputLabels } from "./reportLabels";
import { useTrendReport } from "./useReports";

// A stable empty array, so `points` keeps its identity while the request is in
// flight and the memo below is not rebuilt on every render.
const NO_POINTS: readonly TrendPoint[] = [];

export type ThroughputProps = {
  period: PeriodId;
  bucket: Bucket;
  onPeriodChange: (next: PeriodId) => void;
  onBucketChange: (next: Bucket) => void;
  enabled: boolean;
};

export default function Throughput({
  period,
  bucket,
  onPeriodChange,
  onBucketChange,
  enabled,
}: ThroughputProps) {
  const labels = useThroughputLabels();
  const formats = useFormats();

  // The IST calendar day, not the UTC one: between 18:30 and 00:00 IST those
  // are different dates, and the window would be computed against yesterday.
  const [today] = useState(() => toIstDateKey(new Date()));

  const query = useMemo(
    () => ({ days: periodDays(period, today), bucket }),
    [period, bucket, today],
  );
  const { data, isPending, error, refetch } = useTrendReport(query, enabled);

  const points = data?.points ?? NO_POINTS;
  const totals = useMemo(() => totalsOf(points), [points]);

  // Rounded to whole percent so the column reads as a column; the CSV carries
  // the same figure the officer is looking at, not a longer one.
  const percentText = (rate: number | null) =>
    rate === null ? "—" : `${formats.number(Math.round(rate))}%`;

  const columns: ExportColumn<TrendPoint>[] = [
    { id: "period", header: labels.columns.period, value: (row) => row.period },
    { id: "raised", header: labels.columns.raised, value: (row) => String(row.raised) },
    { id: "resolved", header: labels.columns.resolved, value: (row) => String(row.resolved) },
    {
      id: "rate",
      header: labels.columns.rate,
      value: (row) => {
        const rate = resolutionRate(row.raised, row.resolved);
        return rate === null ? "" : String(Math.round(rate));
      },
    },
  ];

  const download = () => {
    saveCsv(labels.filename(today), toCsv(points, columns));
  };

  return (
    <ReportSection
      icon="data.trend"
      title={labels.title}
      description={labels.description}
      actions={
        <>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="report-period">{labels.periodLabel}</FieldLabel>
            <Select
              value={period}
              onValueChange={(next) => {
                onPeriodChange(next as PeriodId);
              }}
            >
              <SelectTrigger id="report-period" size="sm" className="w-[11.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {labels.periods[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="report-bucket">{labels.bucketLabel}</FieldLabel>
            <Select
              value={bucket}
              onValueChange={(next) => {
                onBucketChange(next as Bucket);
              }}
            >
              <SelectTrigger id="report-bucket" size="sm" className="w-[11.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUCKETS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {labels.buckets[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="secondary"
            size="sm"
            className="self-end"
            disabled={points.length === 0}
            onClick={download}
          >
            <Icon name="action.download" className="size-4" />
            {labels.download}
          </Button>
        </>
      }
    >
      <ReportNote tone="warning" title={labels.cohortTitle}>
        {labels.cohortBody}
      </ReportNote>

      {error ? (
        <SectionError
          title={labels.errorTitle}
          body={labels.errorBody}
          cause={error}
          onRetry={() => {
            void refetch();
          }}
          retryLabel={labels.retry}
        />
      ) : isPending ? (
        <LoadingState label={labels.loading} lines={4} />
      ) : totals.raised === 0 ? (
        <EmptyState
          icon="data.trend"
          title={labels.emptyTitle}
          description={labels.emptyBody}
          size="compact"
        />
      ) : (
        <>
          {/* Horizontal scroll rather than a reflow: a report table keeps its
              columns so two periods can be compared across a row. */}
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{labels.columns.period}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {labels.columns.raised}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {labels.columns.resolved}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {labels.columns.rate}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((point) => (
                  <TableRow key={point.period}>
                    <TableCell className="whitespace-nowrap text-fg-base">
                      {formats.date(point.period)}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formats.number(point.raised)}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formats.number(point.resolved)}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {percentText(resolutionRate(point.raised, point.resolved))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold text-fg-strong">
                    {labels.totals}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular text-fg-strong">
                    {formats.number(totals.raised)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular text-fg-strong">
                    {formats.number(totals.resolved)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular text-fg-strong">
                    {percentText(resolutionRate(totals.raised, totals.resolved))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {data && (
            <p className="text-2xs text-fg-faint">
              {labels.windowNote(formats.date(data.start), formats.date(data.end))}
            </p>
          )}
        </>
      )}

      <div className="flex flex-col gap-2">
        {hasPartialBuckets(bucket) && <ReportNote>{labels.partialNote}</ReportNote>}
        <ReportNote>{labels.allTimeNote}</ReportNote>
      </div>
    </ReportSection>
  );
}
