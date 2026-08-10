import type { FeatureCollection, Polygon } from "geojson";

/** Backend ids may be numbers or UUID strings; always compare via String(). */
export type Id = string | number;

export interface Project {
  id: Id;
  name: string;
  description?: string | null;
  created_at: string;
}

export type RasterStatus = "processing" | "ready" | "failed";

export interface Raster {
  id: Id;
  project_id: Id;
  name: string;
  captured_at: string | null;
  crs: string | null;
  bounds_4326: [number, number, number, number] | null;
  resolution_m: number | null;
  status: RasterStatus;
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
  reviewed_at: string | null;
}

export type ChangeFeatureCollection = FeatureCollection<
  Polygon,
  ChangeFeatureProps
>;
