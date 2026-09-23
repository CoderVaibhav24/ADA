/**
 * The Complaints register's columns.
 *
 * Ten columns, in the design's order, with the design's headers. Four more are
 * declared after them and hidden by default — Zone, ULPIN, Khasra No. and
 * Stage. They are not an invention: the API exposes `zone_cd`, `ulpin`,
 * `khasra_no` and `stage_no` as sort keys, and with no column to hang a sort
 * control on, four of its twelve sortable fields would be unreachable. Hidden
 * by default, so the register opens exactly as Figma draws it.
 *
 * `Area` and `Actions` carry no `sortKey` and therefore render no sort control.
 * For `Area` that is a database fact rather than a preference: the value comes
 * from a correlated scalar subquery over the latest inspection round, and
 * ordering by it would mean joining the rounds, which multiplies a case across
 * the page once it has been inspected twice.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { formatIstDate } from "@ada/shared/dates";
import type { CaseRow, CaseStatus } from "@/api/icms/cases";
import { DataTableRowActions } from "@/components/data-table/DataTable";
import type { DataTableColumnMeta, RowAction } from "@/components/data-table/types";
import { PriorityChip, StatusChip } from "@/components/icms/StatusChip";
import type { PriorityValue } from "@/components/icms/status";
import type { ComplaintsLabels } from "@/i18n/labels";
import { CASE_STATUS_META, toCaseStatus, toPriority } from "./caseStatus";
import { parcelIdForExport, resolveParcelId } from "./parcelId";

type Labels = ComplaintsLabels;

export type ComplaintColumnOptions = {
  labels: Labels;
  /** The API's own status vocabulary, translated. See caseStatus.ts. */
  statusLabels: Record<CaseStatus, string>;
  priorityLabels: Record<PriorityValue, string>;
  /** Keyed by `ParcelIdentity.kindKey`. */
  parcelKindLabels: Record<string, string>;
  /** BCP-47 tag, e.g. `en-IN` / `hi-IN-u-nu-latn`. Drives numbers and dates. */
  locale: string;
  onView: (row: CaseRow) => void;
  onAssign: (row: CaseRow) => void;
};

function meta(value: DataTableColumnMeta<CaseRow>): DataTableColumnMeta<CaseRow> {
  return value;
}

function isoDate(value: string): string {
  return value.slice(0, 10);
}

function areaText(row: CaseRow, labels: Labels, locale: string): string {
  if (row.measured_area_sqm == null) return labels.areaUnknown;
  return labels.area(new Intl.NumberFormat(locale).format(row.measured_area_sqm));
}

