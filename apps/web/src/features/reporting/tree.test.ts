import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { ReportingRole } from "@/api/icms/reporting";
import { MEMBER_PREVIEW, roleLadderTree, treeEdges, visibleCount } from "./tree.ts";

const role = (role_cd: string, reports_to: string | null, level: number): ReportingRole => ({
  role_cd,
  label: role_cd,
  label_hi: null,
  level,
  reports_to,
  members: [],
});

const LADDER = [
  role("super-admin", null, 0),
  role("ada-project-lead", "super-admin", 1),
  role("pcs-nodal-officer", "ada-project-lead", 2),
  role("field-surveyor", "pcs-nodal-officer", 3),
];

test("each role becomes a node parented by the role it reports to", () => {
  const tree = roleLadderTree(LADDER, (r) => r.label.toUpperCase());
  assert.deepEqual(
    tree.map((n) => [n.id, n.parentId, n.label]),
    [
      ["role:super-admin", null, "SUPER-ADMIN"],
      ["role:ada-project-lead", "role:super-admin", "ADA-PROJECT-LEAD"],
      ["role:pcs-nodal-officer", "role:ada-project-lead", "PCS-NODAL-OFFICER"],
      ["role:field-surveyor", "role:pcs-nodal-officer", "FIELD-SURVEYOR"],
    ],
  );
});

test("a role reporting to one that is absent becomes a root", () => {
  const tree = roleLadderTree([role("field-surveyor", "pcs-nodal-officer", 3)], (r) => r.label);
  assert.equal(tree[0]?.parentId, null);
});

test("edges run senior to junior and roots have none", () => {
  const edges = treeEdges(roleLadderTree([...LADDER, role("zone-inspector", null, 4)], (r) => r.label));
  assert.deepEqual(
    edges.map((e) => [e.source, e.target]),
    [
      ["role:super-admin", "role:ada-project-lead"],
      ["role:ada-project-lead", "role:pcs-nodal-officer"],
      ["role:pcs-nodal-officer", "role:field-surveyor"],
    ],
  );
});

test("a box previews a few officers until expanded", () => {
  assert.equal(visibleCount(2, false), 2);
  assert.equal(visibleCount(40, false), MEMBER_PREVIEW);
  assert.equal(visibleCount(40, true), 40);
});
