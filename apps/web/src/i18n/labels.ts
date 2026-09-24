/**
 * The bridge between i18next and the components' `labels` props.
 *
 * Every primitive in the portal takes its strings as a prop so no English lives
 * inside it (see data-table/types.ts). These hooks build those objects out of
 * `t`, which keeps that contract intact and means a screen switching language is
 * a re-render rather than a rewrite.
 *
 * Each hook is memoised on `t`. Without that, `buildComplaintColumns` sees a new
 * `labels` object on every render and rebuilds fourteen column definitions.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DataTableLabels } from "@/components/data-table/types";
import type { RegisterPaginationLabels } from "@/components/icms/RegisterPagination";
import type { PriorityValue, StatusValue } from "@/components/icms/status";
import { PRIORITY_VALUES, STATUS_VALUES } from "@/components/icms/status";
import { CASE_STATUSES, type CaseStatus } from "@/api/icms/cases";
import {
  CHECK_IN_SOURCES,
  EVIDENCE_KINDS,
  EVIDENCE_SOURCES,
  INSPECTION_STATUSES,
  RESURVEY_DECISIONS,
  type InspectionStatus,
  type ResurveyDecision,
} from "@/api/icms/inspections";
import type { NavId } from "@/routes/nav";
import { formatNumber, useLanguage, type Language } from "./index";

const NAV_IDS: readonly NavId[] = [
  "dashboard",
  "changeDetection",
  "complaintNew",
  "complaints",
  "inspections",
  "notices",
  "reports",
  "administration",
  "users",
];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** `t` plus the active language's number formatter, which every count goes through. */
function useI18n(): { t: Translate; language: Language; n: (value: number) => string } {
  const { t } = useTranslation();
  const { language } = useLanguage();
  return useMemo(
    () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        t(key, options ?? {}) as unknown as string,
      language,
      n: (value: number) => formatNumber(language, value),
    }),
    [t, language],
  );
}

/* ---- shell -------------------------------------------------------------- */

export type ShellLabels = {
  brandName: string;
  brandTagline: string;
  brandLogoAlt: string;
  brandHome: string;
  collapseNavigation: string;
  expandNavigation: string;
  navigationLandmark: string;
  skipToContent: string;
  account: string;
  accountMenu: string;
  signedInAs: string;
  signOut: string;
  signingOut: string;
  notifications: string;
  /** Announced count. `0` is a different sentence, not "0 unread". */
  notificationsLabel: (unread: number) => string;
  copyright: (year: number) => string;
  operatedBy: string;
  navLoading: string;
};

export function useShellLabels(): ShellLabels {
  const { t } = useI18n();
  return useMemo(
    () => ({
      brandName: t("shell.brandName"),
      brandTagline: t("shell.brandTagline"),
      brandLogoAlt: t("shell.brandLogoAlt"),
      brandHome: t("shell.brandHome"),
      collapseNavigation: t("shell.collapseNavigation"),
      expandNavigation: t("shell.expandNavigation"),
      navigationLandmark: t("shell.navigationLandmark"),
      skipToContent: t("shell.skipToContent"),
      account: t("shell.account"),
      accountMenu: t("shell.accountMenu"),
      signedInAs: t("shell.signedInAs"),
      signOut: t("shell.signOut"),
      signingOut: t("shell.signingOut"),
      notifications: t("shell.notifications"),
      notificationsLabel: (unread: number) =>
        unread === 0
          ? t("shell.notificationsNone")
          : t("shell.notificationsUnread", { n: String(unread) }),
      // The year is NOT run through the number formatter: 2,026 is not a year.
      copyright: (year: number) => t("shell.copyright", { year: String(year) }),
      operatedBy: t("shell.operatedBy"),
      navLoading: t("shell.navLoading"),
    }),
    [t],
  );
}

// The screen-level permission guard's splash and refusal card.
export function useRouteGateLabels() {
  const { t } = useI18n();
  return useMemo(
    () => ({
      checking: t("routeGate.checking"),
      kicker: t("routeGate.kicker"),
      title: t("routeGate.title"),
      body: (code: string) => t("routeGate.body", { code }),
    }),
    [t],
  );
}

export function useNavLabels(): Record<NavId, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<NavId, string>;
    for (const id of NAV_IDS) out[id] = t(`nav.${id}`);
    return out;
  }, [t]);
}

/* ---- placeholder screens, 404, console ---------------------------------- */

export type ScreenCopy = { title: string; note: string };

const PLACEHOLDER_IDS = [
  "complaintNew",
  "complaint",
  "inspections",
  "inspection",
  "inspectionFindings",
  "notices",
  "noticeNew",
  "notice",
  "reports",
] as const;

export type PlaceholderScreenId = (typeof PLACEHOLDER_IDS)[number];

export function usePlaceholderScreens(): Record<PlaceholderScreenId, ScreenCopy> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<PlaceholderScreenId, ScreenCopy>;
    for (const id of PLACEHOLDER_IDS) {
      out[id] = {
        title: t(`placeholderScreens.${id}.title`),
        note: t(`placeholderScreens.${id}.note`),
      };
    }
    return out;
  }, [t]);
}

export function usePlaceholderLabels() {
  const { t } = useI18n();
  return useMemo(
    () => ({
      kicker: t("placeholder.kicker"),
      body: t("placeholder.body"),
      pathLabel: t("placeholder.pathLabel"),
      back: t("placeholder.back"),
    }),
    [t],
  );
}

export function useNotFoundLabels() {
  const { t } = useI18n();
  return useMemo(
    () => ({
      kicker: t("notFound.kicker"),
      title: t("notFound.title"),
      bodyBefore: t("notFound.bodyBefore"),
      bodyAfter: t("notFound.bodyAfter"),
      back: t("notFound.back"),
    }),
    [t],
  );
}

