import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { FINGERPRINT_EDGE_BYTES, fingerprintFile, matchesFingerprint } from "./fingerprint.ts";

// Run with: npm run test -w @ada/web. crypto.subtle is Node's own, no browser needed.

function expected(bytes: Uint8Array): string {
  const edge = FINGERPRINT_EDGE_BYTES;
  const head = bytes.subarray(0, Math.min(edge, bytes.length));
  const tail = bytes.subarray(Math.max(0, bytes.length - edge));
  const hex = createHash("sha256").update(head).update(tail).digest("hex");
  return `${bytes.length}:${hex.slice(0, 32)}`;
}

test("a small file hashes itself twice, head then tail", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(await fingerprintFile(new File([bytes], "a.tif")), expected(bytes));
  assert.match(await fingerprintFile(new File([bytes], "a.tif")), /^5:[0-9a-f]{32}$/);
});

test("a file over 2 MiB hashes only its first and last MiB", async () => {
  const bytes = new Uint8Array(FINGERPRINT_EDGE_BYTES * 3);
  bytes[0] = 1;
  bytes[bytes.length - 1] = 2;
  const print = await fingerprintFile(new File([bytes], "big.tif"));
  assert.equal(print, expected(bytes));

  const middleChanged = bytes.slice();
  middleChanged[FINGERPRINT_EDGE_BYTES + 10] = 99;
  assert.equal(await fingerprintFile(new File([middleChanged], "big.tif")), print);

  const tailChanged = bytes.slice();
  tailChanged[bytes.length - 2] = 99;
  assert.notEqual(await fingerprintFile(new File([tailChanged], "big.tif")), print);
});

test("the name is not part of the fingerprint, so a renamed copy still matches", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const print = await fingerprintFile(new File([bytes], "one.tif"));
  assert.equal(await fingerprintFile(new File([bytes], "two.tif")), print);
  assert.equal(await matchesFingerprint(new File([bytes], "two.tif"), print), true);
});

test("a different size never matches, whatever the edges hold", async () => {
  const print = await fingerprintFile(new File([new Uint8Array([1, 2, 3])], "a.tif"));
  assert.equal(await matchesFingerprint(new File([new Uint8Array([1, 2, 3, 4])], "a.tif"), print), false);
});
