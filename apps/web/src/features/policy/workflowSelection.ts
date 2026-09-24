import type { PolicyTransition } from "@/api/icms/policy";
import type { FlowSelection } from "@/components/flow/FlowCanvas";

/** The chart node standing in for `source_status: null` — a case that does not exist yet. */
export const START = "__start__";

export function edgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

export function sourceOf(row: PolicyTransition): string {
  return row.source_status ?? START;
}

export function asStatus(id: string): string | null {
  return id === START ? null : id;
}

// Whether a transition row belongs to the chart's current selection.
export function inSelection(row: PolicyTransition, selection: FlowSelection): boolean {
  if (!selection) return true;
  const source = sourceOf(row);
  if (selection.kind === "edge") return edgeId(source, row.target_status) === selection.id;
  return source === selection.id || row.target_status === selection.id;
}
