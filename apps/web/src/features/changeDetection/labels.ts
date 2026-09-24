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

import type { AnalysisMode } from "@/api/types";

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

  upload: {
    button: string;
    unavailable: string;
    title: string;
    description: string;
    fileLabel: string;
    nameLabel: string;
    namePlaceholder: string;
    capturedAtLabel: string;
    capturedAtPlaceholder: string;
    epsgLabel: string;
    epsgPlaceholder: string;
    epsgHint: string;
    tfwLabel: string;
    prjLabel: string;
    submit: string;
    cancel: string;
    progress: (percent: string) => string;
    processing: string;
    failed: string;
    serverTitle: string;
    serverHint: string;
    ready: string;
    readyBody: (name: string) => string;
    serverFailed: string;
    pollFailed: string;
    done: string;
    close: string;
    resumeBanner: (name: string, percent: string) => string;
    resumePick: string;
    resume: string;
    discard: string;
    checking: string;
    mismatch: (name: string) => string;
    paused: string;
    stop: string;
    expired: string;
    completionTimeout: string;
    discardConfirm: string;
    discardYes: string;
    keep: string;
    leaving: string;
    duplicate: string;
    useExisting: string;
    rejected: (reason: string) => string;
    diskFull: string;
    tooLarge: string;
  };

  panel: { hide: string; show: string };

  flight: {
    queued: string;
    uploading: string;
    processing: string;
    ready: string;
    failed: string;
    failedHint: (error: string) => string;
    reorderHint: string;
    dragHandle: (name: string) => string;
    failedNoError: string;
    stageFallback: string;
    percent: (percent: string) => string;
    progressLabel: (name: string, stage: string, percent: string) => string;
    delete: (name: string) => string;
    locate: (name: string) => string;
    locateUnavailable: string;
    resolution: (value: string) => string;
    groupCount: (group: string, n: string) => string;
    archived: string;
    restoring: string;
    rejected: string;
    retrying: string;
    rejectedHint: (reason: string) => string;
    retryingHint: string;
    archivedHint: string;
    restore: string;
    restoreLabel: (name: string) => string;
    restoreFailed: string;
    restoringEta: (hours: string) => string;
    restoringNoEta: string;
    uploadPercent: (percent: string) => string;
  };

  runtime: {
    label: (device: string) => string;
    cuda: string;
    metal: string;
    cpu: string;
    cpuEta: (minutes: string) => string;
    unavailable: string;
  };

  deleteFlight: {
    title: (name: string) => string;
    body: string;
    processing: string;
    confirm: string;
    cancel: string;
    running: string;
    failed: string;
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
    retryingTitle: string;
  };

  detect: {
    before: string;
    after: string;
    placeholder: string;
    flightOption: (name: string, date: string) => string;
    same: string;
    needTwo: string;
    mode: string;
    modeName: (mode: AnalysisMode) => string;
    modeHint: (mode: AnalysisMode) => string;
    run: string;
    starting: string;
    running: (stage: string, percent: string) => string;
    runningTitle: string;
    runningPercent: (percent: string) => string;
    runningDetail: (detail: string) => string;
    failed: string;
  };

  swipe: {
    label: string;
    vertical: string;
    horizontal: string;
    handle: string;
    side: (which: string, name: string, date: string) => string;
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
    linkedCase: (ref: string) => string;
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
    hoverHint: string;
  };

  complaintPrompt: {
    title: (ref: string) => string;
    summary: (type: string, area: string, confidence: string) => string;
    cancel: string;
    confirm: string;
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

      upload: {
        button: t("changeDetection.upload.button"),
        unavailable: t("changeDetection.upload.unavailable"),
        title: t("changeDetection.upload.title"),
        description: t("changeDetection.upload.description"),
        fileLabel: t("changeDetection.upload.fileLabel"),
        nameLabel: t("changeDetection.upload.nameLabel"),
        namePlaceholder: t("changeDetection.upload.namePlaceholder"),
        capturedAtLabel: t("changeDetection.upload.capturedAtLabel"),
        capturedAtPlaceholder: t("changeDetection.upload.capturedAtPlaceholder"),
        epsgLabel: t("changeDetection.upload.epsgLabel"),
        epsgPlaceholder: t("changeDetection.upload.epsgPlaceholder"),
        epsgHint: t("changeDetection.upload.epsgHint"),
        tfwLabel: t("changeDetection.upload.tfwLabel"),
        prjLabel: t("changeDetection.upload.prjLabel"),
        submit: t("changeDetection.upload.submit"),
        cancel: t("changeDetection.upload.cancel"),
        progress: (percent) => t("changeDetection.upload.progress", { percent }),
        processing: t("changeDetection.upload.processing"),
        failed: t("changeDetection.upload.failed"),
        serverTitle: t("changeDetection.upload.serverTitle"),
        serverHint: t("changeDetection.upload.serverHint"),
        ready: t("changeDetection.upload.ready"),
        readyBody: (name) => t("changeDetection.upload.readyBody", { name }),
        serverFailed: t("changeDetection.upload.serverFailed"),
        pollFailed: t("changeDetection.upload.pollFailed"),
        done: t("changeDetection.upload.done"),
        close: t("changeDetection.upload.close"),
        resumeBanner: (name, percent) => t("changeDetection.upload.resumeBanner", { name, percent }),
        resumePick: t("changeDetection.upload.resumePick"),
        resume: t("changeDetection.upload.resume"),
        discard: t("changeDetection.upload.discard"),
        checking: t("changeDetection.upload.checking"),
        mismatch: (name) => t("changeDetection.upload.mismatch", { name }),
        paused: t("changeDetection.upload.paused"),
        stop: t("changeDetection.upload.stop"),
        expired: t("changeDetection.upload.expired"),
        completionTimeout: t("changeDetection.upload.completionTimeout"),
        discardConfirm: t("changeDetection.upload.discardConfirm"),
        discardYes: t("changeDetection.upload.discardYes"),
        keep: t("changeDetection.upload.keep"),
        leaving: t("changeDetection.upload.leaving"),
        duplicate: t("changeDetection.upload.duplicate"),
        useExisting: t("changeDetection.upload.useExisting"),
        rejected: (reason) => t("changeDetection.upload.rejected", { reason }),
        diskFull: t("changeDetection.upload.diskFull"),
        tooLarge: t("changeDetection.upload.tooLarge"),
      },

      panel: {
        hide: t("changeDetection.panel.hide"),
        show: t("changeDetection.panel.show"),
      },

      flight: {
        queued: t("changeDetection.flight.queued"),
        uploading: t("changeDetection.flight.uploading"),
        processing: t("changeDetection.flight.processing"),
        ready: t("changeDetection.flight.ready"),
        failed: t("changeDetection.flight.failed"),
        failedHint: (error) => t("changeDetection.flight.failedHint", { error }),
        reorderHint: t("changeDetection.flight.reorderHint"),
        dragHandle: (name) => t("changeDetection.flight.dragHandle", { name }),
        failedNoError: t("changeDetection.flight.failedNoError"),
        stageFallback: t("changeDetection.flight.stageFallback"),
        percent: (percent) => t("changeDetection.flight.percent", { percent }),
        progressLabel: (name, stage, percent) =>
          t("changeDetection.flight.progressLabel", { name, stage, percent }),
        delete: (name) => t("changeDetection.flight.delete", { name }),
        locate: (name) => t("changeDetection.flight.locate", { name }),
        locateUnavailable: t("changeDetection.flight.locateUnavailable"),
        resolution: (value) => t("changeDetection.flight.resolution", { value }),
        groupCount: (group, n) => t("changeDetection.flight.groupCount", { group, n }),
        archived: t("changeDetection.flight.archived"),
        restoring: t("changeDetection.flight.restoring"),
        rejected: t("changeDetection.flight.rejected"),
        retrying: t("changeDetection.flight.retrying"),
        rejectedHint: (reason) => t("changeDetection.flight.rejectedHint", { reason }),
        retryingHint: t("changeDetection.flight.retryingHint"),
        archivedHint: t("changeDetection.flight.archivedHint"),
        restore: t("changeDetection.flight.restore"),
        restoreLabel: (name) => t("changeDetection.flight.restoreLabel", { name }),
        restoreFailed: t("changeDetection.flight.restoreFailed"),
        restoringEta: (hours) => t("changeDetection.flight.restoringEta", { hours }),
        restoringNoEta: t("changeDetection.flight.restoringNoEta"),
        uploadPercent: (percent) => t("changeDetection.flight.uploadPercent", { percent }),
      },

      runtime: {
        label: (device) => t("changeDetection.runtime.label", { device }),
        cuda: t("changeDetection.runtime.cuda"),
        metal: t("changeDetection.runtime.metal"),
        cpu: t("changeDetection.runtime.cpu"),
        cpuEta: (minutes) => t("changeDetection.runtime.cpuEta", { minutes }),
        unavailable: t("changeDetection.runtime.unavailable"),
      },

      deleteFlight: {
        title: (name) => t("changeDetection.deleteFlight.title", { name }),
        body: t("changeDetection.deleteFlight.body"),
        processing: t("changeDetection.deleteFlight.processing"),
        confirm: t("changeDetection.deleteFlight.confirm"),
        cancel: t("changeDetection.deleteFlight.cancel"),
        running: t("changeDetection.deleteFlight.running"),
        failed: t("changeDetection.deleteFlight.failed"),
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
        retryingTitle: t("changeDetection.run.retryingTitle"),
      },

      detect: {
        before: t("changeDetection.detect.before"),
        after: t("changeDetection.detect.after"),
        placeholder: t("changeDetection.detect.placeholder"),
        flightOption: (name, date) => t("changeDetection.detect.flightOption", { name, date }),
        same: t("changeDetection.detect.same"),
        needTwo: t("changeDetection.detect.needTwo"),
        mode: t("changeDetection.detect.mode"),
        modeName: (mode) => t(`changeDetection.detect.${mode}`),
        modeHint: (mode) => t(`changeDetection.detect.${mode}Hint`),
        run: t("changeDetection.detect.run"),
        starting: t("changeDetection.detect.starting"),
        running: (stage, percent) =>
          t("changeDetection.detect.running", { stage, percent }),
        runningTitle: t("changeDetection.detect.runningTitle"),
        runningPercent: (percent) => t("changeDetection.detect.runningPercent", { percent }),
        runningDetail: (detail) => t("changeDetection.detect.runningDetail", { detail }),
        failed: t("changeDetection.detect.failed"),
      },

      swipe: {
        label: t("changeDetection.swipe.label"),
        vertical: t("changeDetection.swipe.vertical"),
        horizontal: t("changeDetection.swipe.horizontal"),
        handle: t("changeDetection.swipe.handle"),
        side: (which, name, date) => t("changeDetection.swipe.side", { which, name, date }),
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
        linkedCase: (ref) => t("changeDetection.detections.linkedCase", { ref }),
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
        hoverHint: t("changeDetection.detail.hoverHint"),
      },

      complaintPrompt: {
        title: (ref) => t("changeDetection.complaintPrompt.title", { ref }),
        summary: (type, area, confidence) =>
          t("changeDetection.complaintPrompt.summary", { type, area, confidence }),
        cancel: t("changeDetection.complaintPrompt.cancel"),
        confirm: t("changeDetection.complaintPrompt.confirm"),
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
