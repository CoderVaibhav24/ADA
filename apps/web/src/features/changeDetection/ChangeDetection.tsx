/**
 * Change Detection — Map Comparison. Figma 17:1249 (empty) and 17:6917 (filled).
 *
 * ## The one substitution
 *
 * The frame paints the parcels as flat black and dark-blue artwork with ten
 * labelled rectangles and a reservoir. That is mock-up. Everything else here is
 * transformed from the frame — the header, the control bar, the floating
 * opacity pill, the collapsible 320px right column (layers, detections, legend,
 * detail) — and the imagery alone is swapped for the COG tiles
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
import { cn } from "cn";
import { formatIstDate, formatIstDateTime } from "@ada/shared/dates";

import { ApiError, download, downloadUrl } from "@/api/client";
import type { AnalysisMode } from "@/api/types";
import { EmptyState } from "@/components/icms/states";
import MapView, { type FitOptions, type MapViewHandle } from "@/components/MapView";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Parked 2026-09-24 with the Overlay Opacity pill below.
// import { Slider } from "@/components/ui/slider";
import { formatNumber, localeTag, useLanguage } from "@/i18n";
import { Icon } from "@/lib/icons";
import { ROUTES } from "@/routes/paths";
import { useStore } from "@/state/store";

import { CompareBar, type FlightOption, type RuntimeChip } from "./CompareBar";
import { toComplaintSearch } from "./complaintHandoff";
import { ControlToolbar } from "./ControlToolbar";
import { DeleteFlightDialog, type DeleteTarget } from "./DeleteFlightDialog";
import { DetectionDetails } from "./DetectionDetails";
import { DetectionList } from "./DetectionList";
import { useChangeDetectionLabels } from "./labels";
import { LayerControls } from "./LayerControls";
import { MapLegend } from "./MapLegend";
import {
  confidencePercent,
  // cycleOpacities,
  detectionKey,
  etaMinutes,
  fullGridMinutes,
  pairLongestSidePx,
  sid,
  // type CompareMode,
  type DetectionRow,
} from "./model";
import { DetectionSearch, Failure } from "./parts";
import { SwipeCompare, type SwipeOrientation } from "./SwipeCompare";
import { UploadDialog } from "./UploadDialog";
import {
  useCanRunImagery,
  useCanWriteImagery,
  useChangeDetection,
  useRuntime,
  type LoadFailure,
} from "./useChangeDetection";
import { useLayerTree, type UploadInFlight } from "./useLayerTree";

/** The CPU tier's grid cap when the runtime does not report its own. */
const CPU_GRID_PX = 3072;

/** Near the flights' native 0.3-0.5 m/px; closer and one building fills the map. */
const DETECTION_MAX_ZOOM = 18;
const DETECTION_MIN_PADDING = 120;

// Pads a detection fit by a third of the map's short side, so the polygon keeps its surroundings.
function detectionFit(handle: MapViewHandle | null): FitOptions {
  const container = handle?.getMap()?.getContainer();
  const side = container ? Math.min(container.clientWidth, container.clientHeight) : 0;
  return {
    maxZoom: DETECTION_MAX_ZOOM,
    padding: Math.max(DETECTION_MIN_PADDING, Math.round(side / 3)),
  };
}

