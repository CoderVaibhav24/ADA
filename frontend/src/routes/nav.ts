import type { IconKey } from "@/lib/icons";
import type { RealmRole } from "../auth/roles";
import { ROUTES } from "./paths";

export type NavId =
  | "dashboard"
  | "complaints"
  | "inspections"
  | "notices"
  | "changeDetection";

export type NavItem = {
  id: NavId;
  path: string;
  icon: IconKey;
  roles?: readonly RealmRole[];
};

export const PRIMARY_NAV: readonly NavItem[] = [
  { id: "dashboard", path: ROUTES.dashboard, icon: "nav.dashboard" },
  { id: "complaints", path: ROUTES.complaints, icon: "nav.complaints" },
  { id: "inspections", path: ROUTES.inspections, icon: "nav.inspection" },
  { id: "notices", path: ROUTES.notices, icon: "nav.notice" },
  { id: "changeDetection", path: ROUTES.changeDetection, icon: "nav.changeDetection" },
];

export function activeNavId(pathname: string): NavId | null {
  let best: NavItem | null = null;
  for (const item of PRIMARY_NAV) {
    const matches = pathname === item.path || pathname.startsWith(`${item.path}/`);
    if (matches && (!best || item.path.length > best.path.length)) best = item;
  }
  return best?.id ?? null;
}

export function navForRoles(
  items: readonly NavItem[],
  _roles: readonly RealmRole[],
): readonly NavItem[] {
  return items;
}

export function isBleedPath(pathname: string): boolean {
  return (
    pathname === ROUTES.changeDetection ||
    pathname.startsWith(`${ROUTES.changeDetection}/`)
  );
}