export function buildComplaintColumns({
  labels,
  statusLabels,
  priorityLabels,
  parcelKindLabels,
  locale,
  onView,
  onAssign,
}: ComplaintColumnOptions): ColumnDef<CaseRow, unknown>[] {
  return [
    {
      id: "case_ref",
      header: labels.columns.caseRef,
      meta: meta({
        sortKey: "case_ref",
        menuLabel: labels.columns.caseRef,
        alwaysVisible: true,
        // Identity and state are what a register is scanned for, so they are the
        // two that stay in the table at 360px; the rest is one tap away.
        priority: "primary",
        minWidth: "8.5rem",
        exportValue: (row) => row.case_ref,
      }),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => {
            onView(row.original);
          }}
          // Wraps only below `md`, where the reference is competing with a status
          // chip for 250px; the wide layout keeps it on one line.
          className="rounded-xs text-start font-medium max-md:break-all text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {row.original.case_ref}
        </button>
      ),
    },

    {
      id: "parcel_id",
      header: labels.columns.parcelId,
      // Not sortable, deliberately: the value is a ULPIN for some rows and a
      // village/khasra pair for others, so one ORDER BY over it would be
      // ordering two different kinds of identifier together. Sort by the ULPIN
      // or Khasra No. column instead — both indexed, both one toggle away.
      meta: meta({
        menuLabel: labels.columns.parcelId,
        minWidth: "9rem",
        exportValue: parcelIdForExport,
      }),
      cell: ({ row }) => {
        const parcel = resolveParcelId(row.original);
        if (parcel.value === null) {
          return <span className="text-fg-faint">{labels.notRecorded}</span>;
        }
        return (
          <span className="flex flex-col">
            <span className="font-mono text-xs text-fg-strong">{parcel.value}</span>
            {/* Says WHICH identifier this is. Without it the column silently
                alternates between a 14-character ULPIN and a village/khasra
                pair, and reads as inconsistent data. */}
            <span className="text-2xs text-fg-faint">
              {parcelKindLabels[parcel.kindKey]}
            </span>
          </span>
        );
      },
    },

    {
      id: "property_address",
      header: labels.columns.location,
      meta: meta({
        sortKey: "property_address",
        menuLabel: labels.columns.location,
        minWidth: "13rem",
        exportValue: (row) => [row.property_address, row.landmark].filter(Boolean).join(", "),
      }),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="text-fg-base">
            {row.original.property_address ?? labels.notRecorded}
          </span>
          {row.original.landmark && (
            <span className="text-2xs text-fg-faint">{row.original.landmark}</span>
          )}
        </span>
      ),
    },

    {
      id: "complainant_name",
      header: labels.columns.complainant,
      meta: meta({
        sortKey: "complainant_name",
        menuLabel: labels.columns.complainant,
        minWidth: "9rem",
        exportValue: (row) => row.complainant_name ?? "",
      }),
      cell: ({ row }) => (
        <span className="text-fg-base">
          {row.original.complainant_name ?? labels.notRecorded}
        </span>
      ),
    },

    {
      id: "complaint_type_cd",
      header: labels.columns.complaintType,
      meta: meta({
        sortKey: "complaint_type_cd",
        menuLabel: labels.columns.complaintType,
        minWidth: "9rem",
        exportValue: (row) =>
          row.complaint_type_label ?? row.other_type ?? row.complaint_type_cd ?? "",
      }),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="text-fg-base">
            {row.original.complaint_type_label ??
              row.original.complaint_type_cd ??
              labels.notRecorded}
          </span>
          {/* `other_type` is the free text behind the `other` code and is the
              only thing that distinguishes two rows that both read "Other". */}
          {row.original.other_type && (
            <span className="text-2xs text-fg-faint">{row.original.other_type}</span>
          )}
        </span>
      ),
    },

    {
      id: "measured_area_sqm",
      header: labels.columns.area,
      meta: meta({
        menuLabel: labels.columns.area,
        align: "end",
        numeric: true,
        minWidth: "7rem",
        exportValue: (row) =>
          row.measured_area_sqm == null ? "" : String(row.measured_area_sqm),
      }),
      cell: ({ row }) => (
        <span
          className={row.original.measured_area_sqm == null ? "text-fg-faint" : "text-fg-base"}
        >
          {areaText(row.original, labels, locale)}
        </span>
      ),
    },

    {
      id: "priority",
      header: labels.columns.priority,
      meta: meta({
        // Sorts by URGENCY, not alphabetically — the server orders it
        // high/medium/low through a CASE expression, because sorting the raw
        // column gives high, low, medium.
        sortKey: "priority",
        menuLabel: labels.columns.priority,
        minWidth: "7rem",
        exportValue: (row) => row.priority ?? "",
      }),
      cell: ({ row }) => {
        const priority = toPriority(row.original.priority);
        if (!priority) return <span className="text-fg-faint">{labels.notRecorded}</span>;
        // `uppercase` is the chip's own CSS. The value stays lower case all the
        // way back to the API, which validates against ('high','medium','low').
        return (
          <PriorityChip priority={priority} uppercase>
            {priorityLabels[priority]}
          </PriorityChip>
        );
      },
    },

    {
      id: "status",
      header: labels.columns.status,
      meta: meta({
        sortKey: "status",
        menuLabel: labels.columns.status,
        priority: "primary",
        minWidth: "11rem",
        exportValue: (row) => row.status,
      }),
      cell: ({ row }) => {
        const status = toCaseStatus(row.original.status);
        if (!status) {
          // An unrecognised status is shown, not hidden: the raw value is what
          // a support ticket needs, and a blank cell tells nobody anything.
          return (
            <StatusChip status="unknown" uppercase>
              {row.original.status}
            </StatusChip>
          );
        }
        return (
          // The true API status stays in the DOM even though the chip is drawn
          // from the nearest Figma value — see caseStatus.ts.
          <span data-case-status={status}>
            <StatusChip status={CASE_STATUS_META[status].chip} uppercase>
              {statusLabels[status]}
            </StatusChip>
          </span>
        );
      },
    },

    {
      id: "raised_at",
      header: labels.columns.filed,
      meta: meta({
        sortKey: "raised_at",
        menuLabel: labels.columns.filed,
        minWidth: "8rem",
        exportValue: (row) => isoDate(row.raised_at),
      }),
      cell: ({ row }) => (
        <time dateTime={row.original.raised_at} className="text-fg-strong tabular">
          {formatIstDate(row.original.raised_at, locale)}
        </time>
      ),
    },

    {
      id: "actions",
      header: labels.columns.actions,
      meta: meta({
        menuLabel: labels.columns.actions,
        alwaysVisible: true,
        minWidth: "15rem",
        exportValue: () => "",
      }),
      cell: ({ row }) => {
        const record = row.original;
        // The register joins only the OPEN survey assignment, so a non-null
        // `assignee_user_id` means an inspection is live on this case right
        // now — which is exactly when Figma renders the disabled ASSIGNED pill.
        const alreadyAssigned = record.assignee_user_id != null;
        const actions: RowAction<CaseRow>[] = [
          { id: "view", label: labels.view, icon: "action.view", onSelect: onView },
          alreadyAssigned
            ? {
                id: "assign",
                label: labels.assigned,
                icon: "case.assigned",
                onSelect: onAssign,
                disabled: true,
                disabledReason: labels.assignedReason,
              }
            : {
                id: "assign",
                label: labels.assignInspection,
                icon: "case.assign",
                onSelect: onAssign,
                variant: "primary",
              },
        ];
        return <DataTableRowActions row={record} actions={actions} rowLabel={record.case_ref} />;
      },
    },

    /* ---- hidden by default -------------------------------------------- */

    {
      id: "zone_cd",
      header: labels.columns.zone,
      meta: meta({
        sortKey: "zone_cd",
        menuLabel: labels.columns.zone,
        minWidth: "8rem",
        exportValue: (row) => `${row.zone_cd} ${row.zone_name}`.trim(),
      }),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="text-fg-base">{row.original.zone_name}</span>
          <span className="font-mono text-2xs text-fg-faint">{row.original.zone_cd}</span>
        </span>
      ),
    },

    {
      id: "ulpin",
      header: labels.columns.ulpin,
      meta: meta({
        sortKey: "ulpin",
        menuLabel: labels.columns.ulpin,
        minWidth: "10rem",
        exportValue: (row) => row.ulpin ?? "",
      }),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-fg-base">
          {row.original.ulpin ?? labels.notRecorded}
        </span>
      ),
    },

    {
      id: "khasra_no",
      header: labels.columns.khasra,
      meta: meta({
        sortKey: "khasra_no",
        menuLabel: labels.columns.khasra,
        minWidth: "8rem",
        exportValue: (row) => row.khasra_no ?? "",
      }),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-fg-base">
          {row.original.khasra_no ?? labels.notRecorded}
        </span>
      ),
    },

    {
      id: "stage_no",
      header: labels.columns.stage,
      meta: meta({
        sortKey: "stage_no",
        menuLabel: labels.columns.stage,
        align: "end",
        numeric: true,
        minWidth: "6rem",
        exportValue: (row) => String(row.stage_no),
      }),
      cell: ({ row }) => (
        <span className="text-fg-base">{labels.stage(row.original.stage_no)}</span>
      ),
    },
  ];
}

/** Columns hidden until the officer asks for them in the column menu. */
export const COMPLAINT_DEFAULT_HIDDEN = ["zone_cd", "ulpin", "khasra_no", "stage_no"];