export function useConsoleLabels() {
  const { t } = useI18n();
  return useMemo(
    () => ({
      toolbarLandmark: t("console.toolbarLandmark"),
      projectLabel: t("console.projectLabel"),
      noProjects: t("console.noProjects"),
      newProject: t("console.newProject"),
      trainingSet: t("console.trainingSet"),
      trainingSetHint: t("console.trainingSetHint"),
      deleteProject: t("console.deleteProject"),
      confirmDelete: (name: string) => t("console.confirmDelete", { name }),
      firstProjectKicker: t("console.firstProjectKicker"),
      firstProjectTitle: t("console.firstProjectTitle"),
      firstProjectBody: t("console.firstProjectBody"),
      firstProjectAction: t("console.firstProjectAction"),
      openLayers: t("console.openLayers"),
      closeLayers: t("console.closeLayers"),
      layersPanel: t("console.layersPanel"),
    }),
    [t],
  );
}

/* ---- the grid ----------------------------------------------------------- */

export function useDataTableLabels(): DataTableLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      grid: t("dataTable.grid"),
      searchLabel: t("dataTable.searchLabel"),
      searchPlaceholder: t("dataTable.searchPlaceholder"),
      clearSearch: t("dataTable.clearSearch"),
      clearFilters: t("dataTable.clearFilters"),
      columns: t("dataTable.columns"),
      density: t("dataTable.density"),
      densityCompact: t("dataTable.densityCompact"),
      densityStandard: t("dataTable.densityStandard"),
      selectAllOnPage: t("dataTable.selectAllOnPage"),
      selectRow: (id: string) => t("dataTable.selectRow", { id }),
      selected: (count: number) => t("dataTable.selected", { n: n(count) }),
      clearSelection: t("dataTable.clearSelection"),
      exportLabel: t("dataTable.exportLabel"),
      exporting: t("dataTable.exporting"),
      savedViews: t("dataTable.savedViews"),
      saveCurrentView: t("dataTable.saveCurrentView"),
      saveViewNamePrompt: t("dataTable.saveViewNamePrompt"),
      deleteView: (name: string) => t("dataTable.deleteView", { name }),
      noSavedViews: t("dataTable.noSavedViews"),
      sortAscending: t("dataTable.sortAscending"),
      sortDescending: t("dataTable.sortDescending"),
      sortClear: t("dataTable.sortClear"),
      sortedAscending: t("dataTable.sortedAscending"),
      sortedDescending: t("dataTable.sortedDescending"),
      notSorted: t("dataTable.notSorted"),
      loading: t("dataTable.loading"),
      resultsAnnouncement: (total: number) =>
        total === 0
          ? t("dataTable.resultsNone")
          : t("dataTable.resultsCount", { n: n(total) }),
      facetSearchPlaceholder: t("dataTable.facetSearchPlaceholder"),
      facetNoResults: t("dataTable.facetNoResults"),
      facetClear: t("dataTable.facetClear"),
      detailsColumn: t("dataTable.detailsColumn"),
      openDetails: (id: string) => t("dataTable.openDetails", { id }),
      detailsTitle: t("dataTable.detailsTitle"),
      detailsClose: t("dataTable.detailsClose"),
    }),
    [t, n],
  );
}

export function usePaginationLabels(): RegisterPaginationLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      summary: ({ from, to, total }: { from: number; to: number; total: number }) =>
        total === 0
          ? t("pagination.summaryEmpty")
          : t("pagination.summary", { from: n(from), to: n(to), total: n(total) }),
      previous: t("pagination.previous"),
      next: t("pagination.next"),
      first: t("pagination.first"),
      last: t("pagination.last"),
      pageSize: t("pagination.pageSize"),
      page: (page: number) => t("pagination.page", { n: n(page) }),
      currentPage: (page: number) => t("pagination.currentPage", { n: n(page) }),
      morePages: t("pagination.morePages"),
      navigation: t("pagination.navigation"),
    }),
    [t, n],
  );
}

/* ---- status vocabulary -------------------------------------------------- */

export function useStatusLabels(): Record<StatusValue, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<StatusValue, string>;
    for (const value of STATUS_VALUES) out[value] = t(`status.${value}`);
    return out;
  }, [t]);
}

export function usePriorityLabels(): Record<PriorityValue, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<PriorityValue, string>;
    for (const value of PRIORITY_VALUES) out[value] = t(`priority.${value}`);
    return out;
  }, [t]);
}

export function useCaseStatusLabels(): Record<CaseStatus, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<CaseStatus, string>;
    for (const value of CASE_STATUSES) out[value] = t(`caseStatus.${value}`);
    return out;
  }, [t]);
}

/** Keyed by `ParcelIdentity.kindKey`, which is already the i18n key. */
export function useParcelKindLabels(): Record<string, string> {
  const { t } = useI18n();
  return useMemo(
    () => ({
      "parcel.ulpin": t("parcel.ulpin"),
      "parcel.khasra": t("parcel.khasra"),
      "parcel.none": t("parcel.none"),
    }),
    [t],
  );
}

/* ---- the Complaints register -------------------------------------------- */

export type ComplaintColumnId =
  | "caseRef"
  | "parcelId"
  | "location"
  | "complainant"
  | "complaintType"
  | "area"
  | "priority"
  | "status"
  | "filed"
  | "actions"
  | "zone"
  | "ulpin"
  | "khasra"
  | "stage";

export type ComplaintsLabels = {
  title: string;
  subtitle: string;
  back: string;
  export: string;
  newComplaint: string;
  registerTitle: string;
  recordCount: (shown: number, total: number) => string;
  columns: Record<ComplaintColumnId, string>;
  searchLabel: string;
  searchPlaceholder: string;
  facetComplaintType: string;
  facetPriority: string;
  facetStatus: string;
  facetZone: string;
  area: (value: string) => string;
  areaUnknown: string;
  notRecorded: string;
  stage: (n: number) => string;
  view: string;
  assignInspection: string;
  assigned: string;
  assignedReason: string;
  exportSelected: string;
  emptyTitle: string;
  emptyBody: string;
  emptyAction: string;
  noResultsTitle: string;
  noResultsBody: string;
  noResultsAction: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  loading: string;
  exportFilename: (isoDate: string) => string;
  exportProgress: (done: number, total: number) => string;
  exportTruncated: (rows: number) => string;
  exportFailed: string;
  resultsAnnouncement: (total: number) => string;
};

