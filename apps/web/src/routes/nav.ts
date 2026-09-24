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
 * permissions: `administration.access` and `officers.access`. A grouped entry has to be gated
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
  | "users";
  // | "logout";

type NavBase = {
  id: NavId;
  icon: IconKey;
  /** Figma rules a line above Logout, separating navigation from the session. */
  separatorBefore?: boolean;
  /**
   * The screen's `*.access` code from `GET /api/icms/me/capabilities`. Every
   * entry has one; `RequirePermission` checks the same code on the route.
   *
   * Advisory, like everything built from capabilities: hiding the entry hides a
   * door, it does not lock one — ada-api refuses the request underneath either
   * way. The literals mirror the `*_ACCESS` constants in `@/api/icms/*`; they are
   * not imported from there because nav.test.ts runs this module under Node's
   * type stripping, and that import chain reaches `fetch` and oidc.
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
    requiresPermission: "dashboard.access",
  },
  {
    kind: "link",
    id: "changeDetection",
    path: ROUTES.changeDetection,
    icon: "nav.changeDetection",
    requiresPermission: "change_detection.access",
  },
  {
    kind: "link",
    id: "complaintNew",
    path: ROUTES.complaintNew,
    icon: "nav.createComplaint",
    requiresPermission: "complaint_create.access",
  },
  {
    kind: "link",
    id: "complaints",
    path: ROUTES.complaints,
    icon: "nav.complaints",
    requiresPermission: "complaints.access",
  },
  {
    kind: "link",
    id: "inspections",
    path: ROUTES.inspections,
    icon: "nav.inspection",
    requiresPermission: "inspections.access",
  },
  {
    kind: "link",
    id: "notices",
    path: ROUTES.notices,
    icon: "nav.notice",
    requiresPermission: "notices.access",
  },
  {
    kind: "link",
    id: "reports",
    path: ROUTES.reports,
    icon: "nav.report",
    requiresPermission: "reports.access",
  },
  {
    kind: "link",
    id: "administration",
    path: ROUTES.administration,
    icon: "user.role",
    requiresPermission: "administration.access",
  },
  {
    kind: "link",
    id: "users",
    path: ROUTES.administrationUsers,
    icon: "user.group",
    requiresPermission: "officers.access",
  },
  // {
  //   kind: "action",
  //   id: "logout",
  //   action: "logout",
  //   icon: "nav.logout",
  //   separatorBefore: true,
  // },
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
 * `permissions` is `GET /me/capabilities` -> `permissions`. Every rail entry is
 * gated, so an empty array (capabilities loading or refused) yields an empty
 * rail; the layout draws a loading state for the first case.
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

// Where "/" lands after sign-in: the Dashboard when the officer may open it, else their first rail entry, else null.
export function homePathFor(permissions: readonly string[]): string | null {
  const dashboard = PRIMARY_NAV.find((item) => item.id === "dashboard");
  if (dashboard?.requiresPermission && permissions.includes(dashboard.requiresPermission)) {
    return ROUTES.dashboard;
  }
  const first = navForPermissions(PRIMARY_NAV, permissions).find(isNavLink);
  return first?.path ?? null;
}

export function isBleedPath(pathname: string): boolean {
  return (
    pathname === ROUTES.changeDetection ||
    pathname.startsWith(`${ROUTES.changeDetection}/`)
  );
}
