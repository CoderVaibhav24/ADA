/**
 * The Notices register's columns — Figma 67:1627.
 *
 * Eight visible, two more declared after them and hidden by default — Issued By
 * and Zone. Hidden rather than dropped for the same reason as the other two
 * registers' folded columns: the API exposes both as sort keys, and with no
 * column to hang a sort control on they would be unreachable.
 *
 * ## Three of Figma's ten columns are not here, and each absence is a shape
 *
 *   - **RECIPIENT.** `NoticeRow` carries no recipient. The person a notice is
 *     addressed to is the case's complainant-or-owner, joined from
 *     `icms_case`, and the contract does not publish it on the register row. A
 *     column would be a blank cell on every row; the case reference is one
 *     click from the person.
 *   - **RESPONDED.** The tick-and-cross column is delivery acknowledgement, and
 *     `deliveries` is always `[]` — the Parivartan App owns delivery tracking
 *     and every status after issue (build-order §3a). There is no field behind
 *     the control, so the control is not drawn.
 *   - **NOTICE TYPE.** The frame's "Notice to Vacate" is a type vocabulary that
 *     does not exist. What `icms_notice` stores is `act_cd` and `section_cds`,
 *     so the column shows the act with the sections it cites beneath it, which
 *     is the same information with a legal citation instead of a label.
 *
 * ## OVERDUE is a marker, not the status
 *
 * The frame draws OVERDUE as one of four status chips. It is not a value
 * `icms_notice.status` can hold — see `noticeStatus.ts` — so the status column
 * renders the server's status and adds a separate, clearly derived "Overdue"
 * badge beside it when the compliance date has passed. The due-date cell says
 * the same thing in words as well as in colour, because a red date is not a
 * state a screen reader can announce.
 *
 * `Actions` carries no `sortKey` and therefore renders no sort control.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { formatIstDate } from "@ada/shared/dates";
import { toNoticeStatus, type NoticeRow } from "@/api/icms/notices";
import { DataTableRowActions } from "@/components/data-table/DataTable";
import type { DataTableColumnMeta, RowAction } from "@/components/data-table/types";
import { StatusChip } from "@/components/icms/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/lib/icons";
import { ActorName } from "@/components/icms/ActorName";
import { actorLabel } from "@/lib/actor";
import type { NoticesLabels } from "./noticeLabels";
import { daysRemaining, isOverdue, orderedSections, printableOf } from "./noticeModel";
import { NOTICE_STATUS_META } from "./noticeStatus";
import type { NoticeStatus } from "@/api/icms/notices";

export type NoticeColumnOptions = {
  labels: NoticesLabels;
  /** The API's own five-value vocabulary, translated. See noticeStatus.ts. */
  statusLabels: Record<NoticeStatus, string>;
  /** `act_cd` -> its label in the active language. Empty until the vocabulary lands. */
  actLabels: Readonly<Record<string, string>>;
  /** BCP-47 tag, e.g. `en-IN` / `hi-IN-u-nu-latn`. Drives dates. */
  locale: string;
  /** Today on the IST calendar, `YYYY-MM-DD`. Passed in so the rule is one rule. */
  today: string;
  onView: (row: NoticeRow) => void;
  onOpenCase: (row: NoticeRow) => void;
  onPrint: (row: NoticeRow) => void;
};

function meta(value: DataTableColumnMeta<NoticeRow>): DataTableColumnMeta<NoticeRow> {
  return value;
}

function isoDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function buildNoticeColumns({
  labels,
  statusLabels,
  actLabels,
  locale,
  today,
  onView,
  onOpenCase,
  onPrint,
}: NoticeColumnOptions): ColumnDef<NoticeRow, unknown>[] {
  return [
    {
      id: "notice_ref",
      header: labels.columns.noticeRef,
      meta: meta({
        sortKey: "notice_ref",
        menuLabel: labels.columns.noticeRef,
        alwaysVisible: true,
        // Identity, due date and state are what a notice register is scanned
        // for, so those three stay in the table at 360px.
        priority: "primary",
        minWidth: "9.5rem",
        exportValue: (row) => row.notice_ref,
      }),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => {
            onView(row.original);
          }}
          className="rounded-xs text-start font-medium max-md:break-all text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {row.original.notice_ref}
        </button>
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
      ),
    },

    {
      id: "act_cd",
      header: labels.columns.act,
      meta: meta({
        sortKey: "act_cd",
        menuLabel: labels.columns.act,
        minWidth: "12rem",
        exportValue: (row) =>
          [actLabels[row.act_cd] ?? row.act_cd, orderedSections(row.section_cds).join(" ")]
            .filter(Boolean)
            .join(" — "),
      }),
      cell: ({ row }) => {
        const sections = orderedSections(row.original.section_cds);
        return (
          <span className="flex flex-col">
            {/* The code until the vocabulary answers, never a blank cell: an
                act nobody has translated is still the act this notice cites. */}
            <span className="text-fg-base">
              {actLabels[row.original.act_cd] ?? row.original.act_cd}
            </span>
            <span className="text-2xs text-fg-faint">
              {sections.length > 0
                ? labels.sectionList(sections.join(", "))
                : labels.noSections}
            </span>
          </span>
        );
      },
    },

    {
      id: "property_address",
      header: labels.columns.location,
      meta: meta({
        // No `sortKey`: the address is joined from `icms_case` and the
        // register's sort whitelist is the notice's own seven fields. A header
        // offering a sort the server answers with `unknown_sort_field` would be
        // a broken control. Zone, which IS sortable, is the hidden column below.
        menuLabel: labels.columns.location,
        minWidth: "12rem",
        exportValue: (row) =>
          [row.property_address, row.zone_cd].filter(Boolean).join(" "),
      }),
      cell: ({ row }) =>
        row.original.property_address == null && row.original.zone_cd == null ? (
          <span className="text-fg-faint">{labels.notRecorded}</span>
        ) : (
          <span className="flex flex-col">
            <span className="text-fg-base">
              {row.original.property_address ?? labels.notRecorded}
            </span>
            {row.original.zone_cd && (
              <span className="font-mono text-2xs text-fg-faint">{row.original.zone_cd}</span>
            )}
          </span>
        ),
    },

    {
      id: "issued_at",
      header: labels.columns.issued,
      meta: meta({
        sortKey: "issued_at",
        menuLabel: labels.columns.issued,
        minWidth: "8rem",
        exportValue: (row) => isoDate(row.issued_at),
      }),
      cell: ({ row }) =>
        // Null on every draft, and that is a state rather than a blank cell.
        row.original.issued_at == null ? (
          <span className="text-fg-faint">{labels.notIssued}</span>
        ) : (
          <time dateTime={row.original.issued_at} className="text-fg-strong tabular">
            {formatIstDate(row.original.issued_at, locale)}
          </time>
        ),
    },

    {
      id: "compliance_due",
      header: labels.columns.due,
      meta: meta({
        sortKey: "compliance_due",
        menuLabel: labels.columns.due,
        priority: "primary",
        minWidth: "9.5rem",
        exportValue: (row) => isoDate(row.compliance_due),
      }),
      cell: ({ row }) => {
        const record = row.original;
        if (record.compliance_due == null) {
          return <span className="text-fg-faint">{labels.noDueDate}</span>;
        }
        const late = isOverdue(record, today);
        const left = daysRemaining(record.compliance_due, today);
        return (
          <span className="flex flex-col">
            <time
              dateTime={record.compliance_due}
              className={late ? "tabular text-status-danger-fg" : "tabular text-fg-strong"}
            >
              {formatIstDate(record.compliance_due, locale)}
            </time>
            {/* Figma paints an overdue date red and stops there. The words are
                here because colour alone carries no meaning to a screen reader
                and none at all to a colour-blind officer (WCAG 1.4.1). */}
            {left !== null && record.status === "issued" && (
              <span className={late ? "text-2xs text-status-danger-fg" : "text-2xs text-fg-faint"}>
                {late
                  ? labels.overdueBy(Math.abs(left))
                  : left === 0
                    ? labels.dueToday
                    : labels.dueInDays(left)}
              </span>
            )}
          </span>
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
        exportValue: (row) =>
          isOverdue(row, today) ? `${row.status} (${labels.overdue})` : row.status,
      }),
      cell: ({ row }) => {
        const record = row.original;
        const status = toNoticeStatus(record.status);
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {status === null ? (
              // An unrecognised status is shown, not hidden: the raw value is
              // what a support ticket needs, and a blank cell tells nobody anything.
              <StatusChip status="unknown" uppercase>
                {record.status}
              </StatusChip>
            ) : (
              // The true API status stays in the DOM even though the chip is
              // drawn from the nearest Figma value — see noticeStatus.ts.
              <span data-notice-status={status}>
                <StatusChip status={NOTICE_STATUS_META[status].chip} uppercase>
                  {statusLabels[status]}
                </StatusChip>
              </span>
            )}
            {/* Derived, and drawn as its own marker so the register never
                disagrees with the status the API reported. */}
            {isOverdue(record, today) && (
              <Badge
                variant="outline"
                data-derived="overdue"
                className="border-status-danger-border bg-status-danger text-2xs uppercase text-status-danger-fg"
              >
                {labels.overdue}
              </Badge>
            )}
          </span>
        );
      },
    },

    {
      id: "actions",
      header: labels.columns.actions,
      meta: meta({
        menuLabel: labels.columns.actions,
        alwaysVisible: true,
        minWidth: "9rem",
        exportValue: () => "",
      }),
      cell: ({ row }) => {
        const record = row.original;
        // View and Print, which is what the frame draws. Nothing that WRITES:
        // issuing is a transition on the CASE and the server publishes
        // `allowed_actions` on `CaseDetail`, not on a notice row, so a register
        // row cannot know what may be done to it without guessing from a status
        // string — the one thing this codebase refuses to do.
        const actions: RowAction<NoticeRow>[] = [
          {
            id: "view",
            label: labels.view,
            icon: "action.view",
            onSelect: onView,
            variant: "primary",
          },
          {
            id: "print",
            label: labels.print,
            icon: "notice.print",
            onSelect: onPrint,
            // `has_artefact`, never the status: a notice can be issued with the
            // render still queued, and a print button that 404s is worse than
            // one that says why it cannot be pressed.
            disabled: !printableOf(record),
            disabledReason: labels.printUnavailable,
          },
        ];
        return (
          <DataTableRowActions row={record} actions={actions} rowLabel={record.notice_ref} />
        );
      },
    },

    /* ---- hidden by default -------------------------------------------- */

    {
      id: "issued_by",
      header: labels.columns.issuedBy,
      meta: meta({
        // Not sortable: `issued_by` is a Keycloak subject and the register's
        // sort whitelist does not carry it. The column exists so the officer
        // who signed a notice is recoverable without opening it.
        menuLabel: labels.columns.issuedBy,
        minWidth: "9rem",
        exportValue: (row) => actorLabel(row.issued_by_name, row.issued_by).text,
      }),
      cell: ({ row }) =>
        row.original.issued_by == null ? (
          <span className="text-fg-faint">{labels.notIssued}</span>
        ) : (
          <ActorName
            className="text-fg-base"
            name={row.original.issued_by_name}
            id={row.original.issued_by}
          />
        ),
    },

    {
      id: "zone_cd",
      header: labels.columns.zone,
      meta: meta({
        sortKey: "zone_cd",
        menuLabel: labels.columns.zone,
        minWidth: "8rem",
        exportValue: (row) => row.zone_cd ?? "",
      }),
      cell: ({ row }) =>
        row.original.zone_cd == null ? (
          <span className="text-fg-faint">{labels.notRecorded}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono text-2xs text-fg-base">
            <Icon name="map.pin" className="size-3.5 shrink-0" />
            {row.original.zone_cd}
          </span>
        ),
    },
  ];
}

/** Columns hidden until the officer asks for them in the column menu. */
export const NOTICE_DEFAULT_HIDDEN = ["issued_by", "zone_cd"];
