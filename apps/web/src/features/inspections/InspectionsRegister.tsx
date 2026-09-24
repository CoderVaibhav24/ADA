/**
 * The Inspections register — Figma node 31:2647.
 *
 * Same composition as the Complaints register, deliberately: URL state, one
 * query, one grid, and everything reusable in `@/components/data-table`. A
 * second register that re-implements its own paginator is how the estate this
 * replaces ended up with 305 of them.
 *
 * ## What this screen does NOT render
 *
 * The 82px icon rail and the top account bar Figma draws around the frame, nor
 * the page gutter and the 1440 max-width. `AppShell`, mounted once in
 * `ProtectedLayout`, supplies all four.
 *
 * ## Why there is no primary "New" action
 *
 * The Complaints register has one; this does not, and the difference is the
 * workflow rather than the layout. An inspection round is opened by
 * `OPEN_ROUND` against a case — `POST /cases/{case_ref}/inspections` — so it
 * begins on a complaint, taken by an officer the transition table allows. A
 * "New inspection" button here would have nothing to attach the round to.
 *
 * ## Why the row actions are View and nothing else
 *
 * `available_actions` is computed by the server for the caller's roles in the
 * row's current status, and contract §3 publishes it on `InspectionDetail`, not
 * on `InspectionRow`. A register row therefore cannot know what may be done to
 * it, and the alternative — inferring it from the status string — is the one
 * thing this codebase refuses to do. Every write lives on the detail screen,
 * where the server has already said what is allowed.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toIstDateKey } from "@ada/shared/dates";
import type { InspectionRow } from "@/api/icms/inspections";
import { INSPECTION_DEFAULT_SORT } from "@/api/icms/inspections";
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
  useInspectionGateLabels,
  useInspectionStatusLabels,
  useInspectionsGridLabels,
  useInspectionsLabels,
  usePaginationLabels,
} from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { INSPECTION_DEFAULT_HIDDEN, buildInspectionColumns } from "./columns";
import { InspectionToolbarFilters } from "./filters";
import {
  INSPECTION_STATUS_FACET_VALUES,
  INSPECTION_STATUS_META,
  PRIORITY_FACET_VALUES,
  ROUND_FACET_VALUES,
} from "./inspectionStatus";
import { useInspectionPriorityLabels } from "./priorityLabels";
import {
  INSPECTION_FACET_KEYS,
  buildInspectionQuery,
  fetchInspectionPage,
  useInspectionGate,
  useInspectionList,
  useInspectionZones,
} from "./useInspections";

/** `-inspection_ref`, 25 a page, four columns folded away. Mirrors the API. */
const DEFAULT_STATE: RegisterState = {
  page: 1,
  size: 25,
  sort: INSPECTION_DEFAULT_SORT,
  q: "",
  filters: {},
  hiddenColumns: INSPECTION_DEFAULT_HIDDEN,
};

// The IST calendar day, not the UTC one: between 18:30 and 00:00 IST those are
// different dates, and the file would be stamped yesterday.
function today(): string {
  return toIstDateKey(new Date());
}

// `icms_zone.name_hi` is nullable, so a zone nobody has translated yet falls
// back to English rather than to an empty option.
function pickLabel(
  language: string,
  english: string,
  hindi: string | null | undefined,
): string {
  return language === "hi-IN" && hindi ? hindi : english;
}

