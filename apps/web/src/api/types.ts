import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { components } from "@ada/api-types/ada-api";

import type { RasterLifecycleFields, RasterLifecycleStatus } from "../upload/types.ts";

/** Backend ids may be numbers or UUID strings; always compare via String(). */
export type Id = string | number;

export interface Project {
  id: Id;
  name: string;
  description?: string | null;
  created_at: string;
}

export type RasterStatus = RasterLifecycleStatus;

export interface Raster extends RasterLifecycleFields {
  id: Id;
  project_id: Id;
  name: string;
  captured_at: string | null;
  crs: string | null;
  bounds_4326: [number, number, number, number] | null;
  resolution_m: number | null;
  status: RasterStatus;
  /** 0-1, meaningful while status is "processing". */
  progress: number;
  /** Human-readable current ingest step, e.g. "Converting to 8-bit — strip 12/48". */
  stage: string | null;
  error: string | null;
  uploaded_at: string;
}

export interface TileInfo {
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
}

export interface RedZone {
  id: Id;
  project_id: Id;
  name: string;
  geometry: Polygon;
  created_at: string;
}

export type AnalysisStatus = "queued" | "running" | "done" | "failed";

/** ai = full model pipeline (evidence-grade); diff = fast classical triage. */
export type AnalysisMode = "ai" | "diff";

export interface AnalysisStats {
  polygons: number;
  illegal: number;
  changed_area_m2: number;
  mode?: AnalysisMode;
  model: string;
  /** Every model/stage that actually ran, in pipeline order. */
  models_used?: string[];
  working_resolution_m: number;
  /** [dy, dx] in working-grid pixels; [0, 0] = geo-referencing trusted. */
  coregistration_shift_px: [number, number];
  /** The per-parcel change stage's summary, or why it did not run. */
  parcels?: ParcelStageStats;
}

export interface Analysis {
  id: Id;
  project_id: Id;
  raster_t1_id: Id;
  raster_t2_id: Id;
  mode: AnalysisMode;
  status: AnalysisStatus;
  progress: number;
  stage: string | null;
  error: string | null;
  stats: AnalysisStats | null;
  created_at: string;
  finished_at: string | null;
}

/** Officer adjudication of a detection — drives the retraining dataset. */
export type ReviewStatus = "pending" | "confirmed" | "rejected";

export interface ChangeFeatureProps {
  label: string;
  status: "change" | "illegal";
  area_m2: number;
  confidence: number;
  brightness_delta: number;
  red_zone_overlap_pct: number;
  review_status: ReviewStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  /** Newest complaint raised from this detection, and its workflow status. */
  case_ref?: string | null;
  case_status?: string | null;
}

export type ChangeFeatureCollection = FeatureCollection<
  Polygon,
  ChangeFeatureProps
>;

/* ---- per-parcel change (GET /api/analyses/{id}/parcels*), generated from ada-api ---- */

type Schemas = components["schemas"];

/** One parcel's measured change in one analysis. Never carries owner_name. */
export type ParcelResult = Schemas["ParcelResultOut"];
export type ParcelVerdict = ParcelResult["verdict_t1"];
export type ParcelChangeClass = ParcelResult["change_class"];
export type ParcelHistogram = Schemas["ParcelHistogram"];
export type ParcelSummary = Schemas["ParcelSummary"];
export type ParcelResultPage = Schemas["ParcelResultPage"];
/** count, total, limit, offset and bbox of one parcels.geojson page. */
export type ParcelFeatureWindow = Schemas["FeatureWindow"];
/** One parcels.geojson page as sent; a feature's geometry may be null. */
export type ParcelFeatureCollectionOut = Schemas["ParcelFeatureCollection"];
export type ParcelFeatureOut = Schemas["ParcelFeature"];

/** What `stats.parcels` holds: a summary, or why the stage did not produce one. */
export type ParcelStageStats = ParcelSummary | { skipped: string } | { error: string };

export interface ParcelFilters {
  change_class?: ParcelChangeClass | null;
  verdict?: ParcelVerdict | null;
  limit?: number;
  offset?: number;
}

/** The map-ready collection: features without a polygon dropped, the last page's window kept. */
export type ParcelFeatureCollection = FeatureCollection<Polygon | MultiPolygon, ParcelResult> & {
  metadata: ParcelFeatureWindow;
};