export function useComplaintsLabels(): ComplaintsLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      title: t("complaints.title"),
      subtitle: t("complaints.subtitle"),
      back: t("complaints.back"),
      export: t("complaints.export"),
      newComplaint: t("complaints.newComplaint"),
      registerTitle: t("complaints.registerTitle"),
      recordCount: (shown: number, total: number) =>
        t("complaints.recordCount", { shown: n(shown), total: n(total) }),

      columns: {
        caseRef: t("complaints.columns.caseRef"),
        parcelId: t("complaints.columns.parcelId"),
        location: t("complaints.columns.location"),
        complainant: t("complaints.columns.complainant"),
        complaintType: t("complaints.columns.complaintType"),
        area: t("complaints.columns.area"),
        priority: t("complaints.columns.priority"),
        status: t("complaints.columns.status"),
        filed: t("complaints.columns.filed"),
        actions: t("complaints.columns.actions"),
        zone: t("complaints.columns.zone"),
        ulpin: t("complaints.columns.ulpin"),
        khasra: t("complaints.columns.khasra"),
        stage: t("complaints.columns.stage"),
      },

      searchLabel: t("complaints.searchLabel"),
      searchPlaceholder: t("complaints.searchPlaceholder"),
      facetComplaintType: t("complaints.facetComplaintType"),
      facetPriority: t("complaints.facetPriority"),
      facetStatus: t("complaints.facetStatus"),
      facetZone: t("complaints.facetZone"),

      area: (value: string) => t("complaints.area", { value }),
      areaUnknown: t("complaints.areaUnknown"),
      notRecorded: t("complaints.notRecorded"),
      stage: (stage: number) => t("complaints.stage", { n: n(stage) }),

      view: t("complaints.view"),
      assignInspection: t("complaints.assignInspection"),
      assigned: t("complaints.assigned"),
      assignedReason: t("complaints.assignedReason"),

      exportSelected: t("complaints.exportSelected"),

      emptyTitle: t("complaints.emptyTitle"),
      emptyBody: t("complaints.emptyBody"),
      emptyAction: t("complaints.emptyAction"),
      noResultsTitle: t("complaints.noResultsTitle"),
      noResultsBody: t("complaints.noResultsBody"),
      noResultsAction: t("complaints.noResultsAction"),
      errorTitle: t("complaints.errorTitle"),
      errorBody: t("complaints.errorBody"),
      errorRetry: t("complaints.errorRetry"),
      loading: t("complaints.loading"),

      // The filename stays ASCII in both languages: a Devanagari attachment name
      // is mangled by the mail clients a district office actually runs.
      exportFilename: (isoDate: string) => t("complaints.exportFilename", { date: isoDate }),
      exportProgress: (done: number, total: number) =>
        t("complaints.exportProgress", { done: n(done), total: n(total) }),
      exportTruncated: (rows: number) => t("complaints.exportTruncated", { rows: n(rows) }),
      exportFailed: t("complaints.exportFailed"),

      resultsAnnouncement: (total: number) =>
        total === 0
          ? t("complaints.resultsNone")
          : t("complaints.resultsCount", { n: n(total) }),
    }),
    [t, n],
  );
}

/** The grid's own strings, with this register's wording where it differs. */
export function useComplaintsGridLabels(): DataTableLabels {
  const base = useDataTableLabels();
  const labels = useComplaintsLabels();
  return useMemo(
    () => ({
      ...base,
      grid: labels.registerTitle,
      searchLabel: labels.searchLabel,
      searchPlaceholder: labels.searchPlaceholder,
      loading: labels.loading,
      resultsAnnouncement: labels.resultsAnnouncement,
    }),
    [base, labels],
  );
}

/* ---- the inspection loop --------------------------------------------------
   Five shared hooks and then the register's own. The detail screen and the
   findings form build their hooks from `inspectionDetail.*` and
   `inspectionFindings.*`, which are already in both bundles; what is here is
   only what more than one of the three screens renders. -------------------- */

export function useInspectionStatusLabels(): Record<InspectionStatus, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<InspectionStatus, string>;
    for (const value of INSPECTION_STATUSES) out[value] = t(`inspectionStatus.${value}`);
    return out;
  }, [t]);
}

export function useResurveyDecisionLabels(): Record<ResurveyDecision, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<ResurveyDecision, string>;
    for (const value of RESURVEY_DECISIONS) out[value] = t(`resurveyDecision.${value}`);
    return out;
  }, [t]);
}

export function useEvidenceKindLabels(): Record<string, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const value of EVIDENCE_KINDS) out[value] = t(`evidenceKind.${value}`);
    return out;
  }, [t]);
}

/**
 * Both capture vocabularies in one lookup.
 *
 * `icms_check_in.capture_source` and `icms_evidence.capture_source` are
 * different sets on different tables and they do not overlap, so one map serves
 * both and neither screen has to know which table its row came from.
 */
export function useCaptureSourceLabels(): Record<string, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const value of [...CHECK_IN_SOURCES, ...EVIDENCE_SOURCES]) {
      out[value] = t(`captureSource.${value}`);
    }
    return out;
  }, [t]);
}

export type InspectionActionLabels = {
  /** Keyed by the `action_cd` in `available_actions`. An unknown code echoes. */
  label: (actionCd: string) => string;
  /** The same action while its request is in flight. */
  pending: (actionCd: string) => string;
  advisory: string;
  none: string;
};

/** Labels for the workflow's own action codes — never for a status. */
export function useInspectionActionLabels(): InspectionActionLabels {
  const { t } = useI18n();
  return useMemo(
    () => ({
      // `defaultValue` is the raw code: a transition added to the workflow after
      // this build renders as `verify_escalate` rather than as a missing key,
      // which is legible enough to raise a ticket about.
      label: (actionCd: string) =>
        t(`inspectionAction.${actionCd}`, { defaultValue: actionCd }),
      pending: (actionCd: string) =>
        t(`inspectionAction.pending.${actionCd}`, { defaultValue: actionCd }),
      advisory: t("inspectionAction.advisory"),
      none: t("inspectionAction.none"),
    }),
    [t],
  );
}

