import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bandOf, partitionByBand } from "./bands.ts";

const p = (code: string) => ({ permission_cd: code, action: code.split(".")[1] ?? "" });

test("every *.access code is a Screen", () => {
  assert.equal(bandOf(p("dashboard.access")), "screens");
  assert.equal(bandOf(p("officers.access")), "screens");
});

test("the fixed workflow codes are Workflow steps", () => {
  for (const code of ["case.amend", "case.close", "evidence.write", "inspection.request_resurvey", "notice.issue"]) {
    assert.equal(bandOf(p(code)), "workflow", code);
  }
});

test("everything else is Data & admin", () => {
  for (const code of ["case.read", "case.export", "policy.manage", "user.create"]) {
    assert.equal(bandOf(p(code)), "data", code);
  }
});

test("bands come out Screens, Workflow, Data with API order kept inside each", () => {
  const out = partitionByBand([
    p("case.read"),
    p("case.raise"),
    p("dashboard.access"),
    p("case.export"),
    p("case.assign"),
  ]);
  assert.deepEqual(out.map((group) => group.band), ["screens", "workflow", "data"]);
  assert.deepEqual(out[1]?.items.map((item) => item.permission_cd), ["case.raise", "case.assign"]);
  assert.deepEqual(out[2]?.items.map((item) => item.permission_cd), ["case.read", "case.export"]);
});

test("an empty band is dropped", () => {
  assert.deepEqual(partitionByBand([p("case.read")]).map((group) => group.band), ["data"]);
});
