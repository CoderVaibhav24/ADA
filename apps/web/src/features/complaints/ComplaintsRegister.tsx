/**
 * The Complaints register — Figma node 29:1219.
 *
 * The screen composes and owns almost nothing: URL state, one query, one grid.
 * Everything reusable is in `@/components/data-table`, because Inspections and
 * Notices are the same screen with different columns and must not re-implement
 * any of it.
 *
 * ## What this screen does NOT render
 *
 * The 82px icon rail and the top account bar that Figma draws around this
 * frame, nor the page gutter and the 1440 max-width. `AppShell` supplies all
 * four, mounted once in `ProtectedLayout`, so this renders the frame's content
 * region and nothing else.
 *
 * ## Where the Export button is
 *
 * In the page header, where Figma puts it — not in the grid's toolbar. The
 * grid supports an `exporter` in its toolbar for registers designed that way;
 * this one is designed with it up top, so the header button drives the same
 * filter- and sort-respecting export.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toIstDateKey } from "@ada/shared/dates";
import type { CaseRow } from "@/api/icms/cases";
import { CASE_DEFAULT_SORT } from "@/api/icms/cases";
import { IcmsApiError } from "@/api/icms/http";
import { DataTable } from "@/components/data-table/DataTable";
import {
  exportColumnsFor,
  exportRegisterCsv,
  saveCsv,
  toCsv,
} from "@/components/data-table/export-rows";
import { useRegisterState } from "@/components/data-table/register-state";
import { useSavedViews } from "@/components/data-table/saved-views";
import type { BulkAction, FacetDef, RegisterState } from "@/components/data-table/types";
import { EmptyState, ErrorState, NoResultsState } from "@/components/icms/states";
import { PRIORITY_META, STATUS_META } from "@/components/icms/status";
import { Button } from "@/components/ui/button";
import { useFormats } from "@/i18n";
import {
  useCaseStatusLabels,
  useComplaintsGridLabels,
  useComplaintsLabels,
  usePaginationLabels,
  useParcelKindLabels,
  usePriorityLabels,
} from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { CASE_STATUS_META, PRIORITY_FACET_VALUES, STATUS_FACET_VALUES } from "./caseStatus";
import { COMPLAINT_DEFAULT_HIDDEN, buildComplaintColumns } from "./columns";
import {
  COMPLAINT_FACET_KEYS,
  buildCaseQuery,
  fetchCasePage,
  useCaseList,
  useComplaintTypes,
  useZones,
} from "./useCases";

/** `-raised_at`, 25 a page, four columns folded away. Mirrors the API's defaults. */
const DEFAULT_STATE: RegisterState = {
  page: 1,
  size: 25,
  sort: CASE_DEFAULT_SORT,
  q: "",
  filters: {},
  hiddenColumns: COMPLAINT_DEFAULT_HIDDEN,
};

// The IST calendar day, not the UTC one: between 18:30 and 00:00 IST those are
// different dates, and the file would be stamped yesterday.
function today(): string {
  return toIstDateKey(new Date());
}

// `icms_code_value.label_hi` and `icms_zone.name_hi` are nullable, so a row that
// has not been translated yet falls back to English rather than to an empty option.
function pickLabel(
  language: string,
  english: string,
  hindi: string | null | undefined,
): string {
  return language === "hi-IN" && hindi ? hindi : english;
}

