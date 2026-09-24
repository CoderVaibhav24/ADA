/**
 * The Change Detection screen's pure vocabulary: no React, no fetching.
 *
 * Everything here is a total function over what `/api/analyses/{id}/features`
 * and `/api/projects/{id}/rasters` actually return, which is why it is the only
 * file on this screen with tests. Rationale for the band thresholds and for the
 * client-side detection reference lives in docs/, not here.
 */

import type { Polygon } from "geojson";
import type {
  Analysis,
  ChangeFeatureCollection,
  ChangeFeatureProps,
  Id,
  Raster,
  ReviewStatus,
} from "@/api/types";
// Relative, with the extension, and NOT `@/lib/geo`: `npm test` runs this
// module under `node --experimental-strip-types`, which erases types but cannot
// resolve the `@/` alias, and `polygonBounds` is a value. Same rule as
// routes/nav.ts. Vite and tsc both accept the explicit `.ts`.
import { polygonBounds, type BBox } from "../../lib/geo.ts";

export const sid = (id: Id): string => String(id);

/* ------------------------------------------------------------------ bands */

export type ConfidenceBand = "high" | "medium" | "low";

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_MEDIUM = 0.6;

/** Three bands over the model's 0-1 score; the boundaries are inclusive below. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (!Number.isFinite(confidence)) return "low";
  if (confidence >= CONFIDENCE_HIGH) return "high";
  if (confidence >= CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

/** 0-1 to a whole percentage, clamped — a NaN score must not render "NaN%". */
export function confidencePercent(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(100, Math.round(confidence * 100)));
}

/* -------------------------------------------------------------- reference */

/**
 * The officer-facing name of a detection.
 *
 * No such name exists server-side: a detection is (job id, polygon id) and
 * nothing else. This renders that pair, reversibly, so two officers reading the
 * same screen say the same string down a phone.
 */
export function detectionRef(jobId: Id, polygonId: Id): string {
  return `DET-${sid(jobId)}-${sid(polygonId).padStart(4, "0")}`;
}

/**
 * How a detection is addressed inside this screen.
 *
 * Not the display reference: a map click hands back a raw polygon id and has to
 * find the same row the list is holding, so both sides go through this.
 */
export function detectionKey(jobId: Id, polygonId: Id): string {
  return `${sid(jobId)}:${sid(polygonId)}`;
}

/* --------------------------------------------------------------- geometry */

/** Centre of a polygon's bounding box — enough to fly the map to it. */
export function polygonCentre(polygon: Polygon): [number, number] | null {
  const bounds = polygonBounds(polygon);
  if (!bounds) return null;
  const [w, s, e, n] = bounds;
  return [(w + e) / 2, (s + n) / 2];
}

/* --------------------------------------------------------------- the rows */

export type ChangeType =
  "new_construction" | "extension" | "demolition" | "unchanged";

const CHANGE_TYPES: readonly string[] = [
  "new_construction",
  "extension",
  "demolition",
  "unchanged",
];

/** The ML worker's `change_type` is only set when a structure backed the polygon. */
export function toChangeType(value: unknown): ChangeType | null {
  return typeof value === "string" && CHANGE_TYPES.includes(value)
    ? (value as ChangeType)
    : null;
}

export type DetectionRow = {
  /** Stable across re-fetches: job and polygon together. */
  key: string;
  jobId: string;
  featureId: Id;
  ref: string;
  /** The ML worker's own English sentence. Never translated — see labels.ts. */
  description: string;
  status: "change" | "illegal";
  changeType: ChangeType | null;
  areaM2: number;
  confidence: number;
  band: ConfidenceBand;
  reviewStatus: ReviewStatus;
  redZoneOverlapPct: number;
  brightnessDelta: number;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** The complaint already raised from this detection, if any. `status` is the raw icms_case.status. */
  linkedCase: { ref: string; status: string } | null;
  centre: [number, number] | null;
  bounds: BBox | null;
};

function reviewStatusOf(value: unknown): ReviewStatus {
  return value === "confirmed" || value === "rejected" ? value : "pending";
}

