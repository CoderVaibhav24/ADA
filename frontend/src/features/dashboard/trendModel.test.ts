import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  DEFAULT_PERIOD,
  PERIODS,
  axisMax,
  groupTotal,
  labelledIndexes,
  niceTicks,
  periodById,
  seriesVar,
  shareOf,
  trendTotals,
} from "./trendModel.ts";

// Run with: npm run test -w frontend
// trendModel.ts imports one TYPE and nothing else, so Node's type stripping is
// enough — no bundler, no React, no DOM.

test("every offered period is inside the server's 1-365 day range", () => {
  for (const period of PERIODS) {
    assert.ok(period.days >= 1, `${period.id} below the floor`);
    assert.ok(period.days <= 365, `${period.id} above the cap`);
  }
  assert.ok(PERIODS.some((period) => period.id === DEFAULT_PERIOD));
});

test("an unknown or absent period id falls back to the 30-day default", () => {
  assert.equal(periodById("90d").days, 90);
  assert.equal(periodById("90d").bucket, "week");
  assert.equal(periodById(null).id, DEFAULT_PERIOD);
  assert.equal(periodById(undefined).id, DEFAULT_PERIOD);
  assert.equal(periodById("all-time").id, DEFAULT_PERIOD);
});

// The window total is the sum of the buckets the server sent, zeroes included.
test("trend totals sum the buckets as given", () => {
  assert.deepEqual(
    trendTotals([
      { raised: 4, resolved: 1 },
      { raised: 0, resolved: 0 },
      { raised: 7, resolved: 5 },
    ]),
    { raised: 11, resolved: 6 },
  );
  assert.deepEqual(trendTotals([]), { raised: 0, resolved: 0 });
});

/* The reason niceTicks exists: an axis whose top tick sits below the tallest
   mark draws that mark outside the plot, and one whose top tick sits above the
   domain prints a label the scale never reaches. */
test("the top tick is always the top of the scale, and always clears the data", () => {
  for (const max of [0, 1, 3, 7, 12, 45, 60, 140, 999, 1284]) {
    const ticks = niceTicks(max);
    assert.equal(ticks[0], 0, `max ${String(max)} did not start at zero`);
    assert.equal(axisMax(ticks), ticks[ticks.length - 1]);
    assert.ok(axisMax(ticks) >= max, `max ${String(max)} overflows its axis`);
    assert.ok(
      ticks.every((tick) => Number.isInteger(tick)),
      `max ${String(max)} produced a fractional count`,
    );
    assert.ok(
      ticks.length >= 2 && ticks.length <= 7,
      `max ${String(max)} produced ${String(ticks.length)} ticks`,
    );
  }
});

test("ticks are evenly spaced, which is what makes it one scale", () => {
  const ticks = niceTicks(140);
  const step = ticks[1] - ticks[0];
  for (let index = 1; index < ticks.length; index += 1) {
    assert.equal(ticks[index] - ticks[index - 1], step);
  }
});

// An all-zero window is a real answer, not an empty one: the axis still needs a top.
test("an all-zero series still gets a labelled axis", () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(-3), [0, 1]);
  assert.equal(axisMax(niceTicks(0)), 1);
});

test("small counts get one tick per unit rather than a fractional step", () => {
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(5), [0, 1, 2, 3, 4, 5]);
});

test("few enough buckets are all labelled; many are thinned but keep the first", () => {
  assert.deepEqual(labelledIndexes(0), []);
  assert.deepEqual(labelledIndexes(5), [0, 1, 2, 3, 4]);

  const thinned = labelledIndexes(30);
  assert.equal(thinned[0], 0);
  assert.ok(thinned.length <= 7, `30 buckets produced ${String(thinned.length)} labels`);
  assert.ok(thinned.every((index) => index >= 0 && index < 30));
  // Strictly increasing, so no two labels land on the same bucket.
  for (let index = 1; index < thinned.length; index += 1) {
    assert.ok(thinned[index] > thinned[index - 1]);
  }
});

// A last label half a stride from its neighbour would overprint it.
test("the final bucket is labelled only when it clears its neighbour", () => {
  const labels = labelledIndexes(13);
  const last = labels[labels.length - 1];
  const previous = labels[labels.length - 2];
  assert.ok(last - previous >= 1);
  assert.ok(last <= 12);
});

test("shares are of the rows that came back, and a zero total is not a divide", () => {
  assert.equal(shareOf(38, 100), 38);
  assert.equal(shareOf(1, 3), 33);
  assert.equal(shareOf(0, 0), 0);
  assert.equal(shareOf(5, 0), 0);
});

test("group total sums the rows the endpoint returned", () => {
  assert.equal(groupTotal([{ total: 12 }, { total: 3 }, { total: 0 }]), 15);
  assert.equal(groupTotal([]), 0);
});

/* Colour never carries meaning alone on this screen, but a sixth group must
   still be drawn rather than dropped, so the five chart tokens cycle. */
test("series colours cycle through the five chart tokens and never a literal", () => {
  assert.equal(seriesVar(0), "var(--color-chart-1)");
  assert.equal(seriesVar(4), "var(--color-chart-5)");
  assert.equal(seriesVar(5), "var(--color-chart-1)");
  for (let index = 0; index < 12; index += 1) {
    assert.match(seriesVar(index), /^var\(--color-chart-[1-5]\)$/);
  }
});
