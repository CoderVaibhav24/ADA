/**
 * The Notice Create form's fields, and the template panel beside them.
 *
 * Each group takes the whole `NoticeFormState` and hands back the next one, so
 * the screen above owns the single copy that the unsaved-changes guard and the
 * request body are both computed from. A field holding its own value would be a
 * second source of truth for the same notice.
 *
 * What Figma 69:2961 draws and what `NoticeCreate` stores are not the same set,
 * and every difference is deliberate:
 *
 *   - **"Notice Type" is the ACT and its SECTIONS.** There is no notice-type
 *     vocabulary: `icms_notice` stores `act_cd` and `section_cds`, and
 *     `?domain=act` / `?domain=section` are what the reference table seeds. So
 *     the single select becomes two controls — the act, and the sections of
 *     that act — which is the same decision with the legal citation the
 *     document actually needs.
 *   - **"Recipient Name" and "Recipient Address" are NOT collected here.**
 *     `NoticeCreate` has no field for either; the addressee and the property
 *     are the CASE's, and the server reads them from `icms_case` when it
 *     renders. Two boxes whose contents are discarded would be a form lying
 *     about what it stores, so the case's own values are shown read-only
 *     instead — which is also the only way an officer can check they are
 *     issuing against the right property before pressing the button.
 *   - **"Survey / Khasra No." is NOT collected here**, for the same reason. It
 *     is `icms_case.khasra_no`, shown read-only. A notice that cited a
 *     different khasra number from its own case would be a defect, not a
 *     feature.
 *   - **"Encroached Area" is NOT collected here.** The measured area belongs to
 *     the inspection round (`icms_inspection.measured_area_sqm`) and is
 *     established by a surveyor standing at the site. Re-typing it on the
 *     notice form would let an officer contradict the survey in the document
 *     that goes to court.
 *   - **the template panel is a checklist, not a preview.** It lists what the
 *     rendered notice will contain. It cannot show the document: nothing is
 *     rendered until the notice exists, and the notice does not exist until
 *     this form posts.
 */

import type { ReactNode } from "react";
import type { CaseRow } from "@/api/icms/cases";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Icon } from "@/lib/icons";
import {
  MAX_LONG_TEXT,
  MAX_SAFE_TEXT,
  fieldId,
  setAct,
  toggleSection,
  type NoticeFormErrors,
  type NoticeFormState,
} from "./noticeForm";
import type { NoticeNewLabels } from "./noticeLabels";
import type { Vocabulary } from "./useNotices";

export type NoticeFieldsProps = {
  labels: NoticeNewLabels;
  state: NoticeFormState;
  onChange: (next: NoticeFormState) => void;
  /** True while the gate is closed or a submit is in flight. */
  disabled: boolean;
  /** Only after a submit is attempted: a form is not wrong before it is used. */
  errors: NoticeFormErrors;
  acts: Vocabulary;
  sections: Vocabulary;
  /** The confirmed cases this officer may issue against. Empty until they load. */
  cases: readonly CaseRow[];
  casesLoading: boolean;
  /** Absent when the officer holds no `case.read` — then the reference is typed. */
  casePickerAvailable: boolean;
  /** Locale-aware, injected: the picker ships no formatter of its own. */
  formatDate: (value: Date) => string;
};

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
  id,
  htmlFor,
  text,
  required,
  requiredWord,
}: {
  id?: string;
  htmlFor: string;
  text: string;
  required?: boolean;
  requiredWord: string;
}) {
  return (
    <Label id={id} htmlFor={htmlFor} className="text-sm text-fg-base">
      {text}
      {required && (
        <>
          <span aria-hidden className="text-status-danger-fg">
            *
          </span>
          <span className="sr-only">{requiredWord}</span>
        </>
      )}
    </Label>
  );
}

