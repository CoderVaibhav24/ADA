import { strict as assert } from "node:assert";
import { test } from "node:test";

import { listSessions, pruneSessions, saveSession, type KeyValueStorage } from "./session-store.ts";

// Run with: npm run test -w @ada/web.

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const entry = (id: number) => ({ upload_id: id, project_id: 7, fingerprint: `1:${id}`, name: `f${id}`, size: 1 });

test("pruning keeps only sessions the server still lists", () => {
  const storage = memoryStorage();
  saveSession(entry(1), storage);
  saveSession(entry(2), storage);
  pruneSessions(7, ["2"], storage);
  assert.deepEqual(listSessions(7, storage).map((s) => s.upload_id), [2]);
});

test("a storage that throws reads as empty and never breaks the caller", () => {
  const broken: KeyValueStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(listSessions(7, broken), []);
  saveSession(entry(1), broken);
  pruneSessions(7, [], broken);
});
