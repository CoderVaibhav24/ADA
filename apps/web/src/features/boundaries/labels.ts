/** `boundaries.*`, typed, for the Administration → Boundaries tab only — same split as `features/reporting/labels.ts`. */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, useLanguage } from "@/i18n";
import type { Folder } from "./boundaryFile";

export type BoundaryLabels = {
  tab: string;
  title: string;
  subtitle: string;
  folders: Record<Folder, { name: string; body: string }>;
  spec: string;
  fileLabel: string;
  fileHint: string;
  wrongFile: string;
  chosen: (name: string, size: string) => string;
  validate: string;
  import: string;
  uploading: (percent: string) => string;
  processing: string;
  confirmTitle: string;
  confirmBody: string;
  confirmAction: string;
  cancel: string;
  dryRunTitle: string;
  dryRunBody: string;
  importedTitle: string;
  importedBody: string;
  countsCaption: string;
  folder: string;
  inserted: string;
  updated: string;
  deactivated: string;
  rejected: string;
  rejectedTitle: (n: number) => string;
  rejectedNone: string;
  warningsTitle: (n: number) => string;
  placemark: string;
  reason: string;
  unnamed: string;
  errorTitle: string;
  requestId: (id: string) => string;
  historyTitle: string;
  historySubtitle: string;
  file: string;
  importedBy: string;
  importedAt: string;
  counts: string;
  summary: (inserted: string, updated: string, deactivated: string, rejected: string) => string;
  someone: string;
  historyLoading: string;
  historyError: string;
  historyEmpty: string;
  retry: string;
  deniedTitle: string;
  deniedBody: string;
};

export function useBoundaryLabels(): BoundaryLabels {
  const { t: raw } = useTranslation();
  const { language } = useLanguage();
  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      raw(`boundaries.${key}`, options ?? {}) as unknown as string;
    const n = (value: number) => formatNumber(language, value);
    const folder = (key: Folder) => ({ name: t(`folders.${key}.name`), body: t(`folders.${key}.body`) });
    return {
      tab: t("tab"),
      title: t("title"),
      subtitle: t("subtitle"),
      folders: {
        zones: folder("zones"),
        villages: folder("villages"),
        parcels: folder("parcels"),
        reserved: folder("reserved"),
      },
      spec: t("spec"),
      fileLabel: t("fileLabel"),
      fileHint: t("fileHint"),
      wrongFile: t("wrongFile"),
      chosen: (name: string, size: string) => t("chosen", { name, size }),
      validate: t("validate"),
      import: t("import"),
      uploading: (percent: string) => t("uploading", { percent }),
      processing: t("processing"),
      confirmTitle: t("confirmTitle"),
      confirmBody: t("confirmBody"),
      confirmAction: t("confirmAction"),
      cancel: t("cancel"),
      dryRunTitle: t("dryRunTitle"),
      dryRunBody: t("dryRunBody"),
      importedTitle: t("importedTitle"),
      importedBody: t("importedBody"),
      countsCaption: t("countsCaption"),
      folder: t("folder"),
      inserted: t("inserted"),
      updated: t("updated"),
      deactivated: t("deactivated"),
      rejected: t("rejected"),
      rejectedTitle: (value: number) => t("rejectedTitle", { n: n(value) }),
      rejectedNone: t("rejectedNone"),
      warningsTitle: (value: number) => t("warningsTitle", { n: n(value) }),
      placemark: t("placemark"),
      reason: t("reason"),
      unnamed: t("unnamed"),
      errorTitle: t("errorTitle"),
      requestId: (id: string) => t("requestId", { id }),
      historyTitle: t("historyTitle"),
      historySubtitle: t("historySubtitle"),
      file: t("file"),
      importedBy: t("importedBy"),
      importedAt: t("importedAt"),
      counts: t("counts"),
      summary: (inserted: string, updated: string, deactivated: string, rejected: string) =>
        t("summary", { inserted, updated, deactivated, rejected }),
      someone: t("someone"),
      historyLoading: t("historyLoading"),
      historyError: t("historyError"),
      historyEmpty: t("historyEmpty"),
      retry: t("retry"),
      deniedTitle: t("deniedTitle"),
      deniedBody: t("deniedBody"),
    };
  }, [raw, language]);
}