export default function ChangeDetection() {
  const labels = useChangeDetectionLabels();
  const navigate = useNavigate();
  const [upload, setUpload] = useState<UploadInFlight | null>(null);
  const cd = useChangeDetection(upload?.uploadId ?? null);
  const canWrite = useCanWriteImagery();
  const canRun = useCanRunImagery();

  // Parked 2026-09-24 with the compare toggle, zoom cluster and Overlay Opacity pill.
  // const [mode, setMode] = useState<CompareMode>("overlay");
  // const [blend, setBlend] = useState(1);
  // const [zoom, setZoom] = useState(12);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<LoadFailure | null>(null);
  const [restoreError, setRestoreError] = useState<LoadFailure | null>(null);
  const runtime = useRuntime();
  const [uploadOpen, setUploadOpen] = useState(false);
  /** The flight a 409 "Use existing" pointed at, outlined in Drone imagery. */
  const [focusFlight, setFocusFlight] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  // MapLibre's default trackResize picks up the width change when this flips.
  const [panelOpen, setPanelOpen] = useState(true);
  const mapRef = useRef<MapViewHandle>(null);
  const [detectMode, setDetectMode] = useState<AnalysisMode>("ai");
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState<LoadFailure | null>(null);
  const [swipe, setSwipe] = useState<SwipeOrientation | null>(null);

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

  const layerTree = useLayerTree(
    cd.pair,
    cd.runId,
    zoneCountLabel,
    labels.layers.zoneNone,
    upload,
  );

  /* ------------------------------------------------- before and after flights
     The chosen run's pair seeds the Before / After pickers; picking a flight
     overrides that until the run changes. With no run, the two newest ready
     flights are the default. */
  const rasters = useStore((s) => s.rasters);
  const flights = useMemo<FlightOption[]>(
    () =>
      rasters
        .filter((r) => r.status === "ready")
        .map((r) => ({ id: sid(r.id), name: r.name, capturedAt: r.captured_at ?? null }))
        .sort((a, b) => (a.capturedAt ?? "").localeCompare(b.capturedAt ?? "")),
    [rasters],
  );
  const pairKey = `${cd.pair?.reference?.id ?? ""}|${cd.pair?.current?.id ?? ""}`;
  const [picked, setPicked] = useState<{
    key: string;
    before: string | null;
    after: string | null;
  } | null>(null);
  const flightIds = new Set(flights.map((f) => f.id));
  const alive = (id: string | null | undefined) => (id && flightIds.has(id) ? id : null);
  const fromPair = picked?.key === pairKey ? null : cd.pair;
  const referenceId = alive(
    fromPair ? fromPair.reference?.id : (picked?.before ?? flights.at(-2)?.id),
  );
  const currentId = alive(
    fromPair ? fromPair.current?.id : (picked?.after ?? flights.at(-1)?.id),
  );
  const pick = (side: "before" | "after", id: string) =>
    setPicked({
      key: pairKey,
      before: side === "before" ? id : referenceId,
      after: side === "after" ? id : currentId,
    });
  const runtimeChip = useMemo<RuntimeChip | null>(() => {
    if (!runtime) return null;
    const title = labels.runtime.label(runtime.device_name ?? runtime.backend);
    if (runtime.tier === "cuda") return { text: labels.runtime.cuda, title, slow: false };
    if (runtime.tier === "metal") return { text: labels.runtime.metal, title, slow: false };
    const geometry = (id: string | null) => {
      const raster = id ? rasters.find((r) => sid(r.id) === id) : undefined;
      return { bounds: raster?.bounds_4326 ?? null, resolutionM: raster?.resolution_m ?? null };
    };
    const side = pairLongestSidePx(geometry(referenceId), geometry(currentId));
    const minutes =
      side !== null
        ? etaMinutes(runtime.eta_s_per_mpx, side, runtime.grid_cap_px ?? CPU_GRID_PX)
        : fullGridMinutes(runtime.eta_s_at_grid_cap);
    return {
      text: minutes === null ? labels.runtime.cpu : labels.runtime.cpuEta(num(minutes)),
      title,
      slow: true,
    };
  }, [runtime, labels, rasters, referenceId, currentId, num]);

  const swipeOn = swipe !== null && referenceId !== null && currentId !== null && referenceId !== currentId;

  const startRun = cd.startRun;
  const runFailed = labels.detect.failed;
  const runDetection = useCallback(async () => {
    if (!referenceId || !currentId || referenceId === currentId) return;
    setStarting(true);
    setRunError(null);
    try {
      await startRun(referenceId, currentId, detectMode);
    } catch (cause: unknown) {
      setRunError(
        cause instanceof ApiError
          ? { message: cause.message, requestId: cause.requestId }
          : { message: runFailed, requestId: null },
      );
    } finally {
      setStarting(false);
    }
  }, [referenceId, currentId, detectMode, startRun, runFailed]);

  /* ------------------------------------------------------ what the map draws
     A project holds every flight ever uploaded and every run ever started, and
     MapView draws all of them. A comparison is a PAIR, so when the Before /
     After pair or the chosen run changes, everything outside it is switched off
     once. After that the layer tree's own toggles win. While swiping, the
     before flight moves to the swipe view, so the main map shows only after. */
  const rasterKeys = useStore((s) => s.rasters.map((r) => sid(r.id)).join(","));
  const analysisKeys = useStore((s) => s.analyses.map((a) => sid(a.id)).join(","));
  const runId = cd.runId;

  useEffect(() => {
    const store = useStore.getState();
    const keep = new Set(
      [swipeOn ? null : referenceId, currentId].filter((id) => id !== null),
    );
    for (const raster of store.rasters) {
      store.patchRasterUI(raster.id, { visible: keep.has(sid(raster.id)) });
    }
    for (const analysis of store.analyses) {
      const on = sid(analysis.id) === runId;
      store.patchMaskUI(analysis.id, { visible: on });
      store.patchPolyUI(analysis.id, { visible: on });
    }
  }, [referenceId, currentId, swipeOn, runId, rasterKeys, analysisKeys]);

  // Parked 2026-09-24: the per-flight sliders in Drone imagery now own each raster's opacity.
  // useEffect(() => {
  //   const { reference, current } = cycleOpacities(mode, blend);
  //   const store = useStore.getState();
  //   if (referenceId) store.patchRasterUI(referenceId, { opacity: reference });
  //   if (currentId) store.patchRasterUI(currentId, { opacity: current });
  // }, [mode, blend, referenceId, currentId, rasterKeys]);

  /* ---------------------------------------------------------------- actions */

  // const fitBounds = cd.pair?.current?.bounds ?? cd.pair?.reference?.bounds ?? null;
  const select = cd.select;
  const deleteRaster = cd.deleteRaster;
  const confirmDelete = useCallback((id: string) => deleteRaster(id), [deleteRaster]);
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
      if (row.bounds) mapRef.current?.fitBounds(row.bounds, detectionFit(mapRef.current));
    },
    [select],
  );

  // Double-click on a map detection: confirm, then hand it to Create Complaint.
  const findRow = cd.findRow;
  const [complaintFor, setComplaintFor] = useState<DetectionRow | null>(null);
  const promptComplaint = useCallback(
    (target: { jobId: string; featureId: string | number }) =>
      setComplaintFor(findRow(detectionKey(target.jobId, target.featureId))),
    [findRow],
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
  const sideLabel = (which: string, id: string) => {
    const flight = flights.find((f) => f.id === id);
    return labels.swipe.side(which, flight?.name ?? "", date(flight?.capturedAt ?? null));
  };
  // const blendPercent = Math.round(blend * 100);

  const uploadButton = canWrite ? (
    <Button
      variant="outline"
      size="xs"
      disabled={cd.projectId === null || upload !== null}
      title={cd.projectId === null ? labels.upload.unavailable : undefined}
      onClick={() => setUploadOpen(true)}
    >
      <Icon name="action.upload" className="size-3.5" />
      {labels.upload.button}
    </Button>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-strong sm:text-3xl">
            {labels.title}
          </h1>
          <p className="mt-1 text-sm text-fg-canvas-muted">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
      </header>

      {cd.projectId !== null && (
        <UploadDialog
          labels={labels}
          projectId={cd.projectId}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onTransfer={setUpload}
          onUploaded={cd.adoptUpload}
          onUseExisting={(id) => {
            const existing = rasters.find((r) => sid(r.id) === id);
            if (existing?.status === "ready") pick("after", id);
            if (existing?.bounds_4326) mapRef.current?.fitBounds(existing.bounds_4326);
            if (!existing) void cd.refreshImagery().catch(() => undefined);
            setPanelOpen(true);
            setFocusFlight(id);
          }}
          onDelete={canWrite ? setDeleteTarget : undefined}
          pollFailed={cd.rasterPollFailed}
        />
      )}

      <AlertDialog
        open={complaintFor !== null}
        onOpenChange={(open) => {
          if (!open) setComplaintFor(null);
        }}
      >
        <AlertDialogContent>
          {complaintFor && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {labels.complaintPrompt.title(complaintFor.ref)}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-pretty">
                  {labels.complaintPrompt.summary(
                    complaintFor.changeType
                      ? labels.changeType(complaintFor.changeType)
                      : labels.status(complaintFor.status),
                    labels.detections.area(num(Math.round(complaintFor.areaM2))),
                    labels.detections.confidence(num(confidencePercent(complaintFor.confidence))),
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{labels.complaintPrompt.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    void navigate(`${ROUTES.complaintNew}${toComplaintSearch(complaintFor)}`)
                  }
                >
                  {labels.complaintPrompt.confirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <DeleteFlightDialog
        labels={labels}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

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

      {restoreError && (
        <Failure
          compact
          title={labels.flight.restoreFailed}
          message={restoreError.message}
          requestId={restoreError.requestId}
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
            // Parked 2026-09-24: mode, zoom and fit props, with their controls.
          />

          <CompareBar
            labels={labels}
            flights={flights}
            beforeId={referenceId}
            afterId={currentId}
            onBeforeChange={(id) => pick("before", id)}
            onAfterChange={(id) => pick("after", id)}
            mode={detectMode}
            onModeChange={setDetectMode}
            canRun={canRun}
            starting={starting}
            onRun={() => void runDetection()}
            activeRun={cd.activeRun}
            runtime={runtimeChip}
            swipe={swipeOn ? swipe : null}
            onSwipeChange={setSwipe}
            formatDate={date}
          />

          {runError && (
            <Failure
              compact
              title={labels.detect.failed}
              message={runError.message}
              requestId={runError.requestId}
              requestIdText={labels.error.requestId}
              requestIdMissingText={labels.error.requestIdMissing}
            />
          )}

          {/* Map and side panel share one stretched row, so the map's foot
              lines up with the panel's; the page column scrolls, not the aside. */}
          <div
            className={cn(
              "grid flex-1 items-stretch gap-4",
              panelOpen && "lg:grid-cols-[minmax(0,1fr)_320px]",
            )}
          >
            <div
              role="region"
              aria-label={labels.mapLabel}
              className="relative h-full min-h-96 overflow-hidden rounded-md border border-line bg-surface-sunken lg:min-h-[60vh]"
            >
              {/* `.map-wrap` is `flex: 1`, so it needs a flex parent with a
                  definite height — hence the absolutely positioned box. */}
              <div className="absolute inset-0 flex">
                <MapView
                  ref={mapRef}
                  showLegend={false}
                  showEmptyHint={false}
                  basemapVisible={layerTree.basemapVisible}
                  basemapOpacity={layerTree.basemapOpacity}
                  selection={mapSelection}
                  onFeatureDoubleClick={promptComplaint}
                  hoverHint={labels.detail.hoverHint}
                  onSelect={(selection) =>
                    select(
                      selection
                        ? detectionKey(selection.jobId, selection.featureId)
                        : null,
                    )
                  }
                  // Parked 2026-09-24 with the zoom readout: onZoomChange={(next) => setZoom(Math.round(next))}
                />
              </div>

              {swipeOn && referenceId && currentId && (
                <SwipeCompare
                  mapRef={mapRef}
                  beforeId={referenceId}
                  orientation={swipe}
                  beforeLabel={sideLabel(labels.detect.before, referenceId)}
                  afterLabel={sideLabel(labels.detect.after, currentId)}
                  handleLabel={labels.swipe.handle}
                />
              )}

              {/* Parked at the user's request on 2026-09-24: the running-run notice
                  over the map; the Compare bar already shows the stage and percent.
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
              */}
              {!cd.pendingRun && cd.retryingRun !== null && (
                <RunNotice
                  tone="info"
                  title={labels.run.retryingTitle}
                  body={labels.run.failedBody(cd.retryingRun)}
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

              {!panelOpen && (
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute end-14 top-3 z-10 border border-line-subtle bg-surface-overlay backdrop-blur-sm"
                  onClick={() => setPanelOpen(true)}
                >
                  <Icon name="map.layers" className="size-4" />
                  {labels.panel.show}
                </Button>
              )}

              {/* Parked at the user's request on 2026-09-24: the floating Overlay
                  Opacity pill (Figma 130:2243). Each flight's own slider under
                  Drone imagery now sets its opacity.
              <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xs border border-line-subtle bg-surface-overlay px-4 py-2 backdrop-blur-sm">
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
              */}
            </div>

            {/* Below `lg` the 320px column would leave the map unusable, so it
                falls under the map instead of squeezing beside it. */}
            {panelOpen && (
              <aside className="rounded-md border border-line bg-surface-2">
                <LayerControls
                  labels={labels}
                  layers={layerTree.layers}
                  groups={layerTree.groups}
                  onVisibleChange={layerTree.setVisible}
                  onOpacityChange={layerTree.setOpacity}
                  flights={layerTree.flights}
                  onFlightVisibleChange={layerTree.setFlightVisible}
                  onFlightOpacityChange={layerTree.setFlightOpacity}
                  onReorderFlight={layerTree.reorderFlight}
                  onLocateFlight={(flight) => {
                    if (flight.bounds) mapRef.current?.fitBounds(flight.bounds);
                  }}
                  onDeleteFlight={
                    canWrite
                      ? (flight) =>
                          setDeleteTarget({
                            id: flight.id,
                            name: flight.name,
                            processing: flight.status === "processing",
                          })
                      : undefined
                  }
                  focusedFlightId={focusFlight}
                  onRestoreFlight={
                    canWrite
                      ? (flight) => {
                          setRestoreError(null);
                          void cd.restoreRaster(flight.id).catch((cause: unknown) =>
                            setRestoreError(
                              cause instanceof ApiError
                                ? { message: cause.message, requestId: cause.requestId }
                                : { message: labels.flight.restoreFailed, requestId: null },
                            ),
                          );
                        }
                      : undefined
                  }
                  imageryAction={uploadButton}
                  toolbar={
                    <div className="flex items-center gap-2">
                      <DetectionSearch
                        className="min-w-0 flex-1"
                        value={cd.query}
                        onChange={cd.setQuery}
                        label={labels.search.label}
                        placeholder={labels.search.placeholder}
                        clearLabel={labels.search.clear}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-fg-muted"
                        aria-label={labels.panel.hide}
                        title={labels.panel.hide}
                        onClick={() => setPanelOpen(false)}
                      >
                        <Icon name="nav.collapse" className="size-4" />
                      </Button>
                    </div>
                  }
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
              </aside>
            )}
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
