/**
 * `reports.*`, typed, for this feature only.
 *
 * It lives in the feature folder rather than in `src/i18n/labels.ts` because
 * that module is the shared surface — the hooks more than one feature renders —
 * exactly as `features/notices/noticeLabels.ts` and
 * `features/inspections/priorityLabels.ts` already do.
 *
 * Nothing shared is re-derived here. The register exports reuse the registers'
 * own label hooks, so the CSV this screen writes carries the same headers as
 * the CSV the register writes; a second copy of any of them would drift.
 *
 * One hook per section rather than one for the screen: a section re-renders on
 * its own controls, and a single memo over every string would rebuild all of
 * them on every change in a filter.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BUCKETS, PERIOD_IDS, type Bucket, type PeriodId } from "./period";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The same bridge `i18n/labels.ts` uses: `t`, narrowed to a string return. */
function useT(): Translate {
  const { t } = useTranslation();
  return useMemo(
    () => (key: string, options?: Record<string, unknown>) =>
      t(key, options ?? {}) as unknown as string,
    [t],
  );
}

export type ReportShellLabels = {
  title: string;
  subtitle: string;
  scopeNote: string;
  gate: {
    loading: string;
    refusedTitle: string;
    refusedBody: string;
    noneTitle: string;
    noneBody: string;
    aggregatesDenied: string;
    exportsDenied: string;
  };
};

export function useReportShellLabels(): ReportShellLabels {
  const t = useT();
  return useMemo(
    () => ({
      title: t("reports.title"),
      subtitle: t("reports.subtitle"),
      scopeNote: t("reports.scopeNote"),
      gate: {
        loading: t("reports.gate.loading"),
        refusedTitle: t("reports.gate.refusedTitle"),
        refusedBody: t("reports.gate.refusedBody"),
        noneTitle: t("reports.gate.noneTitle"),
        noneBody: t("reports.gate.noneBody"),
        aggregatesDenied: t("reports.gate.aggregatesDenied"),
        exportsDenied: t("reports.gate.exportsDenied"),
      },
    }),
    [t],
  );
}

export type ThroughputLabels = {
  title: string;
  description: string;
  periodLabel: string;
  periods: Record<PeriodId, string>;
  bucketLabel: string;
  buckets: Record<Bucket, string>;
  windowNote: (start: string, end: string) => string;
  allTimeNote: string;
  partialNote: string;
  cohortTitle: string;
  cohortBody: string;
  columns: { period: string; raised: string; resolved: string; rate: string };
  totals: string;
  loading: string;
  emptyTitle: string;
  emptyBody: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  download: string;
  filename: (date: string) => string;
};

export function useThroughputLabels(): ThroughputLabels {
  const t = useT();
  return useMemo(() => {
    const periods = {} as Record<PeriodId, string>;
    for (const id of PERIOD_IDS) periods[id] = t(`reports.throughput.period.${id}`);
    const buckets = {} as Record<Bucket, string>;
    for (const id of BUCKETS) buckets[id] = t(`reports.throughput.bucket.${id}`);

    return {
      title: t("reports.throughput.title"),
      description: t("reports.throughput.description"),
      periodLabel: t("reports.throughput.periodLabel"),
      periods,
      bucketLabel: t("reports.throughput.bucketLabel"),
      buckets,
      windowNote: (start, end) => t("reports.throughput.windowNote", { start, end }),
      allTimeNote: t("reports.throughput.allTimeNote"),
      partialNote: t("reports.throughput.partialNote"),
      cohortTitle: t("reports.throughput.cohortTitle"),
      cohortBody: t("reports.throughput.cohortBody"),
      columns: {
        period: t("reports.throughput.columns.period"),
        raised: t("reports.throughput.columns.raised"),
        resolved: t("reports.throughput.columns.resolved"),
        rate: t("reports.throughput.columns.rate"),
      },
      totals: t("reports.throughput.totals"),
      loading: t("reports.throughput.loading"),
      emptyTitle: t("reports.throughput.emptyTitle"),
      emptyBody: t("reports.throughput.emptyBody"),
      errorTitle: t("reports.throughput.errorTitle"),
      errorBody: t("reports.throughput.errorBody"),
      retry: t("reports.throughput.retry"),
      download: t("reports.throughput.download"),
      filename: (date) => t("reports.throughput.filename", { date }),
    };
  }, [t]);
}

