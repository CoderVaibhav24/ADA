/**
 * The Inspections register's columns.
 *
 * Ten columns visible, four more declared after them and hidden by default —
 * Started, Submitted, Findings and Check-in. Hidden rather than dropped for the
 * same reason as the Complaints register's four: the API exposes `started_at`
 * and `submitted_at` as sort keys, and with no column to hang a sort control on
 * they would be unreachable.
 *
 * Two notes on Figma 31:2647's column set, both deliberate:
 *
 *   - **Round is a column the frame does not draw.** It is the one number that
 *     makes the re-survey loop legible: two rows on the same complaint are not
 *     a duplicate, they are round 1 and round 2, and without the column a
 *     register of a case that has been surveyed twice reads as corrupt data.
 *     It sits second, next to the identity, and is `primary` so it survives the
 *     narrow layout.
 *   - **Priority carries no sort control.** The frame draws the column and
 *     `InspectionRow` carries `priority` (contract amendment 4, joined from
 *     `icms_case.priority`), but the sort whitelist in contract §2 is the
 *     inspection's own nine fields and `priority` is not among them. A header
 *     that offered a sort the server answers with `unknown_sort_field` would be
 *     a broken control; the facet above the table is how the register narrows
 *     to one priority.
 *
 * `Evidence`, `Findings`, `Check-in` and `Actions` carry no `sortKey` and
 * therefore render no sort control. For the first three that is a database
 * fact rather than a preference: the values are correlated scalar subqueries
 * over the child tables, and ordering by them would mean joining those rows,
 * which multiplies one inspection across the page.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { formatIstDate } from "@ada/shared/dates";
import {
  toInspectionPriority,
  toInspectionStatus,
  type InspectionRow,
  type InspectionStatus,
} from "@/api/icms/inspections";
import { DataTableRowActions } from "@/components/data-table/DataTable";
import type { DataTableColumnMeta, RowAction } from "@/components/data-table/types";
import { PriorityChip, StatusChip } from "@/components/icms/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/lib/icons";
import type { InspectionsLabels } from "@/i18n/labels";
import { INSPECTION_STATUS_META } from "./inspectionStatus";
import type { InspectionPriorityLabels } from "./priorityLabels";

export type InspectionColumnOptions = {
  labels: InspectionsLabels;
  /** The API's own status vocabulary, translated. See inspectionStatus.ts. */
  statusLabels: Record<InspectionStatus, string>;
  /** The header, the facet and the three values — shared with Complaints. */
  priorityLabels: InspectionPriorityLabels;
  /** BCP-47 tag, e.g. `en-IN` / `hi-IN-u-nu-latn`. Drives numbers and dates. */
  locale: string;
  number: (value: number) => string;
  onView: (row: InspectionRow) => void;
  onOpenCase: (row: InspectionRow) => void;
};

function meta(value: DataTableColumnMeta<InspectionRow>): DataTableColumnMeta<InspectionRow> {
  return value;
}

function isoDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function buildInspectionColumns({
  labels,
  statusLabels,
  priorityLabels,
  locale,
  number,
  onView,
  onOpenCase,
}: InspectionColumnOptions): ColumnDef<InspectionRow, unknown>[] {
  // Shared by the three date columns: a null date is a state, not a blank cell.
  const dateCell = (value: string | null | undefined, absent: string) =>
    value == null ? (
      <span className="text-fg-faint">{absent}</span>
    ) : (
      <time dateTime={value} className="text-fg-strong tabular">
        {formatIstDate(value, locale)}
      </time>
    );

  return [
    {
      id: "inspection_ref",
      header: labels.columns.inspectionRef,
      meta: meta({
        sortKey: "inspection_ref",
        menuLabel: labels.columns.inspectionRef,
        alwaysVisible: true,
        // Identity, round and state are what a work list is scanned for, so
        // those three stay in the table at 360px; the rest is one tap away.
        priority: "primary",
        minWidth: "9rem",
        exportValue: (row) => row.inspection_ref,
      }),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => {
            onView(row.original);
          }}
          // Wraps only below `md`, where the reference competes with a status
          // chip for 250px; the wide layout keeps it on one line.
          className="rounded-xs text-start font-medium max-md:break-all text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {row.original.inspection_ref}
        </button>
      ),
    },

    {
      id: "round_no",
      header: labels.columns.round,
      meta: meta({
        sortKey: "round_no",
        menuLabel: labels.columns.round,
        priority: "primary",
        minWidth: "6.5rem",
        exportValue: (row) => String(row.round_no),
      }),
      cell: ({ row }) => (
        // A badge rather than a bare digit: "2" alone in a column is read as a
        // count of something, and this is an ordinal on a loop.
        <Badge variant="secondary" className="tabular">
          {labels.round(row.original.round_no)}
        </Badge>
      ),
    },

    {
      id: "case_ref",
      header: labels.columns.caseRef,
      meta: meta({
        sortKey: "case_ref",
        menuLabel: labels.columns.caseRef,
        minWidth: "10rem",
        exportValue: (row) => row.case_ref,
      }),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <button
            type="button"
            aria-label={labels.openCase(row.original.case_ref)}
            onClick={() => {
              onOpenCase(row.original);
            }}
            className="rounded-xs text-start font-medium max-md:break-all text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {row.original.case_ref}
          </button>
          {row.original.case_title && (
            <span className="text-2xs text-fg-faint">{row.original.case_title}</span>
          )}
        </span>
      ),
    },

    {
      id: "zone_cd",
      header: labels.columns.location,
      meta: meta({
        sortKey: "zone_cd",
        menuLabel: labels.columns.location,
        minWidth: "9rem",
        exportValue: (row) => [row.zone_name, row.zone_cd].filter(Boolean).join(" "),
      }),
      cell: ({ row }) =>
        row.original.zone_cd == null ? (
          <span className="text-fg-faint">{labels.notRecorded}</span>
        ) : (
          <span className="flex flex-col">
            <span className="text-fg-base">{row.original.zone_name ?? row.original.zone_cd}</span>
            <span className="font-mono text-2xs text-fg-faint">{row.original.zone_cd}</span>
          </span>
        ),
    },

    {
      id: "surveyor_user_id",
      header: labels.columns.surveyor,
      meta: meta({
        sortKey: "surveyor_user_id",
        menuLabel: labels.columns.surveyor,
        minWidth: "9rem",
        exportValue: (row) => row.surveyor_name ?? row.surveyor_user_id,
      }),
      cell: ({ row }) =>
        // The Keycloak subject is a UUID. Shown only when there is no name to
        // show, because an unattributable row is worse than an ugly one.
        row.original.surveyor_name ? (
          <span className="text-fg-base">{row.original.surveyor_name}</span>
        ) : (
          <span className="font-mono text-2xs break-all text-fg-faint">
            {row.original.surveyor_user_id}
          </span>
        ),
    },

    {
      id: "scheduled_for",
      header: labels.columns.scheduled,
      meta: meta({
        sortKey: "scheduled_for",
        menuLabel: labels.columns.scheduled,
        minWidth: "8rem",
        exportValue: (row) => isoDate(row.scheduled_for),
      }),
      cell: ({ row }) => dateCell(row.original.scheduled_for, labels.notScheduled),
    },

    {
      id: "priority",
      header: priorityLabels.column,
      meta: meta({
        // No `sortKey`, deliberately: `priority` is the CASE's column and the
        // register's whitelist (contract §2) does not include it, so the server
        // would answer `unknown_sort_field`.
        menuLabel: priorityLabels.column,
        minWidth: "7rem",
        exportValue: (row) => row.priority ?? "",
      }),
      cell: ({ row }) => {
        const priority = toInspectionPriority(row.original.priority);
        // A case with no priority set, or a value outside the three the CHECK
        // allows: the dash is the same "not recorded" the other columns use.
        if (!priority) return <span className="text-fg-faint">{labels.notRecorded}</span>;
        // The chip carries the word as well as the colour, and `uppercase` is
        // its own CSS — the value stays lower case all the way to the API.
        return (
          <PriorityChip priority={priority} uppercase>
            {priorityLabels.values[priority]}
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
        minWidth: "10rem",
        exportValue: (row) => row.status,
      }),
      cell: ({ row }) => {
        const status = toInspectionStatus(row.original.status);
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
          // from the nearest Figma value — see inspectionStatus.ts.
          <span data-inspection-status={status}>
            <StatusChip status={INSPECTION_STATUS_META[status].chip} uppercase>
              {statusLabels[status]}
            </StatusChip>
          </span>
        );
      },
    },

    {
      id: "evidence_count",
      header: labels.columns.evidence,
      meta: meta({
        menuLabel: labels.columns.evidence,
        align: "end",
        numeric: true,
        minWidth: "6.5rem",
        exportValue: (row) => String(row.evidence_count),
      }),
      cell: ({ row }) => (
        <span
          className={row.original.evidence_count === 0 ? "text-fg-faint" : "text-fg-base"}
        >
          {number(row.original.evidence_count)}
        </span>
      ),
    },

    {
      id: "actions",
      header: labels.columns.actions,
      meta: meta({
        menuLabel: labels.columns.actions,
        alwaysVisible: true,
        minWidth: "8rem",
        exportValue: () => "",
      }),
      cell: ({ row }) => {
        const record = row.original;
        // View only. Every write on an inspection is gated by the workflow for
        // the caller's roles in that row's status, and `available_actions` is
        // published on the DETAIL, not on a register row — so offering a write
        // here would mean guessing from a status string, which is the one thing
        // this codebase does not do.
        const actions: RowAction<InspectionRow>[] = [
          { id: "view", label: labels.view, icon: "action.view", onSelect: onView, variant: "primary" },
        ];
        return (
          <DataTableRowActions
            row={record}
            actions={actions}
            rowLabel={record.inspection_ref}
          />
        );
      },
    },

    /* ---- hidden by default -------------------------------------------- */

    {
      id: "started_at",
      header: labels.columns.started,
      meta: meta({
        sortKey: "started_at",
        menuLabel: labels.columns.started,
        minWidth: "8rem",
        exportValue: (row) => isoDate(row.started_at),
      }),
      cell: ({ row }) => dateCell(row.original.started_at, labels.notRecorded),
    },

    {
      id: "submitted_at",
      header: labels.columns.submitted,
      meta: meta({
        sortKey: "submitted_at",
        menuLabel: labels.columns.submitted,
        minWidth: "8rem",
        exportValue: (row) => isoDate(row.submitted_at),
      }),
      cell: ({ row }) => dateCell(row.original.submitted_at, labels.notRecorded),
    },

    {
      id: "finding_count",
      header: labels.columns.findings,
      meta: meta({
        menuLabel: labels.columns.findings,
        align: "end",
        numeric: true,
        minWidth: "6.5rem",
        exportValue: (row) => String(row.finding_count),
      }),
      cell: ({ row }) => (
        <span className={row.original.finding_count === 0 ? "text-fg-faint" : "text-fg-base"}>
          {number(row.original.finding_count)}
        </span>
      ),
    },

    {
      id: "has_check_in",
      header: labels.columns.checkIn,
      meta: meta({
        menuLabel: labels.columns.checkIn,
        minWidth: "8rem",
        exportValue: (row) => (row.has_check_in ? labels.checkedIn : labels.notCheckedIn),
      }),
      cell: ({ row }) => (
        // Words, not a tick: a glyph alone carries the state in colour and
        // shape only, and the CSV needs something to write either way.
        <span
          className={
            row.original.has_check_in
              ? "inline-flex items-center gap-1.5 text-fg-base"
              : "inline-flex items-center gap-1.5 text-fg-faint"
          }
        >
          <Icon
            name={row.original.has_check_in ? "inspection.checkIn" : "status.neutral"}
            className="size-3.5 shrink-0"
          />
          {row.original.has_check_in ? labels.checkedIn : labels.notCheckedIn}
        </span>
      ),
    },
  ];
}

/** Columns hidden until the officer asks for them in the column menu. */
export const INSPECTION_DEFAULT_HIDDEN = [
  "started_at",
  "submitted_at",
  "finding_count",
  "has_check_in",
];
