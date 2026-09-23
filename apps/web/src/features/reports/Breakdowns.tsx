/**
 * The two lifetime breakdowns — `GET /dashboard/by-type` and `/by-zone`.
 *
 * Neither endpoint takes a period, so the period control above does not reach
 * them and the panel says so rather than letting the proximity imply it.
 *
 * Both answers carry an English label — `icms_code_value.label` and
 * `icms_zone.name` — so the Hindi build reads `label_hi` / `name_hi` off the
 * reference vocabularies the registers already cache, and falls back to the
 * server's English where a row has not been translated. That is a display join
 * on a cached list, not a second source of truth for the counts.
 *
 * The column is headed with the group's name and never with the word "zone
 * total": for a field surveyor these rows are their own cases inside a zone,
 * not the zone's, and the scope note on the screen states that once.
 */

import { useMemo } from "react";
import { toIstDateKey } from "@ada/shared/dates";
import { MAX_GROUPS } from "@/api/icms/dashboard";
import { saveCsv, toCsv, type ExportColumn } from "@/components/data-table/export-rows";
import { EmptyState, LoadingState } from "@/components/icms/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useComplaintTypes, useZones } from "@/features/complaints/useCases";
import { useFormats } from "@/i18n";
import { Icon, type IconKey } from "@/lib/icons";
import { ReportNote, ReportSection, SectionError, ShareBar } from "./parts";
import { share } from "./period";
import {
  useBreakdownLabels,
  type BreakdownGroupLabels,
  type BreakdownLabels,
} from "./reportLabels";
import { useTypeReport, useZoneReport } from "./useReports";

/** One shape for both breakdowns, so the panel is written once. */
type Group = {
  key: string;
  name: string;
  total: number;
  open: number;
  resolved: number;
};

// `label_hi` and `name_hi` are nullable, so a row nobody has translated falls
// back to English rather than to an empty cell.
function pickLabel(language: string, english: string, hindi: string | null | undefined): string {
  return language.startsWith("hi") && hindi ? hindi : english;
}

function BreakdownPanel({
  icon,
  labels,
  group,
  rows,
  isPending,
  error,
  onRetry,
}: {
  icon: IconKey;
  labels: BreakdownLabels;
  group: BreakdownGroupLabels;
  rows: readonly Group[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const formats = useFormats();
  const today = toIstDateKey(new Date());

  // The rows the server returned are the denominator. `/dashboard/summary`
  // would be a second request for a number this already adds up to: the two
  // endpoints count the same cases, and `by-type` keeps the null group.
  const totals = rows.reduce(
    (sum, row) => ({
      total: sum.total + row.total,
      open: sum.open + row.open,
      resolved: sum.resolved + row.resolved,
    }),
    { total: 0, open: 0, resolved: 0 },
  );

  const percentText = (value: number | null) =>
    value === null ? "—" : `${formats.number(Math.round(value))}%`;

  const columns: ExportColumn<Group>[] = [
    { id: "group", header: group.column, value: (row) => row.name },
    { id: "total", header: labels.columns.total, value: (row) => String(row.total) },
    { id: "open", header: labels.columns.open, value: (row) => String(row.open) },
    { id: "resolved", header: labels.columns.resolved, value: (row) => String(row.resolved) },
    {
      id: "share",
      header: labels.columns.share,
      value: (row) => {
        const value = share(row.total, totals.total);
        return value === null ? "" : String(Math.round(value));
      },
    },
  ];

  return (
    <ReportSection
      icon={icon}
      title={group.title}
      description={group.description}
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={rows.length === 0}
          onClick={() => {
            saveCsv(group.filename(today), toCsv(rows, columns));
          }}
        >
          <Icon name="action.download" className="size-4" />
          {labels.download}
        </Button>
      }
    >
      {error ? (
        <SectionError
          title={labels.errorTitle}
          body={labels.errorBody}
          cause={error}
          onRetry={onRetry}
          retryLabel={labels.retry}
        />
      ) : isPending ? (
        <LoadingState label={labels.loading} lines={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="data.donut"
          title={group.emptyTitle}
          description={group.emptyBody}
          size="compact"
        />
      ) : (
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{group.column}</TableHead>
                <TableHead scope="col" className="text-right">
                  {labels.columns.total}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {labels.columns.open}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {labels.columns.resolved}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {labels.columns.share}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="text-fg-base">{row.name}</TableCell>
                  <TableCell className="text-right tabular">
                    {formats.number(row.total)}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {formats.number(row.open)}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {formats.number(row.resolved)}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center justify-end gap-2">
                      <ShareBar percent={share(row.total, totals.total)} />
                      <span className="tabular">
                        {percentText(share(row.total, totals.total))}
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold text-fg-strong">{labels.totals}</TableCell>
                <TableCell className="text-right font-semibold tabular text-fg-strong">
                  {formats.number(totals.total)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular text-fg-strong">
                  {formats.number(totals.open)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular text-fg-strong">
                  {formats.number(totals.resolved)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <ReportNote>{labels.lifetimeNote}</ReportNote>
        <ReportNote>{labels.complementNote}</ReportNote>
        {rows.length >= MAX_GROUPS && <ReportNote>{labels.truncated}</ReportNote>}
      </div>
    </ReportSection>
  );
}

/** Both breakdowns, gated together: one permission answers for both endpoints. */
export default function Breakdowns({ enabled }: { enabled: boolean }) {
  const labels = useBreakdownLabels();
  const { language } = useFormats();

  const types = useTypeReport(enabled);
  const zones = useZoneReport(enabled);
  const typeVocabulary = useComplaintTypes();
  const zoneVocabulary = useZones();

  const typeRows = useMemo<Group[]>(() => {
    const hindi = new Map(
      (typeVocabulary.data ?? []).map((value) => [value.code, value.label_hi]),
    );
    return (types.data ?? []).map((row) => ({
      // The null group is a real group — a case filed before its type was
      // chosen — and it keeps a key of its own rather than being dropped.
      key: row.complaint_type_cd ?? "__untyped__",
      name:
        row.complaint_type_cd === null
          ? labels.untyped
          : pickLabel(
              language,
              row.label ?? row.complaint_type_cd,
              hindi.get(row.complaint_type_cd),
            ),
      total: row.total,
      open: row.open,
      resolved: row.resolved,
    }));
  }, [types.data, typeVocabulary.data, language, labels.untyped]);

  const zoneRows = useMemo<Group[]>(() => {
    const hindi = new Map(
      (zoneVocabulary.data ?? []).map((zone) => [zone.zone_cd, zone.name_hi]),
    );
    return (zones.data ?? []).map((row) => ({
      key: row.zone_cd,
      name: pickLabel(language, row.zone_name, hindi.get(row.zone_cd)),
      total: row.total,
      open: row.open,
      resolved: row.resolved,
    }));
  }, [zones.data, zoneVocabulary.data, language]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <BreakdownPanel
        icon="data.donut"
        labels={labels}
        group={labels.byType}
        rows={typeRows}
        isPending={enabled && types.isPending}
        error={types.error}
        onRetry={() => {
          void types.refetch();
        }}
      />
      <BreakdownPanel
        icon="data.chart"
        labels={labels}
        group={labels.byZone}
        rows={zoneRows}
        isPending={enabled && zones.isPending}
        error={zones.error}
        onRetry={() => {
          void zones.refetch();
        }}
      />
    </div>
  );
}
