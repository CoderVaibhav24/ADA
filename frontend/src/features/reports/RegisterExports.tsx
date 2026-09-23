/**
 * The three register exports — `/cases`, `/inspections`, `/notices`.
 *
 * Each block builds its register's OWN columns, with that register's own label
 * hooks, and projects them through the shared `exportColumnsFor`. The file an
 * officer gets from here is therefore the file they get from the register: same
 * headers, same order, same per-column projection. A second set of column
 * definitions for "the report version" is how the two would come to disagree.
 *
 * Two deliberate differences from the registers:
 *
 *   - **every column is written, including the ones the register hides by
 *     default.** `hidden` is `[]` here. On a register the officer's column
 *     choices are the point; on a report the complete record is.
 *   - **the filters are the report's, not the grid's.** One value per axis,
 *     held locally rather than in the URL: an export is an action taken now,
 *     and a dozen filter parameters in the address bar would bury the period
 *     and the bucket that the rest of the screen does share through it.
 *
 * `case.export` gates the complaints block. `policy.py` seeds no
 * `inspection.export` and no `notice.export`, so those two are gated on their
 * READ permission, which is what the server enforces for them. An authority
 * that wants an officer to read a register without being able to take it away
 * cannot express that today for two of the three.
 */

import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toIstDateKey } from "@ada/shared/dates";
import { CASE_DEFAULT_SORT, type CaseListQuery, type CaseRow } from "@/api/icms/cases";
import {
  INSPECTION_DEFAULT_SORT,
  type InspectionListQuery,
  type InspectionRow,
} from "@/api/icms/inspections";
import { NOTICE_DEFAULT_SORT, type NoticeListQuery, type NoticeRow } from "@/api/icms/notices";
import { exportColumnsFor } from "@/components/data-table/export-rows";
import { STATUS_FACET_VALUES } from "@/features/complaints/caseStatus";
import { buildComplaintColumns } from "@/features/complaints/columns";
import { fetchCasePage, useZones } from "@/features/complaints/useCases";
import { buildInspectionColumns } from "@/features/inspections/columns";
import { INSPECTION_STATUS_FACET_VALUES } from "@/features/inspections/inspectionStatus";
import { useInspectionPriorityLabels } from "@/features/inspections/priorityLabels";
import { fetchInspectionPage } from "@/features/inspections/useInspections";
import { buildNoticeColumns } from "@/features/notices/columns";
import { useNoticeStatusLabels, useNoticesLabels } from "@/features/notices/noticeLabels";
import { NOTICE_STATUS_FACET_VALUES } from "@/features/notices/noticeStatus";
import { fetchNoticePage, useActOptions } from "@/features/notices/useNotices";
import { useFormats } from "@/i18n";
import {
  useCaseStatusLabels,
  useComplaintsLabels,
  useInspectionStatusLabels,
  useInspectionsLabels,
  useParcelKindLabels,
  usePriorityLabels,
} from "@/i18n/labels";
import { ANY, toIsoDate, useCsvExport } from "./csvExport";
import { DateFilter, ExportRow, SelectFilter } from "./exportRow";
import { ReportNote, ReportSection } from "./parts";
import { useExportLabels } from "./reportLabels";
import {
  useCaseCount,
  useInspectionCount,
  useNoticeCount,
  type ReportsGate,
} from "./useReports";

// Row actions belong to a grid. The export drops the actions column, so these
// exist only to satisfy the builders' contracts.
const noAction = () => undefined;

// A filter set to "all" is the ABSENCE of that filter, never `?status=`.
function chosen(value: string): string[] | undefined {
  return value === ANY ? undefined : [value];
}

function isFiltered(values: readonly string[], range: DateRange | undefined): boolean {
  return values.some((value) => value !== ANY) || range?.from !== undefined;
}

/** The zone options every block offers — already narrowed server-side to this caller. */
function useZoneOptions() {
  const { language } = useFormats();
  const zones = useZones();
  return useMemo(
    () =>
      (zones.data ?? []).map((zone) => ({
        value: zone.zone_cd,
        label: language.startsWith("hi") && zone.name_hi ? zone.name_hi : zone.name,
      })),
    [zones.data, language],
  );
}

