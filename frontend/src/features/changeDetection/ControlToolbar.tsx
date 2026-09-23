/**
 * The bar between the page title and the map — Figma 130:2030.
 *
 * The frame draws three things: a one-segment "Overlay" control, a zoom cluster
 * (out / readout / in / a move glyph), and a "Search parcel / Khasra No." box.
 * All three are here with their meaning matched to the data that exists, and
 * each departure is deliberate:
 *
 *   - **the segmented control gains two segments.** One segment is not a
 *     control; comparing the previous flight with the current one is the
 *     screen's job (progress-tracker §6), so it reads Previous / Overlay /
 *     Current, with Overlay — the frame's own state — the default.
 *   - **the readout is a zoom LEVEL, not "100%".** A slippy map has no 100%.
 *   - **the fourth button fits the map to the imagery.** The frame's glyph is a
 *     four-way move arrow; MapLibre already pans on drag, so a pan MODE would
 *     be a button over nothing. Recentring on the flight's own extent is that
 *     gesture's intent and is backed by `Raster.bounds_4326`.
 *   - **the search box searches DETECTIONS.** There is no parcel id and no
 *     khasra number anywhere in this API, so the frame's placeholder would be a
 *     label over an invented field. It matches the detection reference and the
 *     worker's description, both of which are real.
 *
 * The project and comparison pickers are additions with no counterpart in the
 * frame. Both are hidden when there is only one thing to pick, which is the
 * case the frame draws.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { COMPARE_MODES, isCompareMode, type CompareMode } from "./model";
import type { RunOption } from "./useChangeDetection";

const MODE_ICON = {
  reference: "form.chevronLeft",
  overlay: "map.overlay",
  current: "form.chevronRight",
} as const;

export function ControlToolbar({
  labels,
  projects,
  projectId,
  onSelectProject,
  runs,
  runId,
  onSelectRun,
  formatCycleDate,
  mode,
  onModeChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  canFit,
  query,
  onQueryChange,
}: {
  labels: ChangeDetectionLabels;
  projects: { id: string; name: string }[];
  projectId: string | null;
  onSelectProject: (id: string) => void;
  runs: RunOption[];
  runId: string | null;
  onSelectRun: (id: string) => void;
  formatCycleDate: (value: string | null) => string;
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  canFit: boolean;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const zoomText = String(Math.round(zoom));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-card px-4 py-2 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        {projects.length > 1 && (
          <>
            <Label htmlFor="cd-project" className="sr-only">
              {labels.project.label}
            </Label>
            <Select value={projectId ?? undefined} onValueChange={onSelectProject}>
              <SelectTrigger id="cd-project" size="sm" className="max-w-52">
                <SelectValue placeholder={labels.project.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {runs.length > 1 && (
          <>
            <Label htmlFor="cd-run" className="sr-only">
              {labels.run.label}
            </Label>
            <Select value={runId ?? undefined} onValueChange={onSelectRun}>
              <SelectTrigger id="cd-run" size="sm" className="max-w-64">
                <SelectValue placeholder={labels.run.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.referenceDate ?? run.currentDate
                      ? labels.run.option(
                          formatCycleDate(run.referenceDate),
                          formatCycleDate(run.currentDate),
                        )
                      : labels.run.optionUndated(run.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          aria-label={labels.compare.label}
          // Radix clears the value when the pressed item is pressed again, and
          // "no comparison mode" is not a state this screen has.
          onValueChange={(next) => {
            if (isCompareMode(next)) onModeChange(next);
          }}
        >
          {COMPARE_MODES.map((item) => (
            <ToggleGroupItem key={item} value={item} title={labels.compare.hint(item)}>
              <Icon name={MODE_ICON[item]} className="size-3.5" />
              <span className="text-xs">{labels.compare.mode(item)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex items-center gap-0.5 rounded-md border border-line px-1 py-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={labels.zoom.out}
            onClick={onZoomOut}
          >
            <Icon name="map.zoomOut" />
          </Button>
          <span className="px-1 text-xs text-fg-muted tabular">
            <span className="sr-only">{labels.zoom.levelLabel(zoomText)}</span>
            <span aria-hidden>{labels.zoom.level(zoomText)}</span>
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={labels.zoom.in}
            onClick={onZoomIn}
          >
            <Icon name="map.zoomIn" />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-3" />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={labels.zoom.fit}
            title={canFit ? labels.zoom.fit : labels.zoom.fitUnavailable}
            disabled={!canFit}
            onClick={onFit}
          >
            <Icon name="map.target" />
          </Button>
        </div>
      </div>

      <div className="relative w-full min-w-56 sm:w-72">
        <Label htmlFor="cd-search" className="sr-only">
          {labels.search.label}
        </Label>
        <Icon
          name="nav.search"
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint"
        />
        <Input
          id="cd-search"
          type="search"
          value={query}
          placeholder={labels.search.placeholder}
          className="ps-9 pe-9"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query !== "" && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={labels.search.clear}
            className="absolute end-2 top-1/2 -translate-y-1/2"
            onClick={() => onQueryChange("")}
          >
            <Icon name="action.clear" />
          </Button>
        )}
      </div>
    </div>
  );
}