export default function InspectionsRegister() {
  const navigate = useNavigate();
  const labels = useInspectionsLabels();
  const gridLabels = useInspectionsGridLabels();
  const paginationLabels = usePaginationLabels();
  const statusLabels = useInspectionStatusLabels();
  const priorityLabels = useInspectionPriorityLabels();
  const gateLabels = useInspectionGateLabels();
  const { locale, language, number, date } = useFormats();

  const gate = useInspectionGate();

  const { state, setState, searchValue, setSearchValue, clearFilters } = useRegisterState({
    defaults: DEFAULT_STATE,
    facetKeys: INSPECTION_FACET_KEYS,
  });

  const query = useMemo(() => buildInspectionQuery(state), [state]);
  const { data, status, error, isFetching, refetch } = useInspectionList(query, gate.canRead);
  const zones = useInspectionZones(gate.canRead);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const openInspection = useCallback(
    (row: InspectionRow) => {
      void navigate(ROUTES.inspection(row.inspection_ref));
    },
    [navigate],
  );
  const openCase = useCallback(
    (row: InspectionRow) => {
      void navigate(ROUTES.complaint(row.case_ref));
    },
    [navigate],
  );

  const columns = useMemo(
    () =>
      buildInspectionColumns({
        labels,
        statusLabels,
        priorityLabels,
        locale,
        number,
        onView: openInspection,
        onOpenCase: openCase,
      }),
    [labels, statusLabels, priorityLabels, locale, number, openInspection, openCase],
  );

  /* ---- facets ----------------------------------------------------------
     Four dropdowns. The other four filters are a date range, a "mine" toggle
     and two link-borne chips, all in `toolbarExtra` — see filters.tsx.

     Priority is the CASE's, offered here because Figma 31:2647 draws it and
     because "every high-priority round still open" is the question this
     register exists to answer. Same values and same labels as the Complaints
     register, so the two cannot disagree. */
  const facets = useMemo<FacetDef[]>(
    () => [
      {
        id: "status",
        label: labels.facetStatus,
        options: INSPECTION_STATUS_FACET_VALUES.map((value) => ({
          value,
          label: statusLabels[value],
          icon: STATUS_META[INSPECTION_STATUS_META[value].chip].icon,
        })),
      },
      {
        id: "round_no",
        label: labels.facetRound,
        options: ROUND_FACET_VALUES.map((value) => ({
          // Text, because the URL is text and `buildInspectionQuery` parses it
          // back to an integer on the way to the API.
          value: String(value),
          label: labels.round(value),
        })),
      },
      {
        id: "priority",
        label: priorityLabels.facet,
        options: PRIORITY_FACET_VALUES.map((value) => ({
          value,
          label: priorityLabels.values[value],
          icon: PRIORITY_META[value].icon,
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
    [labels, language, statusLabels, priorityLabels, zones.data, zones.isPending],
  );

  const savedViews = useSavedViews("inspections", state, setState);

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
      const result = await exportRegisterCsv<InspectionRow>({
        filename: labels.exportFilename(today()),
        columns: exportColumnsFor(columns, state.hiddenColumns),
        fetchPage: (page, size, signal) => fetchInspectionPage(query, page, size, signal),
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
  const bulkActions = useMemo<BulkAction<InspectionRow>[]>(
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

  if (gate.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-fg-muted">
          <Icon name="feedback.loading" spin className="size-4" />
          {gateLabels.checking}
        </span>
      </div>
    );
  }

  // Not a redirect to the login screen: the officer IS signed in, they are
  // simply not allowed here, and a login form they already passed reads as a bug.
  if (!gate.canRead) {
    return (
      <section
        role="alert"
        className="mx-auto flex min-h-[40vh] max-w-prose flex-col items-center justify-center gap-3 px-4 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-faint">
          <Icon name="user.password" className="size-5" />
        </span>
        <h1 className="font-display text-xl font-bold text-balance text-fg-strong">
          {gateLabels.deniedTitle}
        </h1>
        <p className="text-sm text-fg-canvas-muted text-pretty">{gateLabels.deniedBody}</p>
      </section>
    );
  }

  return (
    // No gutter and no max-width here: AppShell's `main` supplies both, once,
    // for every screen.
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
      <DataTable<InspectionRow>
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(row) => row.inspection_ref}
        state={state}
        onStateChange={setState}
        // The third click on a sorted header comes back to here, so an officer
        // can undo a sort without reloading the page.
        defaultSort={INSPECTION_DEFAULT_SORT}
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
        toolbarExtra={
          <InspectionToolbarFilters
            labels={labels}
            state={state}
            onStateChange={setState}
            userId={gate.userId}
            formatDate={date}
          />
        }
        emptyState={
          // No action: a round is opened from a complaint, so the only honest
          // thing to offer here is the sentence that says so.
          <EmptyState
            icon="inspection.schedule"
            title={labels.emptyTitle}
            description={labels.emptyBody}
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