function CaseExport({ gate }: { gate: ReportsGate }) {
  const labels = useExportLabels();
  const formats = useFormats();
  const complaintLabels = useComplaintsLabels();
  const statusLabels = useCaseStatusLabels();
  const priorityLabels = usePriorityLabels();
  const parcelKindLabels = useParcelKindLabels();
  const zoneOptions = useZoneOptions();
  const exporter = useCsvExport<CaseRow>();

  const [status, setStatus] = useState<string>(ANY);
  const [zone, setZone] = useState<string>(ANY);
  const [range, setRange] = useState<DateRange | undefined>(undefined);

  const denied = gate.canReadCases && gate.canExportCases ? null : labels.cases.denied;

  const query = useMemo<CaseListQuery>(
    () => ({
      sort: CASE_DEFAULT_SORT,
      ...(chosen(status) ? { status: chosen(status) } : {}),
      ...(chosen(zone) ? { zone_cd: chosen(zone) } : {}),
      ...(range?.from ? { filed_from: toIsoDate(range.from) } : {}),
      ...(range?.to ? { filed_to: toIsoDate(range.to) } : {}),
    }),
    [status, zone, range],
  );

  const count = useCaseCount(query, denied === null);

  const columns = useMemo(
    () =>
      exportColumnsFor<CaseRow>(
        buildComplaintColumns({
          labels: complaintLabels,
          statusLabels,
          priorityLabels,
          parcelKindLabels,
          locale: formats.locale,
          onView: noAction,
          onAssign: noAction,
        }),
        [],
      ),
    [complaintLabels, statusLabels, priorityLabels, parcelKindLabels, formats.locale],
  );

  return (
    <ExportRow
      title={labels.cases.title}
      note={labels.cases.note}
      denied={denied}
      count={count}
      exporting={exporter.exporting}
      progress={exporter.note}
      isFiltered={isFiltered([status, zone], range)}
      onClear={() => {
        setStatus(ANY);
        setZone(ANY);
        setRange(undefined);
      }}
      onExport={() => {
        void exporter.run({
          filename: labels.cases.filename(toIstDateKey(new Date())),
          columns,
          fetchPage: (page, size, signal) => fetchCasePage(query, page, size, signal),
        });
      }}
      filters={
        <>
          <SelectFilter
            id="report-cases-status"
            label={labels.statusLabel}
            anyLabel={labels.anyStatus}
            value={status}
            onChange={setStatus}
            options={STATUS_FACET_VALUES.map((value) => ({
              value,
              label: statusLabels[value],
            }))}
          />
          <SelectFilter
            id="report-cases-zone"
            label={labels.zoneLabel}
            anyLabel={labels.anyZone}
            value={zone}
            onChange={setZone}
            options={zoneOptions}
          />
          <DateFilter
            id="report-cases-dates"
            label={labels.cases.dateLabel}
            value={range}
            onChange={setRange}
            labels={labels}
            formatDate={formats.date}
          />
        </>
      }
    />
  );
}

function InspectionExport({ gate }: { gate: ReportsGate }) {
  const labels = useExportLabels();
  const formats = useFormats();
  const inspectionLabels = useInspectionsLabels();
  const statusLabels = useInspectionStatusLabels();
  const priorityLabels = useInspectionPriorityLabels();
  const zoneOptions = useZoneOptions();
  const exporter = useCsvExport<InspectionRow>();

  const [status, setStatus] = useState<string>(ANY);
  const [zone, setZone] = useState<string>(ANY);
  const [range, setRange] = useState<DateRange | undefined>(undefined);

  const denied = gate.canReadInspections ? null : labels.inspections.denied;

  const query = useMemo<InspectionListQuery>(
    () => ({
      sort: INSPECTION_DEFAULT_SORT,
      ...(chosen(status) ? { status: chosen(status) } : {}),
      ...(chosen(zone) ? { zone_cd: chosen(zone) } : {}),
      ...(range?.from ? { submitted_from: toIsoDate(range.from) } : {}),
      ...(range?.to ? { submitted_to: toIsoDate(range.to) } : {}),
    }),
    [status, zone, range],
  );

  const count = useInspectionCount(query, denied === null);

  const columns = useMemo(
    () =>
      exportColumnsFor<InspectionRow>(
        buildInspectionColumns({
          labels: inspectionLabels,
          statusLabels,
          priorityLabels,
          locale: formats.locale,
          number: formats.number,
          onView: noAction,
          onOpenCase: noAction,
        }),
        [],
      ),
    [inspectionLabels, statusLabels, priorityLabels, formats.locale, formats.number],
  );

  return (
    <ExportRow
      title={labels.inspections.title}
      note={labels.inspections.note}
      denied={denied}
      count={count}
      exporting={exporter.exporting}
      progress={exporter.note}
      isFiltered={isFiltered([status, zone], range)}
      onClear={() => {
        setStatus(ANY);
        setZone(ANY);
        setRange(undefined);
      }}
      onExport={() => {
        void exporter.run({
          filename: labels.inspections.filename(toIstDateKey(new Date())),
          columns,
          fetchPage: (page, size, signal) => fetchInspectionPage(query, page, size, signal),
        });
      }}
      filters={
        <>
          <SelectFilter
            id="report-inspections-status"
            label={labels.statusLabel}
            anyLabel={labels.anyStatus}
            value={status}
            onChange={setStatus}
            options={INSPECTION_STATUS_FACET_VALUES.map((value) => ({
              value,
              label: statusLabels[value],
            }))}
          />
          <SelectFilter
            id="report-inspections-zone"
            label={labels.zoneLabel}
            anyLabel={labels.anyZone}
            value={zone}
            onChange={setZone}
            options={zoneOptions}
          />
          <DateFilter
            id="report-inspections-dates"
            label={labels.inspections.dateLabel}
            value={range}
            onChange={setRange}
            labels={labels}
            formatDate={formats.date}
          />
        </>
      }
    />
  );
}

