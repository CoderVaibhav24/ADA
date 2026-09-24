import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useStoreApi,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { cn } from "@/lib/utils";

export type FlowEdgeData = {
  title?: string;
  /** Secondary label lines, e.g. the roles allowed to take the step. */
  lines?: string[];
  /** Goes back against the layout direction: drawn dashed, arcing out to the side. */
  back?: boolean;
  /** Source and target are the same node: drawn as a solid loop on the side. */
  loop?: boolean;
  /** Switched off / not in force: faint and dashed. */
  muted?: boolean;
  dimmed?: boolean;
  /** Replaces `lines` in danger tone, e.g. "Nobody". */
  warning?: string;
};

export type FlowLabelledEdge = Edge<FlowEdgeData, "labelled">;

// A cubic arc that leaves and re-enters on the same side, for back-edges and self-loops.
function sideArc(sx: number, sy: number, tx: number, ty: number, side: Position) {
  const horizontal = side === Position.Right || side === Position.Left;
  const sign = side === Position.Left || side === Position.Top ? -1 : 1;
  const span = horizontal ? Math.abs(sy - ty) : Math.abs(sx - tx);
  const off = sign * (48 + span * 0.22);
  const path = horizontal
    ? `M${sx},${sy} C${sx + off},${sy} ${tx + off},${ty} ${tx},${ty}`
    : `M${sx},${sy} C${sx},${sy + off} ${tx},${ty + off} ${tx},${ty}`;
  const labelX = horizontal ? (sx + tx) / 2 + off * 0.75 : (sx + tx) / 2;
  const labelY = horizontal ? (sy + ty) / 2 : (sy + ty) / 2 + off * 0.75;
  // The label starts at the arc's apex and grows away from the node.
  const anchor = horizontal
    ? `translate(${sign > 0 ? "4px" : "calc(-100% - 4px)"}, -50%)`
    : `translate(-50%, ${sign > 0 ? "4px" : "calc(-100% - 4px)"})`;
  return [path, labelX, labelY, anchor] as const;
}

// The forward curve, with its label centred on the midpoint.
function bezier(sx: number, sy: number, tx: number, ty: number, from: Position, to: Position) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition: from,
    targetPosition: to,
  });
  return [path, labelX, labelY, "translate(-50%, -50%)"] as const;
}

// An edge with an HTML label; back-edges arc to the side and are dashed.
export default function FlowEdge({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps<FlowLabelledEdge>) {
  const store = useStoreApi();
  const [path, labelX, labelY, anchor] =
    data?.back || data?.loop
      ? sideArc(sourceX, sourceY, targetX, targetY, sourcePosition)
      : bezier(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition);

  const dashed = data?.back === true || data?.muted === true;
  const hasLabel = Boolean(data?.title || data?.lines?.length || data?.warning);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: dashed ? "6 5" : undefined,
          opacity: data?.dimmed ? 0.25 : data?.muted ? 0.6 : 1,
          stroke: selected ? "var(--accent-solid)" : data?.back ? "var(--text-muted)" : undefined,
        }}
      />
      {hasLabel && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-auto absolute flex max-w-[10rem] cursor-pointer flex-col items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-center text-2xs leading-tight transition-opacity",
              selected
                ? "border-line-accent bg-accent-soft text-fg-strong"
                : "border-line-subtle bg-surface-1 text-fg-base",
              data?.muted && "line-through decoration-fg-faint",
              data?.dimmed && "opacity-30",
            )}
            style={{ transform: `translate(${labelX}px, ${labelY}px) ${anchor}` }}
            onClick={() => {
              store.getState().addSelectedEdges([id]);
            }}
          >
            {data?.title && <span className="text-xs font-semibold text-balance">{data.title}</span>}
            {data?.warning ? (
              <span className="text-status-danger-fg">{data.warning}</span>
            ) : (
              data?.lines?.map((line) => (
                <span key={line} className="max-w-full truncate text-fg-muted" title={line}>
                  {line}
                </span>
              ))
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
