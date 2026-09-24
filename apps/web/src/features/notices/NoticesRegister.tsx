/**
 * The Notices register — Figma node 67:1627, `ROUTES.notices`.
 *
 * Same composition as the Complaints and Inspections registers, deliberately:
 * URL state, one query, one grid, and everything reusable in
 * `@/components/data-table`. A third register that re-implements its own
 * paginator is how the estate this replaces ended up with 305 of them.
 *
 * ## What this screen does NOT render
 *
 * The 82px icon rail and the top account bar Figma draws around the frame, nor
 * the page gutter and the 1440 max-width. `AppShell`, mounted once in
 * `ProtectedLayout`, supplies all four.
 *
 * The frame's "Notice Register" tab strip is not built either. It has exactly
 * one tab. A tab strip of one is a heading with extra keyboard semantics, and
 * the grid's own caption band already carries that word.
 *
 * ## The "Issue notice" action, and what it can and cannot promise
 *
 * A notice is issued against a CONFIRMED case — `POST
 * /cases/{case_ref}/notices`, gated by `issue_notice` in that case's
 * `allowed_actions` — so it always begins on a complaint. The natural path is
 * therefore from the complaint itself, and Notice Create accepts `?case_ref=`
 * for exactly that.
 *
 * The button here exists anyway, because without it `/notices/new` is a route
 * no link in the portal reaches: Figma draws no rail entry for it, the
 * Complaint detail screen is not in this change's scope to edit, and a screen
 * reachable only by typing a URL cannot be tested by the people who have to use
 * it. It promises nothing it cannot keep — it opens a form whose first control
 * is a picker of CONFIRMED cases, and the submit stays disabled until that
 * case's own `allowed_actions` offers `issue_notice`. Move it to the complaint
 * the next time that screen is open, and delete it here.
 *
 * ## Why the row actions are View and Print and nothing else
 *
 * `allowed_actions` is computed by the server for the caller's roles in the
 * CASE's current status, and it is published on `CaseDetail` — not on
 * `NoticeRow`. A register row therefore cannot know what may be done to it, and
 * the alternative, inferring it from the status string, is the one thing this
 * codebase refuses to do.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toIstDateKey } from "@ada/shared/dates";
import { IcmsApiError } from "@/api/icms/http";
import { NOTICE_DEFAULT_SORT, type NoticeRow } from "@/api/icms/notices";
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
import { STATUS_META } from "@/components/icms/status";
import { Button } from "@/components/ui/button";
import { useFormats } from "@/i18n";
import { usePaginationLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { NOTICE_DEFAULT_HIDDEN, buildNoticeColumns } from "./columns";
import { NoticeToolbarFilters } from "./filters";
import {
  useNoticeStatusLabels,
  useNoticesGridLabels,
  useNoticesLabels,
} from "./noticeLabels";
import { downloadNoticePdf } from "./noticePdf";
import { NOTICE_STATUS_FACET_VALUES, NOTICE_STATUS_META } from "./noticeStatus";
import {
  NOTICE_FACET_KEYS,
  buildNoticeQuery,
  fetchNoticePage,
  useActOptions,
  useNoticeGate,
  useNoticeList,
  useNoticeZones,
} from "./useNotices";

/** `-notice_ref`, 25 a page, two columns folded away. Mirrors the API. */
const DEFAULT_STATE: RegisterState = {
  page: 1,
  size: 25,
  sort: NOTICE_DEFAULT_SORT,
  q: "",
  filters: {},
  hiddenColumns: NOTICE_DEFAULT_HIDDEN,
};

// The IST calendar day, not the UTC one: between 18:30 and 00:00 IST those are
// different dates, and both the filename and the overdue rule would be a day out.
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

