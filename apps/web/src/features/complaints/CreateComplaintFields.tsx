/**
 * The Create Complaint form's fields, grouped for its two tabs. No state of their own.
 *
 * Each group takes the whole `ComplaintFormState` and hands back the next one,
 * so the screen owns the single copy the unsaved guard and the body read from.
 * Where this departs from Figma 23:1343: "Village" is an LGD code box (no
 * endpoint publishes a village list), "Parcel ID" is the khasra number, the
 * surveyor's fields (owner, property type, floors, police station) are gone,
 * and ULPIN and the district LGD code sit in a collapsed "More details" group.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Icon } from "@/lib/icons";
import {
  COMPLAINT_SOURCES,
  MAX_EMAIL,
  MAX_KHASRA,
  MAX_LONG_TEXT,
  MAX_NAME,
  MAX_SAFE_TEXT,
  OTHER_TYPE_CODE,
  fieldId,
  hasLocation,
  isIsoDate,
  localToday,
  type ComplaintField,
  type ComplaintFormErrors,
  type ComplaintFormState,
} from "./complaintForm";
import type { ComplaintNewLabels, FieldLabels } from "./complaintLabels";
import type { CodeOption, Vocabulary } from "./useCreateComplaint";

export type FieldGroupProps = {
  labels: ComplaintNewLabels;
  state: ComplaintFormState;
  onChange: (next: ComplaintFormState) => void;
  /** True while a submit is in flight. */
  disabled: boolean;
  /** Only after a submit is attempted: a form is not wrong before it is used. */
  errors: ComplaintFormErrors;
  /** `requiredFields(state)`: the asterisks follow the validator, not the frame. */
  requiredSet: ReadonlySet<ComplaintField>;
  /** Filled from the officer's own account, so shown read-only. */
  locked: ReadonlySet<ComplaintField>;
  /** Still holding what the pin suggested; each shows "Suggested from location". */
  fromLocation?: ReadonlySet<ComplaintField>;
  /** Still holding what the land record under the pin suggested; "Suggested from land record". */
  fromLandRecord?: ReadonlySet<ComplaintField>;
  /** Parcel ID still holds a scheme plot's number from the land record, not a khasra. */
  fromPlotNo?: boolean;
};

// Errors are text, never a red border alone.
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-xs text-status-danger-fg">
      {children}
    </p>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-fg-faint text-pretty">
      {children}
    </p>
  );
}

// The detection chip's hint style, reused for fields the pin filled.
function SuggestedHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span id={id} className="flex items-center gap-1 text-2xs text-fg-link">
      <Icon name="feedback.info" className="size-3.5" />
      {children}
    </span>
  );
}

// The asterisk is decorative; the sr-only word is what a screen reader says.
function FieldLabel({
  htmlFor,
  id,
  text,
  required,
  requiredWord,
}: {
  htmlFor?: string;
  id?: string;
  text: string;
  required: boolean;
  requiredWord: string;
}) {
  return (
    <Label htmlFor={htmlFor} id={id} className="gap-1 text-xs font-normal text-fg-muted">
      <span>{text}</span>
      {required && (
        <>
          <span aria-hidden="true" className="font-bold text-status-danger-fg">
            *
          </span>
          <span className="sr-only">{requiredWord}</span>
        </>
      )}
    </Label>
  );
}

// Which suggestion, if any, a field still holds; the land record wins, being the more specific source.
function suggestionText(
  { labels, fromLocation, fromLandRecord, fromPlotNo }: FieldGroupProps,
  field: ComplaintField,
): string | undefined {
  if (field === "khasraNo" && fromPlotNo === true) return labels.location.fromLandRecordPlot;
  if (fromLandRecord?.has(field) === true) return labels.location.fromLandRecord;
  if (fromLocation?.has(field) === true) return labels.location.suggested;
  return undefined;
}

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter((value) => value !== undefined).join(" ");
  return joined === "" ? undefined : joined;
}

type TextFieldProps = FieldGroupProps & {
  field: ComplaintField;
  copy: FieldLabels;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
  type?: string;
  autoComplete?: string;
  readOnly?: boolean;
};

