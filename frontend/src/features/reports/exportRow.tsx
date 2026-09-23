/**
 * One register export: its filters, its row count, its button.
 *
 * Presentation only: the filters, the count line and the button. The export
 * itself is `exportRegisterCsv` from `components/data-table`, wrapped in
 * `useCsvExport` (`csvExport.ts`), and nothing here re-implements any of it.
 *
 * The count beside the button is a `size=1` read of the same query. It is the
 * server's `total`, so "4,318 rows will be exported" is a promise the export
 * then keeps, rather than an estimate from the page on screen.
 */

import type { ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@/lib/icons";
import { ANY } from "./csvExport";
import { FieldLabel } from "./parts";
import { useExportLabels, type ExportLabels } from "./reportLabels";
import type { RegisterCount } from "./useReports";

export type Option = { value: string; label: string };

/** A one-of filter. Repeatable server-side, but a report narrows one axis at a time. */
export function SelectFilter({
  id,
  label,
  anyLabel,
  value,
  options,
  onChange,
}: {
  id: string;
  label: ReactNode;
  anyLabel: string;
  value: string;
  options: readonly Option[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="w-full min-w-[10rem] sm:w-[12rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The two date bounds these query bags take, as one control rather than two. */
export function DateFilter({
  id,
  label,
  value,
  onChange,
  labels,
  formatDate,
}: {
  id: string;
  label: ReactNode;
  value: DateRange | undefined;
  onChange: (next: DateRange | undefined) => void;
  labels: ExportLabels;
  formatDate: (date: Date) => string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DateRangePicker
        id={id}
        value={value}
        onChange={onChange}
        placeholder={labels.dateAny}
        // A one-ended range is a legitimate query — "everything since the 1st"
        // — so it gets its own sentence instead of rendering "1 Sep – ".
        format={(range) =>
          range.from && range.to
            ? labels.dateRange(formatDate(range.from), formatDate(range.to))
            : labels.dateFrom(range.from ? formatDate(range.from) : "")
        }
        numberOfMonths={1}
        className="h-8 w-full min-w-[12rem] text-xs sm:w-[14rem]"
      />
    </div>
  );
}

/** The block one register occupies: what it is, how it is narrowed, how many rows. */
export function ExportRow({
  title,
  note,
  denied,
  filters,
  count,
  exporting,
  progress,
  onExport,
  onClear,
  isFiltered,
}: {
  title: ReactNode;
  note: ReactNode;
  /** A sentence naming the missing permission, or null when the row may run. */
  denied: string | null;
  filters: ReactNode;
  count: RegisterCount;
  exporting: boolean;
  progress: string | null;
  onExport: () => void;
  onClear: () => void;
  isFiltered: boolean;
}) {
  const labels = useExportLabels();

  const countText = count.loading
    ? labels.rowsLoading
    : count.error !== null || count.total === null
      ? labels.rowsUnknown
      : count.total === 0
        ? labels.rowsNone
        : labels.rows(String(count.total));

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line-subtle bg-surface-2 p-3">
      <div className="min-w-0">
        <h3 className="font-display text-sm font-semibold text-fg-strong">{title}</h3>
        <p className="mt-0.5 max-w-prose text-xs text-fg-muted text-pretty">{note}</p>
      </div>

      {denied !== null ? (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon aria-hidden name="user.password" className="size-4 shrink-0" />
          {denied}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">{filters}</div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* The count and the export's progress are one live region: they
                answer the same question a second apart. */}
            <p role="status" className="min-w-0 text-xs text-fg-muted tabular">
              {progress ?? countText}
            </p>

            <div className="flex items-center gap-2">
              {isFiltered && (
                <Button variant="ghost" size="sm" onClick={onClear}>
                  <Icon name="action.clear" className="size-4" />
                  {labels.clear}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                disabled={exporting || count.total === 0}
                onClick={onExport}
              >
                <Icon
                  name={exporting ? "feedback.loading" : "action.export"}
                  className="size-4"
                  spin={exporting}
                />
                {exporting ? labels.exporting : labels.export}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
