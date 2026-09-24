import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  detectionEvidenceName,
  detectionPreviewPath,
  splitPreviewCard,
} from "./detectionEvidence.ts";

test("the crop is the polygon preview Change Detection already renders", () => {
  assert.equal(detectionPreviewPath("15", "1090"), "/api/analyses/15/polygons/1090/preview.png");
  assert.equal(detectionPreviewPath("1/2", "3"), "/api/analyses/1%2F2/polygons/3/preview.png");
});

test("the server's 412x222 card splits into two 200px panels with their labels", () => {
  assert.deepEqual(splitPreviewCard(412, 222), {
    before: { x: 4, y: 0, width: 200, height: 218 },
    after: { x: 208, y: 0, width: 200, height: 218 },
  });
  // A different panel size is read back from the image, not assumed.
  assert.deepEqual(splitPreviewCard(612, 322)?.after, { x: 308, y: 0, width: 300, height: 318 });
});

test("a card of any other shape is not split", () => {
  assert.equal(splitPreviewCard(413, 222), null);
  assert.equal(splitPreviewCard(412, 300), null);
  assert.equal(splitPreviewCard(12, 22), null);
  assert.equal(splitPreviewCard(0, 0), null);
});

test("evidence files are named after the detection", () => {
  assert.equal(detectionEvidenceName("DET-15-1090", "after"), "DET-15-1090-after.png");
  assert.equal(detectionEvidenceName("DET-15-1090", "before-after"), "DET-15-1090-before-after.png");
  assert.equal(detectionEvidenceName("../a b/", "before"), "a-b-before.png");
  assert.equal(detectionEvidenceName("///", "after"), "detection-after.png");
});
