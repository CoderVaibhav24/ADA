import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useStoreApi,
  type AriaLabelConfig,
  type ColorMode,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type FlowSelection = { kind: "node" | "edge"; id: string } | null;

// React Flow's own variables, pointed at the app's theme tokens so both themes follow.
const THEME = {
  "--xy-background-color": "var(--surface-sunken)",
  "--xy-background-pattern-color": "var(--border-base)",
  "--xy-edge-stroke": "var(--text-faint)",
  "--xy-edge-stroke-selected": "var(--accent-solid)",
  "--xy-edge-label-color": "var(--text-base-c)",
  "--xy-edge-label-background-color": "var(--surface-1)",
  "--xy-node-color": "var(--text-strong)",
  "--xy-node-background-color": "var(--surface-2)",
  "--xy-node-border": "1px solid var(--border-base)",
  "--xy-controls-button-background-color": "var(--surface-2)",
  "--xy-controls-button-background-color-hover": "var(--surface-3)",
  "--xy-controls-button-color": "var(--text-base-c)",
  "--xy-controls-button-color-hover": "var(--text-strong)",
  "--xy-controls-button-border-color": "var(--border-subtle)",
  "--xy-controls-box-shadow": "none",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;

function withSelection<T extends Node | Edge>(
  items: T[],
  previous: T[],
  kind: "node" | "edge",
  selection: FlowSelection,
): T[] {
  const measured = new Map(previous.map((item) => [item.id, (item as Node).measured]));
  return items.map((item) => {
    const size = kind === "node" ? measured.get(item.id) : undefined;
    return {
      ...item,
      ...(size ? { measured: size } : {}),
      selected: selection?.kind === kind && selection.id === item.id,
    };
  });
}

const PAD = 24;

// Fits the graph on `fitKey` change; below `minZoom` it keeps text legible and shows the start (top/left) instead.
function AutoFit({ fitKey, minZoom }: { fitKey: string; minZoom: number }) {
  const { getNodes, getNodesBounds, setViewport } = useReactFlow();
  const store = useStoreApi();
  const ready = useNodesInitialized();
  useEffect(() => {
    if (!ready) return;
    const { width, height } = store.getState();
    const bounds = getNodesBounds(getNodes());
    if (!width || !height || !bounds.width || !bounds.height) return;
    const fit = Math.min((width - PAD * 2) / bounds.width, (height - PAD * 2) / bounds.height);
    const zoom = Math.min(1, Math.max(minZoom, fit));
    const place = (view: number, size: number, start: number) =>
      size * zoom <= view - PAD * 2 ? (view - size * zoom) / 2 - start * zoom : PAD - start * zoom;
    void setViewport(
      { x: place(width, bounds.width, bounds.x), y: place(height, bounds.height, bounds.y), zoom },
      { duration: 200 },
    );
  }, [ready, fitKey, minZoom, getNodes, getNodesBounds, setViewport, store]);
  return null;
}

// A read-only, themed React Flow canvas with one controlled selection.
export default function FlowCanvas<N extends Node, E extends Edge>({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  ariaLabel,
  ariaLabelConfig,
  selection,
  onSelectionChange,
  fitKey = "",
  minFitZoom = 0.7,
  className,
}: {
  nodes: N[];
  edges: E[];
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
  ariaLabel: string;
  ariaLabelConfig?: Partial<AriaLabelConfig>;
  selection: FlowSelection;
  onSelectionChange: (next: FlowSelection) => void;
  fitKey?: string;
  /** Below this zoom the initial fit stops shrinking and the user pans instead. */
  minFitZoom?: number;
  className?: string;
}) {
  // React Flow's own .light/.dark class also switches the app's theme tokens, so it must match the scope it sits in.
  const box = useRef<HTMLDivElement>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("dark");
  useEffect(() => {
    if (box.current?.closest('[data-theme="light"], .light')) setColorMode("light");
  }, []);

  const [source, setSource] = useState({ nodes, edges, selection });
  const [flowNodes, setFlowNodes] = useState(() => withSelection(nodes, [], "node", selection));
  const [flowEdges, setFlowEdges] = useState(() => withSelection(edges, [], "edge", selection));

  // Re-derive during render when the inputs move, keeping measured sizes.
  if (source.nodes !== nodes || source.edges !== edges || source.selection !== selection) {
    setSource({ nodes, edges, selection });
    setFlowNodes((current) => withSelection(nodes, current, "node", selection));
    setFlowEdges((current) => withSelection(edges, current, "edge", selection));
  }

  const onNodesChange = (changes: NodeChange<N>[]) => {
    setFlowNodes((current) => applyNodeChanges(changes, current));
    const picked = changes.find((change) => change.type === "select" && change.selected);
    if (picked?.type === "select") onSelectionChange({ kind: "node", id: picked.id });
  };

  const onEdgesChange = (changes: EdgeChange<E>[]) => {
    setFlowEdges((current) => applyEdgeChanges(changes, current));
    const picked = changes.find((change) => change.type === "select" && change.selected);
    if (picked?.type === "select") onSelectionChange({ kind: "edge", id: picked.id });
  };

  return (
    <div
      ref={box}
      className={cn(
        "h-[440px] w-full min-w-0 overflow-hidden rounded-md border border-line-subtle sm:h-[500px]",
        "[&_.react-flow\\_\\_node:focus-visible]:rounded-md [&_.react-flow\\_\\_node:focus-visible]:ring-2 [&_.react-flow\\_\\_node:focus-visible]:ring-ring",
        className,
      )}
    >
      <ReactFlow<N, E>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneClick={() => {
          onSelectionChange(null);
        }}
        aria-label={ariaLabel}
        ariaLabelConfig={ariaLabelConfig}
        style={THEME}
        colorMode={colorMode}
        minZoom={0.2}
        maxZoom={1.75}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        deleteKeyCode={null}
        zoomOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
        <AutoFit fitKey={fitKey} minZoom={minFitZoom} />
      </ReactFlow>
    </div>
  );
}