export type BreakdownGroupLabels = {
  title: string;
  description: string;
  column: string;
  emptyTitle: string;
  emptyBody: string;
  filename: (date: string) => string;
};

export type BreakdownLabels = {
  lifetimeNote: string;
  complementNote: string;
  truncated: string;
  columns: { total: string; open: string; resolved: string; share: string };
  totals: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  download: string;
  byType: BreakdownGroupLabels;
  byZone: BreakdownGroupLabels;
  /** `complaint_type_cd` is nullable, so the null group needs a name of its own. */
  untyped: string;
};

export function useBreakdownLabels(): BreakdownLabels {
  const t = useT();
  return useMemo(
    () => ({
      lifetimeNote: t("reports.breakdown.lifetimeNote"),
      complementNote: t("reports.breakdown.complementNote"),
      truncated: t("reports.breakdown.truncated"),
      columns: {
        total: t("reports.breakdown.columns.total"),
        open: t("reports.breakdown.columns.open"),
        resolved: t("reports.breakdown.columns.resolved"),
        share: t("reports.breakdown.columns.share"),
      },
      totals: t("reports.breakdown.totals"),
      loading: t("reports.breakdown.loading"),
      errorTitle: t("reports.breakdown.errorTitle"),
      errorBody: t("reports.breakdown.errorBody"),
      retry: t("reports.breakdown.retry"),
      download: t("reports.breakdown.download"),
      untyped: t("reports.byType.untyped"),
      byType: {
        title: t("reports.byType.title"),
        description: t("reports.byType.description"),
        column: t("reports.byType.column"),
        emptyTitle: t("reports.byType.emptyTitle"),
        emptyBody: t("reports.byType.emptyBody"),
        filename: (date) => t("reports.byType.filename", { date }),
      },
      byZone: {
        title: t("reports.byZone.title"),
        description: t("reports.byZone.description"),
        column: t("reports.byZone.column"),
        emptyTitle: t("reports.byZone.emptyTitle"),
        emptyBody: t("reports.byZone.emptyBody"),
        filename: (date) => t("reports.byZone.filename", { date }),
      },
    }),
    [t],
  );
}

export type RegisterExportLabels = {
  title: string;
  note: string;
  dateLabel: string;
  filename: (date: string) => string;
  denied: string;
};

export type ExportLabels = {
  title: string;
  description: string;
  allColumnsNote: string;
  rowsLoading: string;
  rows: (count: string) => string;
  rowsNone: string;
  rowsUnknown: string;
  export: string;
  exporting: string;
  progress: (done: string, total: string) => string;
  truncated: (count: string) => string;
  failed: string;
  clear: string;
  statusLabel: string;
  anyStatus: string;
  zoneLabel: string;
  anyZone: string;
  actLabel: string;
  anyAct: string;
  dateAny: string;
  dateRange: (from: string, to: string) => string;
  dateFrom: (from: string) => string;
  denied: string;
  cases: RegisterExportLabels;
  inspections: RegisterExportLabels;
  notices: RegisterExportLabels;
};

// The three registers differ only in these five strings, so they are read in
// one helper rather than in three near-identical blocks.
function registerLabels(t: Translate, register: string): RegisterExportLabels {
  return {
    title: t(`reports.exports.${register}.title`),
    note: t(`reports.exports.${register}.note`),
    dateLabel: t(`reports.exports.${register}.dateLabel`),
    filename: (date) => t(`reports.exports.${register}.filename`, { date }),
    denied: t(`reports.exports.${register}.denied`),
  };
}

