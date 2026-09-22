/**
 * SEED DICTIONARY for the Complaints register.
 *
 * Nothing in this screen holds a literal string. Column headers, chip labels,
 * facet triggers, the empty-state copy and the two row-action verbs all arrive
 * from here, so a translator reaches every one of them by opening one file
 * instead of grepping the JSX.
 *
 * The strings marked FIGMA are transcribed verbatim from node 29:1219,
 * including its casing. Everything else is written for this build: Figma
 * designs no empty state, no error state, no sort control and no column
 * chooser, so it supplies no words for any of them.
 *
 * Uppercase is NOT baked in. Figma renders the column headers, the priority and
 * the row actions in capitals; that is `text-transform` in the component, so
 * Devanagari — which has no case — is unaffected, and an English label is not
 * shouted at a translator who then has to guess whether the capitals carry
 * meaning.
 *
 * i18n key namespace: `complaints.*`, plus `caseStatus.*` and `parcel.*` which
 * are shared with the other case screens.
 */

import type { CaseStatus } from "@/api/icms/cases";
import type { PriorityValue } from "@/components/icms/status";
import { dataTableLabelsEn } from "@/components/data-table/labels.en";
import type { DataTableLabels } from "@/components/data-table/types";

/** `caseStatus.*`. One label per API status — see caseStatus.ts for why. */
export const CASE_STATUS_LABELS_EN: Record<CaseStatus, string> = {
  raised: "Complaint Filed", // FIGMA
  assigned: "Pending Inspection", // FIGMA
  under_inspection: "Under Inspection",
  inspection_submitted: "Inspection Submitted",
  resurvey_requested: "Resurvey Requested",
  verified: "Verified",
  handed_over: "Handed Over",
  confirmed: "Confirmed",
  notice_issued: "Notice Issued", // FIGMA
  closed: "Closed", // FIGMA
  rejected: "Rejected",
};

/** `priority.*`. Lower-case values, title-case labels, capitals from CSS. */
export const CASE_PRIORITY_LABELS_EN: Record<PriorityValue, string> = {
  high: "High", // FIGMA renders HIGH
  medium: "Medium",
  low: "Low", // FIGMA renders LOW
};

/** `parcel.*`. The caption under the Parcel ID value. See parcelId.ts. */
export const PARCEL_KIND_LABELS_EN: Record<string, string> = {
  "parcel.ulpin": "ULPIN",
  "parcel.khasra": "Khasra",
  "parcel.none": "Not recorded",
};

export const complaintsLabelsEn = {
  // ---- page furniture (all FIGMA) ----
  title: "Complaints",
  subtitle: "Track & manage all complaints",
  back: "Back",
  export: "Export",
  newComplaint: "New Complaint",
  registerTitle: "Complaints Register",
  /** FIGMA writes "8 of 8 records"; on real data the two numbers differ. */
  recordCount: (shown: number, total: number) =>
    `${shown.toLocaleString()} of ${total.toLocaleString()} records`,

  // ---- columns, verbatim from the design, in the design's order ----
  columns: {
    caseRef: "Complaint ID",
    parcelId: "Parcel ID",
    location: "Location",
    complainant: "Complainant",
    complaintType: "Complaint Type",
    area: "Area",
    priority: "Priority",
    status: "Status",
    filed: "Filed",
    actions: "Actions",
    // Not in the design. Hidden by default, offered in the column chooser, and
    // the only way to reach the `zone_cd`, `ulpin`, `khasra_no` and `stage_no`
    // sort keys the API exposes.
    zone: "Zone",
    ulpin: "ULPIN",
    khasra: "Khasra No.",
    stage: "Stage",
  },

  // ---- filter row ----
  searchLabel: "Search complaints",
  searchPlaceholder: "Search parcel / Khasra No.", // FIGMA
  facetComplaintType: "Complaint Type", // FIGMA
  facetPriority: "All Priorities", // FIGMA
  facetStatus: "All Statuses", // FIGMA
  facetZone: "All Zones",

  // ---- cells ----
  /** Figma writes "482 sq.m". The unit is a word and is translated with it. */
  area: (value: string) => `${value} sq.m`,
  areaUnknown: "Not surveyed",
  notRecorded: "—",
  stage: (n: number) => `Stage ${n}`,

  // ---- row actions ----
  view: "View", // FIGMA renders VIEW
  assignInspection: "Assign Inspection", // FIGMA renders ASSIGN INSPECTION
  assigned: "Assigned", // FIGMA renders the disabled state as ASSIGNED
  assignedReason: "An inspection is already assigned on this case.",

  // ---- bulk ----
  exportSelected: "Export selected",

  // ---- states Figma does not design ----
  emptyTitle: "No complaints yet",
  emptyBody:
    "Complaints filed by the public, raised from a change detection, or reported from the field will appear here.",
  emptyAction: "New Complaint",
  noResultsTitle: "No complaints match these filters",
  noResultsBody: "Try a different search term, or clear the filters to see the whole register.",
  noResultsAction: "Clear filters",
  errorTitle: "The register could not be loaded",
  errorBody: "The request did not complete. Quote the reference below if you report this.",
  errorRetry: "Try again",
  loading: "Loading complaints",

  // ---- export ----
  exportFilename: (isoDate: string) => `complaints-${isoDate}.csv`,
  exportProgress: (done: number, total: number) =>
    `${done.toLocaleString()} of ${total.toLocaleString()}`,
  exportTruncated: (rows: number) =>
    `Exported the first ${rows.toLocaleString()} rows. Narrow the filters for a smaller file.`,
  exportFailed: "The export could not be completed.",

  // ---- announcements ----
  resultsAnnouncement: (total: number) =>
    total === 0 ? "No complaints match" : `${total.toLocaleString()} complaints`,
} as const;

/** The grid's own strings, with this register's wording where it differs. */
export const complaintsGridLabelsEn: DataTableLabels = {
  ...dataTableLabelsEn,
  grid: complaintsLabelsEn.registerTitle,
  searchLabel: complaintsLabelsEn.searchLabel,
  searchPlaceholder: complaintsLabelsEn.searchPlaceholder,
  selectRow: (id) => `Select complaint ${id}`,
  loading: complaintsLabelsEn.loading,
  resultsAnnouncement: complaintsLabelsEn.resultsAnnouncement,
};
