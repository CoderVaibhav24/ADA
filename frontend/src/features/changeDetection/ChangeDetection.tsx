/**
 * Change Detection — Map Comparison. Figma 17:1249 (empty) and 17:6917 (filled).
 *
 * ## The one substitution
 *
 * The frame paints the parcels as flat black and dark-blue artwork with ten
 * labelled rectangles and a reservoir. That is mock-up. Everything else here is
 * transformed from the frame — the header, the control bar, the floating
 * opacity pill, the 280px right column of three cards, the detail panel across
 * the foot of the map — and the imagery alone is swapped for the COG tiles
 * `/api/tiles/raster/{id}/{z}/{x}/{y}.png` serves, drawn by the existing
 * `components/MapView`. No second map is stood up; MapView gained optional
 * props instead.
 *
 * ## Comparing two flights
 *
 * The tracker's open question was `maplibre-gl-compare` against a custom
 * clip-path control. Neither is here: both need two map canvases, which is the
 * one thing this screen was told not to build. What IS here is the comparison
 * the frame itself draws — the two cycles stacked, with "Overlay Opacity"
 * cross-fading the current flight over the previous one, plus Previous /
 * Current segments that pin it to one or the other.
 *
 * ## The shell
 *
 * No rail, no top bar, no gutter: `ProtectedLayout` mounts all three, and
 * `/change-detection` is already a bleed path, so this component owns a
 * full-height box and scrolls inside it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatIstDate, formatIstDateTime } from "@ada/shared/dates";

import { ApiError, download, downloadUrl } from "@/api/client";
import { EmptyState } from "@/components/icms/states";
import MapView, { type MapViewHandle } from "@/components/MapView";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { formatNumber, localeTag, useLanguage } from "@/i18n";
import { Icon } from "@/lib/icons";
import { useStore } from "@/state/store";

import { ControlToolbar } from "./ControlToolbar";
import { DetectionDetails } from "./DetectionDetails";
import { DetectionList } from "./DetectionList";
import { useChangeDetectionLabels } from "./labels";
import { LayerControls } from "./LayerControls";
import { MapLegend } from "./MapLegend";
import {
  cycleOpacities,
  detectionKey,
  sid,
  type CompareMode,
  type DetectionRow,
} from "./model";
import { Failure } from "./parts";
import { useChangeDetection, type LoadFailure } from "./useChangeDetection";
import { useLayerTree } from "./useLayerTree";

export default function ChangeDetection() {
  const labels = useChangeDetectionLabels();
  const navigate = useNavigate();
  const cd = useChangeDetection();

  const [mode, setMode] = useState<CompareMode>("overlay");
  const [blend, setBlend] = useState(1);
  const [zoom, setZoom] = useState(12);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<LoadFailure | null>(null);
  const mapRef = useRef<MapViewHandle>(null);

  /* ------------------------------------------------------------- formatting
     Built from `language` rather than taken from `useFormats()`, whose closures
     are new on every render: two of these are dependencies of memoised hooks
     below, and an unstable one rebuilds the whole layer tree per keystroke. */
  const { language } = useLanguage();
  const locale = localeTag(language);
  const undated = labels.undated;

  const num = useCallback((value: number) => formatNumber(language, value), [language]);

  const date = useCallback(
    (value: string | null) => {
      if (!value) return undated;
      // formatIstDate throws rather than rendering "Invalid Date"; a flight
      // whose capture date the ingest could not parse is undated, not fatal.
      try {
        return formatIstDate(value, locale);
      } catch {
        return undated;
      }
    },
    [locale, undated],
  );

  const dateTime = useCallback(
    (value: string) => {
      try {
        return formatIstDateTime(value, locale);
      } catch {
        return value;
      }
    },
    [locale],
  );

  const zoneCountLabel = useCallback(
    (n: number) => labels.layers.zoneCount(num(n)),
    [labels, num],
  );

  const layerTree = useLayerTree(cd.pair, cd.runId, zoneCountLabel, labels.layers.zoneNone);

  /* ------------------------------------------------------ what the map draws
     A project holds every flight ever uploaded and every run ever started, and
     MapView draws all of them. A comparison is a PAIR, so when the chosen run
     changes, everything outside it is switched off once. After that the layer
     tree's own toggles win — this does not run again until the pair does. */
  const referenceId = cd.pair?.reference?.id ?? null;
  const currentId = cd.pair?.current?.id ?? null;
  const rasterKeys = useStore((s) => s.rasters.map((r) => sid(r.id)).join(","));
  const analysisKeys = useStore((s) => s.analyses.map((a) => sid(a.id)).join(","));
  const runId = cd.runId;

  useEffect(() => {
    const store = useStore.getState();
    const keep = new Set([referenceId, currentId].filter((id) => id !== null));
    for (const raster of store.rasters) {
      store.patchRasterUI(raster.id, { visible: keep.has(sid(raster.id)) });
    }
    for (const analysis of store.analyses) {
      const on = sid(analysis.id) === runId;
      store.patchMaskUI(analysis.id, { visible: on });
      store.patchPolyUI(analysis.id, { visible: on });
    }
  }, [referenceId, currentId, runId, rasterKeys, analysisKeys]);

  // The comparison control IS the two rasters' opacity. One writer, so the
  // slider and the segments can never disagree about what is on screen.
  useEffect(() => {
    const { reference, current } = cycleOpacities(mode, blend);
    const store = useStore.getState();
    if (referenceId) store.patchRasterUI(referenceId, { opacity: reference });
    if (currentId) store.patchRasterUI(currentId, { opacity: current });
  }, [mode, blend, referenceId, currentId, rasterKeys]);

  /* ---------------------------------------------------------------- actions */

  const fitBounds = cd.pair?.current?.bounds ?? cd.pair?.reference?.bounds ?? null;
  const select = cd.select;
  const selectedRow = cd.selected;

  // Memoised because MapView's feature-state effect depends on it: a fresh
  // object literal would clear and re-apply the highlight on every render,
  // which during a zoom is every animation frame.
  const mapSelection = useMemo(
    () =>
      selectedRow
        ? { jobId: selectedRow.jobId, featureId: selectedRow.featureId }
        : null,
    [selectedRow],
  );

  const openDetection = useCallback(
    (row: DetectionRow) => {
      select(row.key);
      if (row.bounds) mapRef.current?.fitBounds(row.bounds);
    },
    [select],
  );

  const exportFailed = labels.export.failed;
  const exportRun = useCallback(
    async (kind: "geojson" | "csv") => {
      if (!runId) return;
      setExporting(true);
      setExportError(null);
      try {
        await download(
          kind === "geojson"
            ? downloadUrl.reportGeojson(runId)
            : downloadUrl.reportCsv(runId),
          `ada_analysis_${runId}.${kind}`,
        );
      } catch (cause: unknown) {
        setExportError(
          cause instanceof ApiError
            ? { message: cause.message, requestId: cause.requestId }
            : { message: exportFailed, requestId: null },
        );
      } finally {
        setExporting(false);
      }
    },
    [runId, exportFailed],
  );

  const subtitle = cd.pair
    ? labels.subtitle(
        date(cd.pair.reference?.capturedAt ?? null),
        date(cd.pair.current?.capturedAt ?? null),
        cd.projectName,
      )
    : labels.subtitleNoRun(cd.projectName);

  const noProjects = cd.status === "ready" && cd.projects.length === 0;
  const blendPercent = Math.round(blend * 100);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full border-accent-soft-border bg-accent-soft text-fg-link"
          onClick={() => void navigate(-1)}
        >
          <Icon name="action.back" className="size-4" />
          {labels.back}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
            {labels.title}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              disabled={exporting || !runId}
              title={runId ? labels.export.menu : labels.export.unavailable}
            >
              <Icon
                name={exporting ? "feedback.loading" : "action.download"}
                spin={exporting}
                className="size-4"
              />
              {exporting ? labels.export.running : labels.export.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void exportRun("geojson")}>
              {labels.export.geojson}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportRun("csv")}>
              {labels.export.csv}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {cd.error && (
        <Failure
          title={labels.error.title}
          message={cd.error.message || labels.error.body}
          requestId={cd.error.requestId}
          requestIdText={labels.error.requestId}
          requestIdMissingText={labels.error.requestIdMissing}
          onRetry={cd.reload}
          retryLabel={labels.error.retry}
        />
      )}

      {exportError && (
        <Failure
          compact
          title={labels.export.failed}
          message={exportError.message}
          requestId={exportError.requestId}
          requestIdText={labels.error.requestId}
          requestIdMissingText={labels.error.requestIdMissing}
        />
      )}

      {noProjects ? (
        <EmptyState
          icon="nav.map"
          title={labels.project.emptyTitle}
          description={labels.project.emptyBody}
        />
      ) : (
        <>
          <ControlToolbar
            labels={labels}
            projects={cd.projects}
            projectId={cd.projectId}
            onSelectProject={cd.selectProject}
            runs={cd.runs}
            runId={runId}
            onSelectRun={cd.selectRun}
            formatCycleDate={date}
            mode={mode}
            onModeChange={setMode}
            zoom={zoom}
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
            onFit={() => {
              if (fitBounds) mapRef.current?.fitBounds(fitBounds);
            }}
            canFit={fitBounds !== null}
            query={cd.query}
            onQueryChange={cd.setQuery}
          />

          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-h-0 flex-col gap-4">
              <div
                role="region"
                aria-label={labels.mapLabel}
                className="relative min-h-96 flex-1 overflow-hidden rounded-md border border-line bg-surface-sunken"
              >
                {/* `.map-wrap` is `flex: 1`, so it needs a flex parent with a
                    definite height — hence the absolutely positioned box. */}
                <div className="absolute inset-0 flex">
                  <MapView
                    ref={mapRef}
                    showLegend={false}
                    showEmptyHint={false}
                    basemapVisible={layerTree.basemapVisible}
                    selection={mapSelection}
                    onSelect={(selection) =>
                      select(
                        selection
                          ? detectionKey(selection.jobId, selection.featureId)
                          : null,
                      )
                    }
                    onZoomChange={(next) => setZoom(Math.round(next))}
                  />
                </div>

                {cd.pendingRun && (
                  <RunNotice
                    tone="info"
                    title={labels.run.pendingTitle}
                    body={labels.run.pendingBody(
                      cd.pendingRun.stage ?? labels.run.pendingNoStage,
                      num(cd.pendingRun.percent),
                    )}
                    hint={labels.run.pendingHint}
                  />
                )}
                {!cd.pendingRun && cd.failedRun !== null && (
                  <RunNotice
                    tone="danger"
                    title={labels.run.failedTitle}
                    body={labels.run.failedBody(cd.failedRun)}
                  />
                )}
                {!cd.pendingRun && cd.failedRun === null && !cd.pair && (
                  <RunNotice
                    tone="info"
                    title={labels.run.noneTitle}
                    body={labels.run.noneBody}
                  />
                )}

                {/* The frame's floating pill, 130:2243. It IS the comparison
                    control, so it is disabled outside Overlay and says why. */}
                <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xs border border-line-subtle bg-surface-overlay px-4 py-2 backdrop-blur-sm">
                  {/* A span, not a <Label htmlFor>: Radix's slider Root is a
                      span and cannot be labelled that way. `aria-labelledby`
                      points at this text so the accessible name IS the visible
                      name (WCAG 2.5.3). */}
                  <span
                    id="cd-blend-label"
                    className="font-mono text-2xs text-fg-muted"
                  >
                    {labels.blend.label}
                  </span>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[blendPercent]}
                    disabled={mode !== "overlay"}
                    aria-labelledby="cd-blend-label"
                    title={mode === "overlay" ? labels.blend.valueLabel : labels.blend.disabled}
                    className="w-30"
                    onValueChange={([next]) => setBlend((next ?? 100) / 100)}
                  />
                  <span className="w-10 shrink-0 text-end font-mono text-xs text-fg-muted tabular">
                    {labels.percent(num(blendPercent))}
                  </span>
                </div>
              </div>

              <DetectionDetails
                labels={labels}
                row={cd.selected}
                pair={cd.pair}
                onReview={(row, status) => void cd.review(row, status)}
                reviewing={cd.reviewing}
                reviewError={cd.reviewError}
                formatNumber={num}
                formatDate={date}
                formatDateTime={dateTime}
              />
            </div>

            {/* Below `lg` the 280px column would leave the map unusable, so it
                falls under the map instead of squeezing beside it. */}
            <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-surface-2">
              <LayerControls
                labels={labels}
                layers={layerTree.layers}
                groups={layerTree.groups}
                onVisibleChange={layerTree.setVisible}
                onOpacityChange={layerTree.setOpacity}
              />
              <DetectionList
                labels={labels}
                status={cd.detectionsStatus}
                error={cd.detectionsError}
                onRetry={cd.reloadDetections}
                bounded={cd.bounded}
                totalCount={cd.totalCount}
                query={cd.query}
                onClearQuery={() => cd.setQuery("")}
                onShowMore={cd.showMore}
                selectedKey={cd.selected?.key ?? null}
                onSelect={openDetection}
                formatNumber={num}
              />
              <MapLegend labels={labels} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/** Why the map is empty, over the map, where the officer is already looking. */
function RunNotice({
  title,
  body,
  hint,
  tone,
}: {
  title: string;
  body: string;
  hint?: string;
  tone: "info" | "danger";
}) {
  return (
    <div
      role="status"
      className={`absolute top-3 left-1/2 z-10 flex max-w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col gap-1 rounded-md border px-4 py-3 backdrop-blur-sm ${
        tone === "danger"
          ? "border-status-danger-border bg-status-danger"
          : "border-status-info-border bg-status-info"
      }`}
    >
      <p
        className={`text-sm font-semibold ${
          tone === "danger" ? "text-status-danger-fg" : "text-status-info-fg"
        }`}
      >
        {title}
      </p>
      <p className="text-sm text-pretty text-fg-muted">{body}</p>
      {hint && <p className="text-2xs text-fg-faint">{hint}</p>}
    </div>
  );
}
