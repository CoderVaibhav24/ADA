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
import type { ComplaintFieldError } from "./complaintForm";

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
    seedDetail: (ref: string, area: string, confidence: string) => string;
    locked: string;
  };

  source: {
    label: string;
    hint: string;
    option: (value: string) => string;
  };

  complainant: {
    legend: string;
    hint: string;
    name: FieldLabels;
    phone: FieldLabels;
    email: FieldLabels;
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
    mapDeferred: string;
  };

  type: {
    legend: string;
    hint: string;
    unavailable: string;
    loading: string;
    clear: string;
    other: FieldLabels;
  };

  property: {
    legend: string;
    ownerName: FieldLabels;
    ownerPhone: FieldLabels;
    propertyType: FieldLabels;
    floors: FieldLabels;
    address: FieldLabels;
    landmark: FieldLabels;
    policeStation: FieldLabels;
    district: FieldLabels;
    pinCode: FieldLabels;
    state: FieldLabels;
    country: FieldLabels;
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
        seedDetail: (ref: string, area: string, confidence: string) =>
          t("complaintNew.origin.seedDetail", { ref, area, confidence }),
        locked: t("complaintNew.origin.locked"),
      },

      source: {
        label: t("complaintNew.source.label"),
        hint: t("complaintNew.source.hint"),
        option: (value: string) =>
          t(`complaintNew.source.option.${value}`, { defaultValue: value }),
      },

      complainant: {
        legend: t("complaintNew.complainant.legend"),
        hint: t("complaintNew.complainant.hint"),
        name: field("complainant.name"),
        phone: field("complainant.phone", { hint: true }),
        email: field("complainant.email"),
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
        mapDeferred: t("complaintNew.location.mapDeferred"),
      },

      type: {
        legend: t("complaintNew.type.legend"),
        hint: t("complaintNew.type.hint"),
        unavailable: t("complaintNew.type.unavailable"),
        loading: t("complaintNew.type.loading"),
        clear: t("complaintNew.type.clear"),
        other: field("type.other"),
      },

      property: {
        legend: t("complaintNew.property.legend"),
        ownerName: field("property.ownerName"),
        ownerPhone: field("property.ownerPhone"),
        propertyType: field("property.propertyType"),
        floors: field("property.floors"),
        address: field("property.address"),
        landmark: field("property.landmark"),
        policeStation: field("property.policeStation"),
        district: field("property.district"),
        pinCode: field("property.pinCode"),
        state: field("property.state"),
        country: field("property.country"),
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