export default function ComplaintsRegister() {
  const navigate = useNavigate();
  const labels = useComplaintsLabels();
  const gridLabels = useComplaintsGridLabels();
  const paginationLabels = usePaginationLabels();
  const statusLabels = useCaseStatusLabels();
  const priorityLabels = usePriorityLabels();
  const parcelKindLabels = useParcelKindLabels();
  const { locale, language } = useFormats();

  const { state, setState, searchValue, setSearchValue, clearFilters } = useRegisterState({
    defaults: DEFAULT_STATE,
    facetKeys: COMPLAINT_FACET_KEYS,
  });

  const query = useMemo(() => buildCaseQuery(state), [state]);
  const { data, status, error, isFetching, refetch } = useCaseList(query);
  const complaintTypes = useComplaintTypes();
  const zones = useZones();

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  /* ---- navigation seams ------------------------------------------------
     Both row actions land on the case detail. `?action=assign` is the seam the
     Assign Inspection modal (Figma 46:4561) hangs off when that screen is
     built — the modal belongs to the detail screen, not to the register. */
  const openCase = useCallback(
    (row: CaseRow) => {
      void navigate(ROUTES.complaint(row.case_ref));
    },
    [navigate],
  );
  const assignCase = useCallback(
    (row: CaseRow) => {
      void navigate(`${ROUTES.complaint(row.case_ref)}?action=assign`);
    },
    [navigate],
  );

  const columns = useMemo(
    () =>
      buildComplaintColumns({
        labels,
        statusLabels,
        priorityLabels,
        parcelKindLabels,
        locale,
        onView: openCase,
        onAssign: assignCase,
      }),
    [labels, statusLabels, priorityLabels, parcelKindLabels, locale, openCase, assignCase],
  );

  /* ---- facets ----------------------------------------------------------
     Figma draws three. A fourth, Zone, is added because the register is
     zone-scoped server-side and an officer who holds several zones otherwise
     has no way to look at one of them on its own. */
  const facets = useMemo<FacetDef[]>(
    () => [
      {
        id: "complaint_type_cd",
        label: labels.facetComplaintType,
        loading: complaintTypes.isPending,
        options: (complaintTypes.data ?? []).map((value) => ({
          value: value.code,
          // `label_hi` rides along on the same response, so the Hindi build needs
          // no second request — only a different field.
          label: pickLabel(language, value.label, value.label_hi),
        })),
      },
      {
        id: "priority",
        label: labels.facetPriority,
        options: PRIORITY_FACET_VALUES.map((value) => ({
          value,
          label: priorityLabels[value],
          icon: PRIORITY_META[value].icon,
        })),
      },
      {
        id: "status",
        label: labels.facetStatus,
        options: STATUS_FACET_VALUES.map((value) => ({
          value,
          label: statusLabels[value],
          icon: STATUS_META[CASE_STATUS_META[value].chip].icon,
        })),
      },
      {
        id: "zone_cd",
        label: labels.facetZone,
        loading: zones.isPending,
        options: (zones.data ?? []).map((zone) => ({
          value: zone.zone_cd,
          label: pickLabel(language, zone.name, zone.name_hi),
        })),
      },
    ],
    [
      labels,
      language,
      priorityLabels,
      statusLabels,
      complaintTypes.data,
      complaintTypes.isPending,
      zones.data,
      zones.isPending,
    ],
  );

  const savedViews = useSavedViews("complaints", state, setState);

  /* ---- export ----------------------------------------------------------
     Pages the SERVER with the query currently on screen, and writes the
     currently visible columns in their visible order. */
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const exportAbort = useRef<AbortController | null>(null);

  const handleExport = useCallback(async () => {
    exportAbort.current?.abort();
    const controller = new AbortController();
    exportAbort.current = controller;

    setExporting(true);
    setExportNote(null);
    try {
      const result = await exportRegisterCsv<CaseRow>({
        filename: labels.exportFilename(today()),
        columns: exportColumnsFor(columns, state.hiddenColumns),
        fetchPage: (page, size, signal) => fetchCasePage(query, page, size, signal),
        onProgress: (done, count) => {
          setExportNote(labels.exportProgress(done, count));
        },
        signal: controller.signal,
      });
      setExportNote(result.truncated ? labels.exportTruncated(result.rows) : null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setExportNote(cause instanceof IcmsApiError ? cause.message : labels.exportFailed);
    } finally {
      setExporting(false);
    }
  }, [columns, labels, query, state.hiddenColumns]);

  /** The selection's own export: the rows are already here, so no round trip. */
  const bulkActions = useMemo<BulkAction<CaseRow>[]>(
    () => [
      {
        id: "export-selected",
        label: labels.exportSelected,
        icon: "action.export",
        onSelect: (selected) => {
          saveCsv(
            labels.exportFilename(today()),
            toCsv(selected, exportColumnsFor(columns, state.hiddenColumns)),
          );
        },
      },
    ],
    [columns, labels, state.hiddenColumns],
  );

  return (
    // No gutter and no max-width here any more: AppShell's `main` supplies
    // both, once, for every screen. Keeping a second copy double-padded the
    // register and made this the only screen whose margins were its own.
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* ---- title + primary actions ----------------------------------- */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
            {labels.title}
          </h1>
          <p className="mt-1 text-sm text-fg-canvas-muted">{labels.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* The export's progress and its outcome sit next to the control that
              started it, and are announced. A silent five-second freeze on a
              4,000-row register reads as a crash. */}
          {exportNote && (
            <p role="status" className="max-w-[18rem] text-2xs text-fg-muted tabular">
              {exportNote}
            </p>
          )}
          <Button
            variant="secondary"
            disabled={exporting}
            onClick={() => {
              void handleExport();
            }}
          >
            <Icon name={exporting ? "feedback.loading" : "action.export"} spin={exporting} />
            {exporting ? gridLabels.exporting : labels.export}
          </Button>
          <Button
            onClick={() => {
              void navigate(ROUTES.complaintNew);
            }}
          >
            <Icon name="action.add" />
            {labels.newComplaint}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-accent-soft-border bg-accent-soft text-fg-link"
            onClick={() => {
              void navigate(-1);
            }}
          >
            <Icon name="action.back" className="size-4" />
            {labels.back}
          </Button>
        </div>
      </header>

      {/* ---- the register ---------------------------------------------- */}
      <DataTable<CaseRow>
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(row) => row.case_ref}
        state={state}
        onStateChange={setState}
        // The third click on a sorted header comes back to here, so an officer
        // can undo a sort without reloading the page.
        defaultSort={CASE_DEFAULT_SORT}
        status={status}
        isFetching={isFetching}
        error={error}
        onRetry={() => {
          void refetch();
        }}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        facets={facets}
        enableSelection
        bulkActions={bulkActions}
        savedViews={savedViews}
        caption={labels.registerTitle}
        captionAction={labels.recordCount(rows.length, total)}
        labels={gridLabels}
        paginationLabels={paginationLabels}
        emptyState={
          <EmptyState
            icon="case.file"
            title={labels.emptyTitle}
            description={labels.emptyBody}
            action={
              <Button
                size="sm"
                onClick={() => {
                  void navigate(ROUTES.complaintNew);
                }}
              >
                <Icon name="action.add" className="size-4" />
                {labels.emptyAction}
              </Button>
            }
          />
        }
        noResultsState={
          <NoResultsState
            title={labels.noResultsTitle}
            description={labels.noResultsBody}
            action={
              <Button size="sm" variant="outline" onClick={clearFilters}>
                <Icon name="action.clear" className="size-4" />
                {labels.noResultsAction}
              </Button>
            }
          />
        }
        errorState={(cause, retry) => {
          const apiError = cause instanceof IcmsApiError ? cause : null;
          return (
            <ErrorState
              title={labels.errorTitle}
              description={apiError?.message ?? labels.errorBody}
              // The request id is what ties this failure to the server's own log
              // line. Printed, monospaced, so it can be read down a phone.
              detail={apiError?.requestId ?? undefined}
              onRetry={retry}
              retryLabel={labels.errorRetry}
              size="compact"
            />
          );
        }}
      />
    </div>
  );
}
