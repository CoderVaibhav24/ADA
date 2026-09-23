/**
 * `notices.*`, `noticeNew.*` and `noticeDetail.*`, typed, for this feature only.
 *
 * It lives in the feature folder rather than in `src/i18n/labels.ts` because
 * that module is the shared surface — the hooks more than one feature renders —
 * and the three notice screens were built in one pass. What only they read
 * belongs next to them, exactly as `features/inspections/detailLabels.ts` and
 * `findingsLabels.ts` already do.
 *
 * The shared vocabularies are NOT re-derived here. The grid's own strings, the
 * paginator's, the case statuses and the chip labels all have hooks in
 * `@/i18n/labels` already, and a second copy of any of them would drift.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { NOTICE_STATUSES, type NoticeStatus } from "@/api/icms/notices";
import type { DataTableLabels } from "@/components/data-table/types";
import { formatNumber, useLanguage } from "@/i18n";
import { useDataTableLabels } from "@/i18n/labels";
import type { NoticeProblem } from "./noticeForm";

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

/* ---- the five API statuses ------------------------------------------------ */

/**
 * `icms_notice.status`, translated.
 *
 * Its own five labels rather than the chip vocabulary's: `status.*` holds the
 * words Figma drew on three different registers, and only one of them — ISSUED
 * — is a value this column can hold. See `noticeStatus.ts`.
 */
export function useNoticeStatusLabels(): Record<NoticeStatus, string> {
  const { t } = useI18n();
  return useMemo(() => {
    const out = {} as Record<NoticeStatus, string>;
    for (const status of NOTICE_STATUSES) out[status] = t(`notices.status.${status}`);
    return out;
  }, [t]);
}

/* ---- the register --------------------------------------------------------- */

export type NoticeColumnId =
  | "notice_ref"
  | "case_ref"
  | "act_cd"
  | "property_address"
  | "issued_at"
  | "compliance_due"
  | "status"
  | "issued_by"
  | "zone_cd"
  | "actions";

export type NoticesLabels = {
  title: string;
  subtitle: string;
  back: string;
  export: string;
  /** The register's one primary action — see NoticesRegister's module comment. */
  issue: string;
  registerTitle: string;
  recordCount: (shown: number, total: number) => string;

  columns: Record<
    | "noticeRef"
    | "caseRef"
    | "act"
    | "location"
    | "issued"
    | "due"
    | "status"
    | "issuedBy"
    | "zone"
    | "actions",
    string
  >;

  searchLabel: string;
  searchPlaceholder: string;
  facetStatus: string;
  facetAct: string;
  facetZone: string;

  issuedRangeAny: string;
  issuedRangeValue: (from: string, to: string) => string;
  issuedRangeFrom: (from: string) => string;
  issuedRangeClear: string;
  caseFilter: (ref: string) => string;
  caseFilterClear: string;

  /** Sections cited, e.g. "s. 14, 28-A". Prefixed so a bare number is not a count. */
  sectionList: (sections: string) => string;
  noSections: string;
  notRecorded: string;
  notIssued: string;
  noDueDate: string;

  /** The DERIVED marker. See noticeModel.isOverdue — not an API status. */
  overdue: string;
  overdueBy: (days: number) => string;
  dueToday: string;
  dueInDays: (days: number) => string;

  view: string;
  print: string;
  printUnavailable: string;
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

  gate: { checking: string; deniedTitle: string; deniedBody: string };
};

