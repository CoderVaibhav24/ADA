import { strict as assert } from "node:assert";
import { test } from "node:test";

import { actorLabel } from "./actor.ts";

const ID = "5b4814c9-d1ac-4d10-9a08-18841a41e93e";

test("a resolved name is shown, with the id as the tooltip", () => {
  assert.deepEqual(actorLabel("Asha Verma", ID), { text: "Asha Verma", title: ID, isId: false });
});

test("no name falls back to the id itself", () => {
  for (const name of [null, undefined, "  "]) {
    assert.deepEqual(actorLabel(name, ID), { text: ID, title: undefined, isId: true });
  }
});

test("neither is an empty label rather than a crash", () => {
  assert.equal(actorLabel(null, null).text, "");
});
