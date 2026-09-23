/**
 * `complaintDetail.*`, typed, for this screen only.
 *
 * It lives in the feature folder rather than in `src/i18n/labels.ts` because
 * that module is the shared surface — the hooks more than one screen renders —
 * and several screens of this batch are being built in parallel.
 *
 * The shared vocabularies are NOT re-derived here. Case statuses, priorities,
 * the register's own strings and the parcel-kind captions all have hooks in
 * `@/i18n/labels` already, and a second copy of any of them would drift.
 *
 * `fields` is one vocabulary keyed by the API's own field names, so the
 * read-only panels and the amend form cannot disagree about what a field is
 * called — `labels.fields.owner_phone` is the same string in both.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, useLanguage } from "@/i18n";
import type { AmendField } from "./ComplaintDetailModel";

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

/**
 * Every field this screen names, by the name the API gives it — the amendable
 * twenty-two plus the twelve the record carries but no one may edit.
 */
export const FIELD_KEYS = [
  "case_ref",
  "status",
  "stage_no",
  "zone",
  "source",
  "raised_at",
  "created_by",
  "updated_at",
  "closed_at",
  "parcel_id",
  "current_round",
  "location",
  "priority",
  "complaint_type_cd",
  "other_type",
  "detail",
  "complainant_name",
  "complainant_phone",
  "complainant_email",
  "owner_name",
  "owner_phone",
  "property_address",
  "landmark",
  "police_station",
  "pin_code",
  "district",
  "state",
  "country",
  "property_type_cd",
  "floor_count",
  "ulpin",
  "khasra_no",
  "village_lgd_code",
  "district_lgd_code",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

/** A field added to `CaseAmend` is a build error here, not an input with no label. */
export type AmendFieldsAreLabelled = Exclude<AmendField, FieldKey> extends never
  ? true
  : false;

export const AMEND_FIELDS_ARE_LABELLED: AmendFieldsAreLabelled = true;

export type ComplaintDetailLabels = {
  back: string;
  subtitle: (zone: string) => string;
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

  gate: { checking: string; deniedTitle: string; deniedBody: string };

  action: {
    /** Keyed by the action code the server published. An unknown code echoes. */
    label: (actionCd: string) => string;
    pending: (actionCd: string) => string;
    advisory: string;
    none: string;
    elsewhere: string;
  };

  panels: {
    case: string;
    property: string;
    parcel: string;
    complainant: string;
    owner: string;
    assignment: string;
    rounds: string;
    evidence: string;
  };

  fields: Record<FieldKey, string>;

  values: {
    coordinates: (lat: string, lon: string) => string;
    noLocation: string;
    stage: (n: number) => string;
    round: (n: number) => string;
    area: (value: string) => string;
    noDetail: string;
    noComplainant: string;
    noOwner: string;
    noParcel: string;
    source: (code: string) => string;
  };

  assignment: {
    body: string;
    noneTitle: string;
    noneBody: string;
    assignedAt: string;
    kind: string;
    releasedNote: string;
  };

  rounds: {
    body: string;
    count: (n: number) => string;
    current: string;
    emptyTitle: string;
    emptyBody: string;
    open: string;
    columns: {
      round: string;
      inspectionRef: string;
      status: string;
      surveyor: string;
      submitted: string;
      area: string;
    };
  };

  evidence: {
    body: string;
    count: (n: number) => string;
    none: string;
    link: (round: number) => string;
    noRound: string;
  };

  assign: {
    title: string;
    reassignTitle: string;
    body: string;
    reassignBody: string;
    assigneeLabel: string;
    assigneePlaceholder: string;
    assigneeHint: string;
    assigneeRequired: string;
    noteLabel: string;
    notePlaceholder: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    reasonRequired: string;
    notSurveyorTitle: string;
    notSurveyorBody: string;
    notInZoneTitle: string;
    notInZoneBody: string;
    doneTitle: string;
    done: (userId: string) => string;
  };

  amend: {
    open: string;
    title: string;
    body: string;
    submit: string;
    pending: string;
    nothingChanged: string;
    invalidFloors: string;
    otherTypeRequired: string;
    advisory: string;
    typePlaceholder: string;
    priorityPlaceholder: string;
    groups: {
      complaint: string;
      complainant: string;
      owner: string;
      property: string;
      parcel: string;
    };
  };
};

export function useComplaintDetailLabels(): ComplaintDetailLabels {
  const { t, n } = useI18n();

  return useMemo(() => {
    const fields = {} as Record<FieldKey, string>;
    for (const key of FIELD_KEYS) fields[key] = t(`complaintDetail.fields.${key}`);

    return {
      back: t("complaintDetail.back"),
      subtitle: (zone: string) => t("complaintDetail.subtitle", { zone }),
      loading: t("complaintDetail.loading"),
      errorTitle: t("complaintDetail.errorTitle"),
      errorBody: t("complaintDetail.errorBody"),
      errorRetry: t("complaintDetail.errorRetry"),
      notFoundTitle: t("complaintDetail.notFoundTitle"),
      notFoundBody: t("complaintDetail.notFoundBody"),
      requestId: t("complaintDetail.requestId"),
      saved: t("complaintDetail.saved"),
      refusedTitle: t("complaintDetail.refusedTitle"),
      cancel: t("complaintDetail.cancel"),
      actionsTitle: t("complaintDetail.actionsTitle"),

      gate: {
        checking: t("complaintDetail.gate.checking"),
        deniedTitle: t("complaintDetail.gate.deniedTitle"),
        deniedBody: t("complaintDetail.gate.deniedBody"),
      },

      action: {
        // `defaultValue` is the raw code: a transition added to the workflow
        // after this build renders as `verify_escalate` rather than as a missing
        // key, which is legible enough to raise a ticket about.
        label: (actionCd: string) =>
          t(`complaintDetail.action.${actionCd}`, { defaultValue: actionCd }),
        pending: (actionCd: string) =>
          t(`complaintDetail.action.pending.${actionCd}`, { defaultValue: actionCd }),
        advisory: t("complaintDetail.action.advisory"),
        none: t("complaintDetail.action.none"),
        elsewhere: t("complaintDetail.action.elsewhere"),
      },

      panels: {
        case: t("complaintDetail.panels.case"),
        property: t("complaintDetail.panels.property"),
        parcel: t("complaintDetail.panels.parcel"),
        complainant: t("complaintDetail.panels.complainant"),
        owner: t("complaintDetail.panels.owner"),
        assignment: t("complaintDetail.panels.assignment"),
        rounds: t("complaintDetail.panels.rounds"),
        evidence: t("complaintDetail.panels.evidence"),
      },

      fields,

      values: {
        coordinates: (lat: string, lon: string) =>
          t("complaintDetail.values.coordinates", { lat, lon }),
        noLocation: t("complaintDetail.values.noLocation"),
        stage: (value: number) => t("complaintDetail.values.stage", { n: n(value) }),
        round: (value: number) => t("complaintDetail.values.round", { n: n(value) }),
        area: (value: string) => t("complaintDetail.values.area", { value }),
        noDetail: t("complaintDetail.values.noDetail"),
        noComplainant: t("complaintDetail.values.noComplainant"),
        noOwner: t("complaintDetail.values.noOwner"),
        noParcel: t("complaintDetail.values.noParcel"),
        source: (code: string) =>
          t(`complaintDetail.values.source.${code}`, { defaultValue: code }),
      },

      assignment: {
        body: t("complaintDetail.assignment.body"),
        noneTitle: t("complaintDetail.assignment.noneTitle"),
        noneBody: t("complaintDetail.assignment.noneBody"),
        assignedAt: t("complaintDetail.assignment.assignedAt"),
        kind: t("complaintDetail.assignment.kind"),
        releasedNote: t("complaintDetail.assignment.releasedNote"),
      },

      rounds: {
        body: t("complaintDetail.rounds.body"),
        count: (value: number) => t("complaintDetail.rounds.count", { n: n(value) }),
        current: t("complaintDetail.rounds.current"),
        emptyTitle: t("complaintDetail.rounds.emptyTitle"),
        emptyBody: t("complaintDetail.rounds.emptyBody"),
        open: t("complaintDetail.rounds.open"),
        columns: {
          round: t("complaintDetail.rounds.columns.round"),
          inspectionRef: t("complaintDetail.rounds.columns.inspectionRef"),
          status: t("complaintDetail.rounds.columns.status"),
          surveyor: t("complaintDetail.rounds.columns.surveyor"),
          submitted: t("complaintDetail.rounds.columns.submitted"),
          area: t("complaintDetail.rounds.columns.area"),
        },
      },

      evidence: {
        body: t("complaintDetail.evidence.body"),
        count: (value: number) => t("complaintDetail.evidence.count", { n: n(value) }),
        none: t("complaintDetail.evidence.none"),
        link: (value: number) => t("complaintDetail.evidence.link", { n: n(value) }),
        noRound: t("complaintDetail.evidence.noRound"),
      },

      assign: {
        title: t("complaintDetail.assign.title"),
        reassignTitle: t("complaintDetail.assign.reassignTitle"),
        body: t("complaintDetail.assign.body"),
        reassignBody: t("complaintDetail.assign.reassignBody"),
        assigneeLabel: t("complaintDetail.assign.assigneeLabel"),
        assigneePlaceholder: t("complaintDetail.assign.assigneePlaceholder"),
        assigneeHint: t("complaintDetail.assign.assigneeHint"),
        assigneeRequired: t("complaintDetail.assign.assigneeRequired"),
        noteLabel: t("complaintDetail.assign.noteLabel"),
        notePlaceholder: t("complaintDetail.assign.notePlaceholder"),
        reasonLabel: t("complaintDetail.assign.reasonLabel"),
        reasonPlaceholder: t("complaintDetail.assign.reasonPlaceholder"),
        reasonRequired: t("complaintDetail.assign.reasonRequired"),
        notSurveyorTitle: t("complaintDetail.assign.notSurveyorTitle"),
        notSurveyorBody: t("complaintDetail.assign.notSurveyorBody"),
        notInZoneTitle: t("complaintDetail.assign.notInZoneTitle"),
        notInZoneBody: t("complaintDetail.assign.notInZoneBody"),
        doneTitle: t("complaintDetail.assign.doneTitle"),
        done: (userId: string) => t("complaintDetail.assign.done", { userId }),
      },

      amend: {
        open: t("complaintDetail.amend.open"),
        title: t("complaintDetail.amend.title"),
        body: t("complaintDetail.amend.body"),
        submit: t("complaintDetail.amend.submit"),
        pending: t("complaintDetail.amend.pending"),
        nothingChanged: t("complaintDetail.amend.nothingChanged"),
        invalidFloors: t("complaintDetail.amend.invalidFloors"),
        otherTypeRequired: t("complaintDetail.amend.otherTypeRequired"),
        advisory: t("complaintDetail.amend.advisory"),
        typePlaceholder: t("complaintDetail.amend.typePlaceholder"),
        priorityPlaceholder: t("complaintDetail.amend.priorityPlaceholder"),
        groups: {
          complaint: t("complaintDetail.amend.groups.complaint"),
          complainant: t("complaintDetail.amend.groups.complainant"),
          owner: t("complaintDetail.amend.groups.owner"),
          property: t("complaintDetail.amend.groups.property"),
          parcel: t("complaintDetail.amend.groups.parcel"),
        },
      },
    };
  }, [t, n]);
}
