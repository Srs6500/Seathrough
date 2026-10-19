"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge } from "@/lib/data-flow/types";
import type { ArchViewNode, NodeHealth } from "@/lib/frontend-arch/viewModel";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

const HEALTH_BORDER: Record<NodeHealth, string> = {
  healthy: "#86efac",
  warning: "#fcd34d",
  error: "#fca5a5",
};

const HEALTH_BG: Record<NodeHealth, string> = {
  healthy: "#f0fdf4",
  warning: "#fffbeb",
  error: "#fef2f2",
};

function HealthIcon({ health }: { health: NodeHealth }) {
  if (health === "error") {
    return <XCircle className="size-4 shrink-0 text-red-600" />;
  }
  if (health === "warning") {
    return <AlertTriangle className="size-4 shrink-0 text-amber-600" />;
  }
  return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />;
}

function ArchNode({ data }: NodeProps) {
  const d = data as ArchViewNode & { kind: string };
  return (
    <div
      className="min-w-[200px] max-w-[240px] rounded-xl border-2 bg-white px-3.5 py-3 shadow-sm"
      style={{
        borderColor: HEALTH_BORDER[d.health],
        background: HEALTH_BG[d.health],
      }}
    >
      {/* Invisible multi-handles so edges leave/land at different heights */}
      <Handle
        id="t-top"
        type="target"
        position={Position.Left}
        style={{ top: "28%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="t-mid"
        type="target"
        position={Position.Left}
        style={{ top: "50%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="t-bot"
        type="target"
        position={Position.Left}
        style={{ top: "72%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
      />
      <div className="flex items-start gap-2">
        <HealthIcon health={d.health} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#0f172a]">
            {d.title.replace(/^Page\s+/i, "").replace(/^API\s+/i, "")}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-[#64748b]">
            {d.shortPath}
          </p>
          {d.issueLabel ? (
            <p
              className={`mt-1.5 text-[11px] font-medium leading-snug ${
                d.health === "error"
                  ? "text-red-700"
                  : d.health === "warning"
                    ? "text-amber-800"
                    : "text-emerald-800"
              }`}
            >
              {d.issueLabel}
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] font-medium text-emerald-700">
              Healthy
            </p>
          )}
        </div>
      </div>
      <Handle
        id="s-top"
        type="source"
        position={Position.Right}
        style={{ top: "28%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="s-mid"
        type="source"
        position={Position.Right}
        style={{ top: "50%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="s-bot"
        type="source"
        position={Position.Right}
        style={{ top: "72%" }}
        className="!h-1.5 !w-1.5 !border-0 !bg-transparent !opacity-0"
      />
    </div>
  );
}

const nodeTypes = { archNode: ArchNode };

const COL_GAP_X = 320;
const ROW_GAP_Y = 118;

function layerOf(n: ArchViewNode): number {
  if (n.kind === "page") return 0;
  if (n.kind === "component") return 1;
  return 2;
}

/**
 * Order nodes within each layer to reduce edge crossings (barycenter heuristic).
 * Left column stays health/title sorted; later columns follow average neighbor rank.
 */
function orderLayers(
  nodes: ArchViewNode[],
  edges: FlowEdge[],
): ArchViewNode[][] {
  const buckets: ArchViewNode[][] = [[], [], []];
  for (const n of nodes) buckets[layerOf(n)]!.push(n);

  const healthRank = { error: 0, warning: 1, healthy: 2 } as const;
  buckets[0]!.sort((a, c) => {
    const d = healthRank[a.health] - healthRank[c.health];
    return d !== 0 ? d : a.title.localeCompare(c.title);
  });

  const idToLayer = new Map(nodes.map((n) => [n.id, layerOf(n)]));
  const forward = edges.filter((e) => {
    const a = idToLayer.get(e.from);
    const b = idToLayer.get(e.to);
    return a != null && b != null && a < b;
  });

  for (let col = 1; col < 3; col++) {
    const prevIndex = new Map(
      buckets[col - 1]!.map((n, i) => [n.id, i] as const),
    );
    const score = new Map<string, number>();
    for (const n of buckets[col]!) {
      const preds = forward
        .filter((e) => e.to === n.id && prevIndex.has(e.from))
        .map((e) => prevIndex.get(e.from)!);
      if (preds.length === 0) {
        score.set(n.id, 1_000 + healthRank[n.health]);
      } else {
        score.set(n.id, preds.reduce((s, v) => s + v, 0) / preds.length);
      }
    }
    buckets[col]!.sort((a, c) => {
      const d = (score.get(a.id) ?? 0) - (score.get(c.id) ?? 0);
      if (Math.abs(d) > 0.01) return d;
      const h = healthRank[a.health] - healthRank[c.health];
      return h !== 0 ? h : a.title.localeCompare(c.title);
    });
  }

  return buckets;
}

/** Left-to-right layered layout: page → components → apis/libs */
function layoutLayered(nodes: ArchViewNode[], edges: FlowEdge[]): Node[] {
  const buckets = orderLayers(nodes, edges);
  const tallest = Math.max(...buckets.map((b) => b.length), 1);
  const out: Node[] = [];
  buckets.forEach((bucket, col) => {
    const offsetY =
      ((tallest - bucket.length) * ROW_GAP_Y) / 2;
    bucket.forEach((n, row) => {
      out.push({
        id: n.id,
        type: "archNode",
        position: {
          x: col * COL_GAP_X,
          y: offsetY + row * ROW_GAP_Y,
        },
        data: n,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });
  });
  return out;
}

const HANDLE_SLOTS = ["top", "mid", "bot"] as const;

function slotForIndex(i: number, total: number): (typeof HANDLE_SLOTS)[number] {
  if (total <= 1) return "mid";
  if (total === 2) return i === 0 ? "top" : "bot";
  const t = i / (total - 1);
  if (t < 0.34) return "top";
  if (t > 0.66) return "bot";
  return "mid";
}

function toEdges(flowEdges: FlowEdge[], nodes: ArchViewNode[]): Edge[] {
  const nodeOrder = new Map(
    orderLayers(nodes, flowEdges)
      .flat()
      .map((n, i) => [n.id, i] as const),
  );

  // Fan-outs from the same source: sort by target vertical order, then slot handles
  const bySource = new Map<string, FlowEdge[]>();
  for (const e of flowEdges) {
    const list = bySource.get(e.from) ?? [];
    list.push(e);
    bySource.set(e.from, list);
  }
  for (const list of bySource.values()) {
    list.sort(
      (a, b) => (nodeOrder.get(a.to) ?? 0) - (nodeOrder.get(b.to) ?? 0),
    );
  }

  const byTarget = new Map<string, FlowEdge[]>();
  for (const e of flowEdges) {
    const list = byTarget.get(e.to) ?? [];
    list.push(e);
    byTarget.set(e.to, list);
  }
  for (const list of byTarget.values()) {
    list.sort(
      (a, b) => (nodeOrder.get(a.from) ?? 0) - (nodeOrder.get(b.from) ?? 0),
    );
  }

  return flowEdges.map((e) => {
    const outList = bySource.get(e.from) ?? [e];
    const inList = byTarget.get(e.to) ?? [e];
    const outIdx = Math.max(
      0,
      outList.findIndex((s) => s.id === e.id),
    );
    const inIdx = Math.max(
      0,
      inList.findIndex((s) => s.id === e.id),
    );
    const sourceSlot = slotForIndex(outIdx, outList.length);
    const targetSlot = slotForIndex(inIdx, inList.length);

    const guess = e.certainty === "guess";
    const stroke = guess ? "#d97706" : "#94a3b8";

    const label = (e.label || "")
      .replace(/^imports$/i, "")
      .replace(/^calls\s+/i, "→ ")
      .replace(/^links\s+/i, "nav ");

    return {
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: `s-${sourceSlot}`,
      targetHandle: `t-${targetSlot}`,
      type: "smoothstep",
      pathOptions: { borderRadius: 16, offset: 28 },
      label: label || undefined,
      animated: guess,
      style: {
        stroke,
        strokeWidth: guess ? 1.75 : 1.35,
        opacity: guess ? 0.9 : 0.65,
      },
      labelStyle: { fill: "#64748b", fontSize: 10 },
      labelBgStyle: { fill: "#f8fafc", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: stroke,
      },
    } satisfies Edge;
  });
}

type Props = {
  nodes: ArchViewNode[];
  edges: FlowEdge[];
  focusNodeId: string | null;
  onSelectNode: (node: ArchViewNode) => void;
};

function FitButton() {
  const { fitView } = useReactFlow();
  return (
    <button
      type="button"
      onClick={() => void fitView({ padding: 0.2, duration: 200 })}
      className="rounded-md border border-[#e2e8f0] bg-white px-2 py-1 text-[11px] font-medium text-[#475569] shadow-sm hover:bg-[#f8fafc]"
    >
      Fit to screen
    </button>
  );
}

function CanvasInner({ nodes, edges, focusNodeId, onSelectNode }: Props) {
  const initialNodes = useMemo(
    () => layoutLayered(nodes, edges),
    [nodes, edges],
  );
  const initialEdges = useMemo(() => toEdges(edges, nodes), [edges, nodes]);
  const [rfNodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(layoutLayered(nodes, edges));
    setEdges(toEdges(edges, nodes));
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.22, duration: 180 });
    }, 40);
    return () => window.clearTimeout(t);
  }, [nodes, edges, setNodes, setEdges, fitView]);

  useEffect(() => {
    if (!focusNodeId) return;
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        selected: n.id === focusNodeId,
        style:
          n.id === focusNodeId
            ? { outline: "2px solid #6366f1", outlineOffset: 3 }
            : undefined,
      })),
    );
  }, [focusNodeId, setNodes]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <div className="pointer-events-auto">
          <FitButton />
        </div>
      </div>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: "smoothstep",
          pathOptions: { borderRadius: 16, offset: 28 },
        }}
        fitView
        minZoom={0.25}
        maxZoom={1.4}
        nodesDraggable
        edgesFocusable
        onNodeClick={(_, node) => {
          const n = byId.get(node.id);
          if (n) onSelectNode(n);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}

export function FrontendArchCanvas(props: Props) {
  return (
    <div className="h-full min-h-[360px] w-full">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
