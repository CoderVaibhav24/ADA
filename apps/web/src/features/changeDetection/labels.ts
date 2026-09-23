/**
 * The Change Detection screen's strings, from `changeDetection.*` in both
 * bundles.
 *
 * It lives here rather than in `src/i18n/labels.ts` because one screen reads
 * it. Nothing shared is re-derived: the shell, the nav and the status chips
 * keep their own hooks in `labels.ts` and are imported from there.
 *
 * One thing is deliberately NOT translated. `DetectionRow.description` is the
 * sentence the ML worker wrote into `properties.label`
 * (services/ml-worker/app/vectorize.py) — English, generated per polygon, and not a
 * closed vocabulary. `changeType` IS a closed vocabulary, so the four
 * structural types go through i18n and the free sentence is shown verbatim.
 *
 * Memoised on `t`: the map fires a zoom event per animation frame, and without
 * this every one of them would rebuild a hundred strings.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type {
  ChangeType,
  CompareMode,
  ConfidenceBand,
  LayerGroupId,
  LayerId,
} from "./model";

export type ChangeDetectionLabels = {
  title: string;
  subtitle: (reference: string, current: string, project: string) => string;
  subtitleNoRun: (project: string) => string;
  undated: string;
  back: string;
  mapLabel: string;
  /** A bare percentage on its own — an overlap, a blend readout. */
  percent: (value: string) => string;

  export: {
    label: string;
    menu: string;
    geojson: string;
    csv: string;
    running: string;
    failed: string;
    unavailable: string;
  };

  project: {
    label: string;
    placeholder: string;
    loading: string;
    emptyTitle: string;
    emptyBody: string;
  };

  run: {
    label: string;
    placeholder: string;
    option: (reference: string, current: string) => string;
    optionUndated: (id: string) => string;
    noneTitle: string;
    noneBody: string;
    pendingTitle: string;
    pendingBody: (stage: string, percent: string) => string;
    pendingNoStage: string;
    pendingHint: string;
    failedTitle: string;
    failedBody: (error: string) => string;
  };

  compare: {
    label: string;
    mode: (mode: CompareMode) => string;
    hint: (mode: CompareMode) => string;
  };

  zoom: {
    in: string;
    out: string;
    level: (z: string) => string;
    levelLabel: (z: string) => string;
    fit: string;
    fitUnavailable: string;
  };

  search: { label: string; placeholder: string; clear: string };

  blend: { label: string; valueLabel: string; disabled: string };

  layers: {
    title: string;
    group: (group: LayerGroupId) => string;
    layer: (layer: LayerId) => string;
    toggle: (layer: string) => string;
    on: string;
    off: string;
    opacity: (layer: string) => string;
    opacityValue: (percent: string) => string;
    unavailable: string;
    zoneCount: (n: string) => string;
    zoneNone: string;
  };

  detections: {
    title: string;
    titleWithCount: (n: string) => string;
    loading: string;
    errorTitle: string;
    errorBody: string;
    retry: string;
    emptyTitle: string;
    emptyBody: string;
    noResultsTitle: string;
    noResultsBody: (query: string) => string;
    clearSearch: string;
    showMore: (n: string) => string;
    showing: (shown: string, total: string) => string;
    capped: (cap: string, total: string) => string;
    area: (area: string) => string;
    confidence: (percent: string) => string;
    confidenceLabel: (percent: string, band: string) => string;
    redZone: (percent: string) => string;
  };

  band: (band: ConfidenceBand) => string;
  status: (status: "change" | "illegal") => string;
  changeType: (type: ChangeType) => string;

  review: {
    label: (status: "pending" | "confirmed" | "rejected") => string;
    confirm: string;
    dismiss: string;
    reset: string;
    saving: string;
  };

  detail: {
    title: string;
    emptyTitle: string;
    emptyBody: string;
    reference: string;
    description: string;
    changeType: string;
    classification: string;
    area: string;
    confidence: string;
    confidenceMeter: (percent: string, band: string) => string;
    redZone: string;
    brightness: string;
    centre: string;
    run: string;
    reviewedBy: string;
    reviewedAt: string;
    unreviewed: string;
    unavailable: string;
    viewFull: string;
    createComplaint: string;
  };

  preview: {
    title: (ref: string) => string;
    body: string;
    alt: (ref: string) => string;
    loading: string;
    errorTitle: string;
    errorBody: string;
    close: string;
  };

  legend: {
    title: string;
    illegal: string;
    change: string;
    confirmed: string;
    rejected: string;
    redZone: string;
  };

  error: {
    title: string;
    body: string;
    retry: string;
    requestId: (id: string) => string;
    requestIdMissing: string;
  };
};

