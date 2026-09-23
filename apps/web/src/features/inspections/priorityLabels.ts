/**
 * The register's two priority strings — the column header and the facet.
 *
 * The three VALUES are not re-derived here: `usePriorityLabels()` in
 * `@/i18n/labels` already translates `high`, `medium` and `low` for the
 * Complaints register, and the two registers must not disagree about what High
 * is called. Only the header and the facet's "All Priorities" are new, and they
 * live beside the screen that reads them for the same reason `detailLabels.ts`
 * and `findingsLabels.ts` do — `labels.ts` is the shared surface, and
 * `InspectionsLabels` was owned elsewhere when this was written.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PriorityValue } from "@/components/icms/status";
import { usePriorityLabels } from "@/i18n/labels";

export type InspectionPriorityLabels = {
  /** `inspections.columns.priority`, also the column menu's entry. */
  column: string;
  /** `inspections.facetPriority` — the dropdown's resting label. */
  facet: string;
  /** Shared with the Complaints register, from `priority.*`. */
  values: Record<PriorityValue, string>;
};

/** Memoised on `t`, so a re-render does not rebuild the column definitions. */
export function useInspectionPriorityLabels(): InspectionPriorityLabels {
  const { t } = useTranslation();
  const values = usePriorityLabels();
  return useMemo(
    () => ({
      column: t("inspections.columns.priority") as unknown as string,
      facet: t("inspections.facetPriority") as unknown as string,
      values,
    }),
    [t, values],
  );
}
