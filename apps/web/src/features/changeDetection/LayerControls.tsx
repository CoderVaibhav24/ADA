/**
 * The Layer Controls card — Figma 17:4835.
 *
 * The frame lists four flat rows: Encroachments, Parcel Boundaries, Road
 * Network, Satellite Imagery. Two of those four have nothing behind them —
 * there is no cadastral parcel layer and no road layer in this API — so they
 * are not drawn. What replaces them is the layer stack the map actually has,
 * in the OneMap UP shape the scope decision requires: grouped over a common
 * base map, fixed order, one toggle each.
 *
 * Reordering is not here, and there is no affordance suggesting it exists.
 *
 * The drone imagery group follows the legacy console's layer rows
 * (components/LayerRow.tsx): one row per flight with a status chip, locate and
 * delete, and its own opacity slider once it is ready.
 */

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Icon } from "@/lib/icons";

import type { ChangeDetectionLabels } from "./labels";
import { restoreHours, type FlightChip, type LayerGroupId, type LayerId } from "./model";
import { PanelSection, Swatch } from "./parts";
import { flightSwatch, type FlightState, type LayerState } from "./useLayerTree";

export function LayerControls({
  labels,
  layers,
  groups,
  onVisibleChange,
  onOpacityChange,
  flights,
  onFlightVisibleChange,
  onFlightOpacityChange,
  onLocateFlight,
  onDeleteFlight,
  onRestoreFlight,
  focusedFlightId = null,
  onReorderFlight,
  imageryAction,
  toolbar,
}: {
  labels: ChangeDetectionLabels;
  layers: LayerState[];
  groups: LayerGroupId[];
  onVisibleChange: (id: LayerId, visible: boolean) => void;
  onOpacityChange: (id: LayerId, opacity: number) => void;
  flights: FlightState[];
  onFlightVisibleChange: (id: string, visible: boolean) => void;
  onFlightOpacityChange: (id: string, opacity: number) => void;
  onLocateFlight: (flight: FlightState) => void;
  /** Absent without imagery.write, and then no remove button is drawn. */
  onDeleteFlight?: (flight: FlightState) => void;
  /** Absent without imagery.write; archived flights then show no Restore button. */
  onRestoreFlight?: (flight: FlightState) => void;
  /** Outlined and scrolled into view, after "Use existing" pointed at it. */
  focusedFlightId?: string | null;
  /** Restacks flights: the dragged one takes the drop target's place. */
  onReorderFlight?: (dragId: string, dropId: string) => void;
  /** Beside the drone imagery heading: the Upload imagery button. */
  imageryAction?: ReactNode;
  /** A row above the heading: the search box and the hide-panel button. */
  toolbar?: ReactNode;
}) {
  const flightCount = flights.filter((flight) => !flight.uploading).length;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [noDragId, setNoDragId] = useState<string | null>(null);
  const stackable = flights.filter((flight) => !flight.uploading);
  const canReorder = onReorderFlight !== undefined && stackable.length > 1;

  const drop = (targetId: string, payloadId: string | undefined) => {
    const source = dragId ?? payloadId;
    if (source && source !== targetId) onReorderFlight?.(source, targetId);
    setDragId(null);
    setOverId(null);
    setNoDragId(null);
  };

  // The whole row is the drag target; a press on a control inside it is not a drag.
  const dragProps = (flight: FlightState): HTMLAttributes<HTMLLIElement> | undefined => {
    if (!canReorder || flight.uploading) return undefined;
    const id = flight.id;
    return {
      draggable: noDragId !== id,
      onMouseDown: (event) => {
        const target = event.target as HTMLElement;
        setNoDragId(target.closest("input, button:not([data-grip]), a, [role=slider]") ? id : null);
      },
      onMouseUp: () => setNoDragId(null),
      onDragStart: (event) => {
        setDragId(id);
        event.dataTransfer.effectAllowed = "move";
        // Firefox ignores a drag that carries no payload.
        event.dataTransfer.setData("text/plain", id);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverId(null);
      },
      onDragOver: (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOverId(id);
      },
      onDragLeave: () => setOverId((over) => (over === id ? null : over)),
      onDrop: (event) => {
        event.preventDefault();
        drop(id, event.dataTransfer.getData("text/plain") || undefined);
      },
    };
  };

  // Where the row will land: a downward move settles below the target, an upward one above.
  const dropEdge = (flight: FlightState, index: number): "above" | "below" | null => {
    if (overId !== flight.id || dragId === null || dragId === flight.id) return null;
    const from = flights.findIndex((f) => f.id === dragId);
    return from < index ? "below" : "above";
  };

  const moveBy = (flight: FlightState, step: -1 | 1) => {
    const index = stackable.findIndex((f) => f.id === flight.id);
    const neighbour = stackable[index + step];
    if (neighbour) onReorderFlight?.(flight.id, neighbour.id);
  };

  return (
    <PanelSection
      title={labels.layers.title}
      headingId="cd-layers-heading"
      toolbar={toolbar}
    >
      <div className="flex flex-col gap-3">
        {groups.map((group) =>
          group === "imagery" ? (
            <div key={group} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xs font-medium tracking-wider text-fg-faint uppercase">
                  {labels.flight.groupCount(labels.layers.group(group), String(flightCount))}
                </p>
                {imageryAction}
              </div>
              {canReorder && (
                <p className="text-2xs text-pretty text-fg-faint">{labels.flight.reorderHint}</p>
              )}
              <ul className="flex flex-col gap-2">
                {flights.map((flight, index) => (
                  <FlightRow
                    key={flight.id}
                    labels={labels}
                    flight={flight}
                    dragProps={dragProps(flight)}
                    dragging={dragId === flight.id}
                    dropEdge={dropEdge(flight, index)}
                    onMove={
                      canReorder && !flight.uploading
                        ? (step) => moveBy(flight, step)
                        : undefined
                    }
                    onVisibleChange={onFlightVisibleChange}
                    onOpacityChange={onFlightOpacityChange}
                    onLocate={onLocateFlight}
                    onDelete={onDeleteFlight}
                    onRestore={onRestoreFlight}
                    focused={focusedFlightId === flight.id}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <div key={group} className="flex flex-col gap-1.5">
              <p className="text-2xs font-medium tracking-wider text-fg-faint uppercase">
                {labels.layers.group(group)}
              </p>
              <ul className="flex flex-col gap-1.5">
                {layers
                  .filter((layer) => layer.group === group)
                  .map((layer) => (
                    <LayerRow
                      key={layer.id}
                      labels={labels}
                      layer={layer}
                      onVisibleChange={onVisibleChange}
                      onOpacityChange={onOpacityChange}
                    />
                  ))}
              </ul>
            </div>
          ),
        )}
      </div>
    </PanelSection>
  );
}

function LayerRow({
  labels,
  layer,
  onVisibleChange,
  onOpacityChange,
}: {
  labels: ChangeDetectionLabels;
  layer: LayerState;
  onVisibleChange: (id: LayerId, visible: boolean) => void;
  onOpacityChange: (id: LayerId, opacity: number) => void;
}) {
  const name = labels.layers.layer(layer.id);
  const switchId = `cd-layer-${layer.id}`;
  // An unavailable layer keeps its row rather than vanishing: a tree whose
  // length changes with the data is one the officer has to re-read every time.
  const showSlider = layer.hasOpacity && layer.available && layer.visible;

  return (
    <li className="flex flex-col gap-1">
      {/* Checkbox before the label, the same shape as the flight rows below. */}
      <div className="flex items-center gap-2">
        <Checkbox
          id={switchId}
          checked={layer.available && layer.visible}
          disabled={!layer.available}
          title={layer.available ? undefined : labels.layers.unavailable}
          aria-label={labels.layers.toggle(name)}
          onCheckedChange={(next) => onVisibleChange(layer.id, next === true)}
        />
        <Label
          htmlFor={switchId}
          className="flex min-w-0 flex-1 items-center gap-2 text-sm font-normal text-fg-muted"
        >
          {layer.swatch ? (
            <Swatch color={layer.swatch} />
          ) : (
            <span aria-hidden className="size-2.5 shrink-0" />
          )}
          <span className="truncate">{name}</span>
        </Label>
      </div>

      {!layer.available && (
        <p className="ps-6 text-2xs text-pretty text-fg-faint">
          {labels.layers.unavailable}
        </p>
      )}
      {layer.detail && (
        <p className="truncate ps-6 text-2xs text-fg-faint">{layer.detail}</p>
      )}

      {showSlider && (
        <OpacitySlider
          labels={labels}
          name={name}
          opacity={layer.opacity}
          onChange={(opacity) => onOpacityChange(layer.id, opacity)}
        />
      )}
    </li>
  );
}

// aria-label, not a <Label htmlFor>: Radix's slider Root is a span and cannot be labelled.
function OpacitySlider({
  labels,
  name,
  opacity,
  onChange,
}: {
  labels: ChangeDetectionLabels;
  name: string;
  opacity: number;
  onChange: (opacity: number) => void;
}) {
  const percent = Math.round(opacity * 100);
  return (
    <div className="flex items-center gap-2 ps-6">
      <Slider
        aria-label={labels.layers.opacity(name)}
        min={0}
        max={100}
        step={5}
        value={[percent]}
        className="h-4 flex-1"
        onValueChange={([next]) => onChange((next ?? 100) / 100)}
      />
      <span className="w-9 shrink-0 text-end font-mono text-2xs text-fg-faint tabular">
        {labels.layers.opacityValue(String(percent))}
      </span>
    </div>
  );
}

const CHIP_TONE: Record<FlightChip, string> = {
  uploading: "border-status-info-border bg-status-info text-status-info-fg",
  queued: "border-status-info-border bg-status-info text-status-info-fg",
  processing: "border-status-info-border bg-status-info text-status-info-fg",
  restoring: "border-status-info-border bg-status-info text-status-info-fg",
  retrying: "border-status-warning-border bg-status-warning text-status-warning-fg",
  archived: "border-status-neutral-border bg-status-neutral text-status-neutral-fg",
  ready: "border-status-success-border bg-status-success text-status-success-fg",
  failed: "border-status-danger-border bg-status-danger text-status-danger-fg",
  rejected: "border-status-danger-border bg-status-danger text-status-danger-fg",
};

const BUSY_CHIPS: ReadonlySet<FlightChip> = new Set([
  "uploading",
  "queued",
  "processing",
  "restoring",
  "retrying",
]);

// The sentence behind a chip that needs one: why it failed, why it is archived, what retrying means.
function chipHint(labels: ChangeDetectionLabels, flight: FlightState): string | null {
  const reason = flight.error ?? labels.flight.failedNoError;
  switch (flight.chip) {
    case "failed":
      return labels.flight.failedHint(reason);
    case "rejected":
      return labels.flight.rejectedHint(reason);
    case "retrying":
      return labels.flight.retryingHint;
    case "archived":
      return labels.flight.archivedHint;
    default:
      return null;
  }
}

function StatusChip({
  labels,
  flight,
}: {
  labels: ChangeDetectionLabels;
  flight: FlightState;
}) {
  const text = labels.flight[flight.chip];
  const busy = BUSY_CHIPS.has(flight.chip);
  const hint = chipHint(labels, flight);
  const alarming = flight.chip === "failed" || flight.chip === "rejected";
  const chip = (
    <span
      data-chip={flight.chip}
      tabIndex={hint ? 0 : undefined}
      title={busy && !hint ? (flight.stage ?? undefined) : undefined}
      aria-label={hint ?? undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-medium tracking-wide uppercase",
        CHIP_TONE[flight.chip],
      )}
    >
      {busy && <Icon name="feedback.loading" spin className="size-3 shrink-0" />}
      {alarming && <Icon name="feedback.error" className="size-3 shrink-0" />}
      {text}
    </span>
  );
  if (!hint) return chip;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent className="max-w-64">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// One uploaded flight: checkbox, swatch, name, chip, locate, delete; then meta and bar or slider.
function FlightRow({
  labels,
  flight,
  dragProps,
  dragging,
  dropEdge,
  onMove,
  onVisibleChange,
  onOpacityChange,
  onLocate,
  onDelete,
  onRestore,
  focused = false,
}: {
  labels: ChangeDetectionLabels;
  flight: FlightState;
  dragProps?: HTMLAttributes<HTMLLIElement>;
  dragging: boolean;
  dropEdge: "above" | "below" | null;
  /** Keyboard restack from the grip: -1 is up the stack, 1 is down. */
  onMove?: (step: -1 | 1) => void;
  onVisibleChange: (id: string, visible: boolean) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onLocate: (flight: FlightState) => void;
  onDelete?: (flight: FlightState) => void;
  onRestore?: (flight: FlightState) => void;
  focused?: boolean;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);
  const checkId = `cd-flight-${flight.id}`;
  const ready = flight.status === "ready";
  const busy =
    flight.chip === "queued" || flight.chip === "processing" || flight.chip === "uploading";
  const percent = String(flight.percent);
  const stage =
    flight.chip === "uploading"
      ? flight.paused
        ? labels.upload.paused
        : labels.flight.uploadPercent(percent)
      : (flight.stage ?? labels.flight.stageFallback);
  const meta = [
    flight.role === "current" ? labels.layers.layer("currentCycle") : null,
    flight.role === "reference" ? labels.layers.layer("referenceCycle") : null,
    flight.resolutionM !== null
      ? labels.flight.resolution(flight.resolutionM.toFixed(2))
      : null,
    flight.crs,
  ].filter((part): part is string => Boolean(part));

  return (
    <li
      {...dragProps}
      ref={rowRef}
      className={cn(
        "flex flex-col gap-1 rounded-xs",
        focused && "ring-2 ring-ring ring-offset-2 ring-offset-surface-2",
        ready && !flight.visible && "opacity-70",
        dragProps && "cursor-grab",
        dragging && "opacity-40",
        dropEdge === "above" && "shadow-[0_-2px_0_0_var(--color-accent-solid)]",
        dropEdge === "below" && "shadow-[0_2px_0_0_var(--color-accent-solid)]",
      )}
      data-flight-status={flight.chip}
    >
      <div className="flex items-center gap-2">
        {onMove && (
          <button
            type="button"
            data-grip
            className="-ms-1 shrink-0 cursor-grab rounded-xs text-fg-faint hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={labels.flight.dragHandle(flight.name)}
            title={labels.flight.reorderHint}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") onMove(-1);
              else if (event.key === "ArrowDown") onMove(1);
              else return;
              event.preventDefault();
            }}
          >
            <Icon name="form.dragHandle" className="size-3.5" />
          </button>
        )}
        <Checkbox
          id={checkId}
          checked={ready && flight.visible}
          disabled={!ready}
          aria-label={labels.layers.toggle(flight.name)}
          onCheckedChange={(next) => onVisibleChange(flight.id, next === true)}
        />
        <Label
          htmlFor={checkId}
          className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium tracking-wide text-fg-strong uppercase"
        >
          <Swatch color={flightSwatch(flight.role)} />
          <span className="truncate" title={flight.name}>
            {flight.name}
          </span>
        </Label>
        <StatusChip labels={labels} flight={flight} />
        {!flight.uploading && (
          <span className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-fg-muted"
              aria-label={labels.flight.locate(flight.name)}
              title={
                flight.bounds ? labels.flight.locate(flight.name) : labels.flight.locateUnavailable
              }
              disabled={flight.bounds === null}
              onClick={() => onLocate(flight)}
            >
              <Icon name="map.target" />
            </Button>
            {onRestore && flight.chip === "archived" && (
              <Button
                variant="outline"
                size="xs"
                aria-label={labels.flight.restoreLabel(flight.name)}
                title={labels.flight.archivedHint}
                onClick={() => onRestore(flight)}
              >
                {labels.flight.restore}
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-fg-muted hover:text-status-danger-fg"
                aria-label={labels.flight.delete(flight.name)}
                title={labels.flight.delete(flight.name)}
                onClick={() => onDelete(flight)}
              >
                <Icon name="action.delete" />
              </Button>
            )}
          </span>
        )}
      </div>

      {meta.length > 0 && (
        <p className="truncate ps-6 font-mono text-2xs text-fg-faint">{meta.join(" · ")}</p>
      )}

      {busy && (
        <div className="flex flex-col gap-1 ps-6">
          <Progress
            value={flight.percent}
            className="h-1"
            aria-label={labels.flight.progressLabel(flight.name, stage, percent)}
          />
          <div className="flex items-center justify-between gap-2 font-mono text-2xs text-fg-faint">
            <span className="truncate" title={stage}>
              {stage}
            </span>
            <span className="shrink-0 tabular">{labels.flight.percent(percent)}</span>
          </div>
        </div>
      )}

      {flight.chip === "restoring" && (
        <p role="status" className="ps-6 font-mono text-2xs text-fg-faint">
          {restoreHours(flight.restoreEtaHours) !== null
            ? labels.flight.restoringEta(String(restoreHours(flight.restoreEtaHours)))
            : labels.flight.restoringNoEta}
        </p>
      )}

      {ready && flight.visible && (
        <div className="ps-1.5">
          <OpacitySlider
            labels={labels}
            name={flight.name}
            opacity={flight.opacity}
            onChange={(opacity) => onOpacityChange(flight.id, opacity)}
          />
        </div>
      )}
    </li>
  );
}
