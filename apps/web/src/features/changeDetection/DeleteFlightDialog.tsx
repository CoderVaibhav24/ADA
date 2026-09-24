import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icons";

import type { ChangeDetectionLabels } from "./labels";
import { Failure } from "./parts";
import type { LoadFailure } from "./useChangeDetection";

export type DeleteTarget = { id: string; name: string; processing: boolean };

// Removal is permanent server-side (file, tiles, runs, detections), so the dialog names the flight.
export function DeleteFlightDialog({
  labels,
  target,
  onClose,
  onConfirm,
}: {
  labels: ChangeDetectionLabels;
  target: DeleteTarget | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LoadFailure | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(target.id);
      setBusy(false);
      onClose();
    } catch (cause: unknown) {
      setBusy(false);
      setError({
        message:
          cause instanceof Error && cause.message ? cause.message : labels.deleteFlight.failed,
        requestId: cause instanceof ApiError ? cause.requestId : null,
      });
    }
  };

  return (
    <AlertDialog open={target !== null} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.deleteFlight.title(target?.name ?? "")}</AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">
            {labels.deleteFlight.body}
          </AlertDialogDescription>
          {target?.processing && (
            <p className="text-sm text-pretty text-fg-muted">
              {labels.deleteFlight.processing}
            </p>
          )}
        </AlertDialogHeader>
        {error && (
          <Failure
            compact
            title={labels.deleteFlight.failed}
            message={error.message}
            requestId={error.requestId}
            requestIdText={labels.error.requestId}
            requestIdMissingText={labels.error.requestIdMissing}
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{labels.deleteFlight.cancel}</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            <Icon
              name={busy ? "feedback.loading" : "action.delete"}
              spin={busy}
              className="size-4"
            />
            {busy ? labels.deleteFlight.running : labels.deleteFlight.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
