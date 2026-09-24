import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isBoundaryFile, reportedFolders, sizeText, totalCounts } from "./boundaryFile.ts";

test("only a .kml or .kmz name is accepted, in any case", () => {
  assert.equal(isBoundaryFile("agra.kml"), true);
  assert.equal(isBoundaryFile("AGRA.KMZ"), true);
  assert.equal(isBoundaryFile("agra.kml.zip"), false);
  assert.equal(isBoundaryFile("agra.geojson"), false);
  assert.equal(isBoundaryFile(""), false);
});

test("folders come back in the spec's order, and only the reported ones", () => {
  const counts = {
    reserved: { inserted: 1, updated: 0, deactivated: 0, rejected: 0 },
    zones: { inserted: 2, updated: 3, deactivated: 1, rejected: 4 },
  };
  assert.deepEqual(reportedFolders(counts), ["zones", "reserved"]);
  assert.deepEqual(totalCounts(counts), { inserted: 3, updated: 3, deactivated: 1, rejected: 4 });
  assert.deepEqual(totalCounts({}), { inserted: 0, updated: 0, deactivated: 0, rejected: 0 });
});

test("a size reads in B, KB or MB", () => {
  assert.equal(sizeText(512), "512 B");
  assert.equal(sizeText(860_000), "840 KB");
  assert.equal(sizeText(13_000_000), "12.4 MB");
});
