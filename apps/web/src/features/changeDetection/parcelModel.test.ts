import { strict as assert } from "node:assert";
import { test } from "node:test";

import type {
  AnalysisStats,
  ParcelChangeClass,
  ParcelFeatureCollection,
  ParcelFeatureCollectionOut,
  ParcelResult,
} from "../../api/types.ts";
import {
  CHANGE_CLASSES,
  classCounts,
  countRowsByClass,
  DEFAULT_PARCEL_SORT,
  filterParcelFeatures,
  filterParcelRows,
  geometryBounds,
  histogramBars,
  histogramTone,
  isDashed,
  loadParcelPages,
  nextParcelSort,
  numeric,
  PARCEL_COLOURS,
  parcelColour,
  parcelFillColorExpr,
  parcelFillOpacityExpr,
  parcelFilters,
  parcelLabel,
  parcelSummaryOf,
  rovingIndex,
  sortParcelRows,
  toChangeClass,
  toggleClassFilter,
  toMapCollection,
  toParcelRows,
  toVerdict,
} from "./parcelModel.ts";

// Run with: npm run test -w @ada/web

const STATS_BASE: AnalysisStats = {
  polygons: 0,
  illegal: 0,
  changed_area_m2: 0,
  model: "test",
  working_resolution_m: 0.3,
  coregistration_shift_px: [0, 0],
};

function result(id: number, overrides: Partial<ParcelResult> = {}): ParcelResult {
  return {
    id,
    job_id: 7,
    parcel_id: 100 + id,
    parcel_key: `A#${id}`,
    sector: "A",
    plot_no: String(id),
    village_lgd: null,
    khasra_no: null,
    land_use: "residential",
    plot_type: "plot",
    sanctioned_area_sqm: 100,
    parcel_area_sqm: 200,
    tolerance_frac: 0.2,
    imagery_frac_t1: 1,
    imagery_frac_t2: 1,
    built_frac_t1: 0.1,
    built_frac_t2: 0.5,
    built_sqm_t1: 20,
    built_sqm_t2: 100,
    delta_sqm: 80,
    delta_sqm_corrected: 75,
    verdict_t1: "within_tolerance",
    verdict_t2: "within_tolerance",
    change_class: "extension",
    ...overrides,
  };
}

function collection(results: ParcelResult[]): ParcelFeatureCollection {
  return {
    type: "FeatureCollection",
    features: results.map((props, i) => ({
      type: "Feature",
      id: props.id,
      geometry:
        i % 2 === 0
          ? {
              type: "Polygon",
              coordinates: [
                [
                  [80, 26],
                  [80.001, 26],
                  [80.001, 26.001],
                  [80, 26],
                ],
              ],
            }
          : {
              type: "MultiPolygon",
              coordinates: [
                [[[81, 27], [81.002, 27], [81.002, 27.003], [81, 27]]],
                [[[80.5, 26.5], [80.6, 26.5], [80.6, 26.6], [80.5, 26.5]]],
              ],
            },
      properties: props,
    })),
    metadata: { count: results.length, total: results.length, limit: 20000, offset: 0, bbox: null },
  };
}

function wirePage(ids: number[], total: number, offset: number): ParcelFeatureCollectionOut {
  return {
    type: "FeatureCollection",
    features: ids.map((id) => ({
      type: "Feature",
      id,
      geometry: { type: "Polygon", coordinates: [[[80, 26], [80.001, 26], [80, 26.001], [80, 26]]] },
      properties: result(id),
    })),
    metadata: { count: ids.length, total, limit: 2, offset, bbox: null },
  };
}

/* ---------------------------------------------------------- vocabulary */

test("unknown classes and verdicts fall back to the non-committal value", () => {
  assert.equal(toChangeClass("new_build"), "new_build");
  assert.equal(toChangeClass("bogus"), "unassessable");
  assert.equal(toChangeClass(null), "unassessable");
  assert.equal(toVerdict("vacant"), "vacant");
  assert.equal(toVerdict(3), "not_assessable");
});

/* -------------------------------------------------------------- colour */

test("colour mapping follows the contract per class", () => {
  assert.equal(parcelColour("new_build"), "#ef4444");
  assert.equal(parcelColour("extension"), "#f97316");
  assert.equal(parcelColour("demolition"), "#3b82f6");
  assert.equal(parcelColour("unchanged"), "#9ca3af");
  assert.equal(parcelColour("unassessable"), "#9ca3af");
  assert.equal(parcelColour("junk"), PARCEL_COLOURS.unassessable);
  assert.equal(isDashed("unassessable"), true);
  assert.equal(isDashed("unchanged"), false);
});

