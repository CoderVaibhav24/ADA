// `dashboard.*`, typed, for the dashboard screen only.
// `trend.series.resolved` is a cohort (of the cases raised, how many since closed or rejected),
// never "closed on that date"; the legend, footnote and tooltip all say so.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The same bridge `i18n/labels.ts` uses, without the number formatter. */
function useTranslate(): Translate {
  const { t } = useTranslation();
  return useMemo(
    () => (key: string, options?: Record<string, unknown>) =>
      t(key, options ?? {}) as unknown as string,
    [t],
  );
}

export type DashboardLabels = {
  title: string;
  heading: string;
  scopeNote: string;
  subtitle: (time: string) => string;
  runChangeDetection: string;
  refresh: string;
  refreshing: string;

  gate: { checking: string; deniedTitle: string; deniedBody: string };

  panel: {
    loading: string;
    errorTitle: string;
    retry: string;
    /** The correlation id, or a plain statement that the server sent none. */
    requestId: (id: string | null) => string;
  };

  toolbar: { label: string };

  tiles: {
    total: string;
    newDetections: string;
    activeComplaints: string;
    inspectionsScheduled: string;
    noticesIssued: string;
    casesClosed: string;
    unavailable: string;
    noPermission: string;
    last30Days: string;
    raisedInPeriod: (n: string, period: string) => string;
    highPriority: (n: string) => string;
    awaitingSubmission: string;
    allNotices: string;
    rejected: (n: string) => string;
  };

  trend: {
    title: string;
    periodLabel: string;
    period: (id: string) => string;
    periodShort: (id: string) => string;
    series: { raised: string; resolved: string };
    cohortNote: string;
    allZero: string;
    empty: string;
    /** The whole cohort sentence for one bucket. Rides in the tooltip heading. */
    point: (raised: string, resolved: string) => string;
    showTable: string;
    hideTable: string;
    tableCaption: string;
    columns: { period: string; raised: string; resolved: string };
  };

  byType: {
    title: string;
    cap: (limit: string) => string;
    untyped: string;
    empty: string;
    count: (count: string) => string;
    share: (share: string) => string;
  };

  byZone: {
    title: string;
    badge: string;
    cap: (limit: string) => string;
    empty: string;
    scrollHint: string;
    columns: { zone: string; total: string; open: string; resolved: string };
  };

  feed: {
    title: string;
    noPermission: string;
    empty: string;
    noAddress: string;
    today: string;
    daysAgo: (n: string) => string;
    viewAll: string;
  };
};

export function useDashboardLabels(): DashboardLabels {
  const t = useTranslate();
  return useMemo(
    () => ({
      title: t("dashboard.title"),
      heading: t("dashboard.heading"),
      scopeNote: t("dashboard.scopeNote"),
      subtitle: (time: string) => t("dashboard.subtitle", { time }),
      runChangeDetection: t("dashboard.runChangeDetection"),
      refresh: t("dashboard.refresh"),
      refreshing: t("dashboard.refreshing"),

      gate: {
        checking: t("dashboard.gate.checking"),
        deniedTitle: t("dashboard.gate.deniedTitle"),
        deniedBody: t("dashboard.gate.deniedBody"),
      },

      panel: {
        loading: t("dashboard.panel.loading"),
        errorTitle: t("dashboard.panel.errorTitle"),
        retry: t("dashboard.panel.retry"),
        // A missing id is its own sentence, not "Request ID" followed by nothing.
        requestId: (id: string | null) =>
          id === null || id === ""
            ? t("dashboard.panel.noRequestId")
            : t("dashboard.panel.requestId", { id }),
      },

      toolbar: { label: t("dashboard.toolbar.label") },

      tiles: {
        total: t("dashboard.tiles.total"),
        newDetections: t("dashboard.tiles.newDetections"),
        activeComplaints: t("dashboard.tiles.activeComplaints"),
        inspectionsScheduled: t("dashboard.tiles.inspectionsScheduled"),
        noticesIssued: t("dashboard.tiles.noticesIssued"),
        casesClosed: t("dashboard.tiles.casesClosed"),
        unavailable: t("dashboard.tiles.unavailable"),
        noPermission: t("dashboard.tiles.noPermission"),
        last30Days: t("dashboard.tiles.last30Days"),
        raisedInPeriod: (n: string, period: string) =>
          t("dashboard.tiles.raisedInPeriod", { n, period }),
        highPriority: (n: string) => t("dashboard.tiles.highPriority", { n }),
        awaitingSubmission: t("dashboard.tiles.awaitingSubmission"),
        allNotices: t("dashboard.tiles.allNotices"),
        rejected: (n: string) => t("dashboard.tiles.rejected", { n }),
      },

      trend: {
        title: t("dashboard.trend.title"),
        periodLabel: t("dashboard.trend.periodLabel"),
        period: (id: string) => t(`dashboard.trend.period.${id}`),
        periodShort: (id: string) => t(`dashboard.trend.periodShort.${id}`),
        series: {
          raised: t("dashboard.trend.series.raised"),
          resolved: t("dashboard.trend.series.resolved"),
        },
        cohortNote: t("dashboard.trend.cohortNote"),
        allZero: t("dashboard.trend.allZero"),
        empty: t("dashboard.trend.empty"),
        point: (raised: string, resolved: string) =>
          t("dashboard.trend.point", { raised, resolved }),
        showTable: t("dashboard.trend.showTable"),
        hideTable: t("dashboard.trend.hideTable"),
        tableCaption: t("dashboard.trend.tableCaption"),
        columns: {
          period: t("dashboard.trend.columns.period"),
          raised: t("dashboard.trend.columns.raised"),
          resolved: t("dashboard.trend.columns.resolved"),
        },
      },

      byType: {
        title: t("dashboard.byType.title"),
        cap: (limit: string) => t("dashboard.byType.cap", { limit }),
        untyped: t("dashboard.byType.untyped"),
        empty: t("dashboard.byType.empty"),
        count: (count: string) => t("dashboard.byType.count", { count }),
        share: (share: string) => t("dashboard.byType.share", { share }),
      },

      byZone: {
        title: t("dashboard.byZone.title"),
        badge: t("dashboard.byZone.badge"),
        cap: (limit: string) => t("dashboard.byZone.cap", { limit }),
        empty: t("dashboard.byZone.empty"),
        scrollHint: t("dashboard.byZone.scrollHint"),
        columns: {
          zone: t("dashboard.byZone.columns.zone"),
          total: t("dashboard.byZone.columns.total"),
          open: t("dashboard.byZone.columns.open"),
          resolved: t("dashboard.byZone.columns.resolved"),
        },
      },

      feed: {
        title: t("dashboard.feed.title"),
        noPermission: t("dashboard.feed.noPermission"),
        empty: t("dashboard.feed.empty"),
        noAddress: t("dashboard.feed.noAddress"),
        today: t("dashboard.feed.today"),
        daysAgo: (n: string) => t("dashboard.feed.daysAgo", { n }),
        viewAll: t("dashboard.feed.viewAll"),
      },
    }),
    [t],
  );
}