export default function NoticesRegister() {
  const navigate = useNavigate();
  const labels = useNoticesLabels();
  const gridLabels = useNoticesGridLabels();
  const paginationLabels = usePaginationLabels();
  const statusLabels = useNoticeStatusLabels();
  const { locale, language, date } = useFormats();

  const gate = useNoticeGate();

  const { state, setState, searchValue, setSearchValue, clearFilters } = useRegisterState({
    defaults: DEFAULT_STATE,
    facetKeys: NOTICE_FACET_KEYS,
  });

  const query = useMemo(() => buildNoticeQuery(state), [state]);
  const { data, status, error, isFetching, refetch } = useNoticeList(query, gate.canRead);
  const zones = useNoticeZones(gate.canRead);
  const acts = useActOptions(gate.canRead, language);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  /** `act_cd` -> label, so the column shows the act rather than its code. */
  const actLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const option of acts.options) out[option.value] = option.label;
    return out;
  }, [acts.options]);

  const openNotice = useCallback(
    (row: NoticeRow) => {
      void navigate(ROUTES.notice(row.notice_ref));
    },
    [navigate],
  );
  const openCase = useCallback(
    (row: NoticeRow) => {
      void navigate(ROUTES.complaint(row.case_ref));
    },
    [navigate],
  );

  /* ---- print -----------------------------------------------------------
     A DOWNLOAD, not a new tab: the bytes arrive behind the bearer token, and a
     `window.open` after the `await` has lost its user gesture and is blocked.
     The outcome is announced beside the grid rather than thrown away. */
  const [printNote, setPrintNote] = useState<string | null>(null);

  /* Each download owns its own controller and nothing cancels it — unlike the
     CSV export below, which holds one in a ref because a superseded export MUST
     die. Two prints are two different notices, so the second must not kill the
     first, and a print whose officer has navigated away still saves the file
     they asked for. The controller exists only because the client takes a
     signal; keeping one in a ref here would also mean reading a ref from a
     callback that `buildNoticeColumns` receives during render, which the React
     compiler correctly refuses. */
  const handlePrint = useCallback(
    (row: NoticeRow) => {
      setPrintNote(null);
      const controller = new AbortController();

      void downloadNoticePdf(row.notice_ref, controller.signal).catch((cause: unknown) => {
        setPrintNote(
          cause instanceof IcmsApiError ? cause.message : labels.printUnavailable,
        );
      });
    },
    [labels.printUnavailable],
  );

  const columns = useMemo(
    () =>
      buildNoticeColumns({
        labels,
        statusLabels,
        actLabels,
        locale,
        today: today(),
        onView: openNotice,
        onOpenCase: openCase,
        onPrint: handlePrint,
      }),
    [labels, statusLabels, actLabels, locale, openNotice, openCase, handlePrint],
  );

  /* ---- facets ----------------------------------------------------------
     Three dropdowns. The other two filters are a date range and a link-borne
     chip, both in `toolbarExtra` — see filters.tsx.

     The ACT facet is where Figma draws "All Notice Type". There is no notice
     type vocabulary; `icms_notice` stores the act and the sections, and the act
     is the axis a legal register is actually narrowed on. */
  const facets = useMemo<FacetDef[]>(
    () => [
      {
        id: "status",
        label: labels.facetStatus,
        options: NOTICE_STATUS_FACET_VALUES.map((value) => ({
          value,
          label: statusLabels[value],
          icon: STATUS_META[NOTICE_STATUS_META[value].chip].icon,
        })),
      },
      {
        id: "act_cd",
        label: labels.facetAct,
        loading: acts.loading,
        options: acts.options.map((option) => ({
          value: option.value,
          label: option.label,
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
    [labels, language, statusLabels, acts.loading, acts.options, zones.data, zones.isPending],
  );

  const savedViews = useSavedViews("notices", state, setState);

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
      const result = await exportRegisterCsv<NoticeRow>({
        filename: labels.exportFilename(today()),
        columns: exportColumnsFor(columns, state.hiddenColumns),
        fetchPage: (page, size, signal) => fetchNoticePage(query, page, size, signal),
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
  const bulkActions = useMemo<BulkAction<NoticeRow>[]>(
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
          {labels.gate.checking}
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
          {labels.gate.deniedTitle}
        </h1>
        <p className="text-sm text-fg-canvas-muted text-pretty">{labels.gate.deniedBody}</p>
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
            onClick={() => {
              void navigate(ROUTES.noticeNew);
            }}
          >
            <Icon name="notice.issue" className="size-4" />
            {labels.issue}
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

      {/* A failed download says so out loud. The row action that started it is
          inside a menu that has already closed by the time the server answers. */}
      {printNote && (
        <p role="alert" className="text-xs text-status-danger-fg">
          {printNote}
        </p>
      )}

      {/* ---- the register ---------------------------------------------- */}
      <DataTable<NoticeRow>
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(row) => row.notice_ref}
        state={state}
        onStateChange={setState}
        // The third click on a sorted header comes back to here, so an officer
        // can undo a sort without reloading the page.
        defaultSort={NOTICE_DEFAULT_SORT}
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
          <NoticeToolbarFilters
            labels={labels}
            state={state}
            onStateChange={setState}
            formatDate={date}
          />
        }
        emptyState={
          // No action: a notice is issued from a confirmed complaint, so the
          // only honest thing to offer here is the sentence that says so.
          <EmptyState
            icon="notice.draft"
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