function linkedCaseOf(
  ref: unknown,
  status: unknown,
): DetectionRow["linkedCase"] {
  return typeof ref === "string" && ref !== "" && typeof status === "string"
    ? { ref, status }
    : null;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** One analysis's FeatureCollection to the rows the list and the panel render. */
export function toDetectionRows(
  jobId: Id,
  collection: ChangeFeatureCollection | undefined,
): DetectionRow[] {
  if (!collection) return [];
  const job = sid(jobId);
  const rows: DetectionRow[] = [];

  for (const feature of collection.features) {
    // A feature with no id cannot be reviewed, previewed or highlighted on the
    // map — three of the four things this screen does with one. Skip it rather
    // than render a row whose every action is broken.
    if (feature.id === undefined || feature.id === null) continue;
    const props = feature.properties as ChangeFeatureProps & {
      change_type?: unknown;
    };
    const confidence = numberOf(props.confidence);

    rows.push({
      key: detectionKey(job, feature.id),
      jobId: job,
      featureId: feature.id,
      ref: detectionRef(job, feature.id),
      description: typeof props.label === "string" ? props.label : "",
      status: props.status === "illegal" ? "illegal" : "change",
      changeType: toChangeType(props.change_type),
      areaM2: numberOf(props.area_m2),
      confidence,
      band: confidenceBand(confidence),
      reviewStatus: reviewStatusOf(props.review_status),
      redZoneOverlapPct: numberOf(props.red_zone_overlap_pct),
      brightnessDelta: numberOf(props.brightness_delta),
      reviewedBy:
        typeof props.reviewed_by === "string" ? props.reviewed_by : null,
      reviewedByName:
        typeof props.reviewed_by_name === "string"
          ? props.reviewed_by_name
          : null,
      reviewedAt:
        typeof props.reviewed_at === "string" ? props.reviewed_at : null,
      linkedCase: linkedCaseOf(props.case_ref, props.case_status),
      centre: polygonCentre(feature.geometry),
      bounds: polygonBounds(feature.geometry),
    });
  }

  return rows;
}

/**
 * Illegal first, then confidence, then area.
 *
 * The server sorts by area alone, which buries a 94%-confident encroachment in
 * a red zone under every large low-confidence field boundary shift.
 */
export function sortDetections(rows: readonly DetectionRow[]): DetectionRow[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === "illegal" ? -1 : 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.areaM2 - a.areaM2;
  });
}

/** Reference and the worker's description, case-insensitively. */
export function filterDetections(
  rows: readonly DetectionRow[],
  query: string,
): DetectionRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter(
    (row) =>
      row.ref.toLowerCase().includes(needle) ||
      row.description.toLowerCase().includes(needle),
  );
}

/* ---------------------------------------------------------------- bounded */

/**
 * Nothing on this screen renders an unbounded list.
 *
 * `DETECTION_PAGE` is what one press of "show more" adds; `DETECTION_HARD_CAP`
 * is the ceiling it stops at. A run can produce thousands of polygons and the
 * map already draws all of them — the PANEL is what has to stay finite, because
 * four thousand cards is a frozen tab, not a register.
 */
export const DETECTION_PAGE = 25;
export const DETECTION_HARD_CAP = 200;

export type BoundedDetections = {
  shown: DetectionRow[];
  total: number;
  /** More rows exist AND the cap has room for them. */
  canShowMore: boolean;
  /** The cap, not the data, is what is holding rows back. */
  capped: boolean;
};

export function boundDetections(
  rows: readonly DetectionRow[],
  visible: number,
): BoundedDetections {
  const ceiling = Math.min(Math.max(visible, 0), DETECTION_HARD_CAP);
  return {
    shown: rows.slice(0, ceiling),
    total: rows.length,
    canShowMore: rows.length > ceiling && ceiling < DETECTION_HARD_CAP,
    capped: rows.length > DETECTION_HARD_CAP,
  };
}

/* ---------------------------------------------------------- survey cycles */

export type Cycle = {
  id: string;
  name: string;
  /** ISO date the drone flew, when the upload carried one. */
  capturedAt: string | null;
  bounds: BBox | null;
};

export type ComparisonPair = {
  analysis: Analysis;
  /** T1 — the earlier flight the run compared against. */
  reference: Cycle | null;
  /** T2 — the later flight the detections are drawn from. */
  current: Cycle | null;
};

