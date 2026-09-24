import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { HANDLE } from "./constants";

export type FlowNodeTone = "default" | "start" | "end" | "danger";

export type FlowNodeData = {
  title: string;
  subtitle?: string;
  /** A short marker shown above the title, e.g. "Start". */
  tag?: string;
  tone?: FlowNodeTone;
  dimmed?: boolean;
};

export type FlowBoxNode = Node<FlowNodeData, "box">;

const TONES: Record<FlowNodeTone, string> = {
  default: "border-line bg-surface-2 text-fg-strong",
  start: "rounded-full border-line-accent bg-accent-soft text-fg-strong",
  end: "border-2 border-double border-line-strong bg-surface-1 text-fg-strong",
  danger:
    "border-2 border-double border-status-danger-border bg-status-danger text-status-danger-fg",
};

const HIDDEN = "!pointer-events-none !size-1 !min-w-0 !border-0 !bg-transparent";

function sideOf(flow: Position): Position {
  return flow === Position.Bottom || flow === Position.Top ? Position.Right : Position.Bottom;
}

// A status or person box sized by the layout; tone marks start and end states.
export default function FlowNode({
  data,
  selected,
  width,
  height,
  sourcePosition,
  targetPosition,
}: NodeProps<FlowBoxNode>) {
  const side = sideOf(sourcePosition ?? Position.Bottom);
  const along = side === Position.Right ? "top" : "left";
  return (
    <div
      style={{ width, height }}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-md border px-3 text-center transition-opacity",
        TONES[data.tone ?? "default"],
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-surface-sunken",
        data.dimmed && "opacity-35",
      )}
    >
      <Handle
        id={HANDLE.in}
        type="target"
        position={targetPosition ?? Position.Top}
        isConnectable={false}
        className={HIDDEN}
      />
      <Handle
        id={HANDLE.backIn}
        type="target"
        position={side}
        isConnectable={false}
        className={HIDDEN}
        style={{ [along]: "35%" }}
      />
      {data.tag && (
        <span className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">
          {data.tag}
        </span>
      )}
      <span className="line-clamp-2 text-sm leading-tight font-semibold text-balance">
        {data.title}
      </span>
      {data.subtitle && <span className="max-w-full truncate text-2xs text-fg-muted">{data.subtitle}</span>}
      <Handle
        id={HANDLE.out}
        type="source"
        position={sourcePosition ?? Position.Bottom}
        isConnectable={false}
        className={HIDDEN}
      />
      <Handle
        id={HANDLE.backOut}
        type="source"
        position={side}
        isConnectable={false}
        className={HIDDEN}
        style={{ [along]: "65%" }}
      />
    </div>
  );
}
