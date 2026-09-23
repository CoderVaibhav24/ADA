/**
 * The four filters that are not dropdowns.
 *
 * `status`, `round_no`, `priority` and `zone_cd` are multi-select facets and the
 * grid draws them itself — they are declared in `InspectionsRegister.tsx`'s
 * `facets` memo. The other four cannot be: `submitted_from` / `submitted_to` are
 * a date range, `surveyor_user_id` is an unbounded set of Keycloak subjects,
 * and `case_ref` is only ever arrived at by a link from a complaint. All four
 * still live in `RegisterState.filters` so they stay in the URL and in a saved
 * view, which is why this renders into the grid's `toolbarExtra` rather than
 * holding state of its own.
 *
 * On the surveyor filter: there is no officer list this screen may read. The
 * only user endpoint is `GET /api/icms/admin/users`, guarded by `user.read`,
 * which would 403 for the nodal officers this register is for. So the control
 * offered is the one that needs no list — "Assigned to me", from `user_id` on
 * the caller's own capabilities. Any other surveyor id that arrives in the URL
 * is shown as a removable chip rather than silently applied, so a shared link
 * is legible to whoever opens it.
 */

import type { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
import { Toggle } from "@/components/ui/toggle";
import { Icon } from "@/lib/icons";
import type { InspectionsLabels } from "@/i18n/labels";
import type { RegisterState, RegisterStatePatch } from "@/components/data-table/types";

export type InspectionToolbarFiltersProps = {
  labels: InspectionsLabels;
  state: RegisterState;
  onStateChange: (patch: RegisterStatePatch) => void;
  /** The signed-in officer, from `/me/capabilities`. Null until it answers. */
  userId: string | null;
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

export function InspectionToolbarFilters({
  labels,
  state,
  onStateChange,
  userId,
  formatDate,
}: InspectionToolbarFiltersProps) {
  const from = fromIsoDate(first(state.filters.submitted_from));
  const to = fromIsoDate(first(state.filters.submitted_to));
  const range: DateRange | undefined = from ? { from, to } : undefined;

  const surveyors = state.filters.surveyor_user_id ?? [];
  const mineOnly = userId !== null && surveyors.length === 1 && surveyors[0] === userId;
  const othersFiltered = surveyors.filter((id) => id !== userId);
  const caseRef = first(state.filters.case_ref);

  const setRange = (next: DateRange | undefined) => {
    onStateChange({
      filters: {
        ...state.filters,
        submitted_from: next?.from ? [toIsoDate(next.from)] : [],
        submitted_to: next?.to ? [toIsoDate(next.to)] : [],
      },
    });
  };

  const setMine = (pressed: boolean) => {
    onStateChange({
      filters: {
        ...state.filters,
        surveyor_user_id: pressed && userId !== null ? [userId] : [],
      },
    });
  };

  const clearCase = () => {
    onStateChange({ filters: { ...state.filters, case_ref: [] } });
  };

  const clearSurveyors = () => {
    onStateChange({ filters: { ...state.filters, surveyor_user_id: [] } });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangePicker
        value={range}
        onChange={setRange}
        placeholder={labels.submittedRangeAny}
        // A one-ended range is a legitimate query — "everything since the 1st"
        // — so it gets its own sentence instead of rendering "1 Sep – ".
        format={(value) =>
          value.from && value.to
            ? labels.submittedRangeValue(formatDate(value.from), formatDate(value.to))
            : labels.submittedRangeFrom(value.from ? formatDate(value.from) : "")
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
          aria-label={labels.submittedRangeClear}
          onClick={() => {
            setRange(undefined);
          }}
        >
          <Icon name="action.clear" className="size-4" />
        </Button>
      )}

      {/* Hidden until capabilities answer: a toggle that cannot know whose rows
          it would select is a control that does nothing when pressed. */}
      {userId !== null && (
        <>
          <Toggle
            variant="outline"
            size="sm"
            pressed={mineOnly}
            onPressedChange={setMine}
            aria-describedby="inspections-mine-hint"
            className="h-9 rounded-xs px-3 text-xs"
          >
            <Icon name="user.single" className="size-3.5" />
            {labels.mineOnly}
          </Toggle>
          <span id="inspections-mine-hint" className="sr-only">
            {labels.mineOnlyHint}
          </span>
        </>
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

      {othersFiltered.length > 0 && (
        <Badge variant="outline" className="h-9 max-w-[16rem] gap-1 rounded-xs px-2 text-xs">
          <span className="truncate">{labels.surveyorFilter(othersFiltered.join(", "))}</span>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 size-6"
            aria-label={labels.surveyorFilterClear}
            onClick={clearSurveyors}
          >
            <Icon name="action.close" className="size-3.5" />
          </Button>
        </Badge>
      )}
    </div>
  );
}
