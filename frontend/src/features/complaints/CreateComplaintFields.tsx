/**
 * The Create Complaint form's fields. Seven groups, no state of their own.
 *
 * Each takes the whole `ComplaintFormState` and hands back the next one, so the
 * screen above owns the single copy that the unsaved-changes guard and the
 * request body are both computed from. A field holding its own value would be a
 * second source of truth for the same complaint.
 *
 * What Figma 23:1343 draws and what `CaseCreate` stores are not the same set,
 * and the differences are deliberate:
 *
 *   - **"Date of Complaint" is not here.** `icms_case.raised_at` is set by the
 *     server inside the transaction that allocates the reference. A date box
 *     the officer can edit would be a field whose value is discarded without
 *     saying so — and a back-dated complaint is a different feature, with an
 *     audit question attached.
 *   - **"Evidence / Photographs" is not here.** Evidence hangs off an
 *     INSPECTION (`POST /inspections/{ref}/evidence`), and at the moment a case
 *     is raised no round exists to hang it on. An upload control whose Submit
 *     cannot write it would read as an upload that does nothing.
 *   - **"Village" is a code, not a dropdown.** The column is
 *     `village_lgd_code`, an LGD number, and no endpoint in this API publishes
 *     a village list to populate a picker from. A dropdown with nothing in it
 *     is worse than a labelled box that says what shape the code takes.
 *   - **"Parcel ID" is four real identifiers.** `parcelId.ts` records that the
 *     frame's `RJ-JPR-1007` is placeholder text from another state; the columns
 *     behind that slot are `ulpin`, `khasra_no`, `village_lgd_code` and
 *     `district_lgd_code`, and they are collected as themselves.
 *   - **the map is a coordinate pair, for now.** `location` is a real column
 *     and the point is what resolves the zone, so the field stays; the pin-drop
 *     map itself is not built here — see the panel's own note.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
  setSource,
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
  /** True while the gate is closed or a submit is in flight. */
  disabled: boolean;
  /** Only after a submit is attempted: a form is not wrong before it is used. */
  errors: ComplaintFormErrors;
};

// One panel per group, matching the findings form's so the two read as one
// product.
function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
      <header className="max-w-prose min-w-0">
        <h2 className="font-display text-lg font-semibold text-fg-strong">{title}</h2>
        {hint && <p className="mt-1 text-sm text-fg-muted text-pretty">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

// Errors are text, never a red border alone: a colour-blind officer and a
// screen-reader user both have to be told which field, and why.
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-xs text-status-danger-fg">
      {children}
    </p>
  );
}

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-fg-muted text-pretty">
      {children}
    </p>
  );
}

// The asterisk is decorative; the word beside it is what a screen reader says,
// so "required" never depends on seeing a red glyph.
function FieldLabel({
  htmlFor,
  text,
  required,
  requiredWord,
}: {
  htmlFor: string;
  text: string;
  required: boolean;
  requiredWord: string;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs text-fg-muted">
      <span>{text}</span>
      {required && (
        <>
          <span aria-hidden="true" className="ml-0.5 text-status-danger-fg">
            *
          </span>
          <span className="sr-only"> {requiredWord}</span>
        </>
      )}
    </Label>
  );
}

type TextFieldProps = FieldGroupProps & {
  field: ComplaintField;
  copy: FieldLabels;
  required?: boolean;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
  type?: string;
  autoComplete?: string;
};

/** One labelled text control, with its hint, its error and their `aria` wiring. */
function TextField({
  labels,
  state,
  onChange,
  disabled,
  errors,
  field,
  copy,
  required = false,
  maxLength,
  inputMode = "text",
  type = "text",
  autoComplete,
}: TextFieldProps) {
  const id = fieldId(field);
  const problem = errors[field];
  const hintId = copy.hint === undefined ? undefined : `${id}-hint`;
  const errorId = problem === undefined ? undefined : `${id}-error`;
  const described = [hintId, errorId].filter((value) => value !== undefined).join(" ");

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel
        htmlFor={id}
        text={copy.label}
        required={required}
        requiredWord={labels.required}
      />
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={state[field]}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={copy.placeholder}
        aria-required={required || undefined}
        aria-invalid={problem !== undefined}
        aria-describedby={described === "" ? undefined : described}
        onChange={(event) => {
          onChange({ ...state, [field]: event.target.value });
        }}
      />
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
  required?: boolean;
  loading?: boolean;
  unavailable?: boolean;
  /** Said out loud when the vocabulary answered empty or failed to load. */
  unavailableText?: string;
};

