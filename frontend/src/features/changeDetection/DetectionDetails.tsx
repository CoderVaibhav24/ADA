/**
 * The Detection Details panel — Figma 23:1899 filled, 17:6887 empty.
 *
 * ## What the frame asks for and what exists
 *
 * The frame's key/value table has six rows: Parcel ID, Khasra No., Village,
 * Tehsil, Affected Area, Change Type. **Four of the six are not drawn.** A
 * change polygon is a geometry plus the worker's own measurements; there is no
 * parcel id, no khasra number, no village and no tehsil anywhere in
 * `/api/analyses/{id}/features`, in `ChangePolygon`, or in the raster it came
 * from. Rendering "Khasra No." over a blank — or worse, over a plausible
 * invented number — on the screen that raises an enforcement complaint is not a
 * cosmetic error.
 *
 * Their slots are taken by measurements that ARE real and that an officer wants
 * before filing: how much of the polygon falls inside a red zone, the
 * brightness delta the detection turned on, its centre, and which comparison
 * produced it.
 *
 * Affected Area, Change Type and Detection Confidence are the frame's own rows
 * and all three are backed.
 *
 * ## The two buttons
 *
 * "Create Complaint" is the reason the screen exists; it carries the detection
 * into `ROUTES.complaintNew` as a query string (see complaintHandoff.ts). It is
 * a LINK rather than a button with a navigate(), because an officer
 * middle-clicking it to open a second tab is doing something reasonable.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "cn";

import type { ReviewStatus } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";

import { BAND_METER } from "./bands";
import { toComplaintSearch } from "./complaintHandoff";
import { DetectionPreviewDialog } from "./DetectionPreviewDialog";
import type { ChangeDetectionLabels } from "./labels";
import { confidencePercent, type ComparisonPair, type DetectionRow } from "./model";
import { Field, ReviewChip } from "./parts";
import type { LoadFailure } from "./useChangeDetection";

export function DetectionDetails({
  labels,
  row,
  pair,
  onReview,
  reviewing,
  reviewError,
  formatNumber,
  formatDate,
  formatDateTime,
}: {
  labels: ChangeDetectionLabels;
  row: DetectionRow | null;
  pair: ComparisonPair | null;
  onReview: (row: DetectionRow, status: ReviewStatus) => void;
  reviewing: boolean;
  reviewError: LoadFailure | null;
  formatNumber: (value: number) => string;
  formatDate: (value: string | null) => string;
  formatDateTime: (value: string) => string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <section
      aria-labelledby="cd-detail-heading"
      className="flex min-h-44 flex-col gap-3 rounded-md border border-line bg-card p-4 shadow-xs"
    >
      <h2 id="cd-detail-heading" className="font-display text-md font-bold text-fg-strong">
        {labels.detail.title}
      </h2>

      {row ? (
        <Filled
          labels={labels}
          row={row}
          pair={pair}
          formatNumber={formatNumber}
          formatDate={formatDate}
          formatDateTime={formatDateTime}
          onOpenPreview={() => setPreviewOpen(true)}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-full border border-line-subtle bg-surface-2 text-fg-faint"
          >
            <Icon name="map.pin" className="size-5" />
          </span>
          <p className="text-sm font-medium text-fg-strong">{labels.detail.emptyTitle}</p>
          <p className="max-w-prose text-sm text-pretty text-fg-muted">
            {labels.detail.emptyBody}
          </p>
        </div>
      )}

      {row && previewOpen && (
        <DetectionPreviewDialog
          labels={labels}
          row={row}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          onReview={onReview}
          reviewing={reviewing}
          reviewError={reviewError}
          formatNumber={formatNumber}
          formatDateTime={formatDateTime}
        />
      )}
    </section>
  );
}

function Filled({
  labels,
  row,
  pair,
  formatNumber,
  formatDate,
  formatDateTime,
  onOpenPreview,
}: {
  labels: ChangeDetectionLabels;
  row: DetectionRow;
  pair: ComparisonPair | null;
  formatNumber: (value: number) => string;
  formatDate: (value: string | null) => string;
  formatDateTime: (value: string) => string;
  onOpenPreview: () => void;
}) {
  const percent = confidencePercent(row.confidence);
  const bandText = labels.band(row.band);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-base font-bold tracking-wide text-fg-strong">
          {row.ref}
        </p>
        <ReviewChip status={row.reviewStatus}>
          {labels.review.label(row.reviewStatus)}
        </ReviewChip>
      </div>

      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <dl className="flex min-w-0 flex-col gap-1">
          <Field label={labels.detail.classification}>{labels.status(row.status)}</Field>
          {row.changeType && (
            <Field label={labels.detail.changeType}>
              {labels.changeType(row.changeType)}
            </Field>
          )}
          {row.description !== "" && (
            <Field label={labels.detail.description}>{row.description}</Field>
          )}
          <Field label={labels.detail.area} mono>
            {labels.detections.area(formatNumber(Math.round(row.areaM2)))}
          </Field>
          <Field label={labels.detail.redZone} mono>
            {labels.percent(formatNumber(Math.round(row.redZoneOverlapPct)))}
          </Field>
          <Field label={labels.detail.brightness} mono>
            {formatNumber(row.brightnessDelta)}
          </Field>
          {row.centre && (
            <Field label={labels.detail.centre} mono>
              {row.centre[1].toFixed(6)}, {row.centre[0].toFixed(6)}
            </Field>
          )}
          <Field label={labels.detail.run}>
            {labels.run.option(
              formatDate(pair?.reference?.capturedAt ?? null),
              formatDate(pair?.current?.capturedAt ?? null),
            )}
          </Field>
          {row.reviewedBy && (
            <Field label={labels.detail.reviewedBy}>{row.reviewedBy}</Field>
          )}
          {row.reviewedAt && (
            <Field label={labels.detail.reviewedAt} mono>
              {formatDateTime(row.reviewedAt)}
            </Field>
          )}
        </dl>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-fg-muted">{labels.detail.confidence}</span>
              <span className="text-sm font-bold text-fg-strong tabular">
                {labels.detections.confidenceLabel(formatNumber(percent), bandText)}
              </span>
            </div>
            <Progress
              value={percent}
              aria-label={labels.detail.confidenceMeter(formatNumber(percent), bandText)}
              className={cn("h-1.5 bg-surface-2", BAND_METER[row.band])}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Button variant="secondary" size="sm" onClick={onOpenPreview}>
              <Icon name="action.view" className="size-4" />
              {labels.detail.viewFull}
            </Button>
            <Button asChild size="sm">
              <Link to={`${ROUTES.complaintNew}${toComplaintSearch(row)}`}>
                <Icon name="nav.createComplaint" className="size-4" />
                {labels.detail.createComplaint}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