export type InspectionGateLabels = {
  checking: string;
  deniedTitle: string;
  deniedBody: string;
  evidenceDeniedTitle: string;
  evidenceDeniedBody: string;
};

export function useInspectionGateLabels(): InspectionGateLabels {
  const { t } = useI18n();
  return useMemo(
    () => ({
      checking: t("inspectionGate.checking"),
      deniedTitle: t("inspectionGate.deniedTitle"),
      deniedBody: t("inspectionGate.deniedBody"),
      evidenceDeniedTitle: t("inspectionGate.evidenceDeniedTitle"),
      evidenceDeniedBody: t("inspectionGate.evidenceDeniedBody"),
    }),
    [t],
  );
}

export type InspectionEvidenceLabels = {
  title: string;
  count: (n: number) => string;
  add: string;
  adding: string;
  fileLabel: string;
  chooseFile: string;
  kindLabel: string;
  docTypeLabel: string;
  capturedAt: (when: string) => string;
  uploadedAt: (when: string) => string;
  uploadedBy: (who: string) => string;
  round: (n: number) => string;
  checksum: string;
  open: (name: string) => string;
  download: string;
  downloading: string;
  geotagged: string;
  accuracy: (metres: number) => string;
  noLocation: string;
  flagged: string;
  flaggedReason: string;
  appendOnly: string;
  previewUnavailable: string;
  poorAccuracyTitle: string;
  poorAccuracyBody: string;
  emptyTitle: string;
  emptyBody: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  loading: string;
};

export function useInspectionEvidenceLabels(): InspectionEvidenceLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      title: t("inspectionEvidence.title"),
      count: (value: number) => t("inspectionEvidence.count", { n: n(value) }),
      add: t("inspectionEvidence.add"),
      adding: t("inspectionEvidence.adding"),
      fileLabel: t("inspectionEvidence.fileLabel"),
      chooseFile: t("inspectionEvidence.chooseFile"),
      kindLabel: t("inspectionEvidence.kindLabel"),
      docTypeLabel: t("inspectionEvidence.docTypeLabel"),
      capturedAt: (when: string) => t("inspectionEvidence.capturedAt", { when }),
      uploadedAt: (when: string) => t("inspectionEvidence.uploadedAt", { when }),
      uploadedBy: (who: string) => t("inspectionEvidence.uploadedBy", { who }),
      round: (value: number) => t("inspectionEvidence.round", { n: n(value) }),
      checksum: t("inspectionEvidence.checksum"),
      open: (name: string) => t("inspectionEvidence.open", { name }),
      download: t("inspectionEvidence.download"),
      downloading: t("inspectionEvidence.downloading"),
      geotagged: t("inspectionEvidence.geotagged"),
      accuracy: (metres: number) => t("inspectionEvidence.accuracy", { m: n(metres) }),
      noLocation: t("inspectionEvidence.noLocation"),
      flagged: t("inspectionEvidence.flagged"),
      flaggedReason: t("inspectionEvidence.flaggedReason"),
      appendOnly: t("inspectionEvidence.appendOnly"),
      previewUnavailable: t("inspectionEvidence.previewUnavailable"),
      poorAccuracyTitle: t("inspectionEvidence.poorAccuracyTitle"),
      poorAccuracyBody: t("inspectionEvidence.poorAccuracyBody"),
      emptyTitle: t("inspectionEvidence.emptyTitle"),
      emptyBody: t("inspectionEvidence.emptyBody"),
      errorTitle: t("inspectionEvidence.errorTitle"),
      errorBody: t("inspectionEvidence.errorBody"),
      errorRetry: t("inspectionEvidence.errorRetry"),
      loading: t("inspectionEvidence.loading"),
    }),
    [t, n],
  );
}

/* ---- the Inspections register --------------------------------------------- */

export type InspectionColumnId =
  | "inspectionRef"
  | "round"
  | "caseRef"
  | "location"
  | "surveyor"
  | "scheduled"
  | "status"
  | "evidence"
  | "findings"
  | "checkIn"
  | "started"
  | "submitted"
  | "actions";

export type InspectionsLabels = {
  title: string;
  subtitle: string;
  back: string;
  export: string;
  registerTitle: string;
  recordCount: (shown: number, total: number) => string;
  columns: Record<InspectionColumnId, string>;
  searchLabel: string;
  searchPlaceholder: string;
  facetStatus: string;
  facetRound: string;
  facetZone: string;
  round: (n: number) => string;
  submittedRange: string;
  submittedRangeAny: string;
  submittedRangeValue: (from: string, to: string) => string;
  submittedRangeFrom: (from: string) => string;
  submittedRangeClear: string;
  mineOnly: string;
  mineOnlyHint: string;
  surveyorFilter: (id: string) => string;
  surveyorFilterClear: string;
  caseFilter: (ref: string) => string;
  caseFilterClear: string;
  notRecorded: string;
  notScheduled: string;
  checkedIn: string;
  notCheckedIn: string;
  view: string;
  openCase: (ref: string) => string;
  exportSelected: string;
  exportFilename: (isoDate: string) => string;
  exportProgress: (done: number, total: number) => string;
  exportTruncated: (rows: number) => string;
  exportFailed: string;
  emptyTitle: string;
  emptyBody: string;
  noResultsTitle: string;
  noResultsBody: string;
  noResultsAction: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  loading: string;
  resultsAnnouncement: (total: number) => string;
};

