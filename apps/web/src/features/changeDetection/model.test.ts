import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { Analysis, ChangeFeatureCollection, Raster } from "../../api/types.ts";
import {
  boundDetections,
  comparableAnalyses,
  confidenceBand,
  confidencePercent,
  cycleOpacities,
  DETECTION_HARD_CAP,
  detectionRef,
  filterDetections,
  isCompareMode,
  LAYER_GROUP_ORDER,
  LAYER_TREE,
  sortDetections,
  toChangeType,
  toComparisonPair,
  toDetectionRows,
} from "./model.ts";

// Run with: npm run test -w @ada/web
// model.ts value-imports only lib/geo.ts, which is itself type-imports-only, so
// Node's type stripping is enough — no bundler, no React, no DOM.

const SQUARE: [number, number][] = [
  [77.0, 26.0],
  [77.2, 26.0],
  [77.2, 26.4],
  [77.0, 26.4],
  [77.0, 26.0],
];

function collection(
  features: {
    id?: number;
    confidence?: number;
    area?: number;
    status?: string;
    label?: string;
    review?: string;
    changeType?: string;
  }[],
): ChangeFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((spec) => ({
      type: "Feature",
      id: spec.id,
      geometry: { type: "Polygon", coordinates: [SQUARE] },
      properties: {
        label: spec.label ?? "New construction",
        status: spec.status ?? "change",
        area_m2: spec.area ?? 100,
        confidence: spec.confidence ?? 0.5,
        brightness_delta: 3.2,
        red_zone_overlap_pct: 0,
        review_status: spec.review ?? "pending",
        review_note: null,
        reviewed_by: null,
        reviewed_at: null,
        ...(spec.changeType === undefined ? {} : { change_type: spec.changeType }),
      },
    })),
  } as ChangeFeatureCollection;
}

/* ------------------------------------------------------------------ bands */

test("confidence bands split at 0.85 and 0.60, inclusive at the boundary", () => {
  assert.equal(confidenceBand(0.94), "high");
  assert.equal(confidenceBand(0.85), "high");
  assert.equal(confidenceBand(0.8499), "medium");
  assert.equal(confidenceBand(0.6), "medium");
  assert.equal(confidenceBand(0.5999), "low");
  assert.equal(confidenceBand(0), "low");
});

test("a non-finite score bands low and renders 0% rather than NaN", () => {
  assert.equal(confidenceBand(Number.NaN), "low");
  assert.equal(confidencePercent(Number.NaN), 0);
  assert.equal(confidencePercent(Number.POSITIVE_INFINITY), 0);
});

test("confidence percent rounds and clamps to 0..100", () => {
  assert.equal(confidencePercent(0.844), 84);
  assert.equal(confidencePercent(0.845), 85);
  assert.equal(confidencePercent(-3), 0);
  assert.equal(confidencePercent(4), 100);
});

/* -------------------------------------------------------------- reference */

test("a detection reference is (job, polygon), zero padded and reversible", () => {
  assert.equal(detectionRef(7, 42), "DET-7-0042");
  assert.equal(detectionRef("7", "123456"), "DET-7-123456");
});

/* --------------------------------------------------------------- the rows */

test("features without an id are dropped, not rendered with broken actions", () => {
  const rows = toDetectionRows(9, collection([{ id: 1 }, {}, { id: 3 }]));
  assert.deepEqual(
    rows.map((row) => row.ref),
    ["DET-9-0001", "DET-9-0003"],
  );
});

test("rows carry the review state, the band and a centre for the map", () => {
  const [row] = toDetectionRows(
    9,
    collection([{ id: 1, confidence: 0.91, review: "confirmed" }]),
  );
  assert.equal(row.band, "high");
  assert.equal(row.reviewStatus, "confirmed");
  assert.deepEqual(row.centre, [77.1, 26.2]);
  assert.deepEqual(row.bounds, [77, 26, 77.2, 26.4]);
});

test("an unrecognised review status degrades to pending rather than crashing", () => {
  const [row] = toDetectionRows(9, collection([{ id: 1, review: "escalated" }]));
  assert.equal(row.reviewStatus, "pending");
});

test("change_type is narrowed to the four values the worker writes", () => {
  assert.equal(toChangeType("new_construction"), "new_construction");
  assert.equal(toChangeType("demolition"), "demolition");
  assert.equal(toChangeType("teleportation"), null);
  assert.equal(toChangeType(undefined), null);
  const [row] = toDetectionRows(9, collection([{ id: 1, changeType: "extension" }]));
  assert.equal(row.changeType, "extension");
});

test("an absent collection is an empty list, never a throw", () => {
  assert.deepEqual(toDetectionRows(9, undefined), []);
});

/* ------------------------------------------------------------------ order */

test("illegal outranks change, then confidence, then area", () => {
  const rows = toDetectionRows(
    1,
    collection([
      { id: 1, status: "change", confidence: 0.99, area: 10 },
      { id: 2, status: "illegal", confidence: 0.4, area: 10 },
      { id: 3, status: "illegal", confidence: 0.9, area: 10 },
      { id: 4, status: "change", confidence: 0.99, area: 900 },
    ]),
  );
  assert.deepEqual(
    sortDetections(rows).map((row) => row.featureId),
    [3, 2, 4, 1],
  );
});

test("sorting does not mutate its input", () => {
  const rows = toDetectionRows(1, collection([{ id: 1 }, { id: 2, status: "illegal" }]));
  const before = rows.map((row) => row.featureId);
  sortDetections(rows);
  assert.deepEqual(
    rows.map((row) => row.featureId),
    before,
  );
});

