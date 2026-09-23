import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  PRIMARY_NAV,
  activeNavId,
  isBleedPath,
  isNavLink,
  navForPermissions,
} from "./nav.ts";
import { ROUTES } from "./paths.ts";

// Run with: npm run test -w frontend
// nav.ts imports only paths.ts at runtime, so Node's type stripping is enough —
// no bundler, no React, no DOM.

// Figma 17:3980's eight, plus the two administration entries — which the frame
// does not draw. They go after Report and before the rule above Logout.
test("the rail is in the order Figma 17:3980 draws it, plus the admin entries", () => {
  assert.deepEqual(
    PRIMARY_NAV.map((item) => item.id),
    [
      "dashboard",
      "changeDetection",
      "complaintNew",
      "complaints",
      "inspections",
      "notices",
      "reports",
      "administration",
      "users",
      "logout",
    ],
  );
});

test("every link points at a route that exists", () => {
  const known = new Set(
    Object.values(ROUTES).map((value) =>
      typeof value === "function" ? value() : value,
    ),
  );
  for (const item of PRIMARY_NAV) {
    if (isNavLink(item)) assert.ok(known.has(item.path), `unknown route ${item.path}`);
  }
});

test("logout is an action, not a route", () => {
  const logoutItem = PRIMARY_NAV.find((item) => item.id === "logout");
  assert.ok(logoutItem);
  assert.equal(isNavLink(logoutItem), false);
  assert.equal(logoutItem.separatorBefore, true);
});

// The reason this file exists: /complaints/new and /complaints are the first
// pair of rail entries where one path is a prefix of the other, and a
// first-match scan would light up Complaints while the officer is on Create.
test("longest prefix wins between /complaints and /complaints/new", () => {
  assert.equal(activeNavId(ROUTES.complaints), "complaints");
  assert.equal(activeNavId(ROUTES.complaintNew), "complaintNew");
  assert.equal(activeNavId("/complaints/ADA-2026-000001"), "complaints");
  assert.equal(activeNavId("/complaints/new/anything"), "complaintNew");
});

// The second pair where one path is a prefix of the other, and the reason the
// officer screen is a sibling rail entry rather than a tab on /administration.
test("longest prefix wins between /administration and its users screen", () => {
  assert.equal(activeNavId(ROUTES.administration), "administration");
  assert.equal(activeNavId(ROUTES.administrationUsers), "users");
  assert.equal(activeNavId(`${ROUTES.administrationUsers}/anything`), "users");
  assert.equal(activeNavId("/administration/policy"), "administration");
});

test("an unmatched path lights nothing", () => {
  assert.equal(activeNavId("/"), null);
  assert.equal(activeNavId("/complaintsx"), null);
});

test("only the map console is full-bleed", () => {
  assert.equal(isBleedPath(ROUTES.changeDetection), true);
  assert.equal(isBleedPath(`${ROUTES.changeDetection}/42`), true);
  assert.equal(isBleedPath(ROUTES.complaints), false);
});

/* The reason navForPermissions exists: its predecessor took a `roles` argument
   and returned the list unchanged, so a rail entry that looked gated was not. */
test("Administration is hidden without policy.read and shown with it", () => {
  const idsFor = (permissions: string[]) =>
    navForPermissions(PRIMARY_NAV, permissions).map((item) => item.id);

  assert.equal(idsFor([]).includes("administration"), false);
  assert.equal(idsFor(["case.read", "notice.read"]).includes("administration"), false);
  assert.equal(idsFor(["policy.read"]).includes("administration"), true);
});

test("an ungated entry survives every permission set, and order is preserved", () => {
  assert.deepEqual(
    navForPermissions(PRIMARY_NAV, []).map((item) => item.id),
    PRIMARY_NAV.filter((item) => item.requiresPermission === undefined).map(
      (item) => item.id,
    ),
  );
  assert.deepEqual(
    navForPermissions(PRIMARY_NAV, ["dashboard.read", "policy.read", "user.read"]).map(
      (item) => item.id,
    ),
    PRIMARY_NAV.map((item) => item.id),
  );
});

/* The two admin entries are gated apart on purpose: a single grouped entry
   would have to pick one permission and hide the other screen from whoever
   holds only the code it did not pick. */
/* The dashboard is gated too, and on a code the Field Surveyor is not seeded
   with: an entry that always refuses is worse than an absent one. */
test("Dashboard is hidden without dashboard.read and shown with it", () => {
  const idsFor = (permissions: string[]) =>
    navForPermissions(PRIMARY_NAV, permissions).map((item) => item.id);

  assert.equal(idsFor([]).includes("dashboard"), false);
  assert.equal(idsFor(["case.read", "notice.read"]).includes("dashboard"), false);
  assert.equal(idsFor(["dashboard.read"]).includes("dashboard"), true);
  assert.equal(idsFor(["dashboard.read"]).includes("administration"), false);
});

test("Officers is gated on user.read, independently of policy.read", () => {
  const idsFor = (permissions: string[]) =>
    navForPermissions(PRIMARY_NAV, permissions).map((item) => item.id);

  assert.equal(idsFor([]).includes("users"), false);
  assert.equal(idsFor(["policy.read"]).includes("users"), false);
  assert.equal(idsFor(["user.read"]).includes("users"), true);
  assert.equal(idsFor(["user.read"]).includes("administration"), false);
});