test("map expressions cover every class and scale by the layer opacity", () => {
  const fill = parcelFillColorExpr();
  assert.equal(fill[0], "match");
  for (const cls of CHANGE_CLASSES) {
    const at = fill.indexOf(cls);
    assert.ok(at > 1, cls);
    assert.equal(fill[at + 1], PARCEL_COLOURS[cls]);
  }
  const opacity = parcelFillOpacityExpr(0.5);
  assert.equal(opacity[0], "*");
  assert.equal(opacity[1], 0.5);
  const match = opacity[2] as unknown[];
  assert.equal(match[match.indexOf("unchanged") + 1], 0.3);
  assert.equal(match[match.indexOf("unassessable") + 1], 0);
  assert.equal(parcelFillOpacityExpr(4)[1], 1);
  assert.equal(parcelFillOpacityExpr(Number.NaN)[1], 1);
});

/* ------------------------------------------------------------- numbers */

test("numeric accepts decimal strings and rejects junk", () => {
  assert.equal(numeric(12.5), 12.5);
  assert.equal(numeric("112.50"), 112.5);
  assert.equal(numeric(""), null);
  assert.equal(numeric("abc"), null);
  assert.equal(numeric(Number.POSITIVE_INFINITY), null);
  assert.equal(numeric(null), null);
});

/* ------------------------------------------------------------- summary */

test("parcelSummaryOf is null for skipped, failed, empty and missing stages", () => {
  assert.equal(parcelSummaryOf(null), null);
  assert.equal(parcelSummaryOf(STATS_BASE), null);
  assert.equal(parcelSummaryOf({ ...STATS_BASE, parcels: { skipped: "classical mode" } }), null);
  assert.equal(parcelSummaryOf({ ...STATS_BASE, parcels: { error: "boom" } }), null);
  const empty = {
    parcels_total: 0,
    assessable: 0,
    bias_offset_sqm: null,
    histogram: { bin_edges: [], counts: [] },
    counts_by_class: {},
    counts_by_verdict_t1: {},
    counts_by_verdict_t2: {},
  };
  assert.equal(parcelSummaryOf({ ...STATS_BASE, parcels: empty }), null);
});

test("parcelSummaryOf normalises a real summary", () => {
  const summary = parcelSummaryOf({
    ...STATS_BASE,
    parcels: {
      parcels_total: 3,
      assessable: 2,
      bias_offset_sqm: "4.5" as unknown as number,
      histogram: { bin_edges: [0, 1], counts: [2] },
      counts_by_class: { new_build: 1, unchanged: 2 },
      counts_by_verdict_t1: { vacant: 1 },
      counts_by_verdict_t2: {},
    },
  });
  assert.ok(summary);
  assert.equal(summary.parcels_total, 3);
  assert.equal(summary.bias_offset_sqm, 4.5);
  assert.deepEqual(summary.counts_by_class, { new_build: 1, unchanged: 2 });
});

test("classCounts zero-fills every class in display order", () => {
  assert.deepEqual(classCounts({ unchanged: 4, demolition: 1, stray: 9 }), [
    { cls: "new_build", count: 0 },
    { cls: "extension", count: 0 },
    { cls: "demolition", count: 1 },
    { cls: "unchanged", count: 4 },
    { cls: "unassessable", count: 0 },
  ]);
});

/* ----------------------------------------------------------- histogram */

test("histogram heights are normalised to the tallest bin", () => {
  const bars = histogramBars({ bin_edges: [-10, 0, 10, 20], counts: [2, 8, 4] });
  assert.equal(bars.length, 3);
  assert.deepEqual(
    bars.map((b) => b.height),
    [0.25, 1, 0.5],
  );
  assert.deepEqual(bars[1], { from: 0, to: 10, count: 8, height: 1 });
});

test("histogram tolerates empty and malformed input", () => {
  assert.deepEqual(histogramBars(null), []);
  assert.deepEqual(histogramBars({ bin_edges: [], counts: [] }), []);
  assert.deepEqual(histogramBars({ bin_edges: [0], counts: [3] }), []);
  const zero = histogramBars({ bin_edges: [0, 1, 2], counts: [0, 0] });
  assert.deepEqual(
    zero.map((b) => b.height),
    [0, 0],
  );
  // More counts than bins: extra counts are dropped, negatives clamp to zero.
  const extra = histogramBars({ bin_edges: [0, 1, 2], counts: [-1, 5, 9] });
  assert.deepEqual(
    extra.map((b) => [b.count, b.height]),
    [
      [0, 0],
      [5, 1],
    ],
  );
});

