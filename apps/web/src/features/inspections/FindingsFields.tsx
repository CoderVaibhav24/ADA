/**
 * The findings form's fields. Three groups, no state of their own.
 *
 * Each takes the whole `FindingsFormState` and hands back the next one, so the
 * screen above owns the single copy that the unsaved-changes guard and the
 * request body are both computed from. A field holding its own value would be
 * a second source of truth for the same round.
 *
 * What Figma 60:641 draws and what the API stores are not the same set, and
 * the differences are deliberate:
 *
 *   - **the findings list and the cited sections are not on the frame at all.**
 *     Sections sit under the notice's act, inside the notice group.
 *     `FindingsPut.findings` is a list with `min_length=1` and
 *     `icms_inspection_section` is a table; one "Inspection Remarks" box cannot
 *     carry either. The frame's remarks box is `officer_note`, the free-text
 *     field beside them.
 *   - **"Measured Encroached Area" is square metres here**, not the frame's
 *     `sq. ft`: `icms_inspection.measured_area_sqm` is the column, and a form
 *     that collects feet into a metres column is a silent 10.7x error.
 *   - **"Encroachment Confirmed" and "External Support Required" are dropped.**
 *     Neither has a column in `models_icms.py`, so anything typed into them
 *     would be discarded by the server without saying so.
 *   - **"Site Photographs" is not here.** Evidence is append-only and is added
 *     by `ADD_EVIDENCE` on the detail screen; a thumbnail strip on a form whose
 *     Save cannot write it would read as an upload control that does nothing.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/lib/icons";
import type { FindingsLabels } from "./findingsLabels";
import {
  MAX_FINDINGS,
  MAX_LONG_TEXT,
  MAX_NAME,
  addFinding,
  addSection,
  hasSection,
  moveFinding,
  removeFinding,
  removeSection,
  setFindingText,
  setNoticeAct,
  setNoticeRequired,
  sideArea,
  type FindingsFormErrors,
  type FindingsFormState,
} from "./findingsForm";
import type { Vocabulary } from "./useFindings";

export type FieldGroupProps = {
  labels: FindingsLabels;
  state: FindingsFormState;
  onChange: (next: FindingsFormState) => void;
  /** True when the workflow has not offered `record_findings` to this caller. */
  disabled: boolean;
  /** Only after a save is attempted: a form is not wrong before it is used. */
  errors: FindingsFormErrors;
};

/** Where a refused save sends the focus, and what its message points at. */
export const FIRST_FINDING_ID = "findings-item-1";