/** One labelled picker. An unavailable vocabulary is a sentence, not a blank list. */
function SelectField({
  labels,
  state,
  onChange,
  disabled,
  errors,
  field,
  copy,
  options,
  required = false,
  loading = false,
  unavailable = false,
  unavailableText,
}: SelectFieldProps) {
  const id = fieldId(field);
  const problem = errors[field];
  const hintId = copy.hint === undefined ? undefined : `${id}-hint`;
  const noteId = unavailable && unavailableText !== undefined ? `${id}-note` : undefined;
  const errorId = problem === undefined ? undefined : `${id}-error`;
  const described = [hintId, noteId, errorId]
    .filter((value) => value !== undefined)
    .join(" ");
  const value = state[field];

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel
        htmlFor={id}
        text={copy.label}
        required={required}
        requiredWord={labels.required}
      />
      <Select
        value={value === "" ? undefined : value}
        disabled={disabled || loading || unavailable}
        onValueChange={(next) => {
          onChange({ ...state, [field]: next });
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-required={required || undefined}
          aria-invalid={problem !== undefined}
          aria-describedby={described === "" ? undefined : described}
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
      {problem !== undefined && errorId !== undefined && (
        <FieldError id={errorId}>{labels.fieldError(problem)}</FieldError>
      )}
    </div>
  );
}

// Two fields side by side above `sm`, stacked below it. The registers scroll
// sideways at tablet; a form reflows instead, because a field is not a column.
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

/**
 * Where this complaint came from, when it came from a detection.
 *
 * The reference, the area and the confidence are facts about the DETECTION and
 * have no column on `CaseCreate`; they are shown rather than stored so the
 * officer can see what they are filing about, and the reference is what ties
 * the two together in a conversation.
 */
export function OriginPanel({ labels, detectionRef, area, confidence, status }: OriginProps) {
  return (
    <section
      aria-labelledby="complaint-origin-title"
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-accent-soft-border bg-accent-soft p-4 sm:p-5"
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

/** Who reported it, and how it reached the authority. */
export function SourceAndComplainant(props: FieldGroupProps) {
  const { labels, state, onChange } = props;
  const byDetection = state.source === "detection";
  const sourceOptions = COMPLAINT_SOURCES.map((value) => ({
    value,
    label: labels.source.option(value),
  }));

  return (
    <Panel title={labels.complainant.legend} hint={labels.complainant.hint}>
      <Row>
        <SelectField
          {...props}
          field="source"
          copy={{ label: labels.source.label, hint: labels.source.hint }}
          options={sourceOptions}
          required
          // The pair is validated together server-side, so moving the source
          // moves the polygon id with it rather than orphaning one.
          onChange={(next) => {
            onChange(setSource(state, next.source));
          }}
        />
        {byDetection && (
          // Read-only rather than absent: the officer can see which polygon the
          // case will carry, and cannot accidentally retype it.
          <TextField
            {...props}
            field="detectionId"
            copy={{ label: labels.origin.title }}
            inputMode="numeric"
            disabled
          />
        )}
      </Row>

      <Row>
        <TextField
          {...props}
          field="complainantName"
          copy={labels.complainant.name}
          required={!byDetection}
          maxLength={MAX_NAME}
          autoComplete="name"
        />
        <TextField
          {...props}
          field="complainantPhone"
          copy={labels.complainant.phone}
          required={!byDetection}
          inputMode="tel"
          autoComplete="tel"
        />
      </Row>

      <TextField
        {...props}
        field="complainantEmail"
        copy={labels.complainant.email}
        maxLength={MAX_EMAIL}
        inputMode="email"
        type="email"
        autoComplete="email"
      />
    </Panel>
  );
}

export type LocationProps = FieldGroupProps & { zones: Vocabulary };

/**
 * The zone, the point, and the read-back of both.
 *
 * `zone_cd` OR `location` — the server refuses a body with neither, and
 * resolves the zone from the point with `ST_Contains` when there is one. A
 * point outside every active boundary comes back asking for a zone, so both are
 * collected and both are sent.
 */
export function LocationPanel(props: LocationProps) {
  const { labels, state, onChange, disabled, zones } = props;
  const located = hasLocation(state);

  return (
    <Panel title={labels.location.legend} hint={labels.location.hint}>
      <SelectField
        {...props}
        field="zoneCd"
        copy={labels.location.zone}
        options={zones.options}
        loading={zones.loading}
        unavailable={zones.unavailable}
        unavailableText={labels.location.zoneUnavailable}
      />

      <Row>
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
      </Row>

      <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-surface-2 p-3">
        <p className="font-display text-xs font-semibold text-fg-strong">
          {labels.location.readoutTitle}
        </p>
        {/* The coordinates in words as well as in the boxes, so "where is this"
            is answerable without reading two inputs. */}
        <p role="status" className="font-mono text-xs break-all text-fg-muted">
          {located
            ? labels.location.readout(state.latitude, state.longitude)
            : labels.location.readoutEmpty}
        </p>
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
        <p className="max-w-prose text-2xs text-fg-faint text-pretty">
          {labels.location.mapDeferred}
        </p>
      </div>
    </Panel>
  );
}

export type TypeProps = FieldGroupProps & { types: Vocabulary };

/**
 * The complaint type, as Figma's chip row rather than a dropdown.
 *
 * A single-select `ToggleGroup`: the vocabulary is five or six values, all of
 * them visible at once is faster than a menu, and Radix gives it arrow-key
 * movement and one tab stop for free. `other` opens the free-text box beside
 * it, because the server refuses `other` without `other_type`.
 */
export function ComplaintTypePanel(props: TypeProps) {
  const { labels, state, onChange, disabled, errors, types } = props;
  const isOther = state.complaintTypeCd === OTHER_TYPE_CODE;

  return (
    <Panel title={labels.type.legend} hint={labels.type.hint}>
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
          type="single"
          spacing={2}
          variant="outline"
          className="flex w-full flex-wrap justify-start"
          aria-label={labels.type.legend}
          value={state.complaintTypeCd}
          disabled={disabled}
          onValueChange={(next) => {
            // Radix answers "" when the pressed chip was the selected one,
            // which is how a type is cleared again.
            onChange({ ...state, complaintTypeCd: next });
          }}
        >
          {types.options.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="rounded-full">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {state.complaintTypeCd !== "" && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onChange({ ...state, complaintTypeCd: "", otherType: "" });
            }}
          >
            <Icon name="action.clear" className="size-4" />
            {labels.type.clear}
          </Button>
        </div>
      )}

      {/* A server rule, surfaced as a field rather than as a 422. */}
      {isOther && (
        <TextField
          {...props}
          field="otherType"
          copy={labels.type.other}
          required
          maxLength={MAX_SAFE_TEXT}
        />
      )}

      {errors.complaintTypeCd !== undefined && (
        <FieldError id={`${fieldId("complaintTypeCd")}-error`}>
          {labels.fieldError(errors.complaintTypeCd)}
        </FieldError>
      )}
    </Panel>
  );
}

export type PropertyProps = FieldGroupProps & { propertyTypes: Vocabulary };

/** The owner, the building and where it stands. Figma's "Property Address". */
export function PropertyPanel(props: PropertyProps) {
  const { labels, propertyTypes } = props;

  return (
    <Panel title={labels.property.legend}>
      <Row>
        <TextField
          {...props}
          field="ownerName"
          copy={labels.property.ownerName}
          maxLength={MAX_NAME}
        />
        <TextField
          {...props}
          field="ownerPhone"
          copy={labels.property.ownerPhone}
          inputMode="tel"
        />
      </Row>

      <Row>
        <SelectField
          {...props}
          field="propertyTypeCd"
          copy={labels.property.propertyType}
          options={propertyTypes.options}
          loading={propertyTypes.loading}
          unavailable={propertyTypes.unavailable}
          unavailableText={labels.type.unavailable}
        />
        <TextField
          {...props}
          field="floorCount"
          copy={labels.property.floors}
          inputMode="numeric"
        />
      </Row>

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
          required
          maxLength={MAX_NAME}
        />
        <TextField
          {...props}
          field="policeStation"
          copy={labels.property.policeStation}
          maxLength={MAX_NAME}
        />
      </Row>

      <Row>
        <TextField
          {...props}
          field="district"
          copy={labels.property.district}
          required
          maxLength={MAX_NAME}
        />
        <TextField
          {...props}
          field="pinCode"
          copy={labels.property.pinCode}
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
        />
      </Row>

      <Row>
        <TextField
          {...props}
          field="state"
          copy={labels.property.state}
          required
          maxLength={MAX_NAME}
        />
        <TextField
          {...props}
          field="country"
          copy={labels.property.country}
          required
          maxLength={MAX_NAME}
        />
      </Row>
    </Panel>
  );
}

/**
 * The parcel's land-records identity — Figma's "Parcel ID" slot, as real columns.
 *
 * Every one is optional. `parcelId.ts` records why: a case filed by telephone
 * about "the building behind the bus stand" genuinely has no parcel, and a
 * create screen that refused one would make a whole class of real complaint
 * unfileable.
 */
export function ParcelPanel(props: FieldGroupProps) {
  const { labels } = props;

  return (
    <Panel title={labels.parcel.legend} hint={labels.parcel.hint}>
      <Row>
        <TextField {...props} field="ulpin" copy={labels.parcel.ulpin} maxLength={14} />
        <TextField
          {...props}
          field="khasraNo"
          copy={labels.parcel.khasra}
          maxLength={MAX_KHASRA}
        />
      </Row>
      <Row>
        <TextField
          {...props}
          field="villageLgdCode"
          copy={labels.parcel.village}
          inputMode="numeric"
          maxLength={12}
        />
        <TextField
          {...props}
          field="districtLgdCode"
          copy={labels.parcel.districtCode}
          inputMode="numeric"
          maxLength={12}
        />
      </Row>
    </Panel>
  );
}

export type DescriptionProps = FieldGroupProps & { priorities: readonly CodeOption[] };

/** What was seen, and how urgently it needs looking at. */
export function DescriptionPanel(props: DescriptionProps) {
  const { labels, state, onChange, disabled, errors, priorities } = props;
  const id = fieldId("detail");
  const problem = errors.detail;
  const described = [`${id}-hint`, problem === undefined ? undefined : `${id}-error`]
    .filter((value) => value !== undefined)
    .join(" ");

  return (
    <Panel title={labels.detail.legend}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel
          htmlFor={id}
          text={labels.detail.label}
          required
          requiredWord={labels.required}
        />
        <Textarea
          id={id}
          rows={4}
          value={state.detail}
          maxLength={MAX_LONG_TEXT}
          disabled={disabled}
          placeholder={labels.detail.placeholder}
          aria-required
          aria-invalid={problem !== undefined}
          aria-describedby={described}
          onChange={(event) => {
            onChange({ ...state, detail: event.target.value });
          }}
        />
        <Hint id={`${id}-hint`}>{labels.detail.hint}</Hint>
        {problem !== undefined && (
          <FieldError id={`${id}-error`}>{labels.fieldError(problem)}</FieldError>
        )}
      </div>

      <div className="sm:max-w-xs">
        <SelectField {...props} field="priority" copy={labels.priority} options={priorities} />
      </div>
    </Panel>
  );
}
