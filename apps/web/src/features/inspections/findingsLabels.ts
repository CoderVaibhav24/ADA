/**
 * The findings form's strings, from `inspectionFindings.*` in both bundles.
 *
 * It lives here rather than in `src/i18n/labels.ts` because one screen reads
 * it. What more than one of the three inspection screens renders — the
 * statuses, the workflow's action codes, the permission gate — stays in
 * `labels.ts` and is imported from there; nothing is re-derived here.
 *
 * The `load` group is `inspectionDetail.*` on purpose. "The inspection could
 * not be loaded" is the same sentence whichever screen asked for it, and a
 * second copy under a second key would be a second thing for a translator to
 * keep in step.
 *
 * Memoised on `t`: without it every keystroke in a finding rebuilds fifty
 * strings and every field below re-renders.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type FindingsListLabels = {
  label: string;
  hint: string;
  itemLabel: (n: number) => string;
  placeholder: string;
  add: string;
  remove: (n: number) => string;
  moveUp: (n: number) => string;
  moveDown: (n: number) => string;
  required: string;
  empty: string;
  max: (n: number) => string;
};

export type FindingsSectionLabels = {
  label: string;
  chooseAct: string;
  noneForAct: string;
  unavailable: string;
};

export type FindingsLabels = {
  title: string;
  subtitle: (ref: string, round: number) => string;
  back: string;
  list: FindingsListLabels;
  sections: FindingsSectionLabels;
  occupant: {
    legend: string;
    nameLabel: string;
    phoneLabel: string;
    phoneHint: string;
    phoneInvalid: string;
  };
  owner: { nameLabel: string; phoneLabel: string };
  measurement: {
    legend: string;
    areaTypeLabel: string;
    areaTypePlaceholder: string;
    areaLabel: string;
    areaInvalid: string;
    stageLabel: string;
    lengthLabel: string;
    widthLabel: string;
    sideInvalid: string;
    derivedArea: (value: string) => string;
  };
  notice: {
    legend: string;
    requiredLabel: string;
    actLabel: string;
    actPlaceholder: string;
  };
  note: { label: string; hint: string };
  save: string;
  saving: string;
  saved: string;
  submitConfirmTitle: (ref: string) => string;
  submitConfirmBody: string;
  submitConfirmAction: string;
  cancel: string;
  unsaved: string;
  unsavedBody: string;
  unsavedLeave: string;
  readOnly: string;
  submitNeedsSave: string;
  /**
   * The photograph count a submission is held to.
   *
   * A payload rule, not an authority one: it never decides whether the Submit
   * button is drawn — `available_actions` does that — only whether this screen
   * lets the press through to the server.
   */
  photos: {
    shortfall: (held: number, minimum: number) => string;
    unknown: string;
  };
  submitErrorTitle: string;
  errorTitle: string;
  errorBody: string;
  requestId: string;
  /**
   * Contract §6's codes, in the officer's own language.
   *
   * `null` for a code with no sentence of its own, which is the caller's signal
   * to fall back to the server's `message` rather than invent one.
   */
  refusal: (code: string) => string | null;
  /** The inspection itself failing to arrive — shared with the detail screen. */
  load: {
    loading: string;
    errorTitle: string;
    errorBody: string;
    retry: string;
    notFoundTitle: string;
    notFoundBody: string;
  };
};