/** Memoised on `t`, so a re-render does not rebuild ten column definitions. */
export function useNoticesLabels(): NoticesLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      title: t("notices.title"),
      subtitle: t("notices.subtitle"),
      back: t("notices.back"),
      export: t("notices.export"),
      issue: t("notices.issue"),
      registerTitle: t("notices.registerTitle"),
      recordCount: (shown: number, total: number) =>
        t("notices.recordCount", { shown: n(shown), total: n(total) }),

      columns: {
        noticeRef: t("notices.columns.noticeRef"),
        caseRef: t("notices.columns.caseRef"),
        act: t("notices.columns.act"),
        location: t("notices.columns.location"),
        issued: t("notices.columns.issued"),
        due: t("notices.columns.due"),
        status: t("notices.columns.status"),
        issuedBy: t("notices.columns.issuedBy"),
        zone: t("notices.columns.zone"),
        actions: t("notices.columns.actions"),
      },

      searchLabel: t("notices.searchLabel"),
      searchPlaceholder: t("notices.searchPlaceholder"),
      facetStatus: t("notices.facetStatus"),
      facetAct: t("notices.facetAct"),
      facetZone: t("notices.facetZone"),

      issuedRangeAny: t("notices.issuedRangeAny"),
      issuedRangeValue: (from: string, to: string) =>
        t("notices.issuedRangeValue", { from, to }),
      issuedRangeFrom: (from: string) => t("notices.issuedRangeFrom", { from }),
      issuedRangeClear: t("notices.issuedRangeClear"),
      caseFilter: (ref: string) => t("notices.caseFilter", { ref }),
      caseFilterClear: t("notices.caseFilterClear"),

      sectionList: (sections: string) => t("notices.sectionList", { sections }),
      noSections: t("notices.noSections"),
      notRecorded: t("notices.notRecorded"),
      notIssued: t("notices.notIssued"),
      noDueDate: t("notices.noDueDate"),

      overdue: t("notices.overdue"),
      overdueBy: (days: number) => t("notices.overdueBy", { n: n(days) }),
      dueToday: t("notices.dueToday"),
      dueInDays: (days: number) => t("notices.dueInDays", { n: n(days) }),

      view: t("notices.view"),
      print: t("notices.print"),
      printUnavailable: t("notices.printUnavailable"),
      openCase: (ref: string) => t("notices.openCase", { ref }),

      exportSelected: t("notices.exportSelected"),
      // ASCII in both languages, for the same reason as the other two exports.
      exportFilename: (isoDate: string) => t("notices.exportFilename", { date: isoDate }),
      exportProgress: (done: number, total: number) =>
        t("notices.exportProgress", { done: n(done), total: n(total) }),
      exportTruncated: (rows: number) => t("notices.exportTruncated", { rows: n(rows) }),
      exportFailed: t("notices.exportFailed"),

      emptyTitle: t("notices.emptyTitle"),
      emptyBody: t("notices.emptyBody"),
      noResultsTitle: t("notices.noResultsTitle"),
      noResultsBody: t("notices.noResultsBody"),
      noResultsAction: t("notices.noResultsAction"),
      errorTitle: t("notices.errorTitle"),
      errorBody: t("notices.errorBody"),
      errorRetry: t("notices.errorRetry"),
      loading: t("notices.loading"),

      resultsAnnouncement: (total: number) =>
        total === 0
          ? t("notices.resultsNone")
          : t("notices.resultsCount", { n: n(total) }),

      gate: {
        checking: t("notices.gate.checking"),
        deniedTitle: t("notices.gate.deniedTitle"),
        deniedBody: t("notices.gate.deniedBody"),
      },
    }),
    [t, n],
  );
}

