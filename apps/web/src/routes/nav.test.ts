import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  PRIMARY_NAV,
  activeNavId,
  homePathFor,
  isBleedPath,
  isNavLink,
  navForPermissions,
} from "./nav.ts";
import { ROUTES } from "./paths.ts";

// Run with: npm run test -w @ada/web
// nav.ts imports only paths.ts at runtime, so Node's type stripping is enough —
// no bundler, no React, no DOM.

// Figma 17:3980's entries, plus the two administration entries — which the frame
// does not draw. Logout has moved to the account menu, so it is not in the rail.
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

test("logout is not a rail entry; it lives in the account menu", () => {
  assert.equal(
    PRIMARY_NAV.some((item) => (item.id as string) === "logout"),
    false,
  );
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

const ACCESS_CODES = [
  "dashboard.access",
  "change_detection.access",
  "complaint_create.access",
  "complaints.access",
  "inspections.access",
  "notices.access",
  "reports.access",
  "administration.access",
  "officers.access",
];

const idsFor = (permissions: string[]) =>
  navForPermissions(PRIMARY_NAV, permissions).map((item) => item.id);

test("every rail entry is gated on its screen's *.access code", () => {
  assert.deepEqual(
    PRIMARY_NAV.map((item) => item.requiresPermission),
    ACCESS_CODES,
  );
});

/* The reason navForPermissions exists: its predecessor took a `roles` argument
   and returned the list unchanged, so a rail entry that looked gated was not. */
test("with no permissions the rail is empty; with all of them it is whole and in order", () => {
  assert.deepEqual(idsFor([]), []);
  assert.deepEqual(idsFor(ACCESS_CODES), PRIMARY_NAV.map((item) => item.id));
});

test("a read code alone opens no screen", () => {
  assert.deepEqual(
    idsFor(["case.read", "notice.read", "dashboard.read", "policy.read", "user.read"]),
    [],
  );
});

test("Administration is hidden without administration.access and shown with it", () => {
  assert.equal(idsFor(["policy.read"]).includes("administration"), false);
  assert.equal(idsFor(["administration.access"]).includes("administration"), true);
});

/* The two admin entries are gated apart on purpose: a single grouped entry
   would have to pick one permission and hide the other screen from whoever
   holds only the code it did not pick. */
test("Officers is gated on officers.access, independently of administration.access", () => {
  assert.equal(idsFor(["administration.access"]).includes("users"), false);
  assert.equal(idsFor(["officers.access"]).includes("users"), true);
  assert.equal(idsFor(["officers.access"]).includes("administration"), false);
});

/* The seed does not grant the Field Surveyor dashboard.access or reports.access. */
test("the surveyor's seeded codes draw no Dashboard, Reports or admin entries", () => {
  const surveyor = [
    "change_detection.access",
    "complaint_create.access",
    "complaints.access",
    "inspections.access",
    "notices.access",
  ];
  assert.deepEqual(idsFor(surveyor), [
    "changeDetection",
    "complaintNew",
    "complaints",
    "inspections",
    "notices",
  ]);
});

test("home is the Dashboard when dashboard.access is held", () => {
  assert.equal(homePathFor(ACCESS_CODES), ROUTES.dashboard);
  assert.equal(homePathFor(["dashboard.access", "complaints.access"]), ROUTES.dashboard);
});

test("home falls back to the first rail entry the officer may open", () => {
  assert.equal(homePathFor(["reports.access", "notices.access"]), ROUTES.notices);
  assert.equal(homePathFor(["officers.access"]), ROUTES.administrationUsers);
  assert.equal(homePathFor(["complaints.access"]), ROUTES.complaints);
});

test("home is null when no screen is open, e.g. the public role", () => {
  assert.equal(homePathFor([]), null);
  assert.equal(homePathFor(["case.raise"]), null);
});
