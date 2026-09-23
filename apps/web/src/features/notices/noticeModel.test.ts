import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  bodyEntries,
  daysRemaining,
  isOverdue,
  orderedSections,
  pdfFileName,
  printableOf,
} from "./noticeModel.ts";

// Run with: npm run test -w @ada/web
// noticeModel.ts imports one TYPE and nothing else, so Node's type stripping is
// enough — no bundler, no React, no DOM.

const TODAY = "2026-09-23";

test("only an issued notice can be overdue", () => {
  assert.equal(isOverdue({ status: "issued", compliance_due: "2026-09-22" }, TODAY), true);
  assert.equal(isOverdue({ status: "issued", compliance_due: TODAY }, TODAY), false);
  assert.equal(isOverdue({ status: "issued", compliance_due: null }, TODAY), false);
  // A draft has not started running; the other three left the window elsewhere.
  for (const status of ["draft", "delivered", "failed", "withdrawn"]) {
    assert.equal(isOverdue({ status, compliance_due: "2026-01-01" }, TODAY), false, status);
  }
});

test("days remaining counts calendar days and goes negative", () => {
  assert.equal(daysRemaining("2026-09-30", TODAY), 7);
  assert.equal(daysRemaining(TODAY, TODAY), 0);
  assert.equal(daysRemaining("2026-09-20", TODAY), -3);
  assert.equal(daysRemaining(null, TODAY), null);
});

test("sections sort by their number, so 28-A follows 28 and 9 precedes 14", () => {
  assert.deepEqual(orderedSections(["28-A", "14", "9", "28"]), ["9", "14", "28", "28-A"]);
  assert.deepEqual(orderedSections(null), []);
});

test("the print control follows has_artefact, never the status", () => {
  assert.equal(printableOf({ has_artefact: true }), true);
  assert.equal(printableOf({ has_artefact: false }), false);
});

test("a downloaded notice gets an ASCII filename derived from its reference", () => {
  assert.equal(pdfFileName("NTC-2026-0142"), "NTC-2026-0142.pdf");
  assert.equal(pdfFileName("NTC/2026 0142"), "NTC_2026_0142.pdf");
});

test("body entries keep scalars and skip anything that would print as [object Object]", () => {
  assert.deepEqual(
    bodyEntries({ heading: "NOTICE TO VACATE", days: 15, sealed: true, parts: { a: 1 } }),
    [
      { key: "heading", value: "NOTICE TO VACATE" },
      { key: "days", value: "15" },
      { key: "sealed", value: "true" },
    ],
  );
  assert.deepEqual(bodyEntries(null), []);
});
