/**
 * "View Full Details" — the frame's secondary button, given something to do.
 *
 * 23:1953 draws the button and names no destination, and there is no detection
 * detail SCREEN in the route tree. What the API does have is a server-rendered
 * before/after crop of the two flights at this polygon
 * (`/api/analyses/{job}/polygons/{id}/preview.png`), which is the evidence an
 * officer is actually reaching for, so the button opens that.
 *
 * The officer's verdict lives here rather than on the panel behind it. The
 * frame draws no review controls at all, and confirming a violation off a 280px
 * card without looking at the imagery is how a false positive becomes a notice.
 *
 * An <img src> carries no Authorization header, so the crop goes through
 * `objectUrl` and the blob URL is revoked when the dialog closes.
 */

import { useEffect, useState } from "react";

import { ApiError, objectUrl } from "@/api/client";
import type { ReviewStatus } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Icon } from "@/lib/icons";

import { ActorName } from "@/components/icms/ActorName";
import type { ChangeDetectionLabels } from "./labels";
import { confidencePercent, type DetectionRow } from "./model";
import { Failure, Field, ReviewChip } from "./parts";
import type { LoadFailure } from "./useChangeDetection";

export function DetectionPreviewDialog({
  labels,
  row,
  open,
  onOpenChange,
  onReview,
  reviewing,
  reviewError,
  formatNumber,
  formatDateTime,
}: {
  labels: ChangeDetectionLabels;
  row: DetectionRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: (row: DetectionRow, status: ReviewStatus) => void;
  reviewing: boolean;
  reviewError: LoadFailure | null;
  formatNumber: (value: number) => string;
  formatDateTime: (value: string) => string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const errorBody = labels.preview.errorBody;

  // No `open` guard and no reset: DetectionDetails mounts this only while the
  // dialog is open, so the state is already fresh and there is nothing to clear.
  useEffect(() => {
    let url: string | null = null;
    let live = true;

    objectUrl(`/api/analyses/${row.jobId}/polygons/${String(row.featureId)}/preview.png`)
      .then((created) => {
        url = created;
        if (live) setSrc(created);
        else URL.revokeObjectURL(created);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setFailure(
          cause instanceof ApiError
            ? { message: cause.message, requestId: cause.requestId }
            : { message: errorBody, requestId: null },
        );
      });

    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [row.jobId, row.featureId, errorBody]);

  const percent = confidencePercent(row.confidence);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.preview.title(row.ref)}</DialogTitle>
          <DialogDescription>{labels.preview.body}</DialogDescription>
        </DialogHeader>

        {failure ? (
          <Failure
            title={labels.preview.errorTitle}
            message={failure.message}
            requestId={failure.requestId}
            requestIdText={labels.error.requestId}
            requestIdMissingText={labels.error.requestIdMissing}
          />
        ) : src ? (
          <img
            src={src}
            alt={labels.preview.alt(row.ref)}
            className="w-full rounded-md border border-line bg-surface-sunken"
          />
        ) : (
          <div aria-busy aria-live="polite">
            <span className="sr-only">{labels.preview.loading}</span>
            <Skeleton aria-hidden className="h-56 w-full rounded-md" />
          </div>
        )}

        <dl className="flex flex-col gap-1">
          <Field label={labels.detail.reference} mono>
            {row.ref}
          </Field>
          <Field label={labels.detail.classification}>{labels.status(row.status)}</Field>
          {row.changeType && (
            <Field label={labels.detail.changeType}>
              {labels.changeType(row.changeType)}
            </Field>
          )}
          <Field label={labels.detail.confidence} mono>
            {labels.detections.confidence(formatNumber(percent))}
          </Field>
          <Field label={labels.detail.area} mono>
            {labels.detections.area(formatNumber(Math.round(row.areaM2)))}
          </Field>
          <Field label={labels.detail.brightness} mono>
            {formatNumber(row.brightnessDelta)}
          </Field>
          <Field label={labels.detail.reviewedBy}>
            {row.reviewedBy ? (
              <ActorName name={row.reviewedByName} id={row.reviewedBy} />
            ) : (
              labels.detail.unreviewed
            )}
          </Field>
          {row.reviewedAt && (
            <Field label={labels.detail.reviewedAt} mono>
              {formatDateTime(row.reviewedAt)}
            </Field>
          )}
        </dl>

        {reviewError && (
          <Failure
            compact
            title={labels.detections.errorTitle}
            message={reviewError.message}
            requestId={reviewError.requestId}
            requestIdText={labels.error.requestId}
            requestIdMissingText={labels.error.requestIdMissing}
          />
        )}

        <DialogFooter className="sm:justify-between">
          <ReviewChip status={row.reviewStatus}>
            {labels.review.label(row.reviewStatus)}
          </ReviewChip>

          <div className="flex flex-wrap gap-2">
            {row.reviewStatus === "pending" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reviewing}
                  onClick={() => onReview(row, "rejected")}
                >
                  <Icon name="action.hide" className="size-4" />
                  {reviewing ? labels.review.saving : labels.review.dismiss}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={reviewing}
                  onClick={() => onReview(row, "confirmed")}
                >
                  <Icon name="feedback.warning" className="size-4" />
                  {reviewing ? labels.review.saving : labels.review.confirm}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={reviewing}
                onClick={() => onReview(row, "pending")}
              >
                <Icon name="action.retry" className="size-4" />
                {reviewing ? labels.review.saving : labels.review.reset}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
