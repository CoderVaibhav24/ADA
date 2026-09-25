/**
 * The per-parcel change layer's pure vocabulary: no React, no fetching, no MapLibre.
 *
 * Every function is total over what `/api/analyses/{id}/parcels.geojson` and
 * `Analysis.stats.parcels` can hold, including missing fields and null geometry.
 */

import type { MultiPolygon, Polygon } from "geojson";
import type {
  AnalysisStats,
  ParcelChangeClass,
  ParcelFeatureCollection,
  ParcelFeatureCollectionOut,
  ParcelFeatureOut,
  ParcelFeatureWindow,
  ParcelFilters,
  ParcelHistogram,
  ParcelSummary,
  ParcelVerdict,
} from "@/api/types";
import type { BBox } from "../../lib/geo.ts";

/* ---------------------------------------------------------- vocabularies */

/** Display order: the classes an officer acts on first. */
export const CHANGE_CLASSES: readonly ParcelChangeClass[] = [
  "new_build",
  "extension",
  "demolition",
  "unchanged",
  "unassessable",
];

export const VERDICTS: readonly ParcelVerdict[] = [
  "over_tolerance",
  "within_tolerance",
  "vacant",
  "insufficient_imagery",
  "not_assessable",
];

export function toChangeClass(value: unknown): ParcelChangeClass {
  return CHANGE_CLASSES.includes(value as ParcelChangeClass)
    ? (value as ParcelChangeClass)
    : "unassessable";
}

export function toVerdict(value: unknown): ParcelVerdict {
  return VERDICTS.includes(value as ParcelVerdict) ? (value as ParcelVerdict) : "not_assessable";
}

/* ---------------------------------------------------------------- colour */

export const PARCEL_COLOURS: Readonly<Record<ParcelChangeClass, string>> = {
  new_build: "#ef4444",
  extension: "#f97316",
  demolition: "#3b82f6",
  unchanged: "#9ca3af",
  unassessable: "#9ca3af",
};

/** Fill alpha per class before the layer's own opacity; unassessable is outline only. */
export const PARCEL_FILL_ALPHA: Readonly<Record<ParcelChangeClass, number>> = {
  new_build: 0.45,
  extension: 0.45,
  demolition: 0.45,
  unchanged: 0.3,
  unassessable: 0,
};

export function parcelColour(value: unknown): string {
  return PARCEL_COLOURS[toChangeClass(value)];
}

/** Unassessable parcels are drawn with a dashed outline instead of a fill. */
export function isDashed(value: unknown): boolean {
  return toChangeClass(value) === "unassessable";
}

// A MapLibre `match` over change_class; plain arrays so this file stays MapLibre-free.
function classMatch<T>(table: Readonly<Record<ParcelChangeClass, T>>, fallback: T): unknown[] {
  const expr: unknown[] = ["match", ["get", "change_class"]];
  for (const cls of CHANGE_CLASSES) expr.push(cls, table[cls]);
  expr.push(fallback);
  return expr;
}

export function parcelFillColorExpr(): unknown[] {
  return classMatch(PARCEL_COLOURS, PARCEL_COLOURS.unassessable);
}

export function parcelFillOpacityExpr(opacity: number): unknown[] {
  return ["*", clamp01(opacity), classMatch(PARCEL_FILL_ALPHA, 0)];
}

/* ------------------------------------------------------------ the numbers */

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

/** A finite number from a number or a numeric string; anything else is null. */
export function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/* ------------------------------------------------------------- the summary */

/** The parcel summary in a run's stats, or null when the stage skipped, failed or found none. */
export function parcelSummaryOf(stats: AnalysisStats | null | undefined): ParcelSummary | null {
  const raw = stats?.parcels as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const total = numeric(raw.parcels_total);
  if (total === null || total <= 0) return null;
  const histogram = (raw.histogram ?? {}) as Partial<ParcelHistogram>;
  return {
    parcels_total: total,
    assessable: numeric(raw.assessable) ?? 0,
    bias_offset_sqm: numeric(raw.bias_offset_sqm),
    histogram: {
      bin_edges: Array.isArray(histogram.bin_edges) ? histogram.bin_edges : [],
      counts: Array.isArray(histogram.counts) ? histogram.counts : [],
    },
    counts_by_class: countsOf(raw.counts_by_class),
    counts_by_verdict_t1: countsOf(raw.counts_by_verdict_t1),
    counts_by_verdict_t2: countsOf(raw.counts_by_verdict_t2),
  };
}

function countsOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    const n = numeric(count);
    if (n !== null) out[key] = n;
  }
  return out;
}

export type ClassCount = { cls: ParcelChangeClass; count: number };

/** Every class in display order, zero-filled, so the filter row never changes shape. */
export function classCounts(counts: Readonly<Record<string, number>>): ClassCount[] {
  return CHANGE_CLASSES.map((cls) => ({ cls, count: numeric(counts[cls]) ?? 0 }));
}

/** Counts per class over rows, for when the summary is missing its own. */
export function countRowsByClass(rows: readonly ParcelRow[]): Record<ParcelChangeClass, number> {
  const out = Object.fromEntries(CHANGE_CLASSES.map((cls) => [cls, 0])) as Record<
    ParcelChangeClass,
    number
  >;
  for (const row of rows) out[row.changeClass] += 1;
  return out;
}

export type HistogramBar = {
  from: number;
  to: number;
  count: number;
  /** 0..1 against the tallest bin; 0 throughout when every bin is empty. */
  height: number;
};

export type HistogramTone = "growth" | "loss" | "straddle";

/** A bin wholly above the pivot (the epoch bias, else zero) is growth, wholly below is loss. */
export function histogramTone(bar: Pick<HistogramBar, "from" | "to">, pivot: number): HistogramTone {
  if (bar.from >= pivot) return "growth";
  if (bar.to <= pivot) return "loss";
  return "straddle";
}

// Pairs each count with its bin edges; a malformed histogram yields no bars rather than NaN heights.
export function histogramBars(histogram: ParcelHistogram | null | undefined): HistogramBar[] {
  if (!histogram) return [];
  const { bin_edges: edges, counts } = histogram;
  if (!Array.isArray(edges) || !Array.isArray(counts)) return [];
  const n = Math.min(counts.length, edges.length - 1);
  if (n <= 0) return [];
  const clean = counts.slice(0, n).map((c) => Math.max(0, numeric(c) ?? 0));
  const max = Math.max(...clean);
  return clean.map((count, i) => ({
    from: numeric(edges[i]) ?? 0,
    to: numeric(edges[i + 1]) ?? 0,
    count,
    height: max > 0 ? count / max : 0,
  }));
}

/* ---------------------------------------------------------------- the rows */

export type ParcelRow = {
  /** The analysis_parcel_result id, as a string. */
  key: string;
  id: number;
  parcelId: string;
  parcelKey: string;
  sector: string | null;
  plotNo: string | null;
  villageLgd: string | null;
  khasraNo: string | null;
  landUse: string | null;
  plotType: string | null;
  sanctionedSqm: number | null;
  parcelSqm: number | null;
  toleranceFrac: number | null;
  imageryFracT1: number | null;
  imageryFracT2: number | null;
  builtFracT1: number | null;
  builtFracT2: number | null;
  builtSqmT1: number | null;
  builtSqmT2: number | null;
  deltaSqm: number | null;
  deltaCorrectedSqm: number | null;
  verdictT1: ParcelVerdict;
  verdictT2: ParcelVerdict;
  changeClass: ParcelChangeClass;
  bounds: BBox | null;
};

/** The geometry as a Polygon or MultiPolygon, or null for anything else. */
export function asPolygonal(geometry: unknown): Polygon | MultiPolygon | null {
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as { type?: unknown; coordinates?: unknown };
  if ((g.type === "Polygon" || g.type === "MultiPolygon") && Array.isArray(g.coordinates)) {
    return geometry as Polygon | MultiPolygon;
  }
  return null;
}

