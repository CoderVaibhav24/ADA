/**
 * The Create Complaint screen's strings, from `complaintNew.*` in both bundles.
 *
 * It lives here rather than in `src/i18n/labels.ts` because one screen reads
 * it — the same split `features/inspections/findingsLabels.ts` makes. What more
 * than one complaints screen renders stays in `labels.ts` and is imported from
 * there: `usePriorityLabels` supplies the three priority words, so this file
 * does not restate them and the register and the form cannot disagree.
 *
 * Memoised on `t`: without it every keystroke in the description rebuilds a
 * hundred strings and every field below re-renders.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES,
  type EvidenceRejection,
} from "./complaintEvidence";
import { detectionSentence, type ComplaintFieldError } from "./complaintForm";

export type FieldLabels = {
  label: string;
  placeholder?: string;
  hint?: string;
};

export type ComplaintNewLabels = {
  title: string;
  subtitle: string;
  back: string;
  cancel: string;
  /** Read out beside a required field's name, so the asterisk is not the only cue. */
  required: string;
  optional: string;

  origin: {
    title: string;
    reference: (ref: string) => string;
    area: (value: string) => string;
    confidence: (value: string) => string;
    status: (status: "change" | "illegal") => string;
    /** Seeds the description with the detection's own numbers, nothing invented. */
    seedDetail: (
      ref: string,
      status: "change" | "illegal" | null,
      area: string | null,
      confidence: string | null,
    ) => string;
    locked: string;
  };

  source: {
    label: string;
    hint: string;
    option: (value: string) => string;
  };

  /** The two tabs, and the note on the detection tab when there is no hand-off. */
  mode: {
    label: string;
    detection: string;
    manual: string;
    noHandoff: string;
  };

  /** The detection tab's read-only block: who raised it, and from which polygon. */
  officer: {
    legend: string;
    name: string;
    email: string;
    source: string;
    detectionId: string;
  };

  complainant: {
    legend: string;
    hint: string;
    name: FieldLabels;
    phone: FieldLabels;
    email: FieldLabels;
    /** Under a complainant field filled from the officer's own account. */
    fromAccount: string;
    /** Copies the officer's own name and email into the complainant fields. */
    useMine: string;
  };

  location: {
    legend: string;
    hint: string;
    zone: FieldLabels;
    zoneUnavailable: string;
    latitude: FieldLabels;
    longitude: FieldLabels;
    readoutTitle: string;
    readout: (lat: string, lon: string) => string;
    readoutEmpty: string;
    clear: string;
    /** Beside a field the pin filled in, until the officer edits it. */
    suggested: string;
    /** Beside a field the imported land record under the pin filled in. */
    fromLandRecord: string;
    /** Beside Parcel ID when the land record filled it with a scheme plot's number. */
    fromLandRecordPlot: string;
    /** Under the zone picker when the land record's zone is not one of the officer's. */
    foreignZone: (zone: string) => string;
  };

  /** The "Select Location on Map" card. */
  map: {
    title: string;
    /** The map canvas's accessible name, which also says how to use it by keyboard. */
    canvas: string;
    pin: string;
    /** The same button once a pin exists: it moves the pin to the map's centre. */
    movePin: string;
    none: string;
    hint: string;
    unavailable: string;
  };

  /** Figma's "Village" and "Parcel ID" row, under the complainant. */
  parcelRow: {
    hint: string;
    village: FieldLabels;
    parcelId: FieldLabels;
  };

  more: {
    title: string;
    hint: string;
  };

  complaintDate: FieldLabels;

  evidence: {
    label: string;
    hint: string;
    add: string;
    addLabel: string;
    /** The drop zone's own words; the whole zone is the file picker. */
    drop: string;
    dropHint: string;
    remove: (name: string) => string;
    fromDetection: string;
    detectionLoading: string;
    detectionFailed: string;
    rejected: (reason: EvidenceRejection, name: string) => string;
    full: string;
  };

  /** After the case exists, while and after its photos upload. */
  filed: {
    title: (ref: string) => string;
    uploading: (done: number, total: number) => string;
    failed: (count: number) => string;
    saved: string;
    retry: string;
    open: string;
  };

  type: {
    legend: string;
    hint: string;
    unavailable: string;
    loading: string;
    clear: string;
    /** Beside the type when the detection chose it and the officer has not changed it. */
    suggested: string;
    other: FieldLabels;
  };

  property: {
    legend: string;
    address: FieldLabels;
    landmark: FieldLabels;
    district: FieldLabels;
    pinCode: FieldLabels;
    state: FieldLabels;
  };

  parcel: {
    legend: string;
    hint: string;
    ulpin: FieldLabels;
    khasra: FieldLabels;
    village: FieldLabels;
    districtCode: FieldLabels;
  };

  detail: FieldLabels & { legend: string };
  priority: FieldLabels;

  submit: string;
  submitting: string;
  submitConfirmTitle: string;
  submitConfirmBody: string;
  submitConfirmAction: string;

  unsaved: string;
  unsavedBody: string;
  unsavedLeave: string;
  stay: string;

  errorTitle: string;
  errorBody: string;
  requestId: string;
  retry: string;
  /** One sentence per problem code, said in the field's own terms. */
  fieldError: (code: ComplaintFieldError) => string;
  /**
   * The server's refusal codes, in the officer's language.
   *
   * `null` for a code with no sentence of its own, which is the caller's signal
   * to fall back to the server's `message` rather than invent one.
   */
  refusal: (code: string) => string | null;

  gate: {
    checking: string;
    deniedTitle: string;
    deniedBody: string;
  };
};