// Local-time parse/format, the same pair `filters.tsx` uses: `new Date("2026-09-15")`
// is UTC midnight, which is the previous day in a negative-offset timezone.
function fromIsoDate(value: string): Date | undefined {
  if (value === "") return undefined;
  const parts = value.split("-").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function toIsoDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function NoticeFields({
  labels,
  state,
  onChange,
  disabled,
  errors,
  acts,
  sections,
  cases,
  casesLoading,
  casePickerAvailable,
  formatDate,
}: NoticeFieldsProps) {
  const sectionOrder = sections.options.map((option) => option.value);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
      {/* ---- the case ------------------------------------------------- */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel
          htmlFor={fieldId("caseRef")}
          text={labels.caseLabel}
          required
          requiredWord={labels.required}
        />
        {casePickerAvailable ? (
          <Select
            value={state.caseRef === "" ? undefined : state.caseRef}
            disabled={disabled || casesLoading}
            onValueChange={(value) => {
              onChange({ ...state, caseRef: value });
            }}
          >
            <SelectTrigger
              id={fieldId("caseRef")}
              aria-describedby={`${fieldId("caseRef")}-hint`}
              aria-invalid={errors.caseRef !== undefined}
              className="w-full"
            >
              <SelectValue placeholder={labels.casePlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {cases.map((row) => (
                <SelectItem key={row.case_ref} value={row.case_ref}>
                  {/* The address beside the reference: an officer picks the
                      property they inspected, not a number they memorised. */}
                  {row.property_address
                    ? `${row.case_ref} — ${row.property_address}`
                    : row.case_ref}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // No `case.read` means no list to pick from. A typed reference still
          // works: the server resolves it and refuses what this caller may not
          // touch, which is the same answer the picker would have given.
          <Input
            id={fieldId("caseRef")}
            value={state.caseRef}
            disabled={disabled}
            aria-describedby={`${fieldId("caseRef")}-hint`}
            aria-invalid={errors.caseRef !== undefined}
            placeholder={labels.casePlaceholder}
            onChange={(event) => {
              onChange({ ...state, caseRef: event.target.value });
            }}
          />
        )}
        <Hint id={`${fieldId("caseRef")}-hint`}>{labels.caseHint}</Hint>
        {errors.caseRef && (
          <FieldError id={`${fieldId("caseRef")}-error`}>
            {labels.problems[errors.caseRef as keyof typeof labels.problems]}
          </FieldError>
        )}
      </div>

      {/* ---- the act -------------------------------------------------- */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel
          htmlFor={fieldId("actCd")}
          text={labels.actLabel}
          required
          requiredWord={labels.required}
        />
        <Select
          value={state.actCd === "" ? undefined : state.actCd}
          disabled={disabled || acts.loading || acts.unavailable}
          onValueChange={(value) => {
            // Changing the act clears the sections — a section belongs to
            // exactly one act. See noticeForm.setAct.
            onChange(setAct(state, value));
          }}
        >
          <SelectTrigger
            id={fieldId("actCd")}
            aria-describedby={`${fieldId("actCd")}-hint`}
            aria-invalid={errors.actCd !== undefined}
            className="w-full"
          >
            <SelectValue placeholder={labels.actPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {acts.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Hint id={`${fieldId("actCd")}-hint`}>
          {acts.unavailable ? labels.actUnavailable : labels.actHint}
        </Hint>
        {errors.actCd && (
          <FieldError id={`${fieldId("actCd")}-error`}>
            {labels.problems[errors.actCd as keyof typeof labels.problems]}
          </FieldError>
        )}
      </div>

      {/* ---- the sections --------------------------------------------- */}
      <fieldset
        className="flex min-w-0 flex-col gap-2 md:col-span-2"
        aria-describedby={`${fieldId("sectionCds")}-hint`}
        aria-invalid={errors.sectionCds !== undefined}
      >
        <legend className="text-sm text-fg-base">
          {labels.sectionsLabel}
          <span aria-hidden className="text-status-danger-fg">
            *
          </span>
          <span className="sr-only">{labels.required}</span>
        </legend>

        {state.actCd === "" ? (
          <p className="text-sm text-fg-faint">{labels.sectionsNoAct}</p>
        ) : sections.unavailable ? (
          <p className="text-sm text-fg-faint">{labels.sectionsUnavailable}</p>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {sections.options.map((option) => {
              const id = `${fieldId("sectionCds")}-${option.value}`;
              return (
                <div key={option.value} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={state.sectionCds.includes(option.value)}
                    disabled={disabled}
                    onCheckedChange={() => {
                      onChange(toggleSection(state, option.value, sectionOrder));
                    }}
                  />
                  <Label htmlFor={id} className="text-sm font-normal text-fg-base">
                    {option.label}
                  </Label>
                </div>
              );
            })}
          </div>
        )}

        <Hint id={`${fieldId("sectionCds")}-hint`}>
          {state.sectionCds.length > 0
            ? labels.sectionsChosen(state.sectionCds.length)
            : labels.sectionsHint}
        </Hint>
        {errors.sectionCds && (
          <FieldError id={`${fieldId("sectionCds")}-error`}>
            {labels.problems[errors.sectionCds as keyof typeof labels.problems]}
          </FieldError>
        )}
      </fieldset>

      {/* ---- the compliance date --------------------------------------- */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel
          id={`${fieldId("complianceDue")}-label`}
          htmlFor={fieldId("complianceDue")}
          text={labels.dueLabel}
          requiredWord={labels.required}
        />
        {/* The picker's trigger is a Button, which takes no `aria-describedby`
            of its own, so the hint and the error are associated at GROUP level.
            A screen reader announces both on entering the group, which is the
            only way this control can carry them. */}
        <div
          role="group"
          aria-labelledby={`${fieldId("complianceDue")}-label`}
          aria-describedby={
            errors.complianceDue !== undefined
              ? `${fieldId("complianceDue")}-hint ${fieldId("complianceDue")}-error`
              : `${fieldId("complianceDue")}-hint`
          }
          className="flex items-center gap-2"
        >
          <DatePicker
            value={fromIsoDate(state.complianceDue)}
            onChange={(value) => {
              onChange({ ...state, complianceDue: value ? toIsoDate(value) : "" });
            }}
            disabled={disabled}
            placeholder={labels.duePlaceholder}
            format={formatDate}
            id={fieldId("complianceDue")}
            invalid={errors.complianceDue !== undefined}
            className="w-full"
          />
          {state.complianceDue !== "" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={labels.dueClear}
              onClick={() => {
                onChange({ ...state, complianceDue: "" });
              }}
            >
              <Icon name="action.clear" className="size-4" />
            </Button>
          )}
        </div>
        <Hint id={`${fieldId("complianceDue")}-hint`}>{labels.dueHint}</Hint>
        {errors.complianceDue && (
          <FieldError id={`${fieldId("complianceDue")}-error`}>
            {labels.problems[errors.complianceDue as keyof typeof labels.problems]}
          </FieldError>
        )}
      </div>

      {/* ---- the issuing authority -------------------------------------- */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel
          htmlFor={fieldId("issuingAuthority")}
          text={labels.authorityLabel}
          requiredWord={labels.required}
        />
        <Input
          id={fieldId("issuingAuthority")}
          value={state.issuingAuthority}
          disabled={disabled}
          maxLength={MAX_SAFE_TEXT}
          placeholder={labels.authorityPlaceholder}
          aria-describedby={`${fieldId("issuingAuthority")}-hint`}
          aria-invalid={errors.issuingAuthority !== undefined}
          onChange={(event) => {
            onChange({ ...state, issuingAuthority: event.target.value });
          }}
        />
        <Hint id={`${fieldId("issuingAuthority")}-hint`}>{labels.authorityHint}</Hint>
        {errors.issuingAuthority && (
          <FieldError id={`${fieldId("issuingAuthority")}-error`}>
            {labels.problems[errors.issuingAuthority as keyof typeof labels.problems]}
          </FieldError>
        )}
      </div>

      {/* ---- the grounds ------------------------------------------------ */}
      <div className="flex min-w-0 flex-col gap-1.5 md:col-span-2">
        <FieldLabel
          htmlFor={fieldId("grounds")}
          text={labels.groundsLabel}
          requiredWord={labels.required}
        />
        <Textarea
          id={fieldId("grounds")}
          value={state.grounds}
          disabled={disabled}
          rows={5}
          maxLength={MAX_LONG_TEXT}
          placeholder={labels.groundsPlaceholder}
          aria-describedby={`${fieldId("grounds")}-hint`}
          aria-invalid={errors.grounds !== undefined}
          onChange={(event) => {
            onChange({ ...state, grounds: event.target.value });
          }}
        />
        <Hint id={`${fieldId("grounds")}-hint`}>
          {state.grounds.length > 0
            ? labels.charactersLeft(MAX_LONG_TEXT - state.grounds.length)
            : labels.groundsHint}
        </Hint>
        {errors.grounds && (
          <FieldError id={`${fieldId("grounds")}-error`}>
            {labels.problems[errors.grounds as keyof typeof labels.problems]}
          </FieldError>
        )}
      </div>
    </div>
  );
}

/**
 * The checklist Figma puts beside the form — what the rendered notice contains.
 *
 * Its last line is the one that matters most: the template is PROVISIONAL. The
 * layout is transcribed from Figma node 72:4743 into the notice-document
 * appendix of `docs/icms/batch-6-contract.md`, and it is replaced wholesale the
 * moment ADA supplies the official instrument (build-order §8 item 3).
 */
export function NoticeTemplatePanel({ labels }: { labels: NoticeNewLabels }) {
  return (
    <aside className="flex min-w-0 flex-col gap-3 rounded-lg border border-line-subtle bg-surface-1 p-4 sm:p-5">
      <h2 className="font-display text-2xs font-semibold tracking-wider uppercase text-fg-link">
        {labels.template.title}
      </h2>
      <p className="max-w-prose text-sm text-fg-muted text-pretty">{labels.template.intro}</p>
      <ul className="flex flex-col gap-2">
        {labels.template.items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-fg-base">
            <Icon
              name="form.check"
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-status-success-fg"
            />
            {item}
          </li>
        ))}
      </ul>
      <p className="max-w-prose border-t border-line-subtle pt-3 text-2xs text-fg-faint text-pretty">
        {labels.template.provisional}
      </p>
    </aside>
  );
}
