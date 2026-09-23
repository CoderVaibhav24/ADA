/**
 * `dashboard.*`, typed, for the dashboard screen only.
 *
 * It lives in the feature folder rather than in `src/i18n/labels.ts` for the
 * reason `features/users/labels.ts` gives: that module is the shared surface —
 * the hooks more than one screen renders — and what only this screen reads
 * belongs next to this screen. Two vocabularies are NOT re-derived here:
 * `useCaseStatusLabels` already names the eleven workflow statuses, and
 * `useFormats` already owns number and date formatting, so every count reaching
 * these functions is a string that has already been through the Indian grouping.
 *
 * ## The one string on this screen that has to be exactly right
 *
 * `trend.series.resolved`. The server's field is called `resolved`, and it is
 * NOT the number of cases closed on that date — it is, of the cases RAISED in
 * that bucket, how many have since reached `closed` or `rejected`. Three
 * separate surfaces say so, because one is not enough for a number a director
 * will read off a screen: the legend ("Of those, since closed or rejected"),
 * the always-visible note under the plot, and the tooltip, which spells the
 * whole sentence out per bucket. The bare word "resolved" appears in no
 * user-facing string in either language.
 */

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
  loadedAt: (time: string) => string;
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

  summary: {
    title: string;
    description: string;
    empty: string;
    tiles: {
      total: { label: string; note: string };
      open: { label: string; note: string };
      closed: { label: string; note: string };
      rejected: { label: string; note: string };
      highPriority: { label: string; note: string };
    };
  };

  trend: {
    title: string;
    periodLabel: string;
    period: (id: string) => string;
    bucketNote: (bucket: string) => string;
    series: { raised: string; resolved: string };
    cohortNote: string;
    window: (start: string, end: string) => string;
    totals: (raised: string, resolved: string) => string;
    allZero: string;
    empty: string;
    /** The whole cohort sentence for one bucket. Rides in the tooltip heading. */
    point: (raised: string, resolved: string) => string;
    axis: string;
    showTable: string;
    hideTable: string;
    tableCaption: string;
    columns: { period: string; raised: string; resolved: string };
  };

  byType: {
    title: string;
    description: string;
    cap: (limit: string) => string;
    untyped: string;
    empty: string;
    columns: { type: string; total: string; share: string; open: string; resolved: string };
    share: (share: string) => string;
  };

  byZone: {
    title: string;
    description: string;
    cap: (limit: string) => string;
    empty: string;
    axis: string;
    scrollHint: string;
    columns: { zone: string; total: string; open: string; resolved: string };
  };

  byStatus: {
    title: string;
    description: string;
    empty: string;
    unknown: (code: string) => string;
    totalRow: string;
    columns: { status: string; count: string; share: string; high: string };
  };
};

export function useDashboardLabels(): DashboardLabels {
  const t = useTranslate();
  return useMemo(
    () => ({
      title: t("dashboard.title"),
      heading: t("dashboard.heading"),
      scopeNote: t("dashboard.scopeNote"),
      loadedAt: (time: string) => t("dashboard.loadedAt", { time }),
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
        // A missing id is a different sentence, not an empty one: "Request ID"
        // followed by nothing reads as a rendering bug over a phone line.
        requestId: (id: string | null) =>
          id === null || id === ""
            ? t("dashboard.panel.noRequestId")
            : t("dashboard.panel.requestId", { id }),
      },

      summary: {
        title: t("dashboard.summary.title"),
        description: t("dashboard.summary.description"),
        empty: t("dashboard.summary.empty"),
        tiles: {
          total: {
            label: t("dashboard.summary.total.label"),
            note: t("dashboard.summary.total.note"),
          },
          open: {
            label: t("dashboard.summary.open.label"),
            note: t("dashboard.summary.open.note"),
          },
          closed: {
            label: t("dashboard.summary.closed.label"),
            note: t("dashboard.summary.closed.note"),
          },
          rejected: {
            label: t("dashboard.summary.rejected.label"),
            note: t("dashboard.summary.rejected.note"),
          },
          highPriority: {
            label: t("dashboard.summary.highPriority.label"),
            note: t("dashboard.summary.highPriority.note"),
          },
        },
      },

      trend: {
        title: t("dashboard.trend.title"),
        periodLabel: t("dashboard.trend.periodLabel"),
        period: (id: string) => t(`dashboard.trend.period.${id}`),
        bucketNote: (bucket: string) => t(`dashboard.trend.bucketNote.${bucket}`),
        series: {
          raised: t("dashboard.trend.series.raised"),
          resolved: t("dashboard.trend.series.resolved"),
        },
        cohortNote: t("dashboard.trend.cohortNote"),
        window: (start: string, end: string) => t("dashboard.trend.window", { start, end }),
        totals: (raised: string, resolved: string) =>
          t("dashboard.trend.totals", { raised, resolved }),
        allZero: t("dashboard.trend.allZero"),
        empty: t("dashboard.trend.empty"),
        point: (raised: string, resolved: string) =>
          t("dashboard.trend.point", { raised, resolved }),
        axis: t("dashboard.trend.axis"),
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
        description: t("dashboard.byType.description"),
        cap: (limit: string) => t("dashboard.byType.cap", { limit }),
        untyped: t("dashboard.byType.untyped"),
        empty: t("dashboard.byType.empty"),
        columns: {
          type: t("dashboard.byType.columns.type"),
          total: t("dashboard.byType.columns.total"),
          share: t("dashboard.byType.columns.share"),
          open: t("dashboard.byType.columns.open"),
          resolved: t("dashboard.byType.columns.resolved"),
        },
        share: (share: string) => t("dashboard.byType.share", { share }),
      },

      byZone: {
        title: t("dashboard.byZone.title"),
        description: t("dashboard.byZone.description"),
        cap: (limit: string) => t("dashboard.byZone.cap", { limit }),
        empty: t("dashboard.byZone.empty"),
        axis: t("dashboard.byZone.axis"),
        scrollHint: t("dashboard.byZone.scrollHint"),
        columns: {
          zone: t("dashboard.byZone.columns.zone"),
          total: t("dashboard.byZone.columns.total"),
          open: t("dashboard.byZone.columns.open"),
          resolved: t("dashboard.byZone.columns.resolved"),
        },
      },

      byStatus: {
        title: t("dashboard.byStatus.title"),
        description: t("dashboard.byStatus.description"),
        empty: t("dashboard.byStatus.empty"),
        // Falls back to the raw code: a twelfth status arriving from a migration
        // this build has not seen must read as itself, not as a missing key.
        unknown: (code: string) => t("dashboard.byStatus.unknown", { code }),
        totalRow: t("dashboard.byStatus.totalRow"),
        columns: {
          status: t("dashboard.byStatus.columns.status"),
          count: t("dashboard.byStatus.columns.count"),
          share: t("dashboard.byStatus.columns.share"),
          high: t("dashboard.byStatus.columns.high"),
        },
      },
    }),
    [t],
  );
}
