import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { AppConfig } from "../../api/icms/appConfig.ts";
import type { EvidenceOut } from "../../api/icms/inspections.ts";
import { countPhotographs, photoRuleOf } from "./photoRule.ts";

// Run with: npm run test -w @ada/web
// photoRule.ts imports types only, so Node's type stripping is enough — no
// bundler, no React, no DOM, and no `@/` alias to resolve.

function evidence(kind: string, id: number): EvidenceOut {
  return {
    id,
    case_ref: "CMP-2026-0412",
    inspection_ref: "INS-2026-0089",
    round_no: 2,
    kind,
    doc_type_cd: null,
    original_filename: null,
    content_type: null,
    byte_size: null,
    sha256: null,
    lat: null,
    lon: null,
    accuracy_m: null,
    device_timestamp: null,
    capture_source: null,
    captured_at: null,
    uploaded_by: "u1",
    uploaded_at: "2026-09-20T09:00:00Z",
    content_url: `/api/icms/evidence/${String(id)}/content`,
    geotag_flagged: false,
  };
}

function config(over: Partial<AppConfig> = {}): AppConfig {
  return {
    gps_accuracy_gate_m: 50,
    gps_accuracy_flag_m: 15,
    device_timestamp_max_age_hours: 12,
    minimum_photo_count: 3,
    maximum_photo_count: 5,
    ...over,
  };
}

test("only photographs are counted — a document or a signature is not one", () => {
  const round = [
    evidence("photo", 1),
    evidence("document", 2),
    evidence("signature", 3),
    evidence("video", 4),
    evidence("photo", 5),
  ];
  assert.equal(countPhotographs(round), 2);
  assert.equal(countPhotographs([]), 0);
});

test("below the minimum, the shortfall is the number still needed", () => {
  const rule = photoRuleOf(config(), 1);
  assert.equal(rule.shortfall, 2);
  assert.equal(rule.atCeiling, false);
  assert.equal(rule.stated, true);
});

test("at the minimum there is no shortfall, and one over it is still none", () => {
  assert.equal(photoRuleOf(config(), 3).shortfall, 0);
  assert.equal(photoRuleOf(config(), 4).shortfall, 0);
});

test("the ceiling is reached AT the maximum, not one past it", () => {
  assert.equal(photoRuleOf(config(), 4).atCeiling, false);
  assert.equal(photoRuleOf(config(), 5).atCeiling, true);
  // A round that somehow holds more than the maximum is still at the ceiling.
  assert.equal(photoRuleOf(config(), 6).atCeiling, true);
});

test("a config that has not loaded bounds nothing — the server is the judge", () => {
  const rule = photoRuleOf(null, 0);
  assert.equal(rule.minimum, null);
  assert.equal(rule.maximum, null);
  assert.equal(rule.stated, false);
  assert.equal(rule.atCeiling, false);
  assert.equal(rule.shortfall, 0);
  assert.equal(rule.count, 0);
});

test("an unpublished bound is not a bound, even when the other one is published", () => {
  const noMaximum = photoRuleOf(config({ maximum_photo_count: null }), 9);
  assert.equal(noMaximum.atCeiling, false);
  assert.equal(noMaximum.shortfall, 0);
  assert.equal(noMaximum.stated, false);

  const noMinimum = photoRuleOf(config({ minimum_photo_count: null }), 0);
  assert.equal(noMinimum.shortfall, 0);
  assert.equal(noMinimum.stated, false);
});

test("the published numbers are carried through untouched, whatever they are", () => {
  // The server owns the count: 1 and 2 are as valid as 3 and 5, and nothing
  // in the client may prefer one set over another.
  const rule = photoRuleOf(config({ minimum_photo_count: 1, maximum_photo_count: 2 }), 1);
  assert.equal(rule.minimum, 1);
  assert.equal(rule.maximum, 2);
  assert.equal(rule.shortfall, 0);
  assert.equal(rule.atCeiling, false);
});