/** One labelled text control, with its hint, its error and their `aria` wiring. */
function TextField(props: TextFieldProps) {
  const {
    labels,
    state,
    onChange,
    disabled,
    errors,
    requiredSet,
    locked,
    field,
    copy,
    maxLength,
    inputMode = "text",
    type = "text",
    autoComplete,
    readOnly = false,
  } = props;
  const id = fieldId(field);
  const problem = errors[field];
  const required = requiredSet.has(field);
  const hintId = copy.hint === undefined ? undefined : `${id}-hint`;
  const errorId = problem === undefined ? undefined : `${id}-error`;
  const fromAccount = locked.has(field);
  const accountId = fromAccount ? `${id}-account` : undefined;
  const suggestion = suggestionText(props, field);
  const suggestedId = suggestion === undefined ? undefined : `${id}-suggested`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FieldLabel
          htmlFor={id}
          text={copy.label}
          required={required}
          requiredWord={labels.required}
        />
        {suggestedId !== undefined && <SuggestedHint id={suggestedId}>{suggestion}</SuggestedHint>}
      </div>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={state[field]}
        maxLength={maxLength}
        disabled={disabled}
        readOnly={readOnly || fromAccount}
        placeholder={copy.placeholder}
        aria-required={required || undefined}
        aria-invalid={problem !== undefined}
        aria-describedby={describedBy(suggestedId, accountId, hintId, errorId)}
        className={fromAccount ? "h-11 cursor-not-allowed dark:border-line dark:bg-surface-3 dark:text-fg-base" : "h-11"}
        onChange={(event) => {
          onChange({ ...state, [field]: event.target.value });
        }}
      />
      {accountId !== undefined && (
        <p id={accountId} className="flex items-center gap-1.5 text-xs text-fg-faint">
          <Icon name="user.single" className="size-3.5" />
          {labels.complainant.fromAccount}
        </p>
      )}
      {hintId !== undefined && <Hint id={hintId}>{copy.hint}</Hint>}
      {problem !== undefined && errorId !== undefined && (
        <FieldError id={errorId}>{labels.fieldError(problem)}</FieldError>
      )}
    </div>
  );
}

type SelectFieldProps = FieldGroupProps & {
  field: ComplaintField;
  copy: FieldLabels;
  options: readonly CodeOption[];
  loading?: boolean;
  unavailable?: boolean;
  /** Said out loud when the vocabulary answered empty or failed to load. */
  unavailableText?: string;
  /** A warning under the picker that is not an error, e.g. a pin in someone else's zone. */
  note?: string;
};

