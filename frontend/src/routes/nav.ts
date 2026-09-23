import type { IconKey } from "@/lib/icons";
// `.ts` on purpose: Node strips types to run nav.test.ts, and bare ESM
// specifiers have no extension resolution. Vite and tsc both accept it.
import { ROUTES } from "./paths.ts";

/**
 * The rail, in the order Figma node 17:3980 draws it.
 *
 * The rail is present at EVERY width. What changes across breakpoints is
 * expanded (icon + label) versus collapsed (icon only) — never present versus
 * absent, because a phone user navigating a case register still needs to reach
 * Inspections without opening a menu first.
 *
 * Three deliberate departures from that frame:
 *   - Notifications is NOT here. It sits on the horizontal top bar.
 *   - The user card at the foot of the rail is not built at all.
 *   - **The two administration entries are an ADDITION.** 17:3980 draws eight
 *     entries and no admin item; the policy and the officer screens need a way
 *     in, so they sit after Report and before the rule above Logout.
 *
 * ## Why Administration and Officers are siblings rather than one grouped entry
 *
 * `/administration/users` is a path under `/administration`, so one entry could
 * cover both. They are two anyway, because they are gated on DIFFERENT
 * permissions: `policy.read` and `user.read`. A grouped entry has to be gated
 * on one of them, which either hides Officers from somebody holding `user.read`
 * alone or draws a group whose only child they may not open. Two entries let
 * `navForPermissions` answer each question with the code the server actually
 * enforces for it, and `activeNavId`'s longest-prefix rule — already
 * load-bearing for `/complaints` against `/complaints/new` — lights exactly one.
 */
export type NavId =
  | "dashboard"
  | "changeDetection"
  | "complaintNew"
  | "complaints"
  | "inspections"
  | "notices"
  | "reports"
  | "administration"
  | "users"
  | "logout";

type NavBase = {
  id: NavId;
  icon: IconKey;
  /** Figma rules a line above Logout, separating navigation from the session. */
  separatorBefore?: boolean;
  /**
   * A permission code from `GET /api/icms/me/capabilities`. Absent means every
   * signed-in officer sees the entry.
   *
   * Advisory, like everything built from capabilities: hiding the entry hides a
   * door, it does not lock one — ada-api refuses the request underneath either
   * way. The literal mirrors `POLICY_READ` in `@/api/icms/policy`; it is not
   * imported from there because nav.test.ts runs this module under Node's type
   * stripping, and that import chain reaches `fetch` and oidc.
   */
  requiresPermission?: string;
};

/** A destination. `path` is what `activeNavId` matches the URL against. */
export type NavLink = NavBase & { kind: "link"; path: string };

/**
 * Something that happens instead of somewhere to go. Logout is the only one:
 * giving it a fake path would put a route in the tree that must never resolve.
 */
export type NavAction = NavBase & { kind: "action"; action: "logout" };

export type NavItem = NavLink | NavAction;

export const PRIMARY_NAV: readonly NavItem[] = [
  {
    kind: "link",
    id: "dashboard",
    path: ROUTES.dashboard,
    icon: "nav.dashboard",
    // Mirrors `DASHBOARD_READ` in `@/api/icms/dashboard`, and is a literal here
    // for the same reason `policy.read` below is: nav.test.ts runs this module
    // under Node's type stripping, and that import chain reaches `fetch`.
    //
    // The seed does NOT grant this to the Field Surveyor, so the entry is
    // absent for them today rather than leading to a refusal. That is a policy
    // row an admin can change at runtime, not a fact about the role.
    requiresPermission: "dashboard.read",
  },
  {
    kind: "link",
    id: "changeDetection",
    path: ROUTES.changeDetection,
    icon: "nav.changeDetection",
  },
  {
    kind: "link",
    id: "complaintNew",
    path: ROUTES.complaintNew,
    icon: "nav.createComplaint",
  },
  { kind: "link", id: "complaints", path: ROUTES.complaints, icon: "nav.complaints" },
  { kind: "link", id: "inspections", path: ROUTES.inspections, icon: "nav.inspection" },
  { kind: "link", id: "notices", path: ROUTES.notices, icon: "nav.notice" },
  { kind: "link", id: "reports", path: ROUTES.reports, icon: "nav.report" },
  {
    kind: "link",
    id: "administration",
    path: ROUTES.administration,
    icon: "user.role",
    requiresPermission: "policy.read",
  },
  {
    kind: "link",
    id: "users",
    path: ROUTES.administrationUsers,
    icon: "user.group",
    // Mirrors `USER_READ` in `@/api/icms/users`, and is a literal here for the
    // same reason `policy.read` above is: nav.test.ts runs this module under
    // Node's type stripping, and that import chain reaches `fetch` and oidc.
    requiresPermission: "user.read",
  },
  {
    kind: "action",
    id: "logout",
    action: "logout",
    icon: "nav.logout",
    separatorBefore: true,
  },
];

export function isNavLink(item: NavItem): item is NavLink {
  return item.kind === "link";
}

/**
 * Longest matching prefix wins. That rule is load-bearing now: `/complaints/new`
 * and `/complaints` are both in the rail, and a first-match scan would light up
 * Complaints while the officer is on Create Complaint.
 */
export function activeNavId(pathname: string): NavId | null {
  let best: NavLink | null = null;
  for (const item of PRIMARY_NAV) {
    if (!isNavLink(item)) continue;
    const matches = pathname === item.path || pathname.startsWith(`${item.path}/`);
    if (matches && (!best || item.path.length > best.path.length)) best = item;
  }
  return best?.id ?? null;
}

/**
 * The rail, filtered to what this officer's capabilities admit.
 *
 * This replaces `navForRoles`, which took a `roles` argument and ignored it —
 * a signature that read as a gate and gated nothing. It filters on PERMISSION
 * rather than on role because that is the axis the server decides on: the
 * roles holding `policy.read` are editable from the Role grants screen, so a
 * rail keyed to `super-admin` would go wrong the first time someone uses it.
 *
 * `permissions` is `GET /me/capabilities` -> `permissions`. An entry with no
 * `requiresPermission` always survives, so passing an empty array (capabilities
 * still loading, or the call refused) hides only the gated entries.
 */
export function navForPermissions(
  items: readonly NavItem[],
  permissions: readonly string[],
): readonly NavItem[] {
  return items.filter(
    (item) =>
      item.requiresPermission === undefined ||
      permissions.includes(item.requiresPermission),
  );
}

export function isBleedPath(pathname: string): boolean {
  return (
    pathname === ROUTES.changeDetection ||
    pathname.startsWith(`${ROUTES.changeDetection}/`)
  );
}
