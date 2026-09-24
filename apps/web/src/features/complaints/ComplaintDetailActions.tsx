/**
 * The action bar — the only thing on this screen that decides what may be done,
 * and it decides almost nothing.
 *
 * `allowed_actions` arrives on `CaseDetail`, computed by the server from
 * `workflow.allowed_actions` for THIS caller's roles in THIS case's current
 * status, and this component draws one button per code in it. There is no
 * `status === "raised"` anywhere here and there must never be: the transition
 * table is editable at runtime from the policy screens, so a status-to-verb
 * mapping compiled into the portal would be a second, stale copy of a rule an
 * administrator can change this afternoon.
 *
 * A code this screen owns no dialog for is still drawn, disabled, under its own
 * name. That is the honest rendering of "the server offers something this
 * screen cannot do" — better than a missing button, which looks like a revoked
 * permission and gets reported as one. `open_round`, `verify_accept` and the
 * rest belong to the Inspection detail screen and stay there.
 *
 * ## Amend is the one exception
 *
 * `AMEND` is not a transition, so it never appears in `allowed_actions`. It is
 * drawn when the caller holds `case.amend` (`gate.canAmend`) and refused by the
 * server where it must be: 403 without the code, 409 once the case is closed.
 * Both refusals are rendered verbatim.
 */

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  CaseAmend,
  CaseAssign,
  CaseClose,
  CaseDetail,
  CaseReject,
} from "@/api/icms/cases";
import { Button } from "@/components/ui/button";
import { Icon, type IconKey } from "@/lib/icons";
import {
  useAmendCase,
  useAssignCase,
  useCloseCase,
  useRejectCase,
  type CaseGate,
} from "./ComplaintDetailData";
import { ComplaintDetailAmendDialog } from "./ComplaintDetailAmendDialog";
import { ComplaintDetailAssignDialog } from "./ComplaintDetailAssignDialog";
import { ComplaintDetailEndDialog, type EndingBody } from "./ComplaintDetailEndDialog";
import type { ComplaintDetailLabels } from "./ComplaintDetailLabels";
import {
  assignActionOf,
  orderedCaseActions,
  reasonRequired,
  type EndingAction,
} from "./ComplaintDetailModel";
import { WriteOutcome } from "./ComplaintDetailParts";

type Panel = "assign" | "amend" | EndingAction | null;

/** The register links here with `?action=assign` on its per-row assign control. */
const ASSIGN_PARAM = "assign";

const ACTION_ICON: Record<string, IconKey> = {
  assign: "case.assign",
  reassign: "case.assign",
  reject: "action.close",
  open_round: "inspection.schedule",
  check_in: "inspection.checkIn",
  add_evidence: "inspection.photo",
  record_findings: "inspection.record",
  submit: "action.send",
  request_resurvey: "inspection.sync",
  verify_accept: "inspection.complete",
  verify_reject: "action.back",
  hand_over: "case.escalate",
  confirm: "action.confirm",
  issue_notice: "notice.issue",
  close: "case.close",
};