function NoticeExport({ gate }: { gate: ReportsGate }) {
  const labels = useExportLabels();
  const formats = useFormats();
  const noticeLabels = useNoticesLabels();
  const statusLabels = useNoticeStatusLabels();
  const zoneOptions = useZoneOptions();
  const exporter = useCsvExport<NoticeRow>();

  const [status, setStatus] = useState<string>(ANY);
  const [act, setAct] = useState<string>(ANY);
  const [zone, setZone] = useState<string>(ANY);
  const [range, setRange] = useState<DateRange | undefined>(undefined);

  const denied = gate.canReadNotices ? null : labels.notices.denied;
  const acts = useActOptions(denied === null, formats.language);

  const query = useMemo<NoticeListQuery>(
    () => ({
      sort: NOTICE_DEFAULT_SORT,
      ...(chosen(status) ? { status: chosen(status) } : {}),
      ...(chosen(act) ? { act_cd: chosen(act) } : {}),
      ...(chosen(zone) ? { zone_cd: chosen(zone) } : {}),
      ...(range?.from ? { issued_from: toIsoDate(range.from) } : {}),
      ...(range?.to ? { issued_to: toIsoDate(range.to) } : {}),
    }),
    [status, act, zone, range],
  );

  const count = useNoticeCount(query, denied === null);

  /** `act_cd` -> label, so the exported column carries the act and not its code. */
  const actLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const option of acts.options) out[option.value] = option.label;
    return out;
  }, [acts.options]);

  const columns = useMemo(
    () =>
      exportColumnsFor<NoticeRow>(
        buildNoticeColumns({
          labels: noticeLabels,
          statusLabels,
          actLabels,
          locale: formats.locale,
          today: toIstDateKey(new Date()),
          onView: noAction,
          onOpenCase: noAction,
          onPrint: noAction,
        }),
        [],
      ),
    [noticeLabels, statusLabels, actLabels, formats.locale],
  );

  return (
    <ExportRow
      title={labels.notices.title}
      note={labels.notices.note}
      denied={denied}
      count={count}
      exporting={exporter.exporting}
      progress={exporter.note}
      isFiltered={isFiltered([status, act, zone], range)}
      onClear={() => {
        setStatus(ANY);
        setAct(ANY);
        setZone(ANY);
        setRange(undefined);
      }}
      onExport={() => {
        void exporter.run({
          filename: labels.notices.filename(toIstDateKey(new Date())),
          columns,
          fetchPage: (page, size, signal) => fetchNoticePage(query, page, size, signal),
        });
      }}
      filters={
        <>
          <SelectFilter
            id="report-notices-status"
            label={labels.statusLabel}
            anyLabel={labels.anyStatus}
            value={status}
            onChange={setStatus}
            options={NOTICE_STATUS_FACET_VALUES.map((value) => ({
              value,
              label: statusLabels[value],
            }))}
          />
          <SelectFilter
            id="report-notices-act"
            label={labels.actLabel}
            anyLabel={labels.anyAct}
            value={act}
            onChange={setAct}
            options={acts.options}
          />
          <SelectFilter
            id="report-notices-zone"
            label={labels.zoneLabel}
            anyLabel={labels.anyZone}
            value={zone}
            onChange={setZone}
            options={zoneOptions}
          />
          <DateFilter
            id="report-notices-dates"
            label={labels.notices.dateLabel}
            value={range}
            onChange={setRange}
            labels={labels}
            formatDate={formats.date}
          />
        </>
      }
    />
  );
}

/** All three blocks. Each gates itself, so one refusal does not hide the others. */
export default function RegisterExports({ gate }: { gate: ReportsGate }) {
  const labels = useExportLabels();
  return (
    <ReportSection icon="data.records" title={labels.title} description={labels.description}>
      <ReportNote>{labels.allColumnsNote}</ReportNote>
      <div className="flex flex-col gap-3">
        <CaseExport gate={gate} />
        <InspectionExport gate={gate} />
        <NoticeExport gate={gate} />
      </div>
    </ReportSection>
  );
}