export function useInspectionsLabels(): InspectionsLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      title: t("inspections.title"),
      subtitle: t("inspections.subtitle"),
      back: t("inspections.back"),
      export: t("inspections.export"),
      registerTitle: t("inspections.registerTitle"),
      recordCount: (shown: number, total: number) =>
        t("inspections.recordCount", { shown: n(shown), total: n(total) }),

      columns: {
        inspectionRef: t("inspections.columns.inspectionRef"),
        round: t("inspections.columns.round"),
        caseRef: t("inspections.columns.caseRef"),
        location: t("inspections.columns.location"),
        surveyor: t("inspections.columns.surveyor"),
        scheduled: t("inspections.columns.scheduled"),
        status: t("inspections.columns.status"),
        evidence: t("inspections.columns.evidence"),
        findings: t("inspections.columns.findings"),
        checkIn: t("inspections.columns.checkIn"),
        started: t("inspections.columns.started"),
        submitted: t("inspections.columns.submitted"),
        actions: t("inspections.columns.actions"),
      },

      searchLabel: t("inspections.searchLabel"),
      searchPlaceholder: t("inspections.searchPlaceholder"),
      facetStatus: t("inspections.facetStatus"),
      facetRound: t("inspections.facetRound"),
      facetZone: t("inspections.facetZone"),

      round: (value: number) => t("inspections.round", { n: n(value) }),

      submittedRange: t("inspections.submittedRange"),
      submittedRangeAny: t("inspections.submittedRangeAny"),
      submittedRangeValue: (from: string, to: string) =>
        t("inspections.submittedRangeValue", { from, to }),
      submittedRangeFrom: (from: string) => t("inspections.submittedRangeFrom", { from }),
      submittedRangeClear: t("inspections.submittedRangeClear"),

      mineOnly: t("inspections.mineOnly"),
      mineOnlyHint: t("inspections.mineOnlyHint"),
      surveyorFilter: (id: string) => t("inspections.surveyorFilter", { id }),
      surveyorFilterClear: t("inspections.surveyorFilterClear"),
      caseFilter: (ref: string) => t("inspections.caseFilter", { ref }),
      caseFilterClear: t("inspections.caseFilterClear"),

      notRecorded: t("inspections.notRecorded"),
      notScheduled: t("inspections.notScheduled"),
      checkedIn: t("inspections.checkedIn"),
      notCheckedIn: t("inspections.notCheckedIn"),

      view: t("inspections.view"),
      openCase: (ref: string) => t("inspections.openCase", { ref }),

      exportSelected: t("inspections.exportSelected"),
      // ASCII in both languages, for the same reason as the complaints export.
      exportFilename: (isoDate: string) => t("inspections.exportFilename", { date: isoDate }),
      exportProgress: (done: number, total: number) =>
        t("inspections.exportProgress", { done: n(done), total: n(total) }),
      exportTruncated: (rows: number) => t("inspections.exportTruncated", { rows: n(rows) }),
      exportFailed: t("inspections.exportFailed"),

      emptyTitle: t("inspections.emptyTitle"),
      emptyBody: t("inspections.emptyBody"),
      noResultsTitle: t("inspections.noResultsTitle"),
      noResultsBody: t("inspections.noResultsBody"),
      noResultsAction: t("inspections.noResultsAction"),
      errorTitle: t("inspections.errorTitle"),
      errorBody: t("inspections.errorBody"),
      errorRetry: t("inspections.errorRetry"),
      loading: t("inspections.loading"),

      resultsAnnouncement: (total: number) =>
        total === 0
          ? t("inspections.resultsNone")
          : t("inspections.resultsCount", { n: n(total) }),
    }),
    [t, n],
  );
}

/** The grid's own strings, with this register's wording where it differs. */
export function useInspectionsGridLabels(): DataTableLabels {
  const base = useDataTableLabels();
  const labels = useInspectionsLabels();
  return useMemo(
    () => ({
      ...base,
      grid: labels.registerTitle,
      searchLabel: labels.searchLabel,
      searchPlaceholder: labels.searchPlaceholder,
      loading: labels.loading,
      resultsAnnouncement: labels.resultsAnnouncement,
    }),
    [base, labels],
  );
}

/* ---- the policy administration area -------------------------------------- */

/**
 * Role and permission labels come from the i18n bundles keyed by CODE, with the
 * API's own English `label` as the fallback.
 *
 * That is not the arrangement the rest of the portal uses — `icms_code_value`
 * and `icms_zone` are rendered from their `label_hi` / `name_hi` columns. It is
 * forced here: `PermissionOut` and `RoleGrantsOut` in `icms_admin.py` carry no
 * `label_hi` field at all, and migration 0003 seeds `icms_permission.label_hi`
 * as NULL besides. The fallback means a permission code added later still
 * renders — in the server's English — instead of showing a missing key.
 */