/** One labelled picker. An unavailable vocabulary is a sentence, not a blank list. */
function SelectField(props: SelectFieldProps) {
  const {
    labels,
    state,
    onChange,
    disabled,
    errors,
    requiredSet,
    field,
    copy,
    options,
    loading = false,
    unavailable = false,
    unavailableText,
    note,
  } = props;
  const id = fieldId(field);
  const suggestion = suggestionText(props, field);
  const suggestedId = suggestion === undefined ? undefined : `${id}-suggested`;
  const pinNoteId = note === undefined ? undefined : `${id}-pin-note`;
  const problem = errors[field];
  const required = requiredSet.has(field);
  const hintId = copy.hint === undefined ? undefined : `${id}-hint`;
  const noteId = unavailable && unavailableText !== undefined ? `${id}-note` : undefined;
  const errorId = problem === undefined ? undefined : `${id}-error`;
  const value = state[field];

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FieldLabel
          htmlFor={id}
          text={copy.label}
          required={required}
          requiredWord={labels.required}
        />
        {suggestedId !== undefined && <SuggestedHint id={suggestedId}>{suggestion}</SuggestedHint>}
      </div>
      <Select
        value={value === "" ? undefined : value}
        disabled={disabled || loading || unavailable}
        onValueChange={(next) => {
          onChange({ ...state, [field]: next });
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full data-[size=default]:h-11"
          aria-required={required || undefined}
          aria-invalid={problem !== undefined}
          aria-describedby={describedBy(suggestedId, hintId, noteId, pinNoteId, errorId)}
        >
          <SelectValue placeholder={copy.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hintId !== undefined && <Hint id={hintId}>{copy.hint}</Hint>}
      {noteId !== undefined && (
        <p id={noteId} role="status" className="text-xs text-status-warning-fg text-pretty">
          {unavailableText}
        </p>
      )}
      {pinNoteId !== undefined && (
        <p id={pinNoteId} role="status" className="text-xs text-status-warning-fg text-pretty">
          {note}
        </p>
      )}
      {problem !== undefined && errorId !== undefined && (
        <FieldError id={errorId}>{labels.fieldError(problem)}</FieldError>
      )}
    </div>
  );
}

// A value the officer cannot change here, drawn in the same style as a field filled from the account.
function LockedField({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="gap-1 text-xs font-normal text-fg-muted">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        readOnly
        className="h-11 cursor-not-allowed dark:border-line dark:bg-surface-3 dark:text-fg-base"
      />
    </div>
  );
}

// Two fields side by side above `sm`, stacked below it.
function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/* ---- the groups ---------------------------------------------------------- */

export type OriginProps = {
  labels: ComplaintNewLabels;
  detectionRef: string;
  area: string | null;
  confidence: string | null;
  status: "change" | "illegal" | null;
};

/** Where this complaint came from, when it came from a detection. Shown, not stored. */
export function OriginPanel({ labels, detectionRef, area, confidence, status }: OriginProps) {
  return (
    <section
      aria-labelledby="complaint-origin-title"
      className="flex min-w-0 flex-col gap-2 rounded-md border border-accent-soft-border bg-accent-soft p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="map.encroachment" className="size-4 text-fg-link" />
        <h2
          id="complaint-origin-title"
          className="font-display text-sm font-semibold text-fg-strong"
        >
          {labels.origin.title}
        </h2>
      </div>
      <p className="text-sm text-fg-strong text-pretty">
        {labels.origin.reference(detectionRef)}
      </p>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
        {area !== null && <li>{labels.origin.area(area)}</li>}
        {confidence !== null && <li>{labels.origin.confidence(confidence)}</li>}
        {status !== null && <li>{labels.origin.status(status)}</li>}
      </ul>
      <p className="text-2xs text-fg-faint text-pretty">{labels.origin.locked}</p>
    </section>
  );
}

export type DetectionOriginProps = {
  labels: ComplaintNewLabels;
  /** `forMode(state, "detection", officer)`: the officer and the polygon, as filed. */
  state: ComplaintFormState;
};

/** The detection tab's locked block: the officer who raises it, the source and the polygon. */
export function DetectionOriginFields({ labels, state }: DetectionOriginProps) {
  return (
    <section aria-labelledby="complaint-officer-title" className="flex min-w-0 flex-col gap-4">
      <h2
        id="complaint-officer-title"
        className="font-display text-base font-semibold text-fg-strong"
      >
        {labels.officer.legend}
      </h2>
      <Row>
        <LockedField
          id={fieldId("complainantName")}
          label={labels.officer.name}
          value={state.complainantName}
        />
        <LockedField
          id={fieldId("complainantEmail")}
          label={labels.officer.email}
          value={state.complainantEmail}
        />
      </Row>
      <Row>
        <LockedField
          id={fieldId("source")}
          label={labels.officer.source}
          value={labels.source.option("detection")}
        />
        <LockedField
          id={fieldId("detectionId")}
          label={labels.officer.detectionId}
          value={state.detectionId}
        />
      </Row>
      <p className="flex items-center gap-1.5 text-xs text-fg-faint">
        <Icon name="user.single" className="size-3.5" />
        {labels.complainant.fromAccount}
      </p>
    </section>
  );
}

export type ComplainantProps = FieldGroupProps & {
  /** Copies the officer's own name and email in; absent when the profile has neither. */
  onUseMine?: () => void;
};

// A manual complaint comes from somewhere other than a detection.
const MANUAL_SOURCES = COMPLAINT_SOURCES.filter((value) => value !== "detection");

/** The manual tab's complainant: typed, since a citizen may be the one complaining. */
export function ComplainantSection(props: ComplainantProps) {
  const { labels, state, onChange, disabled, onUseMine } = props;
  const sourceOptions = MANUAL_SOURCES.map((value) => ({
    value,
    label: labels.source.option(value),
  }));

  return (
    <section aria-labelledby="complaint-complainant-title" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="complaint-complainant-title"
          className="font-display text-base font-semibold text-fg-strong"
        >
          {labels.complainant.legend}
        </h2>
        {onUseMine !== undefined && (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onUseMine}>
            <Icon name="user.single" className="size-4" />
            {labels.complainant.useMine}
          </Button>
        )}
      </div>
      <Row>
        <TextField
          {...props}
          field="complainantName"
          copy={labels.complainant.name}
          maxLength={MAX_NAME}
          autoComplete="name"
        />
        <TextField
          {...props}
          field="complainantPhone"
          copy={labels.complainant.phone}
          inputMode="tel"
          autoComplete="tel"
        />
      </Row>
      <Row>
        <TextField
          {...props}
          field="complainantEmail"
          copy={labels.complainant.email}
          maxLength={MAX_EMAIL}
          inputMode="email"
          type="email"
          autoComplete="email"
        />
        <SelectField
          {...props}
          // The shared state may hold "detection" from a hand-off; this tab files as the office then.
          state={{ ...state, source: state.source === "detection" ? "office" : state.source }}
          field="source"
          copy={{ label: labels.source.label, hint: labels.source.hint }}
          options={sourceOptions}
          onChange={(next) => {
            onChange({ ...state, source: next.source });
          }}
        />
      </Row>
    </section>
  );
}

