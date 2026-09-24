/**
 * The chart draws a generic tree; adapters turn a payload into one.
 *
 * Today the only adapter is the role ladder: one node per role, parented by
 * `reports_to`. A per-officer reporting line is a second adapter producing the
 * same `OrgTreeNode` shape, and the chart does not change. See
 * docs/icms/ICMS-Access-Control.md §8.
 */

import type { ReportingRole } from "@/api/icms/reporting";

export type OrgTreeNode<T> = {
  id: string;
  label: string;
  /** Null for a root. A parent id absent from the tree is treated as null. */
  parentId: string | null;
  data: T;
};

export type OrgTreeEdge = { id: string; source: string; target: string };

/** How many officers a role box lists before it offers "show all". */
export const MEMBER_PREVIEW = 5;

export function roleNodeId(roleCd: string): string {
  return `role:${roleCd}`;
}

// One node per role, in the server's ladder order, each parented by `reports_to`.
export function roleLadderTree(
  roles: readonly ReportingRole[],
  labelOf: (role: ReportingRole) => string,
): OrgTreeNode<ReportingRole>[] {
  const present = new Set(roles.map((role) => role.role_cd));
  return roles.map((role) => ({
    id: roleNodeId(role.role_cd),
    label: labelOf(role),
    parentId:
      role.reports_to && present.has(role.reports_to) ? roleNodeId(role.reports_to) : null,
    data: role,
  }));
}

// Parent-to-child edges, senior at the source, so a top-down layout reads downwards.
export function treeEdges<T>(tree: readonly OrgTreeNode<T>[]): OrgTreeEdge[] {
  const ids = new Set(tree.map((node) => node.id));
  return tree.flatMap((node) =>
    node.parentId !== null && ids.has(node.parentId) && node.parentId !== node.id
      ? [{ id: `${node.parentId}->${node.id}`, source: node.parentId, target: node.id }]
      : [],
  );
}

/** The members a role box shows: all when expanded, else the first MEMBER_PREVIEW. */
export function visibleCount(total: number, expanded: boolean): number {
  return expanded ? total : Math.min(total, MEMBER_PREVIEW);
}
