import dagre from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";

export type LayoutDirection = "TB" | "LR";

export interface LayoutOptions {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
  /** Space reserved for each edge's label, so labels do not land on nodes. 0 reserves none. */
  labelWidth?: number;
  labelHeight?: number;
}

// Positions nodes with dagre; a node's own width/height overrides the defaults.
export function layoutGraph<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  opts: LayoutOptions = {},
): N[] {
  const {
    direction = "TB",
    nodeWidth = 180,
    nodeHeight = 56,
    rankSep = 70,
    nodeSep = 40,
    labelWidth = 0,
    labelHeight = 0,
  } = opts;
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  const size = (n: N) => ({
    width: n.width ?? n.measured?.width ?? nodeWidth,
    height: n.height ?? n.measured?.height ?? nodeHeight,
  });
  for (const n of nodes) g.setNode(n.id, size(n));
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      g.setEdge(e.source, e.target, { width: labelWidth, height: labelHeight, labelpos: "c" }, e.id);
    }
  }
  dagre.layout(g);

  const horizontal = direction === "LR";
  return nodes.map((n) => {
    const p = g.node(n.id);
    const { width, height } = size(n);
    return {
      ...n,
      targetPosition: horizontal ? Position.Left : Position.Top,
      sourcePosition: horizontal ? Position.Right : Position.Bottom,
      position: { x: p.x - width / 2, y: p.y - height / 2 },
    };
  });
}
