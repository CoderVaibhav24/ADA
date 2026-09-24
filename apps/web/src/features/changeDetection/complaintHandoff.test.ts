import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { DetectionRow } from "./model.ts";
import { parseComplaintHandoff, toComplaintSearch } from "./complaintHandoff.ts";

// Only the fields `toComplaintSearch` reads; the rest of a row is irrelevant here.
function row(changeType: DetectionRow["changeType"]): DetectionRow {
  return {
    ref: "DET-16-2171",
    jobId: "16",
    featureId: 2171,
    areaM2: 46.2,
    confidence: 0.9021,
    status: "change",
    changeType,
    centre: [80.941012, 26.944861],
  } as unknown as DetectionRow;
}

test("the change type travels when the model named one, and round-trips", () => {
  const search = toComplaintSearch(row("new_construction"));
  assert.match(search, /changeType=new_construction/);

  const handoff = parseComplaintHandoff(search);
  assert.equal(handoff?.changeType, "new_construction");
  assert.equal(handoff?.detectionRef, "DET-16-2171");
  assert.equal(handoff?.polygonId, "2171");
  assert.equal(handoff?.areaM2, 46);
  assert.equal(handoff?.status, "change");
  assert.equal(handoff?.lat, 26.944861);
});

test("no change type is sent when the model named none", () => {
  const search = toComplaintSearch(row(null));
  assert.doesNotMatch(search, /changeType/);
  assert.equal(parseComplaintHandoff(search)?.changeType, null);
});

test("an unknown change type in an edited link reads as none", () => {
  const handoff = parseComplaintHandoff(
    "?detectionRef=DET-1-1&analysisId=1&polygonId=1&changeType=bulldozer",
  );
  assert.equal(handoff?.changeType, null);
});
