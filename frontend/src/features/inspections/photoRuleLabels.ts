/**
 * `inspectionEvidence.photos.*` — the photograph rule, in the officer's words.
 *
 * Feature-local for the same reason `findingsLabels.ts` is: `src/i18n/labels.ts`
 * is the shared surface and `useInspectionEvidenceLabels` there is typed field
 * by field. These sentences are read by the gallery and by the upload dialog,
 * both on the inspection, so they live beside them.
 *
 * Every sentence carries the number it is talking about. A count said only in a
 * colour or only in a disabled control is not said at all — not to a screen
 * reader, not to a colour-blind officer, not on a photocopy of a file note.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type PhotoRuleLabels = {
  /** "{{n}} of {{max}} photographs · {{min}} required" — the rule, standing. */
  rule: (held: number, maximum: number, minimum: number) => string;
  /** The round is short of the minimum, said as a count rather than a colour. */
  shortfall: (held: number, minimum: number) => string;
  /** The round is full, and evidence cannot be removed. */
  ceiling: (maximum: number) => string;
  /** Said in the upload dialog, before the officer commits a file. */
  ceilingBlocked: (maximum: number) => string;
  /** The portal has not been told the rule. The server still enforces it. */
  unknown: string;
  /** The same, in the upload dialog, where it decides nothing. */
  uploadUnknown: string;
};

/** Memoised on `t`: the gallery rebuilds these on every thumbnail that arrives. */
export function usePhotoRuleLabels(): PhotoRuleLabels {
  const { t: translate } = useTranslation();

  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      translate(key, options ?? {}) as unknown as string;

    return {
      // Not through the number formatter: a photograph count is never large
      // enough to be grouped, and it must read the same in both bundles.
      rule: (held: number, maximum: number, minimum: number) =>
        t("inspectionEvidence.photos.rule", {
          n: String(held),
          max: String(maximum),
          min: String(minimum),
        }),
      shortfall: (held: number, minimum: number) =>
        t("inspectionEvidence.photos.shortfall", {
          n: String(held),
          min: String(minimum),
        }),
      ceiling: (maximum: number) =>
        t("inspectionEvidence.photos.ceiling", { max: String(maximum) }),
      ceilingBlocked: (maximum: number) =>
        t("inspectionEvidence.photos.ceilingBlocked", { max: String(maximum) }),
      unknown: t("inspectionEvidence.photos.unknown"),
      uploadUnknown: t("inspectionEvidence.photos.uploadUnknown"),
    };
  }, [translate]);
}
