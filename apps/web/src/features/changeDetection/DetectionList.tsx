/**
 * The Detected Changes card — Figma 17:4866.
 *
 * The frame draws four populated cards and nothing else: no loading, no empty,
 * no error, no end of the list. All four are here.
 *
 * Each card in the frame carries an id, a confidence percentage, a LOCATION
 * ("Sector 7, North Block") and an area plus a type. The location line is not
 * drawn: a change polygon has a geometry and nothing else — no sector, no
 * block, no ward — and a made-up place name on an enforcement screen is worse
 * than a missing one. Its slot is taken by the ML worker's own description of
 * the change, which is real.
 *
 * The list is bounded. `boundDetections` pages it and stops at a hard cap, and
 * the card says which of the two is holding rows back rather than silently
 * truncating.
 */

import { cn } from "cn";

import {
  EmptyState,
  LoadingState,
  NoResultsState,
} from "@/components/icms/states";
import { StatusChip } from "@/components/icms/StatusChip";
import { Button } from "@/components/ui/button";
import { useCaseStatusLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";

import {
  CASE_STATUS_META,
  toCaseStatus,
} from "@/features/complaints/caseStatus";

import type { ChangeDetectionLabels } from "./labels";
import {
  confidencePercent,
  DETECTION_HARD_CAP,
  DETECTION_PAGE,
  type BoundedDetections,
  type DetectionRow,
} from "./model";
import { ConfidenceReading, Failure, PanelSection, ReviewChip } from "./parts";
import type { LoadFailure, LoadStatus } from "./useChangeDetection";

export function DetectionList({
  labels,
  status,
  error,
  onRetry,
  bounded,
  totalCount,
  query,
  onClearQuery,
  onShowMore,
  selectedKey,
  onSelect,
  formatNumber,
}: {
  labels: ChangeDetectionLabels;
  status: LoadStatus;
  error: LoadFailure | null;
  onRetry: () => void;
  bounded: BoundedDetections;
  /** Before the search narrowed it — the number in the card's heading. */
  totalCount: number;
  query: string;
  onClearQuery: () => void;
  onShowMore: () => void;
  selectedKey: string | null;
  onSelect: (row: DetectionRow) => void;
  formatNumber: (value: number) => string;
}) {
  const heading =
    status === "ready"
      ? labels.detections.titleWithCount(formatNumber(totalCount))
      : labels.detections.title;

  return (
    <PanelSection
      title={heading}
      headingId="cd-detections-heading"
      bodyClassName="max-h-[28rem] overflow-y-auto"
    >
      {status === "loading" && (
        <LoadingState
          label={labels.detections.loading}
          lines={4}
          className="p-0"
        />
      )}

      {status === "error" && error && (
        <Failure
          compact
          title={labels.detections.errorTitle}
          message={error.message || labels.detections.errorBody}
          requestId={error.requestId}
          requestIdText={labels.error.requestId}
          requestIdMissingText={labels.error.requestIdMissing}
          onRetry={onRetry}
          retryLabel={labels.detections.retry}
        />
      )}

      {status === "ready" && totalCount === 0 && (
        <EmptyState
          size="compact"
          icon="map.encroachment"
          title={labels.detections.emptyTitle}
          description={labels.detections.emptyBody}
        />
      )}

      {status === "ready" && totalCount > 0 && bounded.total === 0 && (
        <NoResultsState
          size="compact"
          title={labels.detections.noResultsTitle}
          description={labels.detections.noResultsBody(query)}
          action={
            <Button variant="outline" size="sm" onClick={onClearQuery}>
              <Icon name="action.clear" className="size-4" />
              {labels.detections.clearSearch}
            </Button>
          }
        />
      )}

      {status === "ready" && bounded.shown.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {bounded.shown.map((row) => (
              <DetectionCard
                key={row.key}
                labels={labels}
                row={row}
                selected={row.key === selectedKey}
                onSelect={onSelect}
                formatNumber={formatNumber}
              />
            ))}
          </ul>

          <div className="flex flex-col items-start gap-2 pt-3">
            <p role="status" className="text-2xs text-fg-faint">
              {labels.detections.showing(
                formatNumber(bounded.shown.length),
                formatNumber(bounded.total),
              )}
            </p>
            {bounded.canShowMore && (
              <Button variant="outline" size="sm" onClick={onShowMore}>
                {labels.detections.showMore(
                  formatNumber(
                    Math.min(
                      DETECTION_PAGE,
                      bounded.total - bounded.shown.length,
                      DETECTION_HARD_CAP - bounded.shown.length,
                    ),
                  ),
                )}
              </Button>
            )}
            {bounded.capped && !bounded.canShowMore && (
              <p className="text-2xs text-pretty text-fg-muted">
                {labels.detections.capped(
                  formatNumber(DETECTION_HARD_CAP),
                  formatNumber(bounded.total),
                )}
              </p>
            )}
          </div>
        </>
      )}
    </PanelSection>
  );
}