export function useChangeDetectionLabels(): ChangeDetectionLabels {
  const { t: translate } = useTranslation();

  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      translate(key, options ?? {}) as unknown as string;

    return {
      title: t("changeDetection.title"),
      subtitle: (reference, current, project) =>
        t("changeDetection.subtitle", { reference, current, project }),
      subtitleNoRun: (project) => t("changeDetection.subtitleNoRun", { project }),
      undated: t("changeDetection.undated"),
      back: t("changeDetection.back"),
      mapLabel: t("changeDetection.mapLabel"),
      percent: (value) => t("changeDetection.percent", { value }),

      export: {
        label: t("changeDetection.export.label"),
        menu: t("changeDetection.export.menu"),
        geojson: t("changeDetection.export.geojson"),
        csv: t("changeDetection.export.csv"),
        running: t("changeDetection.export.running"),
        failed: t("changeDetection.export.failed"),
        unavailable: t("changeDetection.export.unavailable"),
      },

      project: {
        label: t("changeDetection.project.label"),
        placeholder: t("changeDetection.project.placeholder"),
        loading: t("changeDetection.project.loading"),
        emptyTitle: t("changeDetection.project.emptyTitle"),
        emptyBody: t("changeDetection.project.emptyBody"),
      },

      run: {
        label: t("changeDetection.run.label"),
        placeholder: t("changeDetection.run.placeholder"),
        option: (reference, current) =>
          t("changeDetection.run.option", { reference, current }),
        optionUndated: (id) => t("changeDetection.run.optionUndated", { id }),
        noneTitle: t("changeDetection.run.noneTitle"),
        noneBody: t("changeDetection.run.noneBody"),
        pendingTitle: t("changeDetection.run.pendingTitle"),
        pendingBody: (stage, percent) =>
          t("changeDetection.run.pendingBody", { stage, percent }),
        pendingNoStage: t("changeDetection.run.pendingNoStage"),
        pendingHint: t("changeDetection.run.pendingHint"),
        failedTitle: t("changeDetection.run.failedTitle"),
        failedBody: (error) => t("changeDetection.run.failedBody", { error }),
      },

      compare: {
        label: t("changeDetection.compare.label"),
        mode: (mode) => t(`changeDetection.compare.${mode}`),
        hint: (mode) => t(`changeDetection.compare.${mode}Hint`),
      },

      zoom: {
        in: t("changeDetection.zoom.in"),
        out: t("changeDetection.zoom.out"),
        level: (z) => t("changeDetection.zoom.level", { z }),
        levelLabel: (z) => t("changeDetection.zoom.levelLabel", { z }),
        fit: t("changeDetection.zoom.fit"),
        fitUnavailable: t("changeDetection.zoom.fitUnavailable"),
      },

      search: {
        label: t("changeDetection.search.label"),
        placeholder: t("changeDetection.search.placeholder"),
        clear: t("changeDetection.search.clear"),
      },

      blend: {
        label: t("changeDetection.blend.label"),
        valueLabel: t("changeDetection.blend.valueLabel"),
        disabled: t("changeDetection.blend.disabled"),
      },

      layers: {
        title: t("changeDetection.layers.title"),
        // `groupDetections`, not `group.detections`: a group id and a layer id
        // share the string "detections", and one flat key each keeps them apart.
        group: (group) =>
          t(`changeDetection.layers.group${group[0].toUpperCase()}${group.slice(1)}`),
        layer: (layer) => t(`changeDetection.layers.${layer}`),
        toggle: (layer) => t("changeDetection.layers.toggle", { layer }),
        on: t("changeDetection.layers.on"),
        off: t("changeDetection.layers.off"),
        opacity: (layer) => t("changeDetection.layers.opacity", { layer }),
        opacityValue: (percent) =>
          t("changeDetection.layers.opacityValue", { percent }),
        unavailable: t("changeDetection.layers.unavailable"),
        zoneCount: (n) => t("changeDetection.layers.zoneCount", { n }),
        zoneNone: t("changeDetection.layers.zoneNone"),
      },

      detections: {
        title: t("changeDetection.detections.title"),
        titleWithCount: (n) => t("changeDetection.detections.titleWithCount", { n }),
        loading: t("changeDetection.detections.loading"),
        errorTitle: t("changeDetection.detections.errorTitle"),
        errorBody: t("changeDetection.detections.errorBody"),
        retry: t("changeDetection.detections.retry"),
        emptyTitle: t("changeDetection.detections.emptyTitle"),
        emptyBody: t("changeDetection.detections.emptyBody"),
        noResultsTitle: t("changeDetection.detections.noResultsTitle"),
        noResultsBody: (query) =>
          t("changeDetection.detections.noResultsBody", { query }),
        clearSearch: t("changeDetection.detections.clearSearch"),
        showMore: (n) => t("changeDetection.detections.showMore", { n }),
        showing: (shown, total) =>
          t("changeDetection.detections.showing", { shown, total }),
        capped: (cap, total) => t("changeDetection.detections.capped", { cap, total }),
        area: (area) => t("changeDetection.detections.area", { area }),
        confidence: (percent) => t("changeDetection.detections.confidence", { percent }),
        confidenceLabel: (percent, band) =>
          t("changeDetection.detections.confidenceLabel", { percent, band }),
        redZone: (percent) => t("changeDetection.detections.redZone", { percent }),
      },

      band: (band) => t(`changeDetection.band.${band}`),
      status: (status) => t(`changeDetection.status.${status}`),
      changeType: (type) => t(`changeDetection.changeType.${type}`),

      review: {
        label: (status) => t(`changeDetection.review.${status}`),
        confirm: t("changeDetection.review.confirm"),
        dismiss: t("changeDetection.review.dismiss"),
        reset: t("changeDetection.review.reset"),
        saving: t("changeDetection.review.saving"),
      },

      detail: {
        title: t("changeDetection.detail.title"),
        emptyTitle: t("changeDetection.detail.emptyTitle"),
        emptyBody: t("changeDetection.detail.emptyBody"),
        reference: t("changeDetection.detail.reference"),
        description: t("changeDetection.detail.description"),
        changeType: t("changeDetection.detail.changeType"),
        classification: t("changeDetection.detail.classification"),
        area: t("changeDetection.detail.area"),
        confidence: t("changeDetection.detail.confidence"),
        confidenceMeter: (percent, band) =>
          t("changeDetection.detail.confidenceMeter", { percent, band }),
        redZone: t("changeDetection.detail.redZone"),
        brightness: t("changeDetection.detail.brightness"),
        centre: t("changeDetection.detail.centre"),
        run: t("changeDetection.detail.run"),
        reviewedBy: t("changeDetection.detail.reviewedBy"),
        reviewedAt: t("changeDetection.detail.reviewedAt"),
        unreviewed: t("changeDetection.detail.unreviewed"),
        unavailable: t("changeDetection.detail.unavailable"),
        viewFull: t("changeDetection.detail.viewFull"),
        createComplaint: t("changeDetection.detail.createComplaint"),
      },

      preview: {
        title: (ref) => t("changeDetection.preview.title", { ref }),
        body: t("changeDetection.preview.body"),
        alt: (ref) => t("changeDetection.preview.alt", { ref }),
        loading: t("changeDetection.preview.loading"),
        errorTitle: t("changeDetection.preview.errorTitle"),
        errorBody: t("changeDetection.preview.errorBody"),
        close: t("changeDetection.preview.close"),
      },

      legend: {
        title: t("changeDetection.legend.title"),
        illegal: t("changeDetection.legend.illegal"),
        change: t("changeDetection.legend.change"),
        confirmed: t("changeDetection.legend.confirmed"),
        rejected: t("changeDetection.legend.rejected"),
        redZone: t("changeDetection.legend.redZone"),
      },

      error: {
        title: t("changeDetection.error.title"),
        body: t("changeDetection.error.body"),
        retry: t("changeDetection.error.retry"),
        requestId: (id) => t("changeDetection.error.requestId", { id }),
        requestIdMissing: t("changeDetection.error.requestIdMissing"),
      },
    };
  }, [translate]);
}