/* ---------------------------------------------------------------- rows */

test("toParcelRows maps properties, bounds and string numerics", () => {
  const fc = collection([
    result(1, { sanctioned_area_sqm: "112.50" as unknown as number }),
    result(2, { change_class: "new_build" }),
  ]);
  const rows = toParcelRows(fc);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, "1");
  assert.equal(rows[0].sanctionedSqm, 112.5);
  assert.equal(rows[0].parcelId, "101");
  assert.deepEqual(rows[0].bounds, [80, 26, 80.001, 26.001]);
  assert.deepEqual(rows[1].bounds, [80.5, 26.5, 81.002, 27.003]);
  assert.equal(rows[1].changeClass, "new_build");
  assert.ok(!("owner_name" in rows[0]));
});

test("toParcelRows skips features with no result id", () => {
  const fc = collection([result(1)]);
  (fc.features[0].properties as unknown as Record<string, unknown>).id = null;
  fc.features[0].id = undefined;
  assert.deepEqual(toParcelRows(fc), []);
  assert.deepEqual(toParcelRows(undefined), []);
});

test("geometryBounds handles empty and null geometry", () => {
  assert.equal(geometryBounds(null), null);
  assert.equal(geometryBounds({ type: "MultiPolygon", coordinates: [] }), null);
});

test("parcelLabel falls back from key to sector/plot to village/khasra", () => {
  const base = { parcelKey: "", sector: null, plotNo: null, villageLgd: null, khasraNo: null, parcelId: "9" };
  assert.equal(parcelLabel({ ...base, parcelKey: "B#12" }), "B#12");
  assert.equal(parcelLabel({ ...base, sector: "B", plotNo: "12" }), "B#12");
  assert.equal(parcelLabel({ ...base, villageLgd: "1234", khasraNo: "56" }), "1234#56");
  assert.equal(parcelLabel(base), "9");
});

/* ------------------------------------------------------------- filters */

test("class filter toggles and reduces rows and features alike", () => {
  const classes: ParcelChangeClass[] = ["new_build", "extension", "unchanged", "new_build"];
  const results = classes.map((cls, i) => result(i + 1, { change_class: cls }));
  const rows = toParcelRows(collection(results));

  assert.equal(toggleClassFilter(null, "new_build"), "new_build");
  assert.equal(toggleClassFilter("new_build", "new_build"), null);
  assert.equal(toggleClassFilter("new_build", "unchanged"), "unchanged");

  assert.equal(filterParcelRows(rows, null).length, 4);
  assert.deepEqual(
    filterParcelRows(rows, "new_build").map((r) => r.id),
    [1, 4],
  );
  const fc = collection(results);
  assert.equal(filterParcelFeatures(fc, null), fc);
  assert.equal(filterParcelFeatures(fc, "unchanged").features.length, 1);
  assert.equal(filterParcelFeatures(fc, "demolition").features.length, 0);

  assert.deepEqual(countRowsByClass(rows), {
    new_build: 2,
    extension: 1,
    demolition: 0,
    unchanged: 1,
    unassessable: 0,
  });
  assert.deepEqual(parcelFilters(null), {});
  assert.deepEqual(parcelFilters("extension"), { change_class: "extension" });
});

/* ---------------------------------------------------------------- sort */

test("default sort puts the largest corrected growth first and nulls last", () => {
  const rows = toParcelRows(
    collection([
      result(1, { delta_sqm_corrected: 5 }),
      result(2, { delta_sqm_corrected: null }),
      result(3, { delta_sqm_corrected: 50 }),
      result(4, { delta_sqm_corrected: -20 }),
    ]),
  );
  assert.deepEqual(
    sortParcelRows(rows, DEFAULT_PARCEL_SORT).map((r) => r.id),
    [3, 1, 4, 2],
  );
  assert.deepEqual(
    sortParcelRows(rows, { key: "delta", desc: false }).map((r) => r.id),
    [4, 1, 3, 2],
  );
});

test("parcel labels sort naturally and class sorts by severity", () => {
  const rows = toParcelRows(
    collection([
      result(1, { parcel_key: "A#10", change_class: "unchanged" }),
      result(2, { parcel_key: "A#2", change_class: "new_build" }),
      result(3, { parcel_key: "A#1", change_class: "demolition" }),
    ]),
  );
  assert.deepEqual(
    sortParcelRows(rows, { key: "parcel", desc: false }).map((r) => r.parcelKey),
    ["A#1", "A#2", "A#10"],
  );
  assert.deepEqual(
    sortParcelRows(rows, { key: "changeClass", desc: false }).map((r) => r.changeClass),
    ["new_build", "demolition", "unchanged"],
  );
  // Does not mutate its input.
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 2, 3],
  );
});

