/**
 * `inspectionDetail.*`, typed, for this screen only.
 *
 * It lives in the feature folder rather than in `src/i18n/labels.ts` because
 * that module is the shared surface — the hooks more than one screen renders —
 * and three screens of this batch were built in parallel. What only the detail
 * screen reads belongs next to the detail screen.
 *
 * The shared vocabularies are NOT re-derived here. Statuses, action codes,
 * evidence kinds, capture sources, the capability gate and the evidence gallery
 * all have hooks in `@/i18n/labels` already, and a second copy of any of them
 * would drift.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, useLanguage } from "@/i18n";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Same bridge as `i18n/labels.ts` uses: `t` plus the active number formatter. */
function useI18n(): { t: Translate; n: (value: number) => string } {
  const { t } = useTranslation();
  const { language } = useLanguage();
  return useMemo(
    () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        t(key, options ?? {}) as unknown as string,
      n: (value: number) => formatNumber(language, value),
    }),
    [t, language],
  );
}

export type InspectionDetailLabels = {
  back: string;
  subtitle: (round: number, caseRef: string) => string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  notFoundTitle: string;
  notFoundBody: string;
  requestId: string;
  saved: string;
  refusedTitle: string;
  cancel: string;
  actionsTitle: string;

  upload: {
    photoNotice: string;
    geotagRequiredTitle: string;
    /** `allowed` from the 422, joined — the fields the photograph was missing. */
    geotagRequiredBody: (fields: string) => string;
  };

  summary: {
    title: string;
    caseRef: string;
    caseTitle: string;
    caseStatus: string;
    status: string;
    round: string;
    surveyor: string;
    zone: string;
    scheduled: string;
    started: string;
    submitted: string;
    location: string;
    coordinates: (lat: string, lon: string) => string;
    accuracy: (metres: number) => string;
    noLocation: string;
  };

  occupant: { title: string; name: string; phone: string; none: string };

  measurement: {
    title: string;
    areaType: string;
    area: string;
    areaValue: (value: string) => string;
    noticeRequired: string;
    noticeAct: string;
    yes: string;
    no: string;
    undecided: string;
    none: string;
  };

  findings: {
    title: string;
    count: (n: number) => string;
    seq: (n: number) => string;
    recordedAt: (when: string) => string;
    emptyTitle: string;
    emptyBody: string;
    emptyAction: string;
  };

  sections: { title: string; item: (act: string, section: string) => string; none: string };

  officerNote: { title: string; none: string };

  checkIns: {
    title: string;
    count: (n: number) => string;
    accuracy: (metres: number) => string;
    source: string;
    deviceTime: string;
    serverTime: string;
    insideZone: string;
    outsideZone: string;
    zoneUnknown: string;
    emptyTitle: string;
    emptyBody: string;
  };

  rounds: { title: string; current: string; item: (n: number) => string; body: string };

  verify: {
    title: string;
    body: string;
    reasonLabel: string;
    reasonHint: string;
    reasonRequired: string;
    confirmAcceptTitle: (ref: string) => string;
    confirmAcceptBody: string;
    confirmRejectTitle: (ref: string) => string;
    confirmRejectBody: string;
    cancel: string;
  };

  resurvey: {
    title: string;
    reasonLabel: string;
    reasonRequired: string;
    pending: string;
    noteLabel: string;
    surveyorLabel: string;
    surveyorRequired: string;
    fromRound: (n: number) => string;
    resultingRound: (n: number) => string;
    requestedBy: (who: string, when: string) => string;
    decidedBy: (who: string, when: string) => string;
    none: string;
    cancel: string;
  };

  checkIn: {
    title: string;
    body: string;
    locating: string;
    accuracy: (metres: number) => string;
    denied: string;
    unavailable: string;
    cancel: string;
  };

  assign: {
    title: string;
    body: string;
    surveyorLabel: string;
    surveyorPlaceholder: string;
    scheduledLabel: string;
    scheduledPlaceholder: string;
    cancel: string;
  };
};