export function useFindingsLabels(): FindingsLabels {
  const { t: translate } = useTranslation();

  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      translate(key, options ?? {}) as unknown as string;

    return {
      title: t("inspectionFindings.title"),
      // Neither value goes through the number formatter: INS-2026-0089 is a
      // name, and a round number is never large enough to be grouped.
      subtitle: (ref: string, round: number) =>
        t("inspectionFindings.subtitle", { ref, round: String(round) }),
      back: t("inspectionFindings.back"),

      list: {
        label: t("inspectionFindings.list.label"),
        hint: t("inspectionFindings.list.hint"),
        itemLabel: (n: number) => t("inspectionFindings.list.itemLabel", { n: String(n) }),
        placeholder: t("inspectionFindings.list.placeholder"),
        add: t("inspectionFindings.list.add"),
        remove: (n: number) => t("inspectionFindings.list.remove", { n: String(n) }),
        moveUp: (n: number) => t("inspectionFindings.list.moveUp", { n: String(n) }),
        moveDown: (n: number) => t("inspectionFindings.list.moveDown", { n: String(n) }),
        required: t("inspectionFindings.list.required"),
        empty: t("inspectionFindings.list.empty"),
        max: (n: number) => t("inspectionFindings.list.max", { n: String(n) }),
      },

      sections: {
        label: t("inspectionFindings.sections.label"),
        chooseAct: t("inspectionFindings.sections.chooseAct"),
        noneForAct: t("inspectionFindings.sections.noneForAct"),
        unavailable: t("inspectionFindings.sections.unavailable"),
      },

      occupant: {
        legend: t("inspectionFindings.occupant.legend"),
        nameLabel: t("inspectionFindings.occupant.nameLabel"),
        phoneLabel: t("inspectionFindings.occupant.phoneLabel"),
        phoneHint: t("inspectionFindings.occupant.phoneHint"),
        phoneInvalid: t("inspectionFindings.occupant.phoneInvalid"),
      },

      owner: {
        nameLabel: t("inspectionFindings.owner.nameLabel"),
        phoneLabel: t("inspectionFindings.owner.phoneLabel"),
      },

      measurement: {
        legend: t("inspectionFindings.measurement.legend"),
        areaTypeLabel: t("inspectionFindings.measurement.areaTypeLabel"),
        areaTypePlaceholder: t("inspectionFindings.measurement.areaTypePlaceholder"),
        areaLabel: t("inspectionFindings.measurement.areaLabel"),
        areaInvalid: t("inspectionFindings.measurement.areaInvalid"),
        stageLabel: t("inspectionFindings.measurement.stageLabel"),
        lengthLabel: t("inspectionFindings.measurement.lengthLabel"),
        widthLabel: t("inspectionFindings.measurement.widthLabel"),
        sideInvalid: t("inspectionFindings.measurement.sideInvalid"),
        derivedArea: (value: string) =>
          t("inspectionFindings.measurement.derivedArea", { value }),
      },

      notice: {
        legend: t("inspectionFindings.notice.legend"),
        requiredLabel: t("inspectionFindings.notice.requiredLabel"),
        actLabel: t("inspectionFindings.notice.actLabel"),
        actPlaceholder: t("inspectionFindings.notice.actPlaceholder"),
      },

      note: {
        label: t("inspectionFindings.note.label"),
        hint: t("inspectionFindings.note.hint"),
      },

      save: t("inspectionFindings.save"),
      saving: t("inspectionFindings.saving"),
      saved: t("inspectionFindings.saved"),
      submitConfirmTitle: (ref: string) =>
        t("inspectionFindings.submitConfirmTitle", { ref }),
      submitConfirmBody: t("inspectionFindings.submitConfirmBody"),
      submitConfirmAction: t("inspectionFindings.submitConfirmAction"),
      cancel: t("inspectionFindings.cancel"),
      unsaved: t("inspectionFindings.unsaved"),
      unsavedBody: t("inspectionFindings.unsavedBody"),
      unsavedLeave: t("inspectionFindings.unsavedLeave"),
      readOnly: t("inspectionFindings.readOnly"),
      submitNeedsSave: t("inspectionFindings.submitNeedsSave"),
      photos: {
        // Counts of photographs, like a round number, are never large enough
        // to be grouped by the number formatter.
        shortfall: (held: number, minimum: number) =>
          t("inspectionFindings.photos.shortfall", {
            n: String(held),
            min: String(minimum),
          }),
        unknown: t("inspectionFindings.photos.unknown"),
      },
      submitErrorTitle: t("inspectionFindings.submitErrorTitle"),
      errorTitle: t("inspectionFindings.errorTitle"),
      errorBody: t("inspectionFindings.errorBody"),
      requestId: t("inspectionFindings.requestId"),
      refusal: (code: string) => {
        const text = t(`inspectionFindings.refusal.${code}`, { defaultValue: "" });
        return text === "" ? null : text;
      },

      load: {
        loading: t("inspectionDetail.loading"),
        errorTitle: t("inspectionDetail.errorTitle"),
        errorBody: t("inspectionDetail.errorBody"),
        retry: t("inspectionDetail.errorRetry"),
        notFoundTitle: t("inspectionDetail.notFoundTitle"),
        notFoundBody: t("inspectionDetail.notFoundBody"),
      },
    };
  }, [translate]);
}