export type PolicyLabels = {
  title: string;
  subtitle: string;
  back: string;
  revision: (n: number) => string;
  sourceLabel: string;
  source: (source: string | null) => string;
  advisory: string;
  tabs: { permissions: string; roleGrants: string; transitions: string };
  /** The three permission bands (see features/policy/bands.ts), plus the filter's "All". */
  bands: {
    all: string;
    screens: string;
    workflow: string;
    data: string;
    filterLabel: string;
    chip: (band: string, n: number) => string;
  };
  gate: { checking: string; deniedTitle: string; deniedBody: string };
  propagation: {
    title: (revision: number | null) => string;
    body: (seconds: number) => string;
    dismiss: string;
  };
  error: { title: string; body: string; retry: string; requestId: string };

  /** `fallback` is the server's English label for the row. */
  role: (roleCd: string, fallback: string) => string;
  permission: (resource: string, action: string, fallback: string) => string;
  resource: (resource: string) => string;
  permissionAction: (action: string) => string;
  /** The workflow step, short — for a table cell. */
  actionName: (actionCd: string) => string;
  /** The workflow step as a verb phrase — for a sentence about who may do it. */
  actionPhrase: (actionCd: string) => string;

  permissions: {
    title: string;
    subtitle: string;
    count: (n: number) => string;
    columns: {
      code: string;
      resource: string;
      action: string;
      label: string;
      kind: string;
      actions: string;
    };
    systemBadge: string;
    customBadge: string;
    systemHint: string;
    customHint: string;
    deleteLabel: (code: string) => string;
    delete: string;
    deleteDisabled: string;
    confirmTitle: (code: string) => string;
    confirmBody: string;
    confirmAction: string;
    cancel: string;
    deleting: string;
    refusedTitle: (code: string) => string;
    emptyTitle: string;
    emptyBody: string;
  };

  createRole: {
    newRole: string;
    title: string;
    description: string;
    label: string;
    labelHi: string;
    code: string;
    codeHint: string;
    copyFrom: string;
    copyNone: string;
    create: string;
    creating: string;
    cancel: string;
    failedTitle: string;
    labelRequired: string;
    codeInvalid: string;
  };

  grants: {
    title: string;
    subtitle: string;
    roleColumn: string;
    inactiveRole: string;
    granted: string;
    notGranted: string;
    cell: (permission: string, role: string) => string;
    roleTotal: (n: number, total: number) => string;
    sharedScreen: string;
    screenClosedHint: string;
    changedBadge: string;
    fullSetNote: string;
    noChanges: string;
    changeCount: (changes: number, roles: number) => string;
    reviewTitle: string;
    added: (role: string, permission: string) => string;
    removed: (role: string, permission: string) => string;
    save: string;
    saving: string;
    discard: string;
    lockoutHint: string;
    lockoutTitle: string;
    lockoutBody: (role: string) => string;
    lockoutFix: string;
    partialTitle: (role: string) => string;
    partialBody: (saved: string, role: string) => string;
    failedTitle: (role: string) => string;
    openRole: (role: string) => string;
    closeRole: string;
    narrowHint: string;
    bandTotal: (band: string, n: number, total: number) => string;
    scrollHint: string;
  };

  transitions: {
    title: string;
    subtitle: string;
    count: (n: number) => string;
    columns: {
      stage: string;
      action: string;
      from: string;
      to: string;
      permission: string;
      requires: string;
      rules: string;
      edit: string;
    };
    stage: (n: number) => string;
    initialStatus: string;
    assigneeOnly: string;
    assigneeOnlyOff: string;
    opensRound: string;
    active: string;
    inactive: string;
    noHolders: string;
    holdersLabel: string;
    noRequires: string;
    noteLabel: string;
    noNote: string;
    edit: string;
    editLabel: (action: string) => string;
    fixedTitle: string;
    fixedBody: string;
    permissionLabel: string;
    permissionHint: string;
    permissionPlaceholder: string;
    holdersNow: string;
    unknownPermission: (code: string) => string;
    requiresLabel: string;
    requiresHint: string;
    requiresAdd: string;
    requiresPlaceholder: string;
    requiresInvalid: string;
    requiresRemove: (field: string) => string;
    assigneeOnlyLabel: string;
    assigneeOnlyHint: string;
    activeLabel: string;
    activeHint: string;
    noteEditLabel: string;
    noteEditHint: string;
    cancel: string;
    review: string;
    noChanges: string;
    confirmTitle: string;
    confirmBody: string;
    confirmAction: string;
    confirming: string;
    changePermission: (action: string, permission: string, code: string) => string;
    changeHolderAdded: (role: string, action: string) => string;
    changeHolderRemoved: (role: string, action: string) => string;
    changeHoldersSame: string;
    changeAssigneeOnlyOn: (action: string) => string;
    changeAssigneeOnlyOff: (action: string) => string;
    changeActiveOff: (action: string) => string;
    changeActiveOn: string;
    changeRequiresAdded: (field: string, action: string) => string;
    changeRequiresRemoved: (field: string, action: string) => string;
    changeNote: string;
    nobodyWarning: (action: string) => string;
    refusedTitle: string;
    emptyTitle: string;
    emptyBody: string;
    flowchart: {
      title: string;
      hint: string;
      ariaLabel: (statuses: number, steps: number) => string;
      start: string;
      end: string;
      nobody: string;
      legendStart: string;
      legendEnd: string;
      legendBack: string;
      legendOff: string;
      layoutLabel: string;
      layoutVertical: string;
      layoutHorizontal: string;
      nodeAria: (status: string, out: number, into: number) => string;
      edgeAria: (action: string, from: string, to: string, roles: string) => string;
      filterNode: (n: number, status: string) => string;
      filterEdge: (n: number, from: string, to: string) => string;
      showAll: string;
      nodeHelp: string;
      edgeHelp: string;
      controls: string;
      zoomIn: string;
      zoomOut: string;
      fitView: string;
    };
  };
};

