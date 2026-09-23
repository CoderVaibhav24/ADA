/**
 * Assign Inspection — Figma 46:4561, reduced to what `OPEN_ROUND` accepts.
 *
 * The frame draws six controls: Inspector, an inspection schedule as a From/To
 * pair, Priority, and an Instruction textarea. `InspectionOpen` (contract §3)
 * has exactly two fields — `surveyor_user_id` and `scheduled_for` — so four of
 * those six have nowhere on the wire to go:
 *
 *   - **To** would be an end date. `icms_inspection` has one `scheduled_for`
 *     timestamp and no window; drawing a range that collapses to its first
 *     value on save is worse than not drawing it.
 *   - **Priority** lives on the case, not on the round. It is set where the
 *     complaint is raised, and a second copy here would be a second answer.
 *   - **Instruction** has no column in this batch. The nearest thing is the
 *     officer's note on the findings, which the surveyor writes rather than
 *     reads.
 *
 * Named rather than silently dropped: if any of the three is wanted, the field
 * has to exist first.
 *
 * `Inspector` is a free-text user id rather than the frame's dropdown for the
 * same reason. There is no user-directory endpoint in this contract, and a
 * select with nothing to populate it is a dead control. The moment one exists,
 * this input becomes the `Select` the frame draws and nothing else changes.
 *
 * No idempotency key: `OPEN_ROUND` is not one of the three idempotent writes in
 * contract §4.3, and minting a key the server does not read would advertise a
 * guarantee that is not there.
 */

import { useId, useState } from "react";
import type { InspectionOpen } from "@/api/icms/inspections";
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
import { useInspectionActionLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import type { InspectionDetailLabels } from "./detailLabels";
import { WriteOutcome } from "./detailParts";

// `datetime-local` hands back wall-clock text with no zone. The browser's zone
// is the officer's, so this is the one place a local Date is the right reading.
function toIsoOrNull(local: string): string | null {
  if (local === "") return null;
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function AssignInspectionDialog({
  open,
  onOpenChange,
  caseRef,
  labels,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Figma titles the modal with the case the round is opened on. */
  caseRef: string;
  labels: InspectionDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: InspectionOpen) => void;
}) {
  const actionLabels = useInspectionActionLabels();
  const surveyorId = useId();
  const scheduledId = useId();
  const [surveyor, setSurveyor] = useState("");
  const [scheduled, setScheduled] = useState("");

  const missing = surveyor.trim() === "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-pretty">
            {labels.assign.title} — {caseRef}
          </DialogTitle>
          <DialogDescription className="text-pretty">{labels.assign.body}</DialogDescription>
        </DialogHeader>

        {/* Figma's inset summary box, which is what keeps the two fields from
            floating in the middle of a 448px modal. */}
        <div className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface-2 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={surveyorId}>{labels.assign.surveyorLabel}</Label>
            <Input
              id={surveyorId}
              value={surveyor}
              required
              placeholder={labels.assign.surveyorPlaceholder}
              autoComplete="off"
              onChange={(event) => {
                setSurveyor(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={scheduledId}>{labels.assign.scheduledLabel}</Label>
            <Input
              id={scheduledId}
              type="datetime-local"
              value={scheduled}
              aria-describedby={`${scheduledId}-hint`}
              onChange={(event) => {
                setScheduled(event.target.value);
              }}
            />
            <p id={`${scheduledId}-hint`} className="text-2xs text-fg-faint">
              {labels.assign.scheduledPlaceholder}
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
            {labels.assign.cancel}
          </Button>
          <Button
            disabled={missing || pending}
            onClick={() => {
              onSubmit({
                surveyor_user_id: surveyor.trim(),
                scheduled_for: toIsoOrNull(scheduled),
              });
            }}
          >
            <Icon
              name={pending ? "feedback.loading" : "case.assign"}
              spin={pending}
              className="size-4"
            />
            {pending ? actionLabels.pending("open_round") : actionLabels.label("open_round")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
