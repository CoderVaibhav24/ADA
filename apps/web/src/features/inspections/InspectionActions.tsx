/**
 * The action bar — the only thing on this screen that decides what may be done,
 * and it decides nothing.
 *
 * `available_actions` arrives on `InspectionDetail`, computed by the server for
 * THIS caller's roles in THIS row's current status, and this component draws one
 * button per code in it. There is no `status === "submitted"` anywhere here and
 * there must never be: the workflow table is editable at runtime from the policy
 * screens, so a status-to-verb mapping compiled into the portal would be a
 * second, stale copy of a rule an administrator can change this afternoon.
 *
 * A code this build has no dialog for is still drawn, disabled, under its own
 * name. That is the honest rendering of "the server offers something this
 * screen cannot do yet" — better than a missing button, which looks like a
 * revoked permission and gets reported as one.
 *
 * Both routes out of here — `record_findings` and `submit` — go to the findings
 * form, because that is where the fields and the submit confirmation live. The
 * button is still drawn from the code the server published; only its handler is
 * a navigation rather than a request.
 *
 * Contract §6 is worth reading beside this file: a replayed check-in or upload
 * answers **200 with the original row** instead of 201, and that is a success.
 * Nothing here inspects the status code — `icmsRequest` resolves on any 2xx —
 * so a retry lands in `onSuccess` exactly as the first attempt would.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CheckInCreate,
  EvidenceCreate,
  InspectionAction,
  InspectionDetail,
  InspectionOpen,
  ResurveyCreate,
  VerifyRequest,
} from "@/api/icms/inspections";
import { Button } from "@/components/ui/button";
import { useInspectionActionLabels } from "@/i18n/labels";
import { Icon, type IconKey } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import {
  CheckInDialog,
  EvidenceUploadDialog,
  ResurveyRequestDialog,
  VerifyDialog,
} from "./actionDialogs";
import { AssignInspectionDialog } from "./AssignInspectionDialog";
import type { InspectionDetailLabels } from "./detailLabels";
import { orderedActions } from "./detailModel";
import { WriteOutcome } from "./detailParts";
import { usePhotoRule } from "./useAppConfig";
import {
  useAddEvidence,
  useCheckIn,
  useOpenRound,
  useRequestResurvey,
  useVerifyInspection,
} from "./useInspectionDetail";

type Panel = InspectionAction | null;

const ACTION_ICON: Record<InspectionAction, IconKey> = {
  check_in: "inspection.checkIn",
  add_evidence: "inspection.photo",
  record_findings: "inspection.record",
  submit: "action.send",
  verify_accept: "inspection.complete",
  verify_reject: "action.back",
  request_resurvey: "inspection.sync",
  open_round: "case.assign",
};

// Three of the eight change someone else's work or the case's direction and are
// given a weight that says so; the rest are the surveyor's own steps.
const ACTION_VARIANT: Partial<
  Record<InspectionAction, "default" | "outline" | "destructive">
> = {
  verify_accept: "default",
  verify_reject: "destructive",
  request_resurvey: "outline",
};

export function InspectionActions({
  detail,
  labels,
}: {
  detail: InspectionDetail;
  labels: InspectionDetailLabels;
}) {
  const navigate = useNavigate();
  const actionLabels = useInspectionActionLabels();
  const [panel, setPanel] = useState<Panel>(null);
  const [saved, setSaved] = useState(false);

  const ref = detail.inspection_ref;
  const caseRef = detail.case_ref;

  const checkInMutation = useCheckIn(ref, caseRef);
  const evidenceMutation = useAddEvidence(ref, caseRef);
  const verifyMutation = useVerifyInspection(ref, caseRef);
  const resurveyMutation = useRequestResurvey(ref, caseRef);
  const openRoundMutation = useOpenRound(ref, caseRef);

  // The round's photographs against the server's bounds. It gates the upload's
  // PAYLOAD, never whether the button is drawn — `available_actions` does that.
  const photos = usePhotoRule(detail.evidence ?? [], true);

  const { known, unknown } = orderedActions(detail.available_actions ?? []);

  // A fresh dialog must not open onto the refusal the last one collected.
  const openPanel = (action: InspectionAction) => {
    checkInMutation.reset();
    evidenceMutation.reset();
    verifyMutation.reset();
    resurveyMutation.reset();
    openRoundMutation.reset();
    setSaved(false);
    setPanel(action);
  };

  const done = () => {
    setPanel(null);
    setSaved(true);
  };

  const press = (action: InspectionAction) => {
    if (action === "record_findings" || action === "submit") {
      void navigate(ROUTES.inspectionFindings(ref));
      return;
    }
    openPanel(action);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h2 className="sr-only">{labels.actionsTitle}</h2>

      <div className="flex flex-wrap items-center gap-2">
        {known.map((action) => (
          <Button
            key={action}
            size="sm"
            variant={ACTION_VARIANT[action] ?? "secondary"}
            onClick={() => {
              press(action);
            }}
          >
            <Icon name={ACTION_ICON[action]} className="size-4" />
            {actionLabels.label(action)}
          </Button>
        ))}

        {/* Offered by the server, not built here. Drawn under its own code so
            it can be reported rather than mistaken for a lost permission. */}
        {unknown.map((code) => (
          <Button key={code} size="sm" variant="outline" disabled>
            {actionLabels.label(code)}
          </Button>
        ))}

        {known.length === 0 && unknown.length === 0 && (
          <p className="text-sm text-fg-muted text-pretty">{actionLabels.none}</p>
        )}
      </div>

      <p className="max-w-prose text-2xs text-fg-faint text-pretty">{actionLabels.advisory}</p>

      <WriteOutcome error={null} saved={saved} labels={labels} />

      {/* Every dialog is mounted only while it is open. That is what makes a
          fresh idempotency key, an empty reason box and a re-asked position
          fall out of mounting rather than out of an effect that watches a
          boolean — and it is why closing one and opening it again cannot
          inherit the last attempt's half-filled form. */}
      {panel === "check_in" && (
        <CheckInDialog
          open
          onOpenChange={(next) => {
            if (!next) setPanel(null);
          }}
          labels={labels}
          pending={checkInMutation.isPending}
          error={checkInMutation.error}
          onSubmit={(body: CheckInCreate) => {
            checkInMutation.mutate(body, { onSuccess: done });
          }}
        />
      )}

      {panel === "add_evidence" && (
        <EvidenceUploadDialog
          open
          onOpenChange={(next) => {
            if (!next) setPanel(null);
          }}
          labels={labels}
          photos={photos}
          pending={evidenceMutation.isPending}
          error={evidenceMutation.error}
          onSubmit={(input: EvidenceCreate) => {
            evidenceMutation.mutate(input, { onSuccess: done });
          }}
        />
      )}

      {(panel === "verify_accept" || panel === "verify_reject") && (
        <VerifyDialog
          open
          onOpenChange={(next) => {
            if (!next) setPanel(null);
          }}
          decision={panel === "verify_reject" ? "reject" : "accept"}
          inspectionRef={ref}
          labels={labels}
          pending={verifyMutation.isPending}
          error={verifyMutation.error}
          onSubmit={(body: VerifyRequest) => {
            verifyMutation.mutate(body, { onSuccess: done });
          }}
        />
      )}

      {panel === "request_resurvey" && (
        <ResurveyRequestDialog
          open
          onOpenChange={(next) => {
            if (!next) setPanel(null);
          }}
          labels={labels}
          pending={resurveyMutation.isPending}
          error={resurveyMutation.error}
          onSubmit={(body: ResurveyCreate) => {
            resurveyMutation.mutate(body, { onSuccess: done });
          }}
        />
      )}

      {panel === "open_round" && (
        <AssignInspectionDialog
          open
          onOpenChange={(next) => {
            if (!next) setPanel(null);
          }}
          caseRef={caseRef}
          labels={labels}
          pending={openRoundMutation.isPending}
          error={openRoundMutation.error}
          onSubmit={(body: InspectionOpen) => {
            openRoundMutation.mutate(body, {
              // A new round is a different inspection, so the officer is taken
              // to it rather than left looking at the round it replaced.
              onSuccess: (opened) => {
                setPanel(null);
                void navigate(ROUTES.inspection(opened.inspection_ref));
              },
            });
          }}
        />
      )}
    </div>
  );
}
