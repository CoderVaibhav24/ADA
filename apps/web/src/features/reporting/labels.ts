/** `reporting.*`, typed, for the Reporting tab only — same split as `features/users/labels.ts`. */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, useLanguage } from "@/i18n";

export type ReportingLabels = {
  tab: string;
  title: string;
  subtitle: string;
  basis: string;
  chartLabel: string;
  listTitle: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  deniedTitle: string;
  deniedBody: string;
  emptyTitle: string;
  emptyBody: string;
  count: (n: number) => string;
  noMembers: string;
  noZones: string;
  disabled: string;
  showAll: (n: number) => string;
  showFewer: string;
  reportsTo: (role: string) => string;
  top: string;
  unplaced: string;
  openOfficer: (name: string) => string;
};

export function useReportingLabels(): ReportingLabels {
  const { t: raw } = useTranslation();
  const { language } = useLanguage();
  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      raw(`reporting.${key}`, options ?? {}) as unknown as string;
    const n = (value: number) => formatNumber(language, value);
    return {
      tab: t("tab"),
      title: t("title"),
      subtitle: t("subtitle"),
      basis: t("basis"),
      chartLabel: t("chartLabel"),
      listTitle: t("listTitle"),
      loading: t("loading"),
      errorTitle: t("errorTitle"),
      errorBody: t("errorBody"),
      retry: t("retry"),
      deniedTitle: t("deniedTitle"),
      deniedBody: t("deniedBody"),
      emptyTitle: t("emptyTitle"),
      emptyBody: t("emptyBody"),
      count: (value: number) => (value === 1 ? t("countOne") : t("count", { n: n(value) })),
      noMembers: t("noMembers"),
      noZones: t("noZones"),
      disabled: t("disabled"),
      showAll: (value: number) => t("showAll", { n: n(value) }),
      showFewer: t("showFewer"),
      reportsTo: (role: string) => t("reportsTo", { role }),
      top: t("top"),
      unplaced: t("unplaced"),
      openOfficer: (name: string) => t("openOfficer", { name }),
    };
  }, [raw, language]);
}