export function useExportLabels(): ExportLabels {
  const t = useT();
  return useMemo(
    () => ({
      title: t("reports.exports.title"),
      description: t("reports.exports.description"),
      allColumnsNote: t("reports.exports.allColumnsNote"),
      rowsLoading: t("reports.exports.rowsLoading"),
      rows: (count) => t("reports.exports.rows", { count }),
      rowsNone: t("reports.exports.rowsNone"),
      rowsUnknown: t("reports.exports.rowsUnknown"),
      export: t("reports.exports.export"),
      exporting: t("reports.exports.exporting"),
      progress: (done, total) => t("reports.exports.progress", { done, total }),
      truncated: (count) => t("reports.exports.truncated", { count }),
      failed: t("reports.exports.failed"),
      clear: t("reports.exports.clear"),
      statusLabel: t("reports.exports.statusLabel"),
      anyStatus: t("reports.exports.anyStatus"),
      zoneLabel: t("reports.exports.zoneLabel"),
      anyZone: t("reports.exports.anyZone"),
      actLabel: t("reports.exports.actLabel"),
      anyAct: t("reports.exports.anyAct"),
      dateAny: t("reports.exports.dateAny"),
      dateRange: (from, to) => t("reports.exports.dateRange", { from, to }),
      dateFrom: (from) => t("reports.exports.dateFrom", { from }),
      denied: t("reports.exports.denied"),
      cases: registerLabels(t, "cases"),
      inspections: registerLabels(t, "inspections"),
      notices: registerLabels(t, "notices"),
    }),
    [t],
  );
}

export type AnalysisReportLabels = {
  title: string;
  description: string;
  note: string;
  projectLabel: string;
  runLabel: string;
  loading: string;
  noProjectsTitle: string;
  noProjectsBody: string;
  noRunsTitle: string;
  noRunsBody: string;
  runOption: (id: string, date: string) => string;
  runOptionUnfinished: (id: string, date: string, status: string) => string;
  status: (raw: string) => string;
  notFinished: (status: string) => string;
  detections: (count: string, illegal: string) => string;
  csv: string;
  geojson: string;
  downloading: string;
  failed: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
};

export function useAnalysisReportLabels(): AnalysisReportLabels {
  const t = useT();
  return useMemo(
    () => ({
      title: t("reports.analysis.title"),
      description: t("reports.analysis.description"),
      note: t("reports.analysis.note"),
      projectLabel: t("reports.analysis.projectLabel"),
      runLabel: t("reports.analysis.runLabel"),
      loading: t("reports.analysis.loading"),
      noProjectsTitle: t("reports.analysis.noProjectsTitle"),
      noProjectsBody: t("reports.analysis.noProjectsBody"),
      noRunsTitle: t("reports.analysis.noRunsTitle"),
      noRunsBody: t("reports.analysis.noRunsBody"),
      runOption: (id, date) => t("reports.analysis.runOption", { id, date }),
      runOptionUnfinished: (id, date, status) =>
        t("reports.analysis.runOptionUnfinished", { id, date, status }),
      status: (raw) => t(`reports.analysis.status.${raw}`),
      notFinished: (status) => t("reports.analysis.notFinished", { status }),
      detections: (count, illegal) => t("reports.analysis.detections", { count, illegal }),
      csv: t("reports.analysis.csv"),
      geojson: t("reports.analysis.geojson"),
      downloading: t("reports.analysis.downloading"),
      failed: t("reports.analysis.failed"),
      errorTitle: t("reports.analysis.errorTitle"),
      errorBody: t("reports.analysis.errorBody"),
      retry: t("reports.analysis.retry"),
    }),
    [t],
  );
}

/** The four reports that need an endpoint. Listed on screen, never approximated. */
export const GAP_IDS = ["ageing", "workload", "sla", "noticesByAct"] as const;

export type GapId = (typeof GAP_IDS)[number];

export type GapLabels = {
  title: string;
  description: string;
  needs: (endpoint: string) => string;
  items: Record<GapId, { title: string; note: string; endpoint: string }>;
};

export function useGapLabels(): GapLabels {
  const t = useT();
  return useMemo(() => {
    const items = {} as GapLabels["items"];
    for (const id of GAP_IDS) {
      items[id] = {
        title: t(`reports.gaps.items.${id}.title`),
        note: t(`reports.gaps.items.${id}.note`),
        endpoint: t(`reports.gaps.items.${id}.endpoint`),
      };
    }
    return {
      title: t("reports.gaps.title"),
      description: t("reports.gaps.description"),
      needs: (endpoint) => t("reports.gaps.needs", { endpoint }),
      items,
    };
  }, [t]);
}
