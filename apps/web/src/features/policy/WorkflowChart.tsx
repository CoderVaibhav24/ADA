import { useMemo, useState } from "react";
import { CASE_STATUSES } from "@/api/icms/cases";
import type { PolicyTransition } from "@/api/icms/policy";
import FlowCanvas, { type FlowSelection } from "@/components/flow/FlowCanvas";
import { FLOW_MARKER, HANDLE } from "@/components/flow/constants";
import FlowEdge, { type FlowLabelledEdge } from "@/components/flow/FlowEdge";
import FlowNode, { type FlowBoxNode, type FlowNodeTone } from "@/components/flow/FlowNode";
import { layoutGraph, type LayoutDirection } from "@/components/flow/layout";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PolicyLabels } from "@/i18n/labels";
import { Icon } from "@/lib/icons";
import { useIsNarrow } from "@/lib/useMediaQuery";
import { START, asStatus, edgeId, sourceOf } from "./workflowSelection";

const NODE_TYPES = { box: FlowNode };
const EDGE_TYPES = { labelled: FlowEdge };
/** Terminal statuses that mean the case was turned away rather than completed. */
const DANGER_ENDS = new Set<string>(["rejected"]);

function statusOrder(status: string): number {
  if (status === START) return -1;
  const index = (CASE_STATUSES as readonly string[]).indexOf(status);
  return index === -1 ? CASE_STATUSES.length : index;
}

