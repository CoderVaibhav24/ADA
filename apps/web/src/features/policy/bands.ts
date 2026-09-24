import type { PolicyPermission } from "@/api/icms/policy";

export type Band = "screens" | "workflow" | "data";

export const BANDS: readonly Band[] = ["screens", "workflow", "data"];

// The permission codes that gate a workflow step rather than a screen or a data read/write.
const WORKFLOW_CODES: ReadonlySet<string> = new Set([
  "case.raise",
  "case.assign",
  "case.reassign",
  "case.reject",
  "case.amend",
  "case.hand_over",
  "case.confirm",
  "case.close",
  "evidence.write",
  "inspection.open_round",
  "inspection.check_in",
  "inspection.record_findings",
  "inspection.submit",
  "inspection.verify",
  "inspection.request_resurvey",
  "notice.issue",
]);

// Derives the band from the code alone, so a new permission lands somewhere without a table edit.
export function bandOf(permission: Pick<PolicyPermission, "permission_cd" | "action">): Band {
  if (permission.action === "access") return "screens";
  if (WORKFLOW_CODES.has(permission.permission_cd)) return "workflow";
  return "data";
}

// Stable partition by band, keeping the API's order inside each band.
export function partitionByBand<T extends Pick<PolicyPermission, "permission_cd" | "action">>(
  permissions: readonly T[],
): { band: Band; items: T[] }[] {
  return BANDS.map((band) => ({
    band,
    items: permissions.filter((permission) => bandOf(permission) === band),
  })).filter((group) => group.items.length > 0);
}

export type ScreenGroup<T> = { screen: string | null; access: T | null; actions: T[] };

// Groups by the server's `screen_cd`: the screen's `*.access` code, then its actions.
// Screens follow `screenOrder` (the rail); unknown screens after, shared (null) last.
export function groupByScreen<
  T extends Pick<PolicyPermission, "permission_cd" | "action" | "screen_cd">,
>(permissions: readonly T[], screenOrder: readonly string[]): ScreenGroup<T>[] {
  const groups = new Map<string | null, ScreenGroup<T>>();
  for (const permission of permissions) {
    const screen = permission.screen_cd ?? null;
    const group = groups.get(screen) ?? { screen, access: null, actions: [] };
    if (permission.action === "access" && screen !== null) group.access = permission;
    else group.actions.push(permission);
    groups.set(screen, group);
  }
  const rank = (screen: string | null): number => {
    if (screen === null) return Number.MAX_SAFE_INTEGER;
    const index = screenOrder.indexOf(screen);
    return index === -1 ? screenOrder.length : index;
  };
  return [...groups.values()].sort((a, b) => rank(a.screen) - rank(b.screen));
}