/** Bounding box of a Polygon or MultiPolygon; null for an empty or foreign geometry. */
export function geometryBounds(geometry: Polygon | MultiPolygon | null | undefined): BBox | null {
  if (!geometry) return null;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

type LabelParts = Pick<
  ParcelRow,
  "parcelKey" | "sector" | "plotNo" | "villageLgd" | "khasraNo" | "parcelId"
>;

/** The parcel's officer-facing name: its key, else sector and plot, else village and khasra. */
export function parcelLabel(row: LabelParts): string {
  if (row.parcelKey) return row.parcelKey;
  if (row.sector || row.plotNo) return `${row.sector ?? ""}#${row.plotNo ?? ""}`;
  if (row.villageLgd || row.khasraNo) return `${row.villageLgd ?? ""}#${row.khasraNo ?? ""}`;
  return row.parcelId;
}

type AnyParcelCollection = ParcelFeatureCollectionOut | ParcelFeatureCollection;

/** The geojson endpoint's features to table rows; a feature with no result id is skipped. */
export function toParcelRows(collection: AnyParcelCollection | null | undefined): ParcelRow[] {
  if (!collection || !Array.isArray(collection.features)) return [];
  const rows: ParcelRow[] = [];
  for (const feature of collection.features) {
    const p = (feature.properties ?? {}) as unknown as Record<string, unknown>;
    const id = numeric(p.id ?? feature.id);
    if (id === null) continue;
    rows.push({
      key: String(id),
      id,
      parcelId: text(p.parcel_id) ?? "",
      parcelKey: text(p.parcel_key) ?? "",
      sector: text(p.sector),
      plotNo: text(p.plot_no),
      villageLgd: text(p.village_lgd),
      khasraNo: text(p.khasra_no),
      landUse: text(p.land_use),
      plotType: text(p.plot_type),
      sanctionedSqm: numeric(p.sanctioned_area_sqm),
      parcelSqm: numeric(p.parcel_area_sqm),
      toleranceFrac: numeric(p.tolerance_frac),
      imageryFracT1: numeric(p.imagery_frac_t1),
      imageryFracT2: numeric(p.imagery_frac_t2),
      builtFracT1: numeric(p.built_frac_t1),
      builtFracT2: numeric(p.built_frac_t2),
      builtSqmT1: numeric(p.built_sqm_t1),
      builtSqmT2: numeric(p.built_sqm_t2),
      deltaSqm: numeric(p.delta_sqm),
      deltaCorrectedSqm: numeric(p.delta_sqm_corrected),
      verdictT1: toVerdict(p.verdict_t1),
      verdictT2: toVerdict(p.verdict_t2),
      changeClass: toChangeClass(p.change_class),
      bounds: geometryBounds(asPolygonal(feature.geometry)),
    });
  }
  return rows;
}

/** The wire collection as MapLibre GeoJSON; a feature without a polygon is left off the map. */
export function toMapCollection(collection: ParcelFeatureCollectionOut): ParcelFeatureCollection {
  const features: ParcelFeatureCollection["features"] = [];
  for (const feature of collection.features ?? []) {
    const geometry = asPolygonal(feature.geometry);
    if (!geometry || !feature.properties) continue;
    features.push({ type: "Feature", id: feature.id, geometry, properties: feature.properties });
  }
  return { type: "FeatureCollection", features, metadata: collection.metadata };
}

/* ------------------------------------------------------------ the paging */

/** The API's largest parcels.geojson page. */
export const PARCEL_PAGE_SIZE = 20_000;

export type ParcelPages = {
  collection: ParcelFeatureCollectionOut;
  /** The server's row count for the run; the loaded features may be fewer. */
  total: number;
  /** True when the pages stopped before `total` features arrived. */
  partial: boolean;
};

export type FetchParcelPage = (offset: number, limit: number) => Promise<ParcelFeatureCollectionOut>;

// Pages by offset until metadata.total is reached, an empty page arrives, or maxPages runs out.
export async function loadParcelPages(
  fetchPage: FetchParcelPage,
  pageSize = PARCEL_PAGE_SIZE,
  maxPages = 50,
): Promise<ParcelPages> {
  const features: ParcelFeatureOut[] = [];
  let window: ParcelFeatureWindow | null = null;
  let total = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const body = await fetchPage(features.length, pageSize);
    const got = Array.isArray(body?.features) ? body.features : [];
    for (const feature of got) features.push(feature);
    window = body?.metadata ?? window;
    total = Math.max(numeric(window?.total) ?? 0, features.length);
    if (features.length >= total || got.length === 0) break;
  }
  return {
    collection: {
      type: "FeatureCollection",
      features,
      metadata: {
        bbox: window?.bbox ?? null,
        count: features.length,
        limit: numeric(window?.limit) ?? pageSize,
        offset: 0,
        total,
      },
    },
    total,
    partial: features.length < total,
  };
}

