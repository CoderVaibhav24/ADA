import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES,
  acceptEvidence,
  checkEvidenceFile,
  uploadEach,
} from "./complaintEvidence.ts";

const photo = (name: string, size = 1024, type = "image/jpeg") => ({ name, size, type });

test("only jpeg, png and webp under the size limit are accepted", () => {
  assert.equal(checkEvidenceFile(photo("a.jpg")), null);
  assert.equal(checkEvidenceFile(photo("a.png", 10, "image/png")), null);
  assert.equal(checkEvidenceFile(photo("a.webp", 10, "image/webp")), null);
  assert.equal(checkEvidenceFile(photo("a.gif", 10, "image/gif")), "type");
  assert.equal(checkEvidenceFile(photo("a.pdf", 10, "application/pdf")), "type");
  assert.equal(checkEvidenceFile(photo("big.jpg", MAX_EVIDENCE_BYTES + 1)), "size");
  assert.equal(checkEvidenceFile(photo("edge.jpg", MAX_EVIDENCE_BYTES)), null);
});

test("a selection past the per-case ceiling is cut at the ceiling", () => {
  const incoming = [
    photo("1.jpg"),
    photo("2.gif", 1, "image/gif"),
    photo("3.jpg"),
    photo("4.jpg"),
  ];
  const { accepted, rejected } = acceptEvidence(MAX_EVIDENCE_FILES - 2, incoming);

  assert.deepEqual(
    accepted.map((f) => f.name),
    ["1.jpg", "3.jpg"],
  );
  assert.deepEqual(
    rejected.map((r) => [r.file.name, r.reason]),
    [
      ["2.gif", "type"],
      ["4.jpg", "count"],
    ],
  );
});

test("an upload pass records failures instead of throwing", async () => {
  const seen: string[] = [];
  const progress: number[] = [];
  const outcome = await uploadEach(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    (item) => {
      seen.push(item.id);
      return item.id === "b" ? Promise.reject(new Error("503")) : Promise.resolve();
    },
    (done) => progress.push(done),
  );

  // Sequential, and the failure in the middle does not stop the third file.
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.deepEqual(outcome, { uploaded: ["a", "c"], failed: ["b"] });
  assert.deepEqual(progress, [1, 2, 3]);
});