function DetectionCard({
  labels,
  row,
  selected,
  onSelect,
  formatNumber,
}: {
  labels: ChangeDetectionLabels;
  row: DetectionRow;
  selected: boolean;
  onSelect: (row: DetectionRow) => void;
  formatNumber: (value: number) => string;
}) {
  const percent = confidencePercent(row.confidence);
  const percentText = labels.detections.confidence(formatNumber(percent));
  const bandText = labels.band(row.band);
  const caseLabels = useCaseStatusLabels();
  const caseStatus = row.linkedCase
    ? toCaseStatus(row.linkedCase.status)
    : null;

  return (
    <li>
      {/* A button, not a div with onClick: this is the screen's primary way in
          to a detection and it has to be reachable from the keyboard. */}
      {/* No aria-label: one on a button REPLACES its content as the
          accessible name, which would hide the confidence, the area and the
          classification from a screen reader. The content is the name. */}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(row)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-xs border bg-surface-1 px-3 py-2.5 text-start",
          "transition-colors duration-fast ease-standard hover:bg-surface-3",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          selected ? "border-line-accent bg-surface-3" : "border-line",
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-mono text-sm font-medium text-danger-300 tabular">
            {row.ref}
          </span>
          <ConfidenceReading
            band={row.band}
            percentText={percentText}
            bandText={bandText}
            srText={labels.detections.confidenceLabel(
              formatNumber(percent),
              bandText,
            )}
          />
        </span>

        {row.description !== "" && (
          <span className="line-clamp-2 text-sm text-fg-muted">
            {row.description}
          </span>
        )}

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
          <span className="text-sm text-fg-faint tabular">
            {labels.detections.area(formatNumber(Math.round(row.areaM2)))}
          </span>
          <span aria-hidden className="text-fg-faint">
            ·
          </span>
          <span className="text-sm text-fg-muted">
            {labels.status(row.status)}
          </span>
          {row.reviewStatus !== "pending" && (
            <ReviewChip status={row.reviewStatus}>
              {labels.review.label(row.reviewStatus)}
            </ReviewChip>
          )}
        </span>

        {row.redZoneOverlapPct > 0 && (
          <span className="text-2xs text-status-danger-fg">
            {labels.detections.redZone(
              formatNumber(Math.round(row.redZoneOverlapPct)),
            )}
          </span>
        )}

        {row.linkedCase && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <span className="font-mono text-2xs text-fg-muted tabular">
              {labels.detections.linkedCase(row.linkedCase.ref)}
            </span>
            <StatusChip
              status={
                caseStatus ? CASE_STATUS_META[caseStatus].chip : "unknown"
              }
              size="sm"
            >
              {caseStatus ? caseLabels[caseStatus] : row.linkedCase.status}
            </StatusChip>
          </span>
        )}
      </button>
    </li>
  );
}
