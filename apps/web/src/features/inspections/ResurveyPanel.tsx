/**
 * The re-survey requests on this case, and the one decision that can be made.
 *
 * ## Why the decide buttons are gated on `open_round`
 *
 * `POST /resurvey-requests/{id}/decide` is not a transition and publishes no
 * code of its own in `available_actions` — but approving one RUNS `OPEN_ROUND`
 * (contract §2), so the officer who may open a round on this case is exactly
 * the officer who may approve a re-survey of it. That is still the server's own
 * answer about this caller on this row, which is the rule; it is not a status
 * string compared in a component, which is what the rule forbids. If the
 * workflow ever publishes a `resurvey_decide` code, this line becomes that code
 * and nothing else changes.
 *
 * Refusing writes no transition, so no code describes it at all. It is gated
 * the same way deliberately: offering Refuse to someone who cannot Approve
 * would draw one button the server honours beside one it refuses, and the
 * officer would learn that the screen is unreliable rather than that they lack
 * a grant.
 */

import { useId, useState } from "react";
import {
  allows,
  type InspectionDetail,
  type ResurveyDecide,
  type ResurveyDecision,
  type ResurveyDecisionInput,
  type ResurveyRequestOut,
} from "@/api/icms/inspections";
import { IcmsApiError } from "@/api/icms/http";
import { EmptyState, ErrorState, LoadingState } from "@/components/icms/states";
import { Badge } from "@/components/ui/badge";
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
import { useInspectionActionLabels, useResurveyDecisionLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import type { InspectionDetailLabels } from "./detailLabels";
import { decidedResurveys, pendingResurvey } from "./detailModel";
import { DetailPanel, WriteOutcome } from "./detailParts";

function DecideDialog({
  open,
  onOpenChange,
  request,
  decision,
  labels,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ResurveyRequestOut;
  decision: ResurveyDecisionInput;
  labels: InspectionDetailLabels;
  pending: boolean;
  error: unknown;
  onSubmit: (body: ResurveyDecide) => void;
}) {
  const actionLabels = useInspectionActionLabels();
  const noteId = useId();
  const surveyorId = useId();
  const [note, setNote] = useState("");
  const [surveyor, setSurveyor] = useState("");
  const [touched, setTouched] = useState(false);

  const approving = decision === "approve";
  // Approving opens the next round, and a round with no surveyor cannot exist.
  const missing = approving && surveyor.trim() === "";
  const actionCd = approving ? "resurvey_approve" : "resurvey_refuse";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-pretty">
            {actionLabels.label(actionCd)} — {labels.resurvey.fromRound(request.from_round)}
          </DialogTitle>
          <DialogDescription className="text-pretty">{request.reason}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {approving && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={surveyorId}>{labels.resurvey.surveyorLabel}</Label>
              <Input
                id={surveyorId}
                value={surveyor}
                required
                autoComplete="off"
                placeholder={labels.assign.surveyorPlaceholder}
                aria-invalid={touched && missing}
                aria-describedby={`${surveyorId}-hint`}
                onBlur={() => {
                  setTouched(true);
                }}
                onChange={(event) => {
                  setSurveyor(event.target.value);
                }}
              />
              <p id={`${surveyorId}-hint`} className="text-2xs text-fg-muted text-pretty">
                {labels.resurvey.surveyorRequired}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId}>{labels.resurvey.noteLabel}</Label>
            <Textarea
              id={noteId}
              value={note}
              rows={3}
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
            {labels.resurvey.cancel}
          </Button>
          <Button
            variant={approving ? "default" : "destructive"}
            disabled={missing || pending}
            onClick={() => {
              onSubmit({
                decision,
                note: note.trim() === "" ? null : note.trim(),
                surveyor_user_id: approving ? surveyor.trim() : null,
              });
            }}
          >
            {pending && <Icon name="feedback.loading" spin className="size-4" />}
            {pending ? actionLabels.pending(actionCd) : actionLabels.label(actionCd)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One request, decided or not, as a row in the panel. */
function RequestRow({
  request,
  labels,
  formatDateTime,
}: {
  request: ResurveyRequestOut;
  labels: InspectionDetailLabels;
  formatDateTime: (value: string) => string;
}) {
  const decisionLabels = useResurveyDecisionLabels();
  const settled = request.decision !== "pending";
  const decisionLabel =
    decisionLabels[request.decision as ResurveyDecision] ?? request.decision;

  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={settled ? "outline" : "secondary"} className="tabular">
          {labels.resurvey.fromRound(request.from_round)}
        </Badge>
        {/* The decision in words. The badge's tone repeats it, never carries it. */}
        <span className="text-2xs font-medium text-fg-base">{decisionLabel}</span>
        {request.resulting_round != null && (
          <span className="text-2xs text-fg-muted tabular">
            {labels.resurvey.resultingRound(request.resulting_round)}
          </span>
        )}
      </div>

      <p className="text-sm text-fg-strong text-pretty">{request.reason}</p>

      <p className="text-2xs text-fg-muted">
        {labels.resurvey.requestedBy(request.requested_by, formatDateTime(request.requested_at))}
      </p>

      {request.decided_by != null && request.decided_at != null && (
        <p className="text-2xs text-fg-muted">
          {labels.resurvey.decidedBy(request.decided_by, formatDateTime(request.decided_at))}
        </p>
      )}

      {request.decision_note != null && (
        <p className="text-2xs text-fg-muted text-pretty">{request.decision_note}</p>
      )}
    </li>
  );
}

export function ResurveyPanel({
  detail,
  requests,
  status,
  error,
  onRetry,
  labels,
  formatDateTime,
  decidePending,
  decideError,
  onDecide,
}: {
  detail: InspectionDetail;
  requests: readonly ResurveyRequestOut[];
  status: "pending" | "error" | "success";
  error: unknown;
  onRetry: () => void;
  labels: InspectionDetailLabels;
  formatDateTime: (value: string) => string;
  decidePending: boolean;
  decideError: unknown;
  onDecide: (id: number, body: ResurveyDecide) => void;
}) {
  const actionLabels = useInspectionActionLabels();
  const [decision, setDecision] = useState<ResurveyDecisionInput | null>(null);
  const api = error instanceof IcmsApiError ? error : null;

  const open = pendingResurvey(requests);
  const history = decidedResurveys(requests);
  const mayDecide = allows(detail, "open_round");

  return (
    <DetailPanel title={labels.resurvey.title} description={labels.rounds.body}>
      {status === "error" ? (
        <ErrorState
          size="compact"
          title={labels.errorTitle}
          description={api?.message ?? labels.errorBody}
          detail={api?.requestId ?? undefined}
          onRetry={onRetry}
          retryLabel={labels.errorRetry}
        />
      ) : status === "pending" ? (
        <LoadingState label={labels.loading} lines={2} className="p-0" />
      ) : requests.length === 0 ? (
        <EmptyState
          size="compact"
          icon="inspection.sync"
          title={labels.resurvey.title}
          description={labels.resurvey.none}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {open && (
            <>
              <p
                role="status"
                className="rounded-md border border-status-warning-border bg-status-warning px-3 py-2 text-2xs text-status-warning-fg text-pretty"
              >
                {labels.resurvey.pending}
              </p>
              <ul className="flex flex-col gap-2">
                <RequestRow request={open} labels={labels} formatDateTime={formatDateTime} />
              </ul>
              {mayDecide && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setDecision("approve");
                    }}
                  >
                    <Icon name="action.confirm" className="size-4" />
                    {actionLabels.label("resurvey_approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDecision("refuse");
                    }}
                  >
                    <Icon name="action.clear" className="size-4" />
                    {actionLabels.label("resurvey_refuse")}
                  </Button>
                </div>
              )}
            </>
          )}

          {history.length > 0 && (
            <ul className="flex flex-col gap-2">
              {history.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  labels={labels}
                  formatDateTime={formatDateTime}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {open && decision !== null && (
        <DecideDialog
          open
          onOpenChange={(next) => {
            if (!next) setDecision(null);
          }}
          request={open}
          decision={decision}
          labels={labels}
          pending={decidePending}
          error={decideError}
          onSubmit={(body) => {
            onDecide(open.id, body);
          }}
        />
      )}
    </DetailPanel>
  );
}