function toCycle(raster: Raster | undefined): Cycle | null {
  if (!raster) return null;
  return {
    id: sid(raster.id),
    name: raster.name,
    capturedAt: raster.captured_at,
    bounds: raster.bounds_4326,
  };
}

/** Pair one analysis with the two flights it ran over. */
export function toComparisonPair(
  analysis: Analysis,
  rasters: readonly Raster[],
): ComparisonPair {
  const byId = new Map(rasters.map((raster) => [sid(raster.id), raster]));
  return {
    analysis,
    reference: toCycle(byId.get(sid(analysis.raster_t1_id))),
    current: toCycle(byId.get(sid(analysis.raster_t2_id))),
  };
}

/**
 * The runs this screen can draw, newest first.
 *
 * Only `done` runs: a queued or failed job has no mask tiles and no polygons,
 * so offering it in the comparison picker offers a blank map.
 */
export function comparableAnalyses(analyses: readonly Analysis[]): Analysis[] {
  return analyses
    .filter((analysis) => analysis.status === "done")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/* ------------------------------------------------------------- the layers */

/**
 * The OneMap UP layer model: groups over a common base map, each layer
 * individually toggleable with its own opacity, in a FIXED order.
 *
 * Fixed is the point. Drag reordering is cut from v1 (progress-tracker §6), so
 * the order is declared here once, top of the draw stack first, and the panel
 * renders it in that order rather than storing one.
 */
export type LayerId =
  | "detections"
  | "heatMask"
  | "redZones"
  | "currentCycle"
  | "referenceCycle"
  | "baseMap";

export type LayerGroupId = "detections" | "zones" | "imagery" | "base";

export type LayerNode = {
  id: LayerId;
  group: LayerGroupId;
  /** Legend swatch; `null` where the layer has no single colour (the base map). */
  swatch: string | null;
  /** Whether an opacity control means anything for this layer. */
  hasOpacity: boolean;
};

export const LAYER_TREE: readonly LayerNode[] = [
  {
    id: "detections",
    group: "detections",
    swatch: "#ff4438",
    hasOpacity: true,
  },
  { id: "heatMask", group: "detections", swatch: "#ffb020", hasOpacity: true },
  { id: "redZones", group: "zones", swatch: "#ff2d55", hasOpacity: false },
  // The two imagery rows toggle but do not carry their own opacity slider: the
  // opacity of one flight against the other IS the comparison control, and the
  // frame already draws it as "Overlay Opacity" across the foot of the map.
  // Two sliders writing one value is how they end up disagreeing.
  {
    id: "currentCycle",
    group: "imagery",
    swatch: "#4a9a58",
    hasOpacity: false,
  },
  {
    id: "referenceCycle",
    group: "imagery",
    swatch: "#00aacc",
    hasOpacity: false,
  },
  // Base map row parked on 2026-09-24 at the user's request; the map still draws it.
  // { id: "baseMap", group: "base", swatch: null, hasOpacity: true },
];

export const LAYER_GROUP_ORDER: readonly LayerGroupId[] = [
  "detections",
  "zones",
  "imagery",
  // "base",
];

/* --------------------------------------------------------- comparison mode */

/**
 * How the two flights are shown against each other.
 *
 * `overlay` is the frame's own mode and the default: both cycles drawn, the
 * opacity slider cross-fading the current flight over the reference one.
 */
export const COMPARE_MODES = ["reference", "overlay", "current"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export function isCompareMode(value: unknown): value is CompareMode {
  return COMPARE_MODES.includes(value as CompareMode);
}

export type CycleOpacities = { reference: number; current: number };

/**
 * The two raster opacities a mode implies.
 *
 * `blend` is the slider: 0 shows the reference flight, 1 shows the current one.
 * The reference stays fully opaque underneath and the current fades over it, so
 * the officer never sees the base map through a half-transparent sandwich of
 * both.
 */
export function cycleOpacities(
  mode: CompareMode,
  blend: number,
): CycleOpacities {
  const clamped = Math.max(0, Math.min(1, blend));
  if (mode === "reference") return { reference: 1, current: 0 };
  if (mode === "current") return { reference: 0, current: 1 };
  return { reference: 1, current: clamped };
}

/* ---------------------------------------------------------------- flights */

export type FlightChip =
  | "uploading"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "rejected"
  | "retrying"
  | "archived"
  | "restoring";

// A processing raster that has reported no progress is still waiting in the worker's queue.
export function flightChip(
  status: Raster["status"],
  progress: number,
): FlightChip {
  switch (status) {
    case "ready":
      return "ready";
    case "failed":
    case "expired":
      return "failed";
    case "uploading":
      return "uploading";
    case "rejected":
      return "rejected";
    case "failed_retryable":
      return "retrying";
    case "cold":
      return "archived";
    case "restoring":
      return "restoring";
    case "processing":
      return Number.isFinite(progress) && progress > 0
        ? "processing"
        : "queued";
  }
}

// Chunks the server holds as a whole percent; an unknown count reads as 0, never NaN.
export function receivedPercent(
  received: number | null | undefined,
  count: number | null | undefined,
): number {
  if (!received || !count || count <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((received / count) * 100)));
}

// Whole hours until a restore lands; zero, negative or unknown reads as null (no ETA shown).
export function restoreHours(eta: number | null | undefined): number | null {
  if (eta === null || eta === undefined || !(eta > 0)) return null;
  return Math.max(1, Math.ceil(eta));
}

// Whole minutes for a full grid when no pair is selected; null when the runtime gives no figure.
export function fullGridMinutes(
  seconds: number | null | undefined,
): number | null {
  if (!seconds || seconds <= 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

const RETRYABLE_PREFIX = "retryable:";

// ml-worker marks a failure it will requeue with "retryable:"; that run is retrying, not failed.
export function isRetryingRun(
  analysis: Pick<Analysis, "status" | "error">,
): boolean {
  return (
    analysis.status === "failed" &&
    typeof analysis.error === "string" &&
    analysis.error.trimStart().toLowerCase().startsWith(RETRYABLE_PREFIX)
  );
}

// The error without its "retryable:" marker, for display.
export function runErrorText(error: string): string {
  const trimmed = error.trimStart();
  return trimmed.toLowerCase().startsWith(RETRYABLE_PREFIX)
    ? trimmed.slice(RETRYABLE_PREFIX.length).trim()
    : error;
}

const M_PER_DEG = 111_320;

// Longest side in pixels of the pair's overlap at the coarser resolution; null when they do not overlap.
export function pairLongestSidePx(
  a: {
    bounds: [number, number, number, number] | null;
    resolutionM: number | null;
  },
  b: {
    bounds: [number, number, number, number] | null;
    resolutionM: number | null;
  },
): number | null {
  if (!a.bounds || !b.bounds) return null;
  const w = Math.max(a.bounds[0], b.bounds[0]);
  const s = Math.max(a.bounds[1], b.bounds[1]);
  const e = Math.min(a.bounds[2], b.bounds[2]);
  const n = Math.min(a.bounds[3], b.bounds[3]);
  if (e <= w || n <= s) return null;
  const res = Math.max(a.resolutionM ?? 0, b.resolutionM ?? 0);
  if (!(res > 0)) return null;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const wide = ((e - w) * M_PER_DEG * Math.cos(midLat)) / res;
  const tall = ((n - s) * M_PER_DEG) / res;
  return Math.max(wide, tall);
}

// ETA = eta_s_per_mpx * min(longest side, grid_cap_px)^2 / 1e6, in whole minutes (at least one); null if unknown.
export function etaMinutes(
  secondsPerMpx: number | null | undefined,
  longestSidePx: number | null,
  gridCapPx: number,
): number | null {
  if (
    !secondsPerMpx ||
    secondsPerMpx <= 0 ||
    longestSidePx === null ||
    !(longestSidePx > 0)
  )
    return null;
  const side = Math.min(longestSidePx, gridCapPx);
  return Math.max(1, Math.round((secondsPerMpx * side * side) / 1e6 / 60));
}

// 0..1 to a whole clamped percentage; a NaN progress must not render "NaN%".
export function progressPercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}

// Split a worker stage "<human stage> — <backend detail>" at its first em-dash separator.
export function splitStage(stage: string): {
  title: string;
  detail: string | null;
} {
  const at = stage.indexOf(" — ");
  if (at < 0) return { title: stage.trim(), detail: null };
  const title = stage.slice(0, at).trim();
  const detail = stage.slice(at + 3).trim();
  if (title === "") return { title: detail, detail: null };
  return { title, detail: detail === "" ? null : detail };
}