// One panel per group, matching the policy area's so the two read as one product.
function Panel({
  title,
  hint,
  aside,
  children,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose min-w-0">
          <h2 className="font-display text-lg font-semibold text-fg-strong">{title}</h2>
          {hint && <p className="mt-1 text-sm text-fg-muted text-pretty">{hint}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
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

/**
 * The findings themselves — add, edit, reorder, remove.
 *
 * An `<ol>`, because the order is meaningful: it is the `seq` the server
 * stores and the order the round is read back in. Reordering is two buttons
 * rather than a drag handle, which is what makes it reachable from a keyboard
 * and usable on a phone at the site.
 */
export function FindingsList({ labels, state, onChange, disabled, errors }: FieldGroupProps) {
  const atCap = state.findings.length >= MAX_FINDINGS;
  const invalid = errors.findings !== undefined;

  return (
    <Panel title={labels.list.label} hint={labels.list.hint}>
      <ol className="flex flex-col gap-3">
        {state.findings.map((item, index) => {
          const fieldId = `findings-item-${String(index + 1)}`;
          return (
            <li key={item.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={fieldId} className="text-xs text-fg-muted">
                  {labels.list.itemLabel(index + 1)}
                </Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || index === 0}
                    aria-label={labels.list.moveUp(index + 1)}
                    onClick={() => {
                      onChange(moveFinding(state, item.id, -1));
                    }}
                  >
                    <Icon name="form.chevronUp" className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || index === state.findings.length - 1}
                    aria-label={labels.list.moveDown(index + 1)}
                    onClick={() => {
                      onChange(moveFinding(state, item.id, 1));
                    }}
                  >
                    <Icon name="form.chevronDown" className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={labels.list.remove(index + 1)}
                    onClick={() => {
                      onChange(removeFinding(state, item.id));
                    }}
                  >
                    <Icon name="action.delete" className="size-4" />
                  </Button>
                </div>
              </div>

              <Textarea
                id={fieldId}
                value={item.text}
                rows={2}
                maxLength={MAX_LONG_TEXT}
                disabled={disabled}
                placeholder={labels.list.placeholder}
                aria-invalid={invalid}
                aria-describedby={invalid ? "findings-error" : undefined}
                onChange={(event) => {
                  onChange(setFindingText(state, item.id, event.target.value));
                }}
              />
            </li>
          );
        })}
      </ol>

      {/* The empty sentence stays under a single blank row: the list is never
          literally empty on screen, and "add the first one" is the instruction
          that row is waiting for. */}
      {state.findings.every((item) => item.text.trim() === "") && (
        <p className="text-xs text-fg-faint">{labels.list.empty}</p>
      )}

      {errors.findings === "required" && (
        <FieldError id="findings-error">{labels.list.required}</FieldError>
      )}
      {errors.findings === "tooMany" && (
        <FieldError id="findings-error">{labels.list.max(MAX_FINDINGS)}</FieldError>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || atCap}
          onClick={() => {
            onChange(addFinding(state));
          }}
        >
          <Icon name="action.add" className="size-4" />
          {labels.list.add}
        </Button>
        {/* A dead button with no explanation is what this screen must not do.
            The cap is the server's, and it is said out loud. */}
        {atCap && <span className="text-xs text-fg-muted">{labels.list.max(MAX_FINDINGS)}</span>}
      </div>
    </Panel>
  );
}

type SectionsPickerProps = {
  labels: FindingsLabels;
  state: FindingsFormState;
  onChange: (next: FindingsFormState) => void;
  disabled: boolean;
  sections: Vocabulary;
};

// Sections of the notice's act only, via `parent_code`; ticking one cites it.
function SectionsPicker({ labels, state, onChange, disabled, sections }: SectionsPickerProps) {
  const actCd = state.noticeActCd;
  const forAct = sections.options.filter((option) => option.parent === actCd);

  let body: ReactNode;
  if (actCd === "") body = <Hint id="sections-hint">{labels.sections.chooseAct}</Hint>;
  else if (sections.unavailable) body = <Hint id="sections-hint">{labels.sections.unavailable}</Hint>;
  else if (!sections.loading && forAct.length === 0)
    body = <Hint id="sections-hint">{labels.sections.noneForAct}</Hint>;
  else
    body = (
      <ul className="grid gap-2 sm:grid-cols-2">
        {forAct.map((option) => {
          const id = `section-${option.value}`;
          const checked = hasSection(state, actCd, option.value);
          return (
            <li key={option.value} className="flex items-start gap-2">
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled || sections.loading}
                onCheckedChange={(next) => {
                  onChange(
                    next === true
                      ? addSection(state, actCd, option.value)
                      : removeSection(state, actCd, option.value),
                  );
                }}
              />
              <Label htmlFor={id} className="text-sm font-normal break-words">
                {option.label}
              </Label>
            </li>
          );
        })}
      </ul>
    );

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-fg-base">{labels.sections.label}</legend>
      {body}
    </fieldset>
  );
}

export type ObservationFieldsProps = FieldGroupProps & {
  areaTypes: Vocabulary;
  constructionStages: Vocabulary;
  acts: Vocabulary;
  sections: Vocabulary;
};

type CodeSelectProps = {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  vocabulary: Vocabulary;
  disabled: boolean;
  onValueChange: (next: string) => void;
};

// One `icms_code_value` domain as a dropdown.
function CodeSelect({ id, label, placeholder, value, vocabulary, disabled, onValueChange }: CodeSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === "" ? undefined : value}
        disabled={disabled || vocabulary.loading || vocabulary.unavailable}
        onValueChange={onValueChange}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {vocabulary.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type NumberFieldProps = {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  error?: string;
  onValueChange: (next: string) => void;
};

// A decimal typed as text, with its error said in words.
function NumberField({ id, label, value, disabled, error, onValueChange }: NumberFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        autoComplete="off"
        className="tabular"
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
      />
      {error !== undefined && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

type PhoneFieldProps = {
  id: string;
  label: string;
  hint: string;
  invalidText: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onValueChange: (next: string) => void;
};

// An Indian mobile number; blank is allowed.
function PhoneField({ id, label, hint, invalidText, value, disabled, invalid, onValueChange }: PhoneFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : `${id}-hint`}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
      />
      {invalid ? (
        <FieldError id={`${id}-error`}>{invalidText}</FieldError>
      ) : (
        <Hint id={`${id}-hint`}>{hint}</Hint>
      )}
    </div>
  );
}

/** Occupant, owner, measurement, notice and the officer's note — none of them mandatory. */
export function ObservationFields({
  labels,
  state,
  onChange,
  disabled,
  errors,
  areaTypes,
  constructionStages,
  acts,
  sections,
}: ObservationFieldsProps) {
  const derived = state.measuredArea.trim() === "" ? sideArea(state) : null;

  return (
    <Panel title={labels.occupant.legend}>
      {/* Two columns from `sm` up, one below it: on a 360px phone a two-column
          form halves the width of a ten-digit number field. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="occupant-name">{labels.occupant.nameLabel}</Label>
          <Input
            id="occupant-name"
            value={state.occupantName}
            maxLength={MAX_NAME}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => {
              onChange({ ...state, occupantName: event.target.value });
            }}
          />
        </div>

        <PhoneField
          id="occupant-phone"
          label={labels.occupant.phoneLabel}
          hint={labels.occupant.phoneHint}
          invalidText={labels.occupant.phoneInvalid}
          value={state.occupantPhone}
          disabled={disabled}
          invalid={errors.phone !== undefined}
          onValueChange={(next) => {
            onChange({ ...state, occupantPhone: next });
          }}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-name">{labels.owner.nameLabel}</Label>
          <Input
            id="owner-name"
            value={state.ownerName}
            maxLength={MAX_NAME}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => {
              onChange({ ...state, ownerName: event.target.value });
            }}
          />
        </div>

        <PhoneField
          id="owner-phone"
          label={labels.owner.phoneLabel}
          hint={labels.occupant.phoneHint}
          invalidText={labels.occupant.phoneInvalid}
          value={state.ownerPhone}
          disabled={disabled}
          invalid={errors.ownerPhone !== undefined}
          onValueChange={(next) => {
            onChange({ ...state, ownerPhone: next });
          }}
        />
      </div>

      <div className="grid gap-4 border-t border-line-subtle pt-4 sm:grid-cols-2">
        <CodeSelect
          id="area-type"
          label={labels.measurement.areaTypeLabel}
          placeholder={labels.measurement.areaTypePlaceholder}
          value={state.areaTypeCd}
          vocabulary={areaTypes}
          disabled={disabled}
          onValueChange={(next) => {
            onChange({ ...state, areaTypeCd: next });
          }}
        />

        <CodeSelect
          id="construction-stage"
          label={labels.measurement.stageLabel}
          placeholder={labels.measurement.areaTypePlaceholder}
          value={state.constructionStageCd}
          vocabulary={constructionStages}
          disabled={disabled}
          onValueChange={(next) => {
            onChange({ ...state, constructionStageCd: next });
          }}
        />

        <NumberField
          id="length-m"
          label={labels.measurement.lengthLabel}
          value={state.lengthM}
          disabled={disabled}
          error={errors.length === undefined ? undefined : labels.measurement.sideInvalid}
          onValueChange={(next) => {
            onChange({ ...state, lengthM: next });
          }}
        />

        <NumberField
          id="width-m"
          label={labels.measurement.widthLabel}
          value={state.widthM}
          disabled={disabled}
          error={errors.width === undefined ? undefined : labels.measurement.sideInvalid}
          onValueChange={(next) => {
            onChange({ ...state, widthM: next });
          }}
        />

        {/* Square metres, because `measured_area_sqm` is the column. */}
        <div className="flex flex-col gap-1.5">
          <NumberField
            id="measured-area"
            label={labels.measurement.areaLabel}
            value={state.measuredArea}
            disabled={disabled}
            error={errors.area === undefined ? undefined : labels.measurement.areaInvalid}
            onValueChange={(next) => {
              onChange({ ...state, measuredArea: next });
            }}
          />
          {derived !== null && errors.area === undefined && (
            <Hint id="measured-area-derived">{labels.measurement.derivedArea(String(derived))}</Hint>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 border-t border-line-subtle pt-4">
        <legend className="sr-only">{labels.notice.legend}</legend>
        <div className="flex items-center gap-3">
          <Switch
            id="notice-required"
            checked={state.noticeRequired}
            disabled={disabled}
            onCheckedChange={(checked) => {
              onChange(setNoticeRequired(state, checked));
            }}
          />
          <Label htmlFor="notice-required">{labels.notice.requiredLabel}</Label>
        </div>

        {/* Act and sections only with a notice: the server refuses an act without one. */}
        {state.noticeRequired && (
          <>
            <div className="flex max-w-md flex-col gap-1.5">
              <Label htmlFor="notice-act">{labels.notice.actLabel}</Label>
              {acts.unavailable ? (
                <p role="status" className="max-w-prose text-xs text-fg-muted text-pretty">
                  {labels.sections.unavailable}
                </p>
              ) : (
                <Select
                  value={state.noticeActCd === "" ? undefined : state.noticeActCd}
                  disabled={disabled || acts.loading}
                  onValueChange={(next) => {
                    onChange(setNoticeAct(state, next));
                  }}
                >
                  <SelectTrigger id="notice-act" className="w-full">
                    <SelectValue placeholder={labels.notice.actPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {acts.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <SectionsPicker
              labels={labels}
              state={state}
              onChange={onChange}
              disabled={disabled}
              sections={sections}
            />
          </>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5 border-t border-line-subtle pt-4">
        <Label htmlFor="officer-note">{labels.note.label}</Label>
        <Textarea
          id="officer-note"
          value={state.officerNote}
          rows={4}
          maxLength={MAX_LONG_TEXT}
          disabled={disabled}
          aria-describedby="officer-note-hint"
          onChange={(event) => {
            onChange({ ...state, officerNote: event.target.value });
          }}
        />
        <Hint id="officer-note-hint">{labels.note.hint}</Hint>
      </div>
    </Panel>
  );
}
