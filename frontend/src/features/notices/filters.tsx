/**
 * The two filters that are not dropdowns.
 *
 * `status`, `act_cd` and `zone_cd` are multi-select facets and the grid draws
 * them itself — they are declared in `NoticesRegister.tsx`'s `facets` memo. The
 * other two cannot be: `issued_from` / `issued_to` are a date range, and
 * `case_ref` is only ever arrived at by a link from a complaint. Both still
 * live in `RegisterState.filters` so they stay in the URL and in a saved view,
 * which is why this renders into the grid's `toolbarExtra` rather than holding
 * state of its own.
 *
 * Figma 67:1627 draws a search box and two selects — "All Statuses" and "All
 * Notice Type". The search box and the status select are the grid's; the second
 * select is the ACT, because there is no notice-type vocabulary behind the
 * frame's label (see `columns.tsx`). The issued-date range and the case chip
 * are additions: a statutory register is read by period far more often than by
 * anything else, and a link that filters to one case has to say so.
 */

import type { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
import { Icon } from "@/lib/icons";
import type { RegisterState, RegisterStatePatch } from "@/components/data-table/types";
import type { NoticesLabels } from "./noticeLabels";

export type NoticeToolbarFiltersProps = {
  labels: NoticesLabels;
  state: RegisterState;
  onStateChange: (patch: RegisterStatePatch) => void;
  /** Locale-aware, injected: the picker ships no formatter of its own. */
  formatDate: (value: Date) => string;
};

// Local-time parse. `new Date("2026-09-01")` is parsed as UTC midnight, which in
// IST is the same calendar day but in a negative-offset timezone is the day
// before — and this string came from a date the officer picked locally.
function fromIsoDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parts = value.split("-").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// The inverse. `toISOString()` alone shifts the day across timezones.
function toIsoDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function first(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values[0] : undefined;
}

export function NoticeToolbarFilters({
  labels,
  state,
  onStateChange,
  formatDate,
}: NoticeToolbarFiltersProps) {
  const from = fromIsoDate(first(state.filters.issued_from));
  const to = fromIsoDate(first(state.filters.issued_to));
  const range: DateRange | undefined = from ? { from, to } : undefined;
  const caseRef = first(state.filters.case_ref);

  const setRange = (next: DateRange | undefined) => {
    onStateChange({
      filters: {
        ...state.filters,
        issued_from: next?.from ? [toIsoDate(next.from)] : [],
        issued_to: next?.to ? [toIsoDate(next.to)] : [],
      },
    });
  };

  const clearCase = () => {
    onStateChange({ filters: { ...state.filters, case_ref: [] } });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangePicker
        value={range}
        onChange={setRange}
        placeholder={labels.issuedRangeAny}
        // A one-ended range is a legitimate query — "everything issued since the
        // 1st" — so it gets its own sentence instead of rendering "1 Sep – ".
        format={(value) =>
          value.from && value.to
            ? labels.issuedRangeValue(formatDate(value.from), formatDate(value.to))
            : labels.issuedRangeFrom(value.from ? formatDate(value.from) : "")
        }
        // One month: two overflow a 360px viewport, and this sits in a toolbar.
        numberOfMonths={1}
        className="h-9 w-auto min-w-[13rem] rounded-xs text-xs"
        align="end"
      />

      {range && (
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label={labels.issuedRangeClear}
          onClick={() => {
            setRange(undefined);
          }}
        >
          <Icon name="action.clear" className="size-4" />
        </Button>
      )}

      {/* A filter that arrived from a link, named so whoever opened the link can
          see why the register is short — and undo it. */}
      {caseRef && (
        <Badge variant="outline" className="h-9 gap-1 rounded-xs px-2 text-xs">
          {labels.caseFilter(caseRef)}
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 size-6"
            aria-label={labels.caseFilterClear}
            onClick={clearCase}
          >
            <Icon name="action.close" className="size-3.5" />
          </Button>
        </Badge>
      )}
    </div>
  );
}
