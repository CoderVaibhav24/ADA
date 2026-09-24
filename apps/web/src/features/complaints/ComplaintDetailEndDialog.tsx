/**
 * Reject / Close — the two terminal actions, one dialog.
 *
 * A reason code from the seeded vocabulary and free remarks, which the server
 * requires (at least `OTHER_REMARKS_MIN` characters) only when the code is
 * `other`. One idempotency key per opening of the dialog, held across retries.
 */

import { useId, useState } from "react";
import { newIdempotencyKey } from "@/api/icms/cases";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { ComplaintDetailLabels } from "./ComplaintDetailLabels";
import {
  CLOSE_OUTCOMES,
  OTHER_REMARKS_MIN,
  REJECT_REASONS,
  endingIncomplete,
  type EndingAction,
} from "./ComplaintDetailModel";
import { WriteOutcome } from "./ComplaintDetailParts";

export type EndingBody = { code: string; remarks: string | null; idempotencyKey: string };

export function ComplaintDetailEndDialog({
  onOpenChange,
  caseRef,
  action,
  labels,
  pending,
  error,
  onSubmit,
}: {
  onOpenChange: (open: boolean) => void;
  caseRef: string;
  action: EndingAction;
  labels: ComplaintDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: EndingBody) => void;
}) {
  const codeId = useId();
  const remarksId = useId();
  const [key] = useState(newIdempotencyKey);
  const [code, setCode] = useState("");
  const [remarks, setRemarks] = useState("");
  const [touched, setTouched] = useState(false);

  const codes: readonly string[] = action === "reject" ? REJECT_REASONS : CLOSE_OUTCOMES;
  const needsRemarks = code === "other";
  const incomplete = endingIncomplete(code, remarks);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-pretty">
            {labels.end.title(action)} — {caseRef}
          </DialogTitle>
          <DialogDescription className="text-pretty">{labels.end.body(action)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface-2 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={codeId}>{labels.end.codeLabel(action)}</Label>
            <Select
              value={code}
              onValueChange={(next) => {
                setCode(next);
              }}
            >
              <SelectTrigger
                id={codeId}
                className="w-full"
                aria-invalid={touched && code === ""}
              >
                <SelectValue placeholder={labels.end.codePlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {codes.map((value) => (
                  <SelectItem key={value} value={value}>
                    {labels.end.code(action, value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={remarksId}>{labels.end.remarksLabel}</Label>
            <Textarea
              id={remarksId}
              value={remarks}
              rows={3}
              required={needsRemarks}
              placeholder={labels.end.remarksPlaceholder}
              aria-describedby={`${remarksId}-hint`}
              aria-invalid={touched && needsRemarks && incomplete}
              onBlur={() => {
                setTouched(true);
              }}
              onChange={(event) => {
                setRemarks(event.target.value);
              }}
            />
            <p
              id={`${remarksId}-hint`}
              className={
                touched && needsRemarks && incomplete
                  ? "text-2xs text-status-danger-fg"
                  : "text-2xs text-fg-faint text-pretty"
              }
            >
              {needsRemarks
                ? labels.end.remarksRequired(OTHER_REMARKS_MIN)
                : labels.end.remarksOptional}
            </p>
          </div>
        </div>

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
            variant={action === "reject" ? "destructive" : "default"}
            disabled={incomplete || pending}
            onClick={() => {
              setTouched(true);
              if (incomplete) return;
              const trimmed = remarks.trim();
              onSubmit({ code, remarks: trimmed === "" ? null : trimmed, idempotencyKey: key });
            }}
          >
            <Icon
              name={pending ? "feedback.loading" : action === "reject" ? "action.close" : "case.close"}
              spin={pending}
              className="size-4"
            />
            {pending ? labels.action.pending(action) : labels.action.label(action)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