/** The grid's own strings, with this register's wording where it differs. */
export function useNoticesGridLabels(): DataTableLabels {
  const base = useDataTableLabels();
  const labels = useNoticesLabels();
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

/* ---- Notice Create -------------------------------------------------------- */

export type NoticeNewLabels = {
  title: string;
  subtitle: string;
  back: string;
  formTitle: string;
  submit: string;
  submitting: string;
  cancel: string;
  required: string;

  caseLabel: string;
  caseHint: string;
  casePlaceholder: string;
  actLabel: string;
  actHint: string;
  actPlaceholder: string;
  actUnavailable: string;
  sectionsLabel: string;
  sectionsHint: string;
  sectionsNoAct: string;
  sectionsUnavailable: string;
  sectionsChosen: (n: number) => string;
  dueLabel: string;
  dueHint: string;
  duePlaceholder: string;
  dueClear: string;
  authorityLabel: string;
  authorityHint: string;
  authorityPlaceholder: string;
  groundsLabel: string;
  groundsHint: string;
  groundsPlaceholder: string;
  charactersLeft: (n: number) => string;

  /** The case as the server reports it — read-only, never posted from here. */
  caseSummary: {
    title: string;
    hint: string;
    status: string;
    address: string;
    khasra: string;
    zone: string;
    complainant: string;
    absent: string;
    loading: string;
    errorTitle: string;
    errorBody: string;
    notFoundTitle: string;
    notFoundBody: string;
  };

  template: {
    title: string;
    intro: string;
    items: readonly string[];
    provisional: string;
  };

  gate: {
    checking: string;
    /** `issue_notice` was not offered on this case, for this caller. */
    deniedTitle: string;
    deniedBody: string;
    noCaseTitle: string;
    noCaseBody: string;
  };

  refusedTitle: string;
  requestId: string;
  problems: Record<NoticeProblem, string>;

  discardTitle: string;
  discardBody: string;
  discardConfirm: string;
  discardCancel: string;
};

export function useNoticeNewLabels(): NoticeNewLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      title: t("noticeNew.title"),
      subtitle: t("noticeNew.subtitle"),
      back: t("noticeNew.back"),
      formTitle: t("noticeNew.formTitle"),
      submit: t("noticeNew.submit"),
      submitting: t("noticeNew.submitting"),
      cancel: t("noticeNew.cancel"),
      required: t("noticeNew.required"),

      caseLabel: t("noticeNew.caseLabel"),
      caseHint: t("noticeNew.caseHint"),
      casePlaceholder: t("noticeNew.casePlaceholder"),
      actLabel: t("noticeNew.actLabel"),
      actHint: t("noticeNew.actHint"),
      actPlaceholder: t("noticeNew.actPlaceholder"),
      actUnavailable: t("noticeNew.actUnavailable"),
      sectionsLabel: t("noticeNew.sectionsLabel"),
      sectionsHint: t("noticeNew.sectionsHint"),
      sectionsNoAct: t("noticeNew.sectionsNoAct"),
      sectionsUnavailable: t("noticeNew.sectionsUnavailable"),
      sectionsChosen: (count: number) => t("noticeNew.sectionsChosen", { n: n(count) }),
      dueLabel: t("noticeNew.dueLabel"),
      dueHint: t("noticeNew.dueHint"),
      duePlaceholder: t("noticeNew.duePlaceholder"),
      dueClear: t("noticeNew.dueClear"),
      authorityLabel: t("noticeNew.authorityLabel"),
      authorityHint: t("noticeNew.authorityHint"),
      authorityPlaceholder: t("noticeNew.authorityPlaceholder"),
      groundsLabel: t("noticeNew.groundsLabel"),
      groundsHint: t("noticeNew.groundsHint"),
      groundsPlaceholder: t("noticeNew.groundsPlaceholder"),
      charactersLeft: (count: number) => t("noticeNew.charactersLeft", { n: n(count) }),

      caseSummary: {
        title: t("noticeNew.caseSummary.title"),
        hint: t("noticeNew.caseSummary.hint"),
        status: t("noticeNew.caseSummary.status"),
        address: t("noticeNew.caseSummary.address"),
        khasra: t("noticeNew.caseSummary.khasra"),
        zone: t("noticeNew.caseSummary.zone"),
        complainant: t("noticeNew.caseSummary.complainant"),
        absent: t("noticeNew.caseSummary.absent"),
        loading: t("noticeNew.caseSummary.loading"),
        errorTitle: t("noticeNew.caseSummary.errorTitle"),
        errorBody: t("noticeNew.caseSummary.errorBody"),
        notFoundTitle: t("noticeNew.caseSummary.notFoundTitle"),
        notFoundBody: t("noticeNew.caseSummary.notFoundBody"),
      },

      template: {
        title: t("noticeNew.template.title"),
        intro: t("noticeNew.template.intro"),
        items: [
          t("noticeNew.template.letterhead"),
          t("noticeNew.template.number"),
          t("noticeNew.template.legal"),
          t("noticeNew.template.property"),
          t("noticeNew.template.compliance"),
          t("noticeNew.template.seal"),
          t("noticeNew.template.acknowledgement"),
        ],
        provisional: t("noticeNew.template.provisional"),
      },

      gate: {
        checking: t("noticeNew.gate.checking"),
        deniedTitle: t("noticeNew.gate.deniedTitle"),
        deniedBody: t("noticeNew.gate.deniedBody"),
        noCaseTitle: t("noticeNew.gate.noCaseTitle"),
        noCaseBody: t("noticeNew.gate.noCaseBody"),
      },

      refusedTitle: t("noticeNew.refusedTitle"),
      requestId: t("noticeNew.requestId"),
      problems: {
        caseRequired: t("noticeNew.problems.caseRequired"),
        actRequired: t("noticeNew.problems.actRequired"),
        sectionsRequired: t("noticeNew.problems.sectionsRequired"),
        tooManySections: t("noticeNew.problems.tooManySections"),
        dueMalformed: t("noticeNew.problems.dueMalformed"),
        duePast: t("noticeNew.problems.duePast"),
        authorityTooLong: t("noticeNew.problems.authorityTooLong"),
        groundsTooLong: t("noticeNew.problems.groundsTooLong"),
      },

      discardTitle: t("noticeNew.discardTitle"),
      discardBody: t("noticeNew.discardBody"),
      discardConfirm: t("noticeNew.discardConfirm"),
      discardCancel: t("noticeNew.discardCancel"),
    }),
    [t, n],
  );
}