test("nextParcelSort flips the same column and starts text columns ascending", () => {
  assert.deepEqual(nextParcelSort({ key: "delta", desc: true }, "delta"), { key: "delta", desc: false });
  assert.deepEqual(nextParcelSort({ key: "delta", desc: true }, "parcel"), { key: "parcel", desc: false });
  assert.deepEqual(nextParcelSort({ key: "parcel", desc: false }, "builtT2"), { key: "builtT2", desc: true });
});

/* ------------------------------------------------------------ paging */

test("loadParcelPages pages by offset until metadata.total is reached", async () => {
  const calls: [number, number][] = [];
  const pages = await loadParcelPages(async (offset, limit) => {
    calls.push([offset, limit]);
    const ids = [1, 2, 3, 4, 5].slice(offset, offset + limit);
    return wirePage(ids, 5, offset);
  }, 2);
  assert.deepEqual(calls, [[0, 2], [2, 2], [4, 2]]);
  assert.deepEqual(pages.collection.features.map((f) => f.id), [1, 2, 3, 4, 5]);
  assert.equal(pages.total, 5);
  assert.equal(pages.partial, false);
  assert.equal(pages.collection.metadata.count, 5);
});

test("loadParcelPages marks a run partial when a page comes back short of the total", async () => {
  const pages = await loadParcelPages(async (offset) => wirePage(offset === 0 ? [1, 2] : [], 8096, offset), 2);
  assert.equal(pages.collection.features.length, 2);
  assert.equal(pages.total, 8096);
  assert.equal(pages.partial, true);
});

test("loadParcelPages stops at maxPages and reports partial", async () => {
  let n = 0;
  const pages = await loadParcelPages(async (offset) => wirePage([++n, ++n], 100, offset), 2, 3);
  assert.equal(pages.collection.features.length, 6);
  assert.equal(pages.partial, true);
});

test("loadParcelPages uses the API maximum page size by default", async () => {
  let asked = 0;
  await loadParcelPages(async (offset, limit) => {
    asked = limit;
    return wirePage([1], 1, offset);
  });
  assert.equal(asked, 20000);
});

test("toMapCollection drops null geometry; the table keeps the row without bounds", () => {
  const page = wirePage([1, 2], 2, 0);
  page.features[1] = { ...page.features[1], geometry: null };
  const map = toMapCollection(page);
  assert.deepEqual(map.features.map((f) => f.id), [1]);
  assert.equal(map.metadata.total, 2);
  const rows = toParcelRows(page);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].bounds, null);
});

test("toParcelRows tolerates missing optional delta fields", () => {
  const page = wirePage([1], 1, 0);
  const { delta_sqm: _a, delta_sqm_corrected: _b, ...rest } = page.features[0].properties;
  page.features[0] = { ...page.features[0], properties: rest as ParcelResult };
  const [row] = toParcelRows(page);
  assert.equal(row.deltaSqm, null);
  assert.equal(row.deltaCorrectedSqm, null);
});

/* ---------------------------------------------------------- histogram tone */

test("histogram bins are toned against the epoch bias, not zero", () => {
  assert.equal(histogramTone({ from: 5, to: 10 }, 4.5), "growth");
  assert.equal(histogramTone({ from: 0, to: 4.5 }, 4.5), "loss");
  assert.equal(histogramTone({ from: 0, to: 10 }, 4.5), "straddle");
  assert.equal(histogramTone({ from: 0, to: 10 }, 0), "growth");
  assert.equal(histogramTone({ from: -10, to: 0 }, 0), "loss");
});

/* ------------------------------------------------------- roving tabindex */

test("rovingIndex moves one row, jumps with Home and End, and ignores other keys", () => {
  assert.equal(rovingIndex(0, "ArrowDown", 3), 1);
  assert.equal(rovingIndex(2, "ArrowDown", 3), 2);
  assert.equal(rovingIndex(0, "ArrowUp", 3), 0);
  assert.equal(rovingIndex(1, "Home", 3), 0);
  assert.equal(rovingIndex(0, "End", 3), 2);
  assert.equal(rovingIndex(9, "ArrowUp", 3), 1);
  assert.equal(rovingIndex(0, "Tab", 3), null);
  assert.equal(rovingIndex(0, "ArrowDown", 0), null);
});