export function usePolicyLabels(): PolicyLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      title: t("policy.title"),
      subtitle: t("policy.subtitle"),
      back: t("policy.back"),
      revision: (value: number) => t("policy.revision", { n: n(value) }),
      sourceLabel: t("policy.sourceLabel"),
      // `policy_source` is "database" | "partial" | "code". Anything else is a
      // contract change, and echoing it beats rendering a missing key.
      source: (source: string | null) =>
        source === "database" || source === "partial" || source === "code"
          ? t(`policy.source.${source}`)
          : (source ?? ""),
      advisory: t("policy.advisory"),

      tabs: {
        permissions: t("policy.tabs.permissions"),
        roleGrants: t("policy.tabs.roleGrants"),
        transitions: t("policy.tabs.transitions"),
      },

      bands: {
        all: t("policy.bands.all"),
        screens: t("policy.bands.screens"),
        workflow: t("policy.bands.workflow"),
        data: t("policy.bands.data"),
        filterLabel: t("policy.bands.filterLabel"),
        chip: (band: string, value: number) => t("policy.bands.chip", { band, n: n(value) }),
      },

      gate: {
        checking: t("policy.gate.checking"),
        deniedTitle: t("policy.gate.deniedTitle"),
        deniedBody: t("policy.gate.deniedBody"),
      },

      propagation: {
        // The revision is an identifier, not a quantity: 1,024 is not a revision.
        title: (revision: number | null) =>
          t("policy.propagation.title", { revision: revision === null ? "?" : String(revision) }),
        body: (seconds: number) =>
          t("policy.propagation.body", { seconds: String(seconds) }),
        dismiss: t("policy.propagation.dismiss"),
      },

      error: {
        title: t("policy.error.title"),
        body: t("policy.error.body"),
        retry: t("policy.error.retry"),
        requestId: t("policy.error.requestId"),
      },

      role: (roleCd: string, fallback: string) =>
        t(`policy.roleLabels.${roleCd}`, { defaultValue: fallback }),
      permission: (resource: string, action: string, fallback: string) =>
        t(`policy.permissionLabels.${resource}.${action}`, { defaultValue: fallback }),
      resource: (resource: string) =>
        t(`policy.resourceLabels.${resource}`, { defaultValue: resource }),
      permissionAction: (action: string) =>
        t(`policy.actionLabels.${action}`, { defaultValue: action }),
      actionName: (actionCd: string) =>
        t(`policy.actionName.${actionCd}`, { defaultValue: actionCd }),
      actionPhrase: (actionCd: string) =>
        t(`policy.actionPhrase.${actionCd}`, { defaultValue: actionCd }),

      permissions: {
        title: t("policy.permissions.title"),
        subtitle: t("policy.permissions.subtitle"),
        count: (value: number) => t("policy.permissions.count", { n: n(value) }),
        columns: {
          code: t("policy.permissions.columns.code"),
          resource: t("policy.permissions.columns.resource"),
          action: t("policy.permissions.columns.action"),
          label: t("policy.permissions.columns.label"),
          kind: t("policy.permissions.columns.kind"),
          actions: t("policy.permissions.columns.actions"),
        },
        systemBadge: t("policy.permissions.systemBadge"),
        customBadge: t("policy.permissions.customBadge"),
        systemHint: t("policy.permissions.systemHint"),
        customHint: t("policy.permissions.customHint"),
        deleteLabel: (code: string) => t("policy.permissions.deleteLabel", { code }),
        delete: t("policy.permissions.delete"),
        deleteDisabled: t("policy.permissions.deleteDisabled"),
        confirmTitle: (code: string) => t("policy.permissions.confirmTitle", { code }),
        confirmBody: t("policy.permissions.confirmBody"),
        confirmAction: t("policy.permissions.confirmAction"),
        cancel: t("policy.permissions.cancel"),
        deleting: t("policy.permissions.deleting"),
        refusedTitle: (code: string) => t("policy.permissions.refusedTitle", { code }),
        emptyTitle: t("policy.permissions.emptyTitle"),
        emptyBody: t("policy.permissions.emptyBody"),
      },

      createRole: {
        newRole: t("policy.createRole.newRole"),
        title: t("policy.createRole.title"),
        description: t("policy.createRole.description"),
        label: t("policy.createRole.label"),
        labelHi: t("policy.createRole.labelHi"),
        code: t("policy.createRole.code"),
        codeHint: t("policy.createRole.codeHint"),
        copyFrom: t("policy.createRole.copyFrom"),
        copyNone: t("policy.createRole.copyNone"),
        create: t("policy.createRole.create"),
        creating: t("policy.createRole.creating"),
        cancel: t("policy.createRole.cancel"),
        failedTitle: t("policy.createRole.failedTitle"),
        labelRequired: t("policy.createRole.labelRequired"),
        codeInvalid: t("policy.createRole.codeInvalid"),
      },

      grants: {
        title: t("policy.grants.title"),
        subtitle: t("policy.grants.subtitle"),
        roleColumn: t("policy.grants.roleColumn"),
        inactiveRole: t("policy.grants.inactiveRole"),
        granted: t("policy.grants.granted"),
        notGranted: t("policy.grants.notGranted"),
        cell: (permission: string, role: string) =>
          t("policy.grants.cell", { permission, role }),
        sharedScreen: t("policy.grants.sharedScreen"),
        screenClosedHint: t("policy.grants.screenClosedHint"),
        roleTotal: (value: number, total: number) =>
          t("policy.grants.roleTotal", { n: n(value), total: n(total) }),
        changedBadge: t("policy.grants.changedBadge"),
        fullSetNote: t("policy.grants.fullSetNote"),
        noChanges: t("policy.grants.noChanges"),
        changeCount: (changes: number, roles: number) =>
          t("policy.grants.changeCount", { changes: n(changes), roles: n(roles) }),
        reviewTitle: t("policy.grants.reviewTitle"),
        added: (role: string, permission: string) =>
          t("policy.grants.added", { role, permission }),
        removed: (role: string, permission: string) =>
          t("policy.grants.removed", { role, permission }),
        save: t("policy.grants.save"),
        saving: t("policy.grants.saving"),
        discard: t("policy.grants.discard"),
        lockoutHint: t("policy.grants.lockoutHint"),
        lockoutTitle: t("policy.grants.lockoutTitle"),
        lockoutBody: (role: string) => t("policy.grants.lockoutBody", { role }),
        lockoutFix: t("policy.grants.lockoutFix"),
        partialTitle: (role: string) => t("policy.grants.partialTitle", { role }),
        partialBody: (saved: string, role: string) =>
          t("policy.grants.partialBody", { saved, role }),
        failedTitle: (role: string) => t("policy.grants.failedTitle", { role }),
        openRole: (role: string) => t("policy.grants.openRole", { role }),
        closeRole: t("policy.grants.closeRole"),
        narrowHint: t("policy.grants.narrowHint"),
        bandTotal: (band: string, value: number, total: number) =>
          t("policy.grants.bandTotal", { band, n: n(value), total: n(total) }),
        scrollHint: t("policy.grants.scrollHint"),
      },

      transitions: {
        title: t("policy.transitions.title"),
        subtitle: t("policy.transitions.subtitle"),
        count: (value: number) => t("policy.transitions.count", { n: n(value) }),
        columns: {
          stage: t("policy.transitions.columns.stage"),
          action: t("policy.transitions.columns.action"),
          from: t("policy.transitions.columns.from"),
          to: t("policy.transitions.columns.to"),
          permission: t("policy.transitions.columns.permission"),
          requires: t("policy.transitions.columns.requires"),
          rules: t("policy.transitions.columns.rules"),
          edit: t("policy.transitions.columns.edit"),
        },
        stage: (value: number) => t("policy.transitions.stage", { n: n(value) }),
        initialStatus: t("policy.transitions.initialStatus"),
        assigneeOnly: t("policy.transitions.assigneeOnly"),
        assigneeOnlyOff: t("policy.transitions.assigneeOnlyOff"),
        opensRound: t("policy.transitions.opensRound"),
        active: t("policy.transitions.active"),
        inactive: t("policy.transitions.inactive"),
        noHolders: t("policy.transitions.noHolders"),
        holdersLabel: t("policy.transitions.holdersLabel"),
        noRequires: t("policy.transitions.noRequires"),
        noteLabel: t("policy.transitions.noteLabel"),
        noNote: t("policy.transitions.noNote"),
        edit: t("policy.transitions.edit"),
        editLabel: (action: string) => t("policy.transitions.editLabel", { action }),
        fixedTitle: t("policy.transitions.fixedTitle"),
        fixedBody: t("policy.transitions.fixedBody"),
        permissionLabel: t("policy.transitions.permissionLabel"),
        permissionHint: t("policy.transitions.permissionHint"),
        permissionPlaceholder: t("policy.transitions.permissionPlaceholder"),
        holdersNow: t("policy.transitions.holdersNow"),
        unknownPermission: (code: string) =>
          t("policy.transitions.unknownPermission", { code }),
        requiresLabel: t("policy.transitions.requiresLabel"),
        requiresHint: t("policy.transitions.requiresHint"),
        requiresAdd: t("policy.transitions.requiresAdd"),
        requiresPlaceholder: t("policy.transitions.requiresPlaceholder"),
        requiresInvalid: t("policy.transitions.requiresInvalid"),
        requiresRemove: (field: string) => t("policy.transitions.requiresRemove", { field }),
        assigneeOnlyLabel: t("policy.transitions.assigneeOnlyLabel"),
        assigneeOnlyHint: t("policy.transitions.assigneeOnlyHint"),
        activeLabel: t("policy.transitions.activeLabel"),
        activeHint: t("policy.transitions.activeHint"),
        noteEditLabel: t("policy.transitions.noteEditLabel"),
        noteEditHint: t("policy.transitions.noteEditHint"),
        cancel: t("policy.transitions.cancel"),
        review: t("policy.transitions.review"),
        noChanges: t("policy.transitions.noChanges"),
        confirmTitle: t("policy.transitions.confirmTitle"),
        confirmBody: t("policy.transitions.confirmBody"),
        confirmAction: t("policy.transitions.confirmAction"),
        confirming: t("policy.transitions.confirming"),
        changePermission: (action: string, permission: string, code: string) =>
          t("policy.transitions.changePermission", { action, permission, code }),
        changeHolderAdded: (role: string, action: string) =>
          t("policy.transitions.changeHolderAdded", { role, action }),
        changeHolderRemoved: (role: string, action: string) =>
          t("policy.transitions.changeHolderRemoved", { role, action }),
        changeHoldersSame: t("policy.transitions.changeHoldersSame"),
        changeAssigneeOnlyOn: (action: string) =>
          t("policy.transitions.changeAssigneeOnlyOn", { action }),
        changeAssigneeOnlyOff: (action: string) =>
          t("policy.transitions.changeAssigneeOnlyOff", { action }),
        changeActiveOff: (action: string) =>
          t("policy.transitions.changeActiveOff", { action }),
        changeActiveOn: t("policy.transitions.changeActiveOn"),
        changeRequiresAdded: (field: string, action: string) =>
          t("policy.transitions.changeRequiresAdded", { field, action }),
        changeRequiresRemoved: (field: string, action: string) =>
          t("policy.transitions.changeRequiresRemoved", { field, action }),
        changeNote: t("policy.transitions.changeNote"),
        nobodyWarning: (action: string) =>
          t("policy.transitions.nobodyWarning", { action }),
        refusedTitle: t("policy.transitions.refusedTitle"),
        emptyTitle: t("policy.transitions.emptyTitle"),
        emptyBody: t("policy.transitions.emptyBody"),
        flowchart: {
          title: t("policy.transitions.flowchart.title"),
          hint: t("policy.transitions.flowchart.hint"),
          ariaLabel: (statuses: number, steps: number) =>
            t("policy.transitions.flowchart.ariaLabel", { statuses: n(statuses), steps: n(steps) }),
          start: t("policy.transitions.flowchart.start"),
          end: t("policy.transitions.flowchart.end"),
          nobody: t("policy.transitions.flowchart.nobody"),
          legendStart: t("policy.transitions.flowchart.legendStart"),
          legendEnd: t("policy.transitions.flowchart.legendEnd"),
          legendBack: t("policy.transitions.flowchart.legendBack"),
          legendOff: t("policy.transitions.flowchart.legendOff"),
          layoutLabel: t("policy.transitions.flowchart.layoutLabel"),
          layoutVertical: t("policy.transitions.flowchart.layoutVertical"),
          layoutHorizontal: t("policy.transitions.flowchart.layoutHorizontal"),
          nodeAria: (status: string, out: number, into: number) =>
            t("policy.transitions.flowchart.nodeAria", { status, out: n(out), in: n(into) }),
          edgeAria: (action: string, from: string, to: string, roles: string) =>
            t("policy.transitions.flowchart.edgeAria", { action, from, to, roles }),
          filterNode: (value: number, status: string) =>
            t("policy.transitions.flowchart.filterNode", { n: n(value), status }),
          filterEdge: (value: number, from: string, to: string) =>
            t("policy.transitions.flowchart.filterEdge", { n: n(value), from, to }),
          showAll: t("policy.transitions.flowchart.showAll"),
          nodeHelp: t("policy.transitions.flowchart.nodeHelp"),
          edgeHelp: t("policy.transitions.flowchart.edgeHelp"),
          controls: t("policy.transitions.flowchart.controls"),
          zoomIn: t("policy.transitions.flowchart.zoomIn"),
          zoomOut: t("policy.transitions.flowchart.zoomOut"),
          fitView: t("policy.transitions.flowchart.fitView"),
        },
      },
    }),
    [t, n],
  );
}
