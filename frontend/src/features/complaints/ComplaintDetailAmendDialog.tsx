/**
 * Amend — `PATCH /cases/{ref}`, the descriptive fields and nothing else.
 *
 * ## Only what changed is sent
 *
 * `CaseAmend.changes()` is `model_dump(exclude_unset=True)`, so every key in
 * the body is written. A form that posted all twenty-two fields would rewrite
 * the whole record on every save — and an untouched field that arrived as null
 * would ERASE a value nobody meant to touch. `amendDiff` is what stops that:
 * the body is the difference between the case and the form, an emptied input
 * is an explicit null, and an input that was already empty is simply absent.
 *
 * ## Only the fields `CaseAmend` names
 *
 * `status`, `stage_no`, `zone_cd` and `case_ref` are not fields of the request
 * model — `extra="forbid"` refuses them by name — so there is no control for
 * them here. The status moves through the workflow's own actions or not at all.
 *
 * ## Complaint type is the only picker
 *
 * `icms_code_value` is a real vocabulary with a Hindi label beside each code,
 * and the register already fetches it. Property type has no seeded domain in
 * this batch, so it stays a code input rather than a `Select` with nothing to
 * populate it.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { CASE_PRIORITIES, type CaseAmend, type CaseDetail } from "@/api/icms/cases";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useLanguage } from "@/i18n";
import { usePriorityLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import type { ComplaintDetailLabels } from "./ComplaintDetailLabels";
import {
  amendDiff,
  draftFromCase,
  hasChanges,
  otherTypeMissing,
  type AmendDraft,
  type AmendField,
} from "./ComplaintDetailModel";
import { WriteOutcome } from "./ComplaintDetailParts";
import { useComplaintTypes } from "./useCases";

/** A labelled section of the form, so twenty-two inputs read as five groups. */
function Group({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-line-subtle bg-surface-2 p-4">
      <legend className="px-1 text-2xs font-semibold text-fg-muted">{title}</legend>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function ComplaintDetailAmendDialog({
  open,
  onOpenChange,
  detail,
  labels,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: CaseDetail;
  labels: ComplaintDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: CaseAmend) => void;
}) {
  const uid = useId();
  const priorityLabels = usePriorityLabels();
  const { language } = useLanguage();
  const types = useComplaintTypes();

  const [draft, setDraft] = useState<AmendDraft>(() => draftFromCase(detail));

  const diff = amendDiff(detail, draft);
  const typeContradiction = otherTypeMissing(draft);
  const nothingChanged = !hasChanges(diff);
  const blocked = nothingChanged || diff.invalid.length > 0 || typeContradiction;

  const set = (field: AmendField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const fieldId = (field: AmendField) => `${uid}-${field}`;

  const text = (
    field: AmendField,
    options: { type?: string; wide?: boolean; rows?: number } = {},
  ) => {
    const { type = "text", wide = false, rows } = options;
    return (
      <div
        className={
          wide
            ? "flex min-w-0 flex-col gap-1.5 sm:col-span-2"
            : "flex min-w-0 flex-col gap-1.5"
        }
      >
        <Label htmlFor={fieldId(field)}>{labels.fields[field]}</Label>
        {rows === undefined ? (
          <Input
            id={fieldId(field)}
            type={type}
            value={draft[field]}
            autoComplete="off"
            onChange={(event) => {
              set(field, event.target.value);
            }}
          />
        ) : (
          <Textarea
            id={fieldId(field)}
            rows={rows}
            value={draft[field]}
            onChange={(event) => {
              set(field, event.target.value);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-pretty">
            {labels.amend.title} — {detail.case_ref}
          </DialogTitle>
          <DialogDescription className="text-pretty">{labels.amend.body}</DialogDescription>
        </DialogHeader>

        {/* The form is taller than a modal on a laptop; the header, the outcome
            and the footer stay put while the fields scroll. */}
        <div className="-mx-1 flex max-h-[60vh] min-w-0 flex-col gap-4 overflow-y-auto px-1">
          <Group title={labels.amend.groups.complaint}>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={fieldId("complaint_type_cd")}>
                {labels.fields.complaint_type_cd}
              </Label>
              <Select
                value={draft.complaint_type_cd === "" ? undefined : draft.complaint_type_cd}
                disabled={types.isPending}
                onValueChange={(next) => {
                  set("complaint_type_cd", next);
                }}
              >
                <SelectTrigger id={fieldId("complaint_type_cd")} className="w-full">
                  <SelectValue placeholder={labels.amend.typePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {(types.data ?? []).map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {language === "hi-IN" ? (option.label_hi ?? option.label) : option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {text("other_type")}

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={fieldId("priority")}>{labels.fields.priority}</Label>
              <Select
                value={draft.priority === "" ? undefined : draft.priority}
                onValueChange={(next) => {
                  set("priority", next);
                }}
              >
                <SelectTrigger id={fieldId("priority")} className="w-full">
                  <SelectValue placeholder={labels.amend.priorityPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {CASE_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {priorityLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {text("detail", { wide: true, rows: 4 })}

            {typeContradiction && (
              <p className="text-2xs text-status-danger-fg sm:col-span-2">
                {labels.amend.otherTypeRequired}
              </p>
            )}
          </Group>

          <Group title={labels.amend.groups.complainant}>
            {text("complainant_name")}
            {text("complainant_phone", { type: "tel" })}
            {text("complainant_email", { type: "email", wide: true })}
          </Group>

          <Group title={labels.amend.groups.owner}>
            {text("owner_name")}
            {text("owner_phone", { type: "tel" })}
          </Group>

          <Group title={labels.amend.groups.property}>
            {text("property_address", { wide: true })}
            {text("landmark")}
            {text("police_station")}
            {text("pin_code")}
            {text("district")}
            {text("state")}
            {text("country")}
            {text("property_type_cd")}

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={fieldId("floor_count")}>{labels.fields.floor_count}</Label>
              <Input
                id={fieldId("floor_count")}
                type="number"
                min={0}
                max={200}
                step={1}
                value={draft.floor_count}
                aria-invalid={diff.invalid.includes("floor_count") || undefined}
                aria-describedby={`${fieldId("floor_count")}-hint`}
                onChange={(event) => {
                  set("floor_count", event.target.value);
                }}
              />
              {diff.invalid.includes("floor_count") && (
                <p
                  id={`${fieldId("floor_count")}-hint`}
                  className="text-2xs text-status-danger-fg"
                >
                  {labels.amend.invalidFloors}
                </p>
              )}
            </div>
          </Group>

          <Group title={labels.amend.groups.parcel}>
            {text("ulpin")}
            {text("khasra_no")}
            {text("village_lgd_code")}
            {text("district_lgd_code")}
          </Group>
        </div>

        <p className="max-w-prose text-2xs text-fg-faint text-pretty">{labels.amend.advisory}</p>

        {/* Says why Save is unavailable rather than leaving a dead button. */}
        {nothingChanged && (
          <p aria-live="polite" className="text-2xs text-fg-faint text-pretty">
            {labels.amend.nothingChanged}
          </p>
        )}

        <WriteOutcome error={error} saved={false} labels={labels} />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {labels.cancel}
          </Button>
          <Button
            disabled={blocked || pending}
            onClick={() => {
              if (blocked) return;
              onSubmit(diff.changes);
            }}
          >
            <Icon
              name={pending ? "feedback.loading" : "action.save"}
              spin={pending}
              className="size-4"
            />
            {pending ? labels.amend.pending : labels.amend.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