export function useInspectionDetailLabels(): InspectionDetailLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      back: t("inspectionDetail.back"),
      subtitle: (round: number, caseRef: string) =>
        t("inspectionDetail.subtitle", { round: n(round), caseRef }),
      loading: t("inspectionDetail.loading"),
      errorTitle: t("inspectionDetail.errorTitle"),
      errorBody: t("inspectionDetail.errorBody"),
      errorRetry: t("inspectionDetail.errorRetry"),
      notFoundTitle: t("inspectionDetail.notFoundTitle"),
      notFoundBody: t("inspectionDetail.notFoundBody"),
      requestId: t("inspectionDetail.requestId"),
      saved: t("inspectionDetail.saved"),
      refusedTitle: t("inspectionDetail.refusedTitle"),
      cancel: t("inspectionDetail.cancel"),
      actionsTitle: t("inspectionDetail.actionsTitle"),

      upload: {
        photoNotice: t("inspectionDetail.upload.photoNotice"),
        geotagRequiredTitle: t("inspectionDetail.upload.geotagRequiredTitle"),
        geotagRequiredBody: (fields: string) =>
          t("inspectionDetail.upload.geotagRequiredBody", { fields }),
      },

      summary: {
        title: t("inspectionDetail.summary.title"),
        caseRef: t("inspectionDetail.summary.caseRef"),
        caseTitle: t("inspectionDetail.summary.caseTitle"),
        caseStatus: t("inspectionDetail.summary.caseStatus"),
        status: t("inspectionDetail.summary.status"),
        round: t("inspectionDetail.summary.round"),
        surveyor: t("inspectionDetail.summary.surveyor"),
        zone: t("inspectionDetail.summary.zone"),
        scheduled: t("inspectionDetail.summary.scheduled"),
        started: t("inspectionDetail.summary.started"),
        submitted: t("inspectionDetail.summary.submitted"),
        location: t("inspectionDetail.summary.location"),
        // Already formatted to six decimals by the caller: a coordinate is not
        // a quantity, and running it through the locale's grouping turns
        // 28.6139 into 28.614 in one language and 28,6139 in another.
        coordinates: (lat: string, lon: string) =>
          t("inspectionDetail.summary.coordinates", { lat, lon }),
        accuracy: (metres: number) =>
          t("inspectionDetail.summary.accuracy", { m: n(metres) }),
        noLocation: t("inspectionDetail.summary.noLocation"),
      },

      occupant: {
        title: t("inspectionDetail.occupant.title"),
        name: t("inspectionDetail.occupant.name"),
        phone: t("inspectionDetail.occupant.phone"),
        none: t("inspectionDetail.occupant.none"),
      },

      measurement: {
        title: t("inspectionDetail.measurement.title"),
        areaType: t("inspectionDetail.measurement.areaType"),
        area: t("inspectionDetail.measurement.area"),
        areaValue: (value: string) =>
          t("inspectionDetail.measurement.areaValue", { value }),
        noticeRequired: t("inspectionDetail.measurement.noticeRequired"),
        noticeAct: t("inspectionDetail.measurement.noticeAct"),
        yes: t("inspectionDetail.measurement.yes"),
        no: t("inspectionDetail.measurement.no"),
        undecided: t("inspectionDetail.measurement.undecided"),
        none: t("inspectionDetail.measurement.none"),
      },

      findings: {
        title: t("inspectionDetail.findings.title"),
        count: (value: number) => t("inspectionDetail.findings.count", { n: n(value) }),
        seq: (value: number) => t("inspectionDetail.findings.seq", { n: n(value) }),
        recordedAt: (when: string) =>
          t("inspectionDetail.findings.recordedAt", { when }),
        emptyTitle: t("inspectionDetail.findings.emptyTitle"),
        emptyBody: t("inspectionDetail.findings.emptyBody"),
        emptyAction: t("inspectionDetail.findings.emptyAction"),
      },

      sections: {
        title: t("inspectionDetail.sections.title"),
        item: (act: string, section: string) =>
          t("inspectionDetail.sections.item", { act, section }),
        none: t("inspectionDetail.sections.none"),
      },

      officerNote: {
        title: t("inspectionDetail.officerNote.title"),
        none: t("inspectionDetail.officerNote.none"),
      },

      checkIns: {
        title: t("inspectionDetail.checkIns.title"),
        count: (value: number) => t("inspectionDetail.checkIns.count", { n: n(value) }),
        accuracy: (metres: number) =>
          t("inspectionDetail.checkIns.accuracy", { m: n(metres) }),
        source: t("inspectionDetail.checkIns.source"),
        deviceTime: t("inspectionDetail.checkIns.deviceTime"),
        serverTime: t("inspectionDetail.checkIns.serverTime"),
        insideZone: t("inspectionDetail.checkIns.insideZone"),
        outsideZone: t("inspectionDetail.checkIns.outsideZone"),
        zoneUnknown: t("inspectionDetail.checkIns.zoneUnknown"),
        emptyTitle: t("inspectionDetail.checkIns.emptyTitle"),
        emptyBody: t("inspectionDetail.checkIns.emptyBody"),
      },

      rounds: {
        title: t("inspectionDetail.rounds.title"),
        current: t("inspectionDetail.rounds.current"),
        item: (value: number) => t("inspectionDetail.rounds.item", { n: n(value) }),
        body: t("inspectionDetail.rounds.body"),
      },

      verify: {
        title: t("inspectionDetail.verify.title"),
        body: t("inspectionDetail.verify.body"),
        reasonLabel: t("inspectionDetail.verify.reasonLabel"),
        reasonHint: t("inspectionDetail.verify.reasonHint"),
        reasonRequired: t("inspectionDetail.verify.reasonRequired"),
        confirmAcceptTitle: (ref: string) =>
          t("inspectionDetail.verify.confirmAcceptTitle", { ref }),
        confirmAcceptBody: t("inspectionDetail.verify.confirmAcceptBody"),
        confirmRejectTitle: (ref: string) =>
          t("inspectionDetail.verify.confirmRejectTitle", { ref }),
        confirmRejectBody: t("inspectionDetail.verify.confirmRejectBody"),
        cancel: t("inspectionDetail.verify.cancel"),
      },

      resurvey: {
        title: t("inspectionDetail.resurvey.title"),
        reasonLabel: t("inspectionDetail.resurvey.reasonLabel"),
        reasonRequired: t("inspectionDetail.resurvey.reasonRequired"),
        pending: t("inspectionDetail.resurvey.pending"),
        noteLabel: t("inspectionDetail.resurvey.noteLabel"),
        surveyorLabel: t("inspectionDetail.resurvey.surveyorLabel"),
        surveyorRequired: t("inspectionDetail.resurvey.surveyorRequired"),
        fromRound: (value: number) =>
          t("inspectionDetail.resurvey.fromRound", { n: n(value) }),
        resultingRound: (value: number) =>
          t("inspectionDetail.resurvey.resultingRound", { n: n(value) }),
        requestedBy: (who: string, when: string) =>
          t("inspectionDetail.resurvey.requestedBy", { who, when }),
        decidedBy: (who: string, when: string) =>
          t("inspectionDetail.resurvey.decidedBy", { who, when }),
        none: t("inspectionDetail.resurvey.none"),
        cancel: t("inspectionDetail.resurvey.cancel"),
      },

      checkIn: {
        title: t("inspectionDetail.checkIn.title"),
        body: t("inspectionDetail.checkIn.body"),
        locating: t("inspectionDetail.checkIn.locating"),
        accuracy: (metres: number) =>
          t("inspectionDetail.checkIn.accuracy", { m: n(metres) }),
        denied: t("inspectionDetail.checkIn.denied"),
        unavailable: t("inspectionDetail.checkIn.unavailable"),
        cancel: t("inspectionDetail.checkIn.cancel"),
      },

      assign: {
        title: t("inspectionDetail.assign.title"),
        body: t("inspectionDetail.assign.body"),
        surveyorLabel: t("inspectionDetail.assign.surveyorLabel"),
        surveyorPlaceholder: t("inspectionDetail.assign.surveyorPlaceholder"),
        scheduledLabel: t("inspectionDetail.assign.scheduledLabel"),
        scheduledPlaceholder: t("inspectionDetail.assign.scheduledPlaceholder"),
        cancel: t("inspectionDetail.assign.cancel"),
      },
    }),
    [t, n],
  );
}
