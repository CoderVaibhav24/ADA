/**
 * Assign / Reassign — the caller `POST /cases/{ref}/assign` has not had.
 *
 * ## The assignee is a user id, not a picker
 *
 * The only officer directory the portal could read is
 * `GET /api/icms/admin/users`, and it is guarded by `user.read` — a permission
 * the nodal officers who use this screen do not hold. A `Select` with nothing
 * legal to populate it is a dead control, so the field is the id itself, which
 * is the same answer `AssignInspectionDialog` reached for `surveyor_user_id`.
 * The moment a directory endpoint exists that this role may call, this input
 * becomes a picker and nothing else changes.
 *
 * ## What the form demands is the server's answer, not this file's
 *
 * `assign` needs an assignee; `reassign` needs an assignee AND a reason. That
 * pairing is in the transition table, which is editable at runtime from the
 * policy screens, so it is read from the `requires` that `/me/capabilities`
 * published for THIS caller rather than compiled in here. The workflow's own
 * default is the fallback and only applies when capabilities have not answered.
 *
 * ## No idempotency key
 *
 * `assign` is not one of the idempotent writes, and minting a key the server
 * does not read would advertise a guarantee that is not there.
 */

import { useId, useState } from "react";
import type { CaseAssign } from "@/api/icms/cases";
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
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/lib/icons";
import type { ComplaintDetailLabels } from "./ComplaintDetailLabels";
import type { BuiltAction } from "./ComplaintDetailModel";
import { Mono, WriteOutcome } from "./ComplaintDetailParts";

export function ComplaintDetailAssignDialog({
  open,
  onOpenChange,
  caseRef,
  action,
  needsReason,
  currentAssignee,
  labels,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The modal names the case the assignment is made on. */
  caseRef: string;
  /** Which transition the server will run — decided from `allowed_actions`. */
  action: BuiltAction;
  /** From the server's `requires`, never from the action's name. */
  needsReason: boolean;
  currentAssignee: string | null;
  labels: ComplaintDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: CaseAssign) => void;
}) {
  const assigneeId = useId();
  const noteId = useId();
  const reasonId = useId();

  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const reassigning = action === "reassign";
  const assigneeMissing = assignee.trim() === "";
  const reasonMissing = needsReason && reason.trim() === "";
  const incomplete = assigneeMissing || reasonMissing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-pretty">
            {reassigning ? labels.assign.reassignTitle : labels.assign.title} — {caseRef}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {reassigning ? labels.assign.reassignBody : labels.assign.body}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface-2 p-4">
          {/* Who holds it now, so a reassignment is not made blind. */}
          {currentAssignee !== null && (
            <p className="flex flex-wrap items-center gap-1.5 text-2xs text-fg-muted">
              <Icon name="case.assigned" className="size-3.5 shrink-0" />
              <span>{labels.assignment.body}</span>
              <Mono className="text-fg-strong">{currentAssignee}</Mono>
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={assigneeId}>{labels.assign.assigneeLabel}</Label>
            <Input
              id={assigneeId}
              value={assignee}
              required
              placeholder={labels.assign.assigneePlaceholder}
              autoComplete="off"
              aria-describedby={`${assigneeId}-hint`}
              aria-invalid={touched && assigneeMissing}
              onBlur={() => {
                setTouched(true);
              }}
              onChange={(event) => {
                setAssignee(event.target.value);
              }}
            />
            <p id={`${assigneeId}-hint`} className="text-2xs text-fg-faint text-pretty">
              {touched && assigneeMissing
                ? labels.assign.assigneeRequired
                : labels.assign.assigneeHint}
            </p>
          </div>

          {/* Required by the transition table for a reassignment: the surveyor
              who loses the case, and the one who gains it, both get a reason. */}
          {needsReason && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId}>{labels.assign.reasonLabel}</Label>
              <Textarea
                id={reasonId}
                value={reason}
                rows={3}
                required
                placeholder={labels.assign.reasonPlaceholder}
                aria-describedby={`${reasonId}-hint`}
                aria-invalid={touched && reasonMissing}
                onBlur={() => {
                  setTouched(true);
                }}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              {touched && reasonMissing && (
                <p id={`${reasonId}-hint`} className="text-2xs text-status-danger-fg">
                  {labels.assign.reasonRequired}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId}>{labels.assign.noteLabel}</Label>
            <Textarea
              id={noteId}
              value={note}
              rows={2}
              placeholder={labels.assign.notePlaceholder}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
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
            disabled={incomplete || pending}
            onClick={() => {
              setTouched(true);
              if (incomplete) return;
              onSubmit({
                assignee_user_id: assignee.trim(),
                note: note.trim() === "" ? null : note.trim(),
                reason: reason.trim() === "" ? null : reason.trim(),
              });
            }}
          >
            <Icon
              name={pending ? "feedback.loading" : "case.assign"}
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
