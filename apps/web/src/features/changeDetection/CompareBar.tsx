/**
 * Pick the before and after flights, run change detection on them, and swipe
 * between them on the map. The two pickers drive what the map draws.
 */

import { cn } from "cn";

import type { AnalysisMode } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Icon } from "@/lib/icons";

import type { ChangeDetectionLabels } from "./labels";
import { splitStage } from "./model";
import type { SwipeOrientation } from "./SwipeCompare";

export type FlightOption = { id: string; name: string; capturedAt: string | null };

/** The ml-worker tier beside the run button; `slow` is the CPU tier. */
export type RuntimeChip = { text: string; title: string; slow: boolean };

const MODES: readonly AnalysisMode[] = ["ai", "diff"];

export function CompareBar({
  labels,
  flights,
  beforeId,
  afterId,
  onBeforeChange,
  onAfterChange,
  mode,
  onModeChange,
  canRun,
  starting,
  onRun,
  activeRun,
  runtime = null,
  swipe,
  onSwipeChange,
  formatDate,
}: {
  labels: ChangeDetectionLabels;
  flights: FlightOption[];
  beforeId: string | null;
  afterId: string | null;
  onBeforeChange: (id: string) => void;
  onAfterChange: (id: string) => void;
  mode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  /** False hides the run controls; the swipe still works. */
  canRun: boolean;
  starting: boolean;
  onRun: () => void;
  activeRun: { stage: string | null; percent: number } | null;
  runtime?: RuntimeChip | null;
  swipe: SwipeOrientation | null;
  onSwipeChange: (next: SwipeOrientation | null) => void;
  formatDate: (value: string | null) => string;
}) {
  const same = beforeId !== null && beforeId === afterId;
  const pairReady = beforeId !== null && afterId !== null && !same;
  const option = (flight: FlightOption) =>
    labels.detect.flightOption(flight.name, formatDate(flight.capturedAt));

  const picker = (
    id: string,
    label: string,
    value: string | null,
    onChange: (id: string) => void,
  ) => (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="shrink-0 font-mono text-2xs text-fg-muted uppercase">
        {label}
      </Label>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="w-52">
          <SelectValue placeholder={labels.detect.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {flights.map((flight) => (
            <SelectItem key={flight.id} value={flight.id}>
              {option(flight)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    // Sticky in the page's scroll box; -top-5 cancels its p-5 so no map shows above the bar.
    <div className="sticky -top-5 z-20 flex flex-col gap-2 rounded-md border border-line bg-card px-4 py-2 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        {picker("cd-before", labels.detect.before, beforeId, onBeforeChange)}
        <Icon name="form.chevronRight" className="size-4 text-fg-faint" aria-hidden />
        {picker("cd-after", labels.detect.after, afterId, onAfterChange)}

        {canRun && (
          <>
            <Separator orientation="vertical" className="h-5" />
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mode}
              aria-label={labels.detect.mode}
              onValueChange={(next) => {
                if (MODES.includes(next as AnalysisMode)) onModeChange(next as AnalysisMode);
              }}
            >
              {MODES.map((item) => (
                <ToggleGroupItem key={item} value={item} title={labels.detect.modeHint(item)}>
                  <span className="text-xs">{labels.detect.modeName(item)}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button size="sm" disabled={!pairReady || starting} onClick={onRun}>
              <Icon
                name={starting ? "feedback.loading" : "action.run"}
                spin={starting}
                className="size-4"
              />
              {starting ? labels.detect.starting : labels.detect.run}
            </Button>
            {runtime && (
              <span
                data-runtime={runtime.slow ? "cpu" : "gpu"}
                title={runtime.title}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-2xs font-medium tracking-wide uppercase",
                  runtime.slow
                    ? "border-status-warning-border bg-status-warning text-status-warning-fg"
                    : "border-status-neutral-border bg-status-neutral text-status-neutral-fg",
                )}
              >
                {runtime.text}
              </span>
            )}
          </>
        )}

        <div className="ms-auto flex items-center gap-2">
          <span className="font-mono text-2xs text-fg-muted uppercase">
            {labels.swipe.label}
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={swipe ?? ""}
            aria-label={labels.swipe.label}
            // Pressing the active orientation again clears the value: swipe off.
            onValueChange={(next) =>
              onSwipeChange(next === "vertical" || next === "horizontal" ? next : null)
            }
          >
            <ToggleGroupItem
              value="vertical"
              disabled={!pairReady}
              aria-label={labels.swipe.vertical}
              title={labels.swipe.vertical}
            >
              <Icon name="map.compare" className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="horizontal"
              disabled={!pairReady}
              aria-label={labels.swipe.horizontal}
              title={labels.swipe.horizontal}
            >
              <Icon name="map.compare" className="size-4 rotate-90" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {same && <p className="text-xs text-status-danger-fg">{labels.detect.same}</p>}
      {flights.length < 2 && <p className="text-xs text-fg-muted">{labels.detect.needTwo}</p>}
      {activeRun && (
        <RunProgress labels={labels} stage={activeRun.stage} percent={activeRun.percent} />
      )}
    </div>
  );
}

// The in-flight run: human stage up front, engine detail muted, percent on a bar.
function RunProgress({
  labels,
  stage,
  percent,
}: {
  labels: ChangeDetectionLabels;
  stage: string | null;
  percent: number;
}) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
  const { title, detail } = splitStage(stage ?? "");
  const shown = title || labels.run.pendingNoStage;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-sm border border-status-info-border bg-status-info px-3 py-2.5"
    >
      <div className="flex items-center gap-3">
        <Icon
          name="feedback.loading"
          spin
          className="size-4 shrink-0 text-status-info-fg"
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-2xs text-fg-muted uppercase">
            {labels.detect.runningTitle}
          </span>
          <span className="truncate text-sm font-medium text-status-info-fg" title={shown}>
            {shown}
          </span>
        </div>
        <span className="shrink-0 font-mono text-xl font-semibold text-status-info-fg tabular">
          {labels.detect.runningPercent(String(value))}
        </span>
      </div>
      <Progress value={value} aria-label={labels.detect.running(shown, String(value))} />
      {detail && (
        <span className="truncate text-2xs text-fg-muted" title={detail}>
          {labels.detect.runningDetail(detail)}
        </span>
      )}
    </div>
  );
}
