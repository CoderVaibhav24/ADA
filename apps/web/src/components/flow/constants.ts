import { MarkerType } from "@xyflow/react";

/** Handle ids a FlowEdge can attach to: the layout flow, and a side lane for back-edges. */
export const HANDLE = { in: "in", out: "out", backIn: "back-in", backOut: "back-out" } as const;

/** The arrowhead every FlowEdge wants; set as `markerEnd` when building edges. */
export const FLOW_MARKER = { type: MarkerType.ArrowClosed, width: 16, height: 16 } as const;