/* ----------------------------------------------------------------- filter */

test("search matches the reference and the worker's description, case-insensitively", () => {
  const rows = toDetectionRows(
    5,
    collection([
      { id: 1, label: "New construction" },
      { id: 2, label: "Structure removed" },
    ]),
  );
  assert.equal(filterDetections(rows, "det-5-0002").length, 1);
  assert.equal(filterDetections(rows, "REMOVED").length, 1);
  assert.equal(filterDetections(rows, "   ").length, 2);
  assert.equal(filterDetections(rows, "khasra").length, 0);
});

/* ---------------------------------------------------------------- bounded */

test("the list is bounded by the page size and then by the hard cap", () => {
  const rows = toDetectionRows(
    1,
    collection(Array.from({ length: 300 }, (_, i) => ({ id: i + 1 }))),
  );

  const first = boundDetections(rows, 25);
  assert.equal(first.shown.length, 25);
  assert.equal(first.total, 300);
  assert.equal(first.canShowMore, true);
  assert.equal(first.capped, true);

  const atCap = boundDetections(rows, DETECTION_HARD_CAP);
  assert.equal(atCap.shown.length, DETECTION_HARD_CAP);
  assert.equal(atCap.canShowMore, false, "the cap, not the button, is the end");

  const beyondCap = boundDetections(rows, 10_000);
  assert.equal(beyondCap.shown.length, DETECTION_HARD_CAP);
});

test("a short list is never reported as capped", () => {
  const rows = toDetectionRows(1, collection([{ id: 1 }, { id: 2 }]));
  const bounded = boundDetections(rows, 25);
  assert.equal(bounded.shown.length, 2);
  assert.equal(bounded.canShowMore, false);
  assert.equal(bounded.capped, false);
});

/* ---------------------------------------------------------- survey cycles */

function analysis(over: Partial<Analysis> & Pick<Analysis, "id">): Analysis {
  return {
    project_id: 1,
    raster_t1_id: 11,
    raster_t2_id: 12,
    mode: "ai",
    status: "done",
    progress: 1,
    stage: null,
    error: null,
    stats: null,
    created_at: "2026-01-01T00:00:00+00:00",
    finished_at: null,
    ...over,
  };
}

function raster(id: number, name: string, capturedAt: string | null): Raster {
  return {
    id,
    project_id: 1,
    name,
    captured_at: capturedAt,
    crs: "EPSG:32643",
    bounds_4326: [77, 26, 77.2, 26.4],
    resolution_m: 0.08,
    status: "ready",
    progress: 1,
    stage: null,
    error: null,
    uploaded_at: "2026-01-02T00:00:00+00:00",
  };
}

test("a comparison pair names T1 as the reference flight and T2 as the current one", () => {
  const pair = toComparisonPair(analysis({ id: 3 }), [
    raster(11, "Jamdoli Jan", "2026-01-15"),
    raster(12, "Jamdoli Aug", "2026-08-28"),
  ]);
  assert.equal(pair.reference?.capturedAt, "2026-01-15");
  assert.equal(pair.current?.capturedAt, "2026-08-28");
});

test("a deleted raster leaves its side of the pair null rather than crashing", () => {
  const pair = toComparisonPair(analysis({ id: 3 }), [raster(12, "Jamdoli Aug", null)]);
  assert.equal(pair.reference, null);
  assert.equal(pair.current?.name, "Jamdoli Aug");
});

test("only finished runs are comparable, newest first", () => {
  const list = comparableAnalyses([
    analysis({ id: 1, created_at: "2026-03-01T00:00:00+00:00" }),
    analysis({ id: 2, status: "running", created_at: "2026-09-01T00:00:00+00:00" }),
    analysis({ id: 3, created_at: "2026-06-01T00:00:00+00:00" }),
    analysis({ id: 4, status: "failed", created_at: "2026-07-01T00:00:00+00:00" }),
  ]);
  assert.deepEqual(
    list.map((item) => item.id),
    [3, 1],
  );
});

/* -------------------------------------------------------- comparison mode */

test("the compare modes cross-fade the current flight over the reference", () => {
  assert.deepEqual(cycleOpacities("reference", 0.5), { reference: 1, current: 0 });
  assert.deepEqual(cycleOpacities("current", 0.5), { reference: 0, current: 1 });
  assert.deepEqual(cycleOpacities("overlay", 0.4), { reference: 1, current: 0.4 });
});

test("a blend outside 0..1 is clamped, so a bad slider cannot blank the map", () => {
  assert.deepEqual(cycleOpacities("overlay", -2), { reference: 1, current: 0 });
  assert.deepEqual(cycleOpacities("overlay", 9), { reference: 1, current: 1 });
});

test("only the three declared modes are accepted from a URL or storage", () => {
  assert.equal(isCompareMode("overlay"), true);
  assert.equal(isCompareMode("swipe"), false);
  assert.equal(isCompareMode(null), false);
});

/* ------------------------------------------------------------- the layers */

test("the layer tree is fixed, unique, and every layer belongs to a known group", () => {
  const ids = LAYER_TREE.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, "no layer appears twice");
  for (const node of LAYER_TREE) {
    assert.ok(
      LAYER_GROUP_ORDER.includes(node.group),
      `${node.id} belongs to an ungrouped group`,
    );
  }
  // Groups are contiguous: the panel renders the tree in order and must not
  // have to sort it, which is what "fixed order, toggles only" means.
  const seen: string[] = [];
  for (const node of LAYER_TREE) {
    if (seen.at(-1) !== node.group) seen.push(node.group);
  }
  assert.equal(new Set(seen).size, seen.length, "a group is split across the tree");
});