export function useComplaintNewLabels(): ComplaintNewLabels {
  const { t: translate } = useTranslation();

  return useMemo(() => {
    const t = (key: string, options?: Record<string, unknown>) =>
      translate(key, options ?? {}) as unknown as string;

    // A field's strings always sit together under one key, so a translator sees
    // the label, its placeholder and its hint as one unit.
    const field = (key: string, parts: { hint?: boolean } = {}) => ({
      label: t(`complaintNew.${key}.label`),
      placeholder: t(`complaintNew.${key}.placeholder`),
      hint: parts.hint === true ? t(`complaintNew.${key}.hint`) : undefined,
    });

    return {
      title: t("complaintNew.title"),
      subtitle: t("complaintNew.subtitle"),
      back: t("complaintNew.back"),
      cancel: t("complaintNew.cancel"),
      required: t("complaintNew.required"),
      optional: t("complaintNew.optional"),

      origin: {
        title: t("complaintNew.origin.title"),
        // A detection reference is a name, not a quantity: no number formatter.
        reference: (ref: string) => t("complaintNew.origin.reference", { ref }),
        area: (value: string) => t("complaintNew.origin.area", { value }),
        confidence: (value: string) => t("complaintNew.origin.confidence", { value }),
        status: (status: "change" | "illegal") => t(`complaintNew.origin.status.${status}`),
        seedDetail: (ref, status, area, confidence) =>
          detectionSentence(
            t("complaintNew.origin.seed.lead", { ref }),
            [
              status === null ? null : t(`complaintNew.origin.seed.status.${status}`),
              area === null ? null : t("complaintNew.origin.seed.area", { area }),
              confidence === null
                ? null
                : t("complaintNew.origin.seed.confidence", { confidence }),
            ],
            t("complaintNew.origin.seed.end"),
          ),
        locked: t("complaintNew.origin.locked"),
      },

      source: {
        label: t("complaintNew.source.label"),
        hint: t("complaintNew.source.hint"),
        option: (value: string) =>
          t(`complaintNew.source.option.${value}`, { defaultValue: value }),
      },

      mode: {
        label: t("complaintNew.mode.label"),
        detection: t("complaintNew.mode.detection"),
        manual: t("complaintNew.mode.manual"),
        noHandoff: t("complaintNew.mode.noHandoff"),
      },

      officer: {
        legend: t("complaintNew.officer.legend"),
        name: t("complaintNew.officer.name"),
        email: t("complaintNew.officer.email"),
        source: t("complaintNew.officer.source"),
        detectionId: t("complaintNew.officer.detectionId"),
      },

      complainant: {
        legend: t("complaintNew.complainant.legend"),
        hint: t("complaintNew.complainant.hint"),
        name: field("complainant.name"),
        phone: field("complainant.phone", { hint: true }),
        email: field("complainant.email"),
        fromAccount: t("complaintNew.complainant.fromAccount"),
        useMine: t("complaintNew.complainant.useMine"),
      },

      location: {
        legend: t("complaintNew.location.legend"),
        hint: t("complaintNew.location.hint"),
        zone: field("location.zone", { hint: true }),
        zoneUnavailable: t("complaintNew.location.zoneUnavailable"),
        latitude: field("location.latitude"),
        longitude: field("location.longitude"),
        readoutTitle: t("complaintNew.location.readoutTitle"),
        readout: (lat: string, lon: string) =>
          t("complaintNew.location.readout", { lat, lon }),
        readoutEmpty: t("complaintNew.location.readoutEmpty"),
        clear: t("complaintNew.location.clear"),
        suggested: t("complaintNew.location.suggested"),
        fromLandRecord: t("complaintNew.location.fromLandRecord"),
        fromLandRecordPlot: t("complaintNew.location.fromLandRecordPlot"),
        foreignZone: (zone: string) => t("complaintNew.location.foreignZone", { zone }),
      },

      map: {
        title: t("complaintNew.map.title"),
        canvas: t("complaintNew.map.canvas"),
        pin: t("complaintNew.map.pin"),
        movePin: t("complaintNew.map.movePin"),
        none: t("complaintNew.map.none"),
        hint: t("complaintNew.map.hint"),
        unavailable: t("complaintNew.map.unavailable"),
      },

      parcelRow: {
        hint: t("complaintNew.parcelRow.hint"),
        village: field("parcelRow.village", { hint: true }),
        parcelId: field("parcelRow.parcelId", { hint: true }),
      },

      more: {
        title: t("complaintNew.more.title"),
        hint: t("complaintNew.more.hint"),
      },

      complaintDate: field("complaintDate", { hint: true }),

      evidence: {
        label: t("complaintNew.evidence.label"),
        hint: t("complaintNew.evidence.hint", {
          mb: MAX_EVIDENCE_BYTES / (1024 * 1024),
          max: MAX_EVIDENCE_FILES,
        }),
        add: t("complaintNew.evidence.add"),
        addLabel: t("complaintNew.evidence.addLabel"),
        drop: t("complaintNew.evidence.drop"),
        dropHint: t("complaintNew.evidence.dropHint"),
        remove: (name: string) => t("complaintNew.evidence.remove", { name }),
        fromDetection: t("complaintNew.evidence.fromDetection"),
        detectionLoading: t("complaintNew.evidence.detectionLoading"),
        detectionFailed: t("complaintNew.evidence.detectionFailed"),
        rejected: (reason: EvidenceRejection, name: string) =>
          t(`complaintNew.evidence.rejected.${reason}`, {
            name,
            mb: MAX_EVIDENCE_BYTES / (1024 * 1024),
            max: MAX_EVIDENCE_FILES,
          }),
        full: t("complaintNew.evidence.full", { max: MAX_EVIDENCE_FILES }),
      },

      filed: {
        title: (ref: string) => t("complaintNew.filed.title", { ref }),
        uploading: (done: number, total: number) =>
          t("complaintNew.filed.uploading", { done, total }),
        failed: (count: number) => t("complaintNew.filed.failed", { count }),
        saved: t("complaintNew.filed.saved"),
        retry: t("complaintNew.filed.retry"),
        open: t("complaintNew.filed.open"),
      },

      type: {
        legend: t("complaintNew.type.legend"),
        hint: t("complaintNew.type.hint"),
        unavailable: t("complaintNew.type.unavailable"),
        loading: t("complaintNew.type.loading"),
        clear: t("complaintNew.type.clear"),
        suggested: t("complaintNew.type.suggested"),
        other: field("type.other"),
      },

      property: {
        legend: t("complaintNew.property.legend"),
        address: field("property.address"),
        landmark: field("property.landmark"),
        district: field("property.district"),
        pinCode: field("property.pinCode"),
        state: field("property.state"),
      },

      parcel: {
        legend: t("complaintNew.parcel.legend"),
        hint: t("complaintNew.parcel.hint"),
        ulpin: field("parcel.ulpin", { hint: true }),
        khasra: field("parcel.khasra", { hint: true }),
        village: field("parcel.village", { hint: true }),
        districtCode: field("parcel.districtCode"),
      },

      detail: {
        legend: t("complaintNew.detail.legend"),
        label: t("complaintNew.detail.label"),
        placeholder: t("complaintNew.detail.placeholder"),
        hint: t("complaintNew.detail.hint"),
      },
      priority: field("priority"),

      submit: t("complaintNew.submit"),
      submitting: t("complaintNew.submitting"),
      submitConfirmTitle: t("complaintNew.submitConfirmTitle"),
      submitConfirmBody: t("complaintNew.submitConfirmBody"),
      submitConfirmAction: t("complaintNew.submitConfirmAction"),

      unsaved: t("complaintNew.unsaved"),
      unsavedBody: t("complaintNew.unsavedBody"),
      unsavedLeave: t("complaintNew.unsavedLeave"),
      stay: t("complaintNew.stay"),

      errorTitle: t("complaintNew.errorTitle"),
      errorBody: t("complaintNew.errorBody"),
      requestId: t("complaintNew.requestId"),
      retry: t("complaintNew.retry"),
      fieldError: (code: ComplaintFieldError) => t(`complaintNew.fieldError.${code}`),
      refusal: (code: string) => {
        const text = t(`complaintNew.refusal.${code}`, { defaultValue: "" });
        return text === "" ? null : text;
      },

      gate: {
        checking: t("complaintNew.gate.checking"),
        deniedTitle: t("complaintNew.gate.deniedTitle"),
        deniedBody: t("complaintNew.gate.deniedBody"),
      },
    };
  }, [translate]);
}