// Village and Parcel ID, with the hint that they come from the land record.
function ParcelRow(props: FieldGroupProps) {
  const { labels } = props;
  return (
    <>
      <Row>
        <TextField
          {...props}
          field="villageLgdCode"
          copy={labels.parcelRow.village}
          inputMode="numeric"
          maxLength={12}
        />
        <TextField
          {...props}
          field="khasraNo"
          copy={labels.parcelRow.parcelId}
          maxLength={MAX_KHASRA}
        />
      </Row>
      <p className="text-xs text-fg-faint text-pretty">{labels.parcelRow.hint}</p>
    </>
  );
}

export type TypeProps = FieldGroupProps & {
  types: Vocabulary;
  /** The selected chip is the detection's suggestion, untouched. */
  suggested: boolean;
};

/** The complaint type as Figma's pill chips: single-select, arrow keys, one tab stop. */
export function ComplaintTypeField(props: TypeProps) {
  const { labels, state, onChange, disabled, errors, types, suggested } = props;
  const isOther = state.complaintTypeCd === OTHER_TYPE_CODE;
  const titleId = `${fieldId("complaintTypeCd")}-label`;
  const hintId = `${fieldId("complaintTypeCd")}-hint`;
  const suggestedId = `${fieldId("complaintTypeCd")}-suggested`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FieldLabel
          id={titleId}
          text={labels.type.legend}
          required={false}
          requiredWord={labels.required}
        />
        {suggested && <SuggestedHint id={suggestedId}>{labels.type.suggested}</SuggestedHint>}
      </div>

      {types.loading && (
        <p role="status" className="flex items-center gap-2 text-xs text-fg-muted">
          <Icon name="feedback.loading" spin className="size-3.5" />
          {labels.type.loading}
        </p>
      )}
      {types.unavailable && (
        <p role="status" className="max-w-prose text-xs text-status-warning-fg text-pretty">
          {labels.type.unavailable}
        </p>
      )}

      {types.options.length > 0 && (
        <ToggleGroup
          id={fieldId("complaintTypeCd")}
          type="single"
          spacing={2}
          variant="outline"
          className="flex w-full flex-wrap justify-start gap-x-6 gap-y-2"
          aria-labelledby={titleId}
          aria-describedby={describedBy(suggested ? suggestedId : undefined, hintId)}
          value={state.complaintTypeCd}
          disabled={disabled}
          onValueChange={(next) => {
            // Radix answers "" when the selected chip is pressed again, which clears it.
            onChange({
              ...state,
              complaintTypeCd: next,
              otherType: next === OTHER_TYPE_CODE ? state.otherType : "",
            });
          }}
        >
          {types.options.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="h-9 rounded-full border-line-subtle bg-surface-2 px-4 text-sm font-normal text-fg-base sm:min-w-52 data-[state=on]:border-line-accent data-[state=on]:bg-accent-soft data-[state=on]:text-fg-link"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <Hint id={hintId}>{labels.type.hint}</Hint>

      {/* A server rule, surfaced as a field rather than as a 422. */}
      {isOther && (
        <TextField
          {...props}
          field="otherType"
          copy={labels.type.other}
          maxLength={MAX_SAFE_TEXT}
        />
      )}

      {errors.complaintTypeCd !== undefined && (
        <FieldError id={`${fieldId("complaintTypeCd")}-error`}>
          {labels.fieldError(errors.complaintTypeCd)}
        </FieldError>
      )}
    </div>
  );
}

export type PropertyProps = FieldGroupProps & { mode: "detection" | "manual" };

/** "Property Address": where the property stands. Address and landmark are the manual tab's only. */
export function PropertySection(props: PropertyProps) {
  const { labels, mode } = props;
  const manual = mode === "manual";

  return (
    <section aria-labelledby="complaint-property-title" className="flex min-w-0 flex-col gap-4">
      <h2
        id="complaint-property-title"
        className="pt-2 font-display text-base font-semibold text-fg-strong"
      >
        {labels.property.legend}
      </h2>
      {manual && (
        <>
          <TextField
            {...props}
            field="propertyAddress"
            copy={labels.property.address}
            maxLength={MAX_SAFE_TEXT}
            autoComplete="street-address"
          />
          <Row>
            <TextField
              {...props}
              field="landmark"
              copy={labels.property.landmark}
              maxLength={MAX_NAME}
            />
            <PinCodeField {...props} />
          </Row>
        </>
      )}
      <ParcelRow {...props} />
      <Row>
        <TextField
          {...props}
          field="district"
          copy={labels.property.district}
          maxLength={MAX_NAME}
        />
        <TextField {...props} field="state" copy={labels.property.state} maxLength={MAX_NAME} />
      </Row>
      {!manual && (
        <Row>
          <PinCodeField {...props} />
        </Row>
      )}
    </section>
  );
}

function PinCodeField(props: FieldGroupProps) {
  return (
    <TextField
      {...props}
      field="pinCode"
      copy={props.labels.property.pinCode}
      inputMode="numeric"
      maxLength={6}
      autoComplete="postal-code"
    />
  );
}

function fromIsoDate(value: string): Date | undefined {
  if (!isIsoDate(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Figma writes the date as 07-09-2026: day, month, year.
function formatDayMonthYear(value: Date): string {
  const [year, month, day] = localToday(value).split("-");
  return `${day}-${month}-${year}`;
}

export type DescriptionProps = FieldGroupProps & { priorities: readonly CodeOption[] };

/** Description, then Priority beside Date of Complaint. */
export function DescriptionAndDate(props: DescriptionProps) {
  const { labels, state, onChange, disabled, errors, priorities, requiredSet } = props;
  const id = fieldId("detail");
  const problem = errors.detail;
  const detailRequired = requiredSet.has("detail");
  const dateId = fieldId("complaintDate");
  const dateProblem = errors.complaintDate;

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel
          htmlFor={id}
          text={labels.detail.label}
          required={detailRequired}
          requiredWord={labels.required}
        />
        <Textarea
          id={id}
          rows={3}
          value={state.detail}
          maxLength={MAX_LONG_TEXT}
          disabled={disabled}
          placeholder={labels.detail.placeholder}
          aria-required={detailRequired || undefined}
          aria-invalid={problem !== undefined}
          aria-describedby={describedBy(
            `${id}-hint`,
            problem === undefined ? undefined : `${id}-error`,
          )}
          onChange={(event) => {
            onChange({ ...state, detail: event.target.value });
          }}
        />
        <Hint id={`${id}-hint`}>{labels.detail.hint}</Hint>
        {problem !== undefined && (
          <FieldError id={`${id}-error`}>{labels.fieldError(problem)}</FieldError>
        )}
      </div>

      <Row>
        <SelectField {...props} field="priority" copy={labels.priority} options={priorities} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel
            id={`${dateId}-label`}
            htmlFor={dateId}
            text={labels.complaintDate.label}
            required={false}
            requiredWord={labels.required}
          />
          {/* The trigger is a Button, which cannot carry the hint itself, so the
              group does — the pattern NoticeCreate uses for its due date. */}
          <div
            role="group"
            aria-labelledby={`${dateId}-label`}
            aria-describedby={describedBy(
              `${dateId}-hint`,
              dateProblem === undefined ? undefined : `${dateId}-error`,
            )}
          >
            <DatePicker
              id={dateId}
              value={fromIsoDate(state.complaintDate)}
              onChange={(value) => {
                onChange({ ...state, complaintDate: value ? localToday(value) : "" });
              }}
              disabled={disabled}
              placeholder={labels.complaintDate.placeholder}
              format={formatDayMonthYear}
              disabledDates={{ after: new Date() }}
              invalid={dateProblem !== undefined}
              className="h-11 w-full"
            />
          </div>
          <Hint id={`${dateId}-hint`}>{labels.complaintDate.hint}</Hint>
          {dateProblem !== undefined && (
            <FieldError id={`${dateId}-error`}>{labels.fieldError(dateProblem)}</FieldError>
          )}
        </div>
      </Row>
    </>
  );
}

export type MoreProps = FieldGroupProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Fields the frame does not draw but the record keeps, collapsed by default. */
export function MoreDetails(props: MoreProps) {
  const { labels, open, onOpenChange } = props;

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-md border border-line-subtle"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="text-sm font-semibold text-fg-strong">{labels.more.title}</span>
            <span className="text-xs font-normal whitespace-normal text-fg-faint">
              {labels.more.hint}
            </span>
          </span>
          <Icon
            name={open ? "form.chevronUp" : "form.chevronDown"}
            className="size-4 shrink-0"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 px-4 pt-1 pb-4">
        <Row>
          <TextField {...props} field="ulpin" copy={labels.parcel.ulpin} maxLength={14} />
          <TextField
            {...props}
            field="districtLgdCode"
            copy={labels.parcel.districtCode}
            inputMode="numeric"
            maxLength={12}
          />
        </Row>
      </CollapsibleContent>
    </Collapsible>
  );
}

export type GeoProps = FieldGroupProps & {
  zones: Vocabulary;
  /** Set when the land record puts the pin in a zone the officer is not assigned. */
  zoneNote?: string;
};

/**
 * Figma's "Geographical Details" card: the read-back, the typed coordinates the
 * map writes into, and the zone. `zone_cd` OR a point — the server resolves the
 * zone from the point when there is one.
 */
export function GeographicalDetails(props: GeoProps) {
  const { labels, state, onChange, disabled, zones, zoneNote } = props;
  const located = hasLocation(state);

  return (
    <section
      aria-labelledby="complaint-geo-title"
      className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line-subtle bg-surface-sunken"
    >
      <header className="border-b border-line-subtle px-3.5 py-2.5">
        <h2 id="complaint-geo-title" className="font-display text-xs font-bold text-fg-strong">
          {labels.location.readoutTitle}
        </h2>
      </header>
      <div className="flex flex-col gap-3 p-3.5">
        <p aria-live="polite" className="font-mono text-xs break-all text-fg-link">
          {located
            ? labels.location.readout(state.latitude, state.longitude)
            : labels.location.readoutEmpty}
        </p>
        <p className="text-2xs text-fg-faint text-pretty">{labels.location.hint}</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            {...props}
            field="latitude"
            copy={labels.location.latitude}
            inputMode="decimal"
          />
          <TextField
            {...props}
            field="longitude"
            copy={labels.location.longitude}
            inputMode="decimal"
          />
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !located}
            onClick={() => {
              onChange({ ...state, latitude: "", longitude: "" });
            }}
          >
            <Icon name="action.clear" className="size-4" />
            {labels.location.clear}
          </Button>
        </div>
        <SelectField
          {...props}
          field="zoneCd"
          copy={labels.location.zone}
          options={zones.options}
          loading={zones.loading}
          unavailable={zones.unavailable}
          unavailableText={labels.location.zoneUnavailable}
          note={zoneNote}
        />
      </div>
    </section>
  );
}