/* ----------------------------------------------------------- the filters */

export type ClassFilter = ParcelChangeClass | null;

/** Clicking the active class clears the filter; clicking another switches to it. */
export function toggleClassFilter(current: ClassFilter, clicked: ParcelChangeClass): ClassFilter {
  return current === clicked ? null : clicked;
}

export function filterParcelRows(rows: readonly ParcelRow[], cls: ClassFilter): ParcelRow[] {
  return cls === null ? [...rows] : rows.filter((row) => row.changeClass === cls);
}

/** The same filter over the map's collection, so the map and the table show one set. */
export function filterParcelFeatures(
  collection: ParcelFeatureCollection,
  cls: ClassFilter,
): ParcelFeatureCollection {
  if (cls === null) return collection;
  return {
    ...collection,
    features: collection.features.filter(
      (feature) => toChangeClass(feature.properties?.change_class) === cls,
    ),
  };
}

/** The API's filter params for a class filter; the CSV carries the same set the table shows. */
export function parcelFilters(cls: ClassFilter): ParcelFilters {
  return cls === null ? {} : { change_class: cls };
}

/* -------------------------------------------------------------- the sort */

export const PARCEL_SORT_KEYS = [
  "parcel",
  "changeClass",
  "sanctioned",
  "builtT1",
  "builtT2",
  "delta",
  "verdictT1",
  "verdictT2",
  "landUse",
  "plotType",
] as const;
export type ParcelSortKey = (typeof PARCEL_SORT_KEYS)[number];
export type ParcelSort = { key: ParcelSortKey; desc: boolean };

/** Largest corrected growth first: the parcels most worth a site visit. */
export const DEFAULT_PARCEL_SORT: ParcelSort = { key: "delta", desc: true };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

type SortValue = number | string | null;

function sortValue(row: ParcelRow, key: ParcelSortKey): SortValue {
  switch (key) {
    case "parcel":
      return parcelLabel(row);
    case "changeClass":
      return CHANGE_CLASSES.indexOf(row.changeClass);
    case "sanctioned":
      return row.sanctionedSqm;
    case "builtT1":
      return row.builtSqmT1;
    case "builtT2":
      return row.builtSqmT2;
    case "delta":
      return row.deltaCorrectedSqm;
    case "verdictT1":
      return VERDICTS.indexOf(row.verdictT1);
    case "verdictT2":
      return VERDICTS.indexOf(row.verdictT2);
    case "landUse":
      return row.landUse;
    case "plotType":
      return row.plotType;
  }
}

// Nulls sort last in both directions; ties fall back to the parcel label so the order is stable.
export function sortParcelRows(rows: readonly ParcelRow[], sort: ParcelSort): ParcelRow[] {
  const sign = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : collator.compare(String(va), String(vb));
      if (cmp !== 0) return sign * cmp;
    }
    return collator.compare(parcelLabel(a), parcelLabel(b)) || a.id - b.id;
  });
}

/** Header click: a new column starts at its natural direction, the same column flips. */
export function nextParcelSort(current: ParcelSort, key: ParcelSortKey): ParcelSort {
  if (current.key === key) return { key, desc: !current.desc };
  const textual = key === "parcel" || key === "landUse" || key === "plotType";
  return { key, desc: !textual };
}

/** The grid's next active row for a key press, or null when the key does not move it. */
export function rovingIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const at = Math.max(0, Math.min(count - 1, current));
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, at + 1);
    case "ArrowUp":
      return Math.max(0, at - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
