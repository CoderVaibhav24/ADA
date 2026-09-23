import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  DEFAULT_BUCKET,
  DEFAULT_PERIOD,
  MAX_TREND_DAYS,
  financialYearDays,
  hasPartialBuckets,
  isBucket,
  isPeriodId,
  periodDays,
  resolutionRate,
  share,
  totalsOf,
} from "./period.ts";

// Run with: npm run test -w frontend
// period.ts imports nothing at all, so Node's type stripping is enough — no
// bundler, no React, no DOM, and no timezone: every function takes the date key.

const TODAY = "2026-09-23";

test("the fixed periods are what the endpoint accepts", () => {
  assert.equal(periodDays("last7", TODAY), 7);
  assert.equal(periodDays("last30", TODAY), 30);
  assert.equal(periodDays("last90", TODAY), 90);
  assert.equal(periodDays("last365", TODAY), MAX_TREND_DAYS);
  for (const period of ["last7", "last30", "last90", "last365", "financialYear"] as const) {
    const days = periodDays(period, TODAY);
    assert.ok(days >= 1 && days <= MAX_TREND_DAYS, `${period} -> ${String(days)}`);
  }
});

test("the financial year runs from 1 April and counts today", () => {
  // 1 April is the first day of the window, so the window is one day long.
  assert.equal(financialYearDays("2026-04-01"), 1);
  assert.equal(financialYearDays("2026-04-30"), 30);
  // 1 April to 23 September 2026: 30 + 31 + 30 + 31 + 31 + 23.
  assert.equal(financialYearDays(TODAY), 176);
  // January falls in the financial year that opened the previous April.
  assert.equal(financialYearDays("2027-01-01"), 276);
  assert.equal(financialYearDays("2027-03-31"), 365);
});

test("a leap financial year is clamped to the endpoint's ceiling", () => {
  // 1 Apr 2023 – 31 Mar 2024 contains 29 Feb 2024, so it is 366 days and the
  // endpoint refuses 366.
  assert.equal(financialYearDays("2024-03-31"), MAX_TREND_DAYS);
});

test("only the whitelisted period and bucket survive the URL", () => {
  assert.equal(isPeriodId("last90"), true);
  assert.equal(isPeriodId("allTime"), false);
  assert.equal(isPeriodId(null), false);
  assert.equal(isBucket("month"), true);
  assert.equal(isBucket("quarter"), false);
  assert.equal(isPeriodId(DEFAULT_PERIOD), true);
  assert.equal(isBucket(DEFAULT_BUCKET), true);
});

test("totals sum the points the server sent", () => {
  assert.deepEqual(totalsOf([]), { raised: 0, resolved: 0 });
  assert.deepEqual(
    totalsOf([
      { raised: 4, resolved: 1 },
      { raised: 0, resolved: 0 },
      { raised: 7, resolved: 5 },
    ]),
    { raised: 11, resolved: 6 },
  );
});

test("a rate over nothing is absent, not zero", () => {
  assert.equal(resolutionRate(0, 0), null);
  assert.equal(resolutionRate(4, 1), 25);
  assert.equal(share(0, 0), null);
  assert.equal(share(1, 4), 25);
});

test("only a weekly or monthly window has partial outer buckets", () => {
  assert.equal(hasPartialBuckets("day"), false);
  assert.equal(hasPartialBuckets("week"), true);
  assert.equal(hasPartialBuckets("month"), true);
});