// The live workflow as a flowchart: statuses as boxes, steps as arrows labelled with the roles that may take them.
export default function WorkflowChart({
  rows,
  labels,
  roleLabel,
  statusLabel,
  selection,
  onSelectionChange,
}: {
  rows: readonly PolicyTransition[];
  labels: PolicyLabels;
  roleLabel: (roleCd: string) => string;
  statusLabel: (value: string | null) => string;
  selection: FlowSelection;
  onSelectionChange: (next: FlowSelection) => void;
}) {
  const text = labels.transitions.flowchart;
  const narrow = useIsNarrow();
  const [picked, setPicked] = useState<LayoutDirection | null>(null);
  const direction: LayoutDirection = picked ?? (narrow ? "TB" : "LR");

  const graph = useMemo(() => {
    const groups = new Map<string, PolicyTransition[]>();
    const outgoing = new Map<string, number>();
    const incoming = new Map<string, number>();
    for (const row of rows) {
      const source = sourceOf(row);
      const id = edgeId(source, row.target_status);
      groups.set(id, [...(groups.get(id) ?? []), row]);
      outgoing.set(source, outgoing.get(source) ?? 0);
      incoming.set(row.target_status, incoming.get(row.target_status) ?? 0);
      if (row.active && source !== row.target_status) {
        outgoing.set(source, (outgoing.get(source) ?? 0) + 1);
        incoming.set(row.target_status, (incoming.get(row.target_status) ?? 0) + 1);
      }
    }
    const statuses = [...new Set([...outgoing.keys(), ...incoming.keys()])].sort(
      (a, b) => statusOrder(a) - statusOrder(b),
    );
    const hasStart = statuses.includes(START);

    const nodes: FlowBoxNode[] = statuses.map((status) => {
      const out = outgoing.get(status) ?? 0;
      const into = incoming.get(status) ?? 0;
      const isStart = status === START || (!hasStart && into === 0);
      const isEnd = !isStart && out === 0;
      let tone: FlowNodeTone = "default";
      if (isStart) tone = "start";
      else if (isEnd) tone = DANGER_ENDS.has(status) ? "danger" : "end";
      const title = statusLabel(asStatus(status));
      return {
        id: status,
        type: "box",
        position: { x: 0, y: 0 },
        width: 164,
        height: 60,
        data: { title, tone, tag: isStart ? text.start : isEnd ? text.end : undefined },
        ariaLabel: text.nodeAria(title, out, into),
      };
    });

    const edges: FlowLabelledEdge[] = [...groups.entries()].map(([id, items]) => {
      const source = sourceOf(items[0]);
      const target = items[0].target_status;
      const live = items.filter((row) => row.active);
      const roles = [...new Set(live.flatMap((row) => row.roles))].map(roleLabel);
      const title = items.map((row) => labels.actionName(row.action_cd)).join(" · ");
      return {
        id,
        source,
        target,
        type: "labelled",
        markerEnd: FLOW_MARKER,
        data: {
          title,
          lines: roles,
          loop: source === target,
          muted: live.length === 0,
          warning: live.length > 0 && roles.length === 0 ? text.nobody : undefined,
        },
        ariaLabel: text.edgeAria(
          title,
          statusLabel(asStatus(source)),
          statusLabel(target),
          roles.length > 0 ? roles.join(", ") : text.nobody,
        ),
      };
    });

    const horizontal = direction === "LR";
    const placed = layoutGraph(nodes, edges, {
      direction,
      rankSep: horizontal ? 40 : 30,
      nodeSep: horizontal ? 40 : 50,
      labelWidth: 160,
      labelHeight: horizontal ? 64 : 84,
    });
    const at = new Map(placed.map((node) => [node.id, node.position]));
    const along = (id: string) => (horizontal ? at.get(id)?.x : at.get(id)?.y) ?? 0;
    // A back-edge points against the layout; it and self-loops take the side lane.
    const routed = edges.map((edge) => {
      const back = edge.source !== edge.target && along(edge.target) < along(edge.source);
      const side = back || edge.source === edge.target;
      return {
        ...edge,
        sourceHandle: side ? HANDLE.backOut : HANDLE.out,
        targetHandle: side ? HANDLE.backIn : HANDLE.in,
        data: { ...edge.data, back },
      };
    });
    return { nodes: placed, edges: routed };
  }, [rows, direction, labels, roleLabel, statusLabel, text]);

  // Dims what the selection does not touch, without re-running the layout.
  const view = useMemo(() => {
    if (!selection) return graph;
    const lit = new Set<string>([selection.id]);
    const edges = graph.edges.map((edge) => {
      const on =
        selection.kind === "edge"
          ? edge.id === selection.id
          : edge.source === selection.id || edge.target === selection.id;
      if (on) {
        lit.add(edge.source);
        lit.add(edge.target);
      }
      return { ...edge, data: { ...edge.data, dimmed: !on } };
    });
    const nodes = graph.nodes.map((node) => ({
      ...node,
      data: { ...node.data, dimmed: !lit.has(node.id) },
    }));
    return { nodes, edges };
  }, [graph, selection]);

  const statusCount = graph.nodes.filter((node) => node.id !== START).length;

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="workflow-chart-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id="workflow-chart-title" className="text-sm font-semibold text-fg-strong">
            {text.title}
          </h3>
          <p className="mt-1 max-w-prose text-2xs text-fg-faint text-pretty">{text.hint}</p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={direction}
          aria-label={text.layoutLabel}
          onValueChange={(next) => {
            if (next === "TB" || next === "LR") setPicked(next);
          }}
        >
          <ToggleGroupItem value="TB" className="px-2.5 text-2xs">
            {text.layoutVertical}
          </ToggleGroupItem>
          <ToggleGroupItem value="LR" className="px-2.5 text-2xs">
            {text.layoutHorizontal}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <FlowCanvas
        nodes={view.nodes}
        edges={view.edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        ariaLabel={text.ariaLabel(statusCount, rows.length)}
        ariaLabelConfig={{
          "node.a11yDescription.default": text.nodeHelp,
          "node.a11yDescription.keyboardDisabled": text.nodeHelp,
          "edge.a11yDescription.default": text.edgeHelp,
          "controls.ariaLabel": text.controls,
          "controls.zoomIn.ariaLabel": text.zoomIn,
          "controls.zoomOut.ariaLabel": text.zoomOut,
          "controls.fitView.ariaLabel": text.fitView,
        }}
        selection={selection}
        onSelectionChange={onSelectionChange}
        fitKey={`${direction}:${graph.nodes.length}`}
      />

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted" aria-hidden>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-full border border-line-accent bg-accent-soft" />
          {text.legendStart}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm border-2 border-double border-line-strong bg-surface-1" />
          {text.legendEnd}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-fg-muted" />
          {text.legendBack}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-fg-faint opacity-60" />
          <span className="line-through">{text.legendOff}</span>
        </li>
      </ul>
    </section>
  );
}

// The "showing N steps" strip between the chart and the table, with the way back to all of them.
export function SelectionFilter({
  selection,
  count,
  labels,
  statusLabel,
  onClear,
}: {
  selection: FlowSelection;
  count: number;
  labels: PolicyLabels;
  statusLabel: (value: string | null) => string;
  onClear: () => void;
}) {
  if (!selection) return null;
  const text = labels.transitions.flowchart;
  let message: string;
  if (selection.kind === "edge") {
    const [from, to] = selection.id.split("->");
    message = text.filterEdge(count, statusLabel(asStatus(from)), statusLabel(to));
  } else {
    message = text.filterNode(count, statusLabel(asStatus(selection.id)));
  }
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-accent bg-accent-soft px-3 py-2 text-sm text-fg-strong"
      aria-live="polite"
    >
      <span className="min-w-0 text-pretty">{message}</span>
      <Button variant="outline" size="sm" onClick={onClear}>
        <Icon name="action.close" className="size-4" />
        {text.showAll}
      </Button>
    </div>
  );
}