export function ComplaintDetailActions({
  detail,
  gate,
  labels,
}: {
  detail: CaseDetail;
  gate: CaseGate;
  labels: ComplaintDetailLabels;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const allowed = detail.allowed_actions ?? [];
  const { built, endings, offered } = orderedCaseActions(allowed);
  const assignAction = assignActionOf(allowed);

  // The deep link is honoured only when the server actually offers the action,
  // so a stale bookmark opens the case rather than a dialog that cannot submit.
  const [panel, setPanel] = useState<Panel>(() =>
    searchParams.get("action") === ASSIGN_PARAM && assignAction !== null ? "assign" : null,
  );
  const [saved, setSaved] = useState<"assign" | "amend" | EndingAction | null>(null);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);

  const assign = useAssignCase(detail.case_ref);
  const amend = useAmendCase(detail.case_ref);
  const reject = useRejectCase(detail.case_ref);
  const close = useCloseCase(detail.case_ref);

  // The assignee's name from the refetched case; never the raw user ID.
  const assignedName =
    assignedTo !== null && detail.assignment?.assignee_user_id === assignedTo
      ? (detail.assignment.assignee_name ?? null)
      : null;

  const needsReason =
    assignAction === null ? false : reasonRequired(gate.actions, assignAction, detail.status);

  // A fresh dialog must not open onto the refusal the last one collected.
  const openPanel = (next: Exclude<Panel, null>) => {
    assign.reset();
    amend.reset();
    reject.reset();
    close.reset();
    setSaved(null);
    setPanel(next);
  };

  const closePanel = () => {
    setPanel(null);
    if (searchParams.get("action") === null) return;
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h2 className="sr-only">{labels.actionsTitle}</h2>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {built.map((action) => (
          <Button
            key={action}
            size="sm"
            onClick={() => {
              openPanel("assign");
            }}
          >
            <Icon name={ACTION_ICON[action] ?? "case.assign"} className="size-4" />
            {labels.action.label(action)}
          </Button>
        ))}

        {endings.map((action) => (
          <Button
            key={action}
            size="sm"
            variant={action === "reject" ? "destructive" : "default"}
            onClick={() => {
              openPanel(action);
            }}
          >
            <Icon name={ACTION_ICON[action] ?? "action.close"} className="size-4" />
            {labels.action.label(action)}
          </Button>
        ))}

        {/* Offered by the server, owned by another screen. Drawn under its own
            code so it can be reported rather than mistaken for a lost grant. */}
        {offered.map((code) => (
          <Button key={code} size="sm" variant="outline" disabled>
            <Icon name={ACTION_ICON[code] ?? "action.more"} className="size-4" />
            {labels.action.label(code)}
          </Button>
        ))}

        {gate.canAmend && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              openPanel("amend");
            }}
          >
            <Icon name="action.edit" className="size-4" />
            {labels.amend.open}
          </Button>
        )}
      </div>

      <WriteOutcome
        error={null}
        saved={saved !== null}
        savedTitle={
          saved === "assign"
            ? labels.assign.doneTitle
            : saved === "reject" || saved === "close"
              ? labels.end.doneTitle(saved)
              : labels.saved
        }
        savedBody={
          saved === "assign" && assignedName !== null ? labels.assign.done(assignedName) : undefined
        }
        labels={labels}
      />

      {/* Each dialog is mounted only while it is open, so a fresh form and an
          empty reason box fall out of mounting rather than out of an effect. */}
      {panel === "assign" && assignAction !== null && (
        <ComplaintDetailAssignDialog
          open
          onOpenChange={(next) => {
            if (!next) closePanel();
          }}
          caseRef={detail.case_ref}
          action={assignAction}
          needsReason={needsReason}
          currentAssignee={detail.assignment?.assignee_user_id ?? null}
          currentAssigneeName={detail.assignment?.assignee_name ?? null}
          labels={labels}
          pending={assign.isPending}
          error={assign.error}
          onSubmit={(body: CaseAssign) => {
            assign.mutate(body, {
              onSuccess: () => {
                setAssignedTo(body.assignee_user_id);
                setSaved("assign");
                closePanel();
              },
            });
          }}
        />
      )}

      {(panel === "reject" || panel === "close") && endings.includes(panel) && (
        <ComplaintDetailEndDialog
          onOpenChange={(next) => {
            if (!next) closePanel();
          }}
          caseRef={detail.case_ref}
          action={panel}
          labels={labels}
          pending={panel === "reject" ? reject.isPending : close.isPending}
          error={panel === "reject" ? reject.error : close.error}
          onSubmit={(body: EndingBody) => {
            const done = {
              onSuccess: () => {
                setSaved(panel);
                closePanel();
              },
            };
            const common = { remarks: body.remarks, idempotency_key: body.idempotencyKey };
            if (panel === "reject") {
              reject.mutate({ ...common, reason_cd: body.code as CaseReject["reason_cd"] }, done);
            } else {
              close.mutate({ ...common, outcome_cd: body.code as CaseClose["outcome_cd"] }, done);
            }
          }}
        />
      )}

      {panel === "amend" && gate.canAmend && (
        <ComplaintDetailAmendDialog
          open
          onOpenChange={(next) => {
            if (!next) closePanel();
          }}
          detail={detail}
          labels={labels}
          pending={amend.isPending}
          error={amend.error}
          onSubmit={(body: CaseAmend) => {
            amend.mutate(body, {
              onSuccess: () => {
                setSaved("amend");
                closePanel();
              },
            });
          }}
        />
      )}
    </div>
  );
}

/** The notes explaining the action bar; drawn under the headline, apart from the buttons. */
export function ComplaintDetailActionNotes({
  detail,
  labels,
}: {
  detail: CaseDetail;
  labels: ComplaintDetailLabels;
}) {
  const { built, endings, offered } = orderedCaseActions(detail.allowed_actions ?? []);

  return (
    <div className="mt-2 flex max-w-prose flex-col gap-1">
      {built.length === 0 && endings.length === 0 && offered.length === 0 && (
        <p className="text-sm text-fg-muted text-pretty">{labels.action.none}</p>
      )}
      {offered.length > 0 && (
        <p className="text-2xs text-fg-faint text-pretty">{labels.action.elsewhere}</p>
      )}
      <p className="text-2xs text-fg-faint text-pretty">{labels.action.advisory}</p>
    </div>
  );
}