/* ---- Notice detail -------------------------------------------------------- */

export type NoticeDetailLabels = {
  back: string;
  subtitle: (caseRef: string) => string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  notFoundTitle: string;
  notFoundBody: string;
  requestId: string;

  summary: {
    title: string;
    noticeRef: string;
    caseRef: string;
    inspectionRef: string;
    act: string;
    sections: string;
    issuedBy: string;
    issuedAt: string;
    complianceDue: string;
    zone: string;
    address: string;
    authority: string;
    checksum: string;
    absent: string;
  };

  document: {
    title: string;
    hint: string;
    opening: string;
    download: string;
    unavailableTitle: string;
    unavailableBody: string;
    errorTitle: string;
    frameTitle: (ref: string) => string;
  };

  body: { title: string; hint: string; empty: string };

  /** Says plainly that delivery is not tracked here, and who owns it. */
  delivery: { title: string; body: string };

  openCase: string;
  overdue: string;
  overdueBy: (days: number) => string;
};

export function useNoticeDetailLabels(): NoticeDetailLabels {
  const { t, n } = useI18n();
  return useMemo(
    () => ({
      back: t("noticeDetail.back"),
      subtitle: (caseRef: string) => t("noticeDetail.subtitle", { caseRef }),
      loading: t("noticeDetail.loading"),
      errorTitle: t("noticeDetail.errorTitle"),
      errorBody: t("noticeDetail.errorBody"),
      errorRetry: t("noticeDetail.errorRetry"),
      notFoundTitle: t("noticeDetail.notFoundTitle"),
      notFoundBody: t("noticeDetail.notFoundBody"),
      requestId: t("noticeDetail.requestId"),

      summary: {
        title: t("noticeDetail.summary.title"),
        noticeRef: t("noticeDetail.summary.noticeRef"),
        caseRef: t("noticeDetail.summary.caseRef"),
        inspectionRef: t("noticeDetail.summary.inspectionRef"),
        act: t("noticeDetail.summary.act"),
        sections: t("noticeDetail.summary.sections"),
        issuedBy: t("noticeDetail.summary.issuedBy"),
        issuedAt: t("noticeDetail.summary.issuedAt"),
        complianceDue: t("noticeDetail.summary.complianceDue"),
        zone: t("noticeDetail.summary.zone"),
        address: t("noticeDetail.summary.address"),
        authority: t("noticeDetail.summary.authority"),
        checksum: t("noticeDetail.summary.checksum"),
        absent: t("noticeDetail.summary.absent"),
      },

      document: {
        title: t("noticeDetail.document.title"),
        hint: t("noticeDetail.document.hint"),
        opening: t("noticeDetail.document.opening"),
        download: t("noticeDetail.document.download"),
        unavailableTitle: t("noticeDetail.document.unavailableTitle"),
        unavailableBody: t("noticeDetail.document.unavailableBody"),
        errorTitle: t("noticeDetail.document.errorTitle"),
        frameTitle: (ref: string) => t("noticeDetail.document.frameTitle", { ref }),
      },

      body: {
        title: t("noticeDetail.body.title"),
        hint: t("noticeDetail.body.hint"),
        empty: t("noticeDetail.body.empty"),
      },

      delivery: {
        title: t("noticeDetail.delivery.title"),
        body: t("noticeDetail.delivery.body"),
      },

      openCase: t("noticeDetail.openCase"),
      overdue: t("noticeDetail.overdue"),
      overdueBy: (days: number) => t("noticeDetail.overdueBy", { n: n(days) }),
    }),
    [t, n],
  );
}
