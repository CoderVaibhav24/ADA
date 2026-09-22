import { useState, type ComponentProps, type ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Icon } from "@/lib/icons";

/**
 * Date picker.
 *
 * shadcn has no `date-picker` in the registry — it is documented as a recipe
 * (Popover + Calendar + Button), not a component, so `shadcn add date-picker`
 * is a no-op. This is that recipe wired once, so the four date fields in the
 * designs (Date of Complaint, Compliance Due Date, and the From/To pair in the
 * Assign Inspection modal) do not each grow their own copy.
 *
 * Formatting is injected, never assumed. Figma renders dates as `06 Sep 2026`
 * on one screen and `07-09-2026` on another; more importantly a Hindi locale
 * needs Devanagari month names, so this takes a `format` function and a
 * `locale` rather than calling toLocaleDateString with a baked-in locale.
 * `placeholder` is a translated node for the same reason.
 */
export type DatePickerProps = {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  /** Translated empty-state text shown on the trigger. */
  placeholder: ReactNode;
  /** Renders the selected date. Inject a locale-aware formatter. */
  format: (date: Date) => string;
  /** date-fns locale, passed through to react-day-picker. */
  locale?: ComponentProps<typeof Calendar>["locale"];
  disabled?: boolean;
  /** react-day-picker matcher: past-only, future-only, blackout ranges. */
  disabledDates?: ComponentProps<typeof Calendar>["disabled"];
  id?: string;
  /** When set, mirrors the value into a hidden input as ISO `YYYY-MM-DD`. */
  name?: string;
  className?: string;
  /** Marks the trigger invalid for the Form wrapper. */
  invalid?: boolean;
  align?: "start" | "center" | "end";
};

/** Local-time ISO date. `toISOString()` alone shifts the day across timezones. */
function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  format,
  locale,
  disabled,
  disabledDates,
  id,
  name,
  className,
  invalid,
  align = "start",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          // justify-start with a flexible label: a Devanagari month name is
          // wider than its English counterpart and must not be centred-then-clipped.
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !value && "text-fg-faint",
            className,
          )}
        >
          <Icon name="form.calendar" className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{value ? format(value) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      {name && (
        <input type="hidden" name={name} value={value ? toIsoDate(value) : ""} />
      )}
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
          locale={locale}
          disabled={disabledDates}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Two-ended variant, for the `Inspection Schedule` From/To pair in the Assign
 * Inspection modal (46:4561). Figma draws it as two separate date fields; one
 * range control is the same data with half the chance of From later than To.
 */
export type DateRangePickerProps = Omit<
  DatePickerProps,
  "value" | "onChange" | "format" | "name"
> & {
  value?: DateRange;
  onChange: (range: DateRange | undefined) => void;
  format: (range: DateRange) => string;
  /** Drop to 1 below `sm`: two months overflow a 360px viewport. */
  numberOfMonths?: number;
};

export function DateRangePicker({
  value,
  onChange,
  placeholder,
  format,
  locale,
  disabled,
  disabledDates,
  id,
  className,
  invalid,
  align = "start",
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const hasValue = Boolean(value?.from);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            "w-full justify-start gap-2 font-normal",
            !hasValue && "text-fg-faint",
            className,
          )}
        >
          <Icon name="form.calendar" className="size-4 shrink-0" />
          <span className="min-w-0 truncate">
            {hasValue && value ? format(value) : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          locale={locale}
          disabled={disabledDates}
          numberOfMonths={numberOfMonths}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
