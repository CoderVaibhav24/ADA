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
import { useState } from "react";
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

export type SectionsEditorProps = FieldGroupProps & {
  acts: Vocabulary;
  sections: Vocabulary;
};

/**
 * The statutory sections the round cites.
 *
 * Two dependent pickers: `icms_code_value.parent_code` is what ties a section
 * to its act, so choosing an act narrows the second list. The pair is added to
 * a list rather than edited in place, because the server stores a set — sorted
 * and de-duplicated — not a row the form owns a slot in.
 */
export function SectionsEditor({
  labels,
  state,
  onChange,
  disabled,
  acts,
  sections,
}: SectionsEditorProps) {
  const [actCd, setActCd] = useState("");
  const [sectionCd, setSectionCd] = useState("");
  const [duplicate, setDuplicate] = useState(false);

  // A section with no parent belongs to no particular act, so it stays on offer
  // rather than disappearing because the vocabulary is only half filled in.
  const forAct = sections.options.filter(
    (option) => option.parent === null || option.parent === actCd,
  );
  const vocabularyMissing = acts.unavailable || sections.unavailable;

  const add = () => {
    if (actCd === "" || sectionCd === "") return;
    if (hasSection(state, actCd, sectionCd)) {
      setDuplicate(true);
      return;
    }
    setDuplicate(false);
    setSectionCd("");
    onChange(addSection(state, actCd, sectionCd));
  };

  return (
    <Panel title={labels.sections.label} hint={labels.sections.hint}>
      {state.sections.length === 0 ? (
        <p className="text-xs text-fg-faint">{labels.sections.none}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {state.sections.map((item) => (
            <li
              key={`${item.actCd}/${item.sectionCd}`}
              className="flex items-center gap-1 rounded-full border border-line-subtle bg-surface-2 py-1 ps-3 pe-1 text-xs text-fg-base"
            >
              <span className="break-words">
                {acts.label(item.actCd)} · {sections.label(item.sectionCd)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label={labels.sections.remove(
                  acts.label(item.actCd),
                  sections.label(item.sectionCd),
                )}
                onClick={() => {
                  onChange(removeSection(state, item.actCd, item.sectionCd));
                }}
              >
                <Icon name="action.close" className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {vocabularyMissing ? (
        // Not a dead dropdown: the vocabulary is a seeding gap, and the officer
        // is told so rather than left clicking an empty list.
        <p role="status" className="max-w-prose text-xs text-fg-muted text-pretty">
          {labels.sections.unavailable}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="section-act">{labels.sections.actLabel}</Label>
            <Select
              value={actCd === "" ? undefined : actCd}
              disabled={disabled || acts.loading}
              onValueChange={(next) => {
                setActCd(next);
                setSectionCd("");
                setDuplicate(false);
              }}
            >
              <SelectTrigger id="section-act" className="w-full">
                <SelectValue placeholder={labels.sections.actPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {acts.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="section-code">{labels.sections.sectionLabel}</Label>
            <Select
              value={sectionCd === "" ? undefined : sectionCd}
              disabled={disabled || actCd === "" || sections.loading}
              onValueChange={(next) => {
                setSectionCd(next);
                setDuplicate(false);
              }}
            >
              <SelectTrigger id="section-code" className="w-full">
                <SelectValue placeholder={labels.sections.sectionPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {forAct.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            disabled={disabled || actCd === "" || sectionCd === ""}
            onClick={add}
          >
            <Icon name="action.add" className="size-4" />
            {labels.sections.add}
          </Button>
        </div>
      )}

      {duplicate && <FieldError id="section-duplicate">{labels.sections.duplicate}</FieldError>}
    </Panel>
  );
}

export type ObservationFieldsProps = FieldGroupProps & {
  areaTypes: Vocabulary;
  acts: Vocabulary;
};

/** Occupant, measurement, notice and the officer's note — the frame's own fields. */
export function ObservationFields({
  labels,
  state,
  onChange,
  disabled,
  errors,
  areaTypes,
  acts,
}: ObservationFieldsProps) {
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="occupant-phone">{labels.occupant.phoneLabel}</Label>
          <Input
            id="occupant-phone"
            type="tel"
            inputMode="numeric"
            value={state.occupantPhone}
            disabled={disabled}
            autoComplete="off"
            aria-invalid={errors.phone !== undefined}
            aria-describedby={
              errors.phone === undefined ? "occupant-phone-hint" : "occupant-phone-error"
            }
            onChange={(event) => {
              onChange({ ...state, occupantPhone: event.target.value });
            }}
          />
          {errors.phone === undefined ? (
            <Hint id="occupant-phone-hint">{labels.occupant.phoneHint}</Hint>
          ) : (
            <FieldError id="occupant-phone-error">{labels.occupant.phoneInvalid}</FieldError>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="area-type">{labels.measurement.areaTypeLabel}</Label>
          <Select
            value={state.areaTypeCd === "" ? undefined : state.areaTypeCd}
            disabled={disabled || areaTypes.loading || areaTypes.unavailable}
            onValueChange={(next) => {
              onChange({ ...state, areaTypeCd: next });
            }}
          >
            <SelectTrigger id="area-type" className="w-full">
              <SelectValue placeholder={labels.measurement.areaTypePlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {areaTypes.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          {/* Square metres, because `measured_area_sqm` is the column. The unit
              is in the label rather than in a suffix, so it is read out too. */}
          <Label htmlFor="measured-area">{labels.measurement.areaLabel}</Label>
          <Input
            id="measured-area"
            type="text"
            inputMode="decimal"
            value={state.measuredArea}
            disabled={disabled}
            autoComplete="off"
            className="tabular"
            aria-invalid={errors.area !== undefined}
            aria-describedby={errors.area === undefined ? undefined : "measured-area-error"}
            onChange={(event) => {
              onChange({ ...state, measuredArea: event.target.value });
            }}
          />
          {errors.area !== undefined && (
            <FieldError id="measured-area-error">{labels.measurement.areaInvalid}</FieldError>
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
              onChange({ ...state, noticeRequired: checked });
            }}
          />
          <Label htmlFor="notice-required">{labels.notice.requiredLabel}</Label>
        </div>

        {/* The act matters only once a notice is required, and it is required
            then: `notice_act_cd` with no notice is a value nothing reads. */}
        {state.noticeRequired && (
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
                  onChange({ ...state, noticeActCd: next });
                }}
              >
                <SelectTrigger
                  id="notice-act"
                  className="w-full"
                  aria-invalid={errors.noticeAct !== undefined}
                  aria-describedby={
                    errors.noticeAct === undefined ? undefined : "notice-act-error"
                  }
                >
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
            {errors.noticeAct !== undefined && (
              <FieldError id="notice-act-error">{labels.notice.actRequired}</FieldError>
            )}
          </div>
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
