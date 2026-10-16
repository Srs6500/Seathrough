"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Certainty, FlowEdge, FlowNode } from "@/lib/data-flow/types";

const KIND_COLOR: Record<string, string> = {
  page: "#1d4f6e",
  component: "#2f6b4f",
  api: "#6b4a1d",
  database: "#5a2d6b",
  lib: "#3d4a57",
  other: "#4a5560",
};

function FlowBox({ data }: NodeProps) {
  const d = data as {
    title: string;
    summary: string;
    kind: string;
    certainty: Certainty;
  };
  return (
    <div
      className="min-w-[160px] max-w-[220px] rounded-lg border bg-white px-3 py-2 shadow-sm"
      style={{ borderColor: KIND_COLOR[d.kind] ?? "#94a3b8" }}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#94a3b8]" />
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white"
          style={{ background: KIND_COLOR[d.kind] ?? "#64748b" }}
        >
          {d.kind}
        </span>
        {d.certainty === "guess" ? (
          <span className="rounded border border-amber-400/80 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            guess
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-[#17324a]">{d.title}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-[#5a7388]">
        {d.summary}
      </p>
      <Handle type="source" position={Position.Right} className="!bg-[#94a3b8]" />
    </div>
  );
}

const nodeTypes = { flowBox: FlowBox };

function layoutNodes(nodes: FlowNode[]): Node[] {
  const columns: Record<string, number> = {
    page: 0,
    component: 1,
    api: 2,
    database: 3,
    lib: 2,
    other: 1,
  };
  const colCount = [0, 0, 0, 0];
  return nodes.map((n) => {
    const col = columns[n.kind] ?? 1;
    const row = colCount[col] ?? 0;
    colCount[col] = row + 1;
    return {
      id: n.id,
      type: "flowBox",
      position: { x: col * 280, y: row * 120 },
      data: {
        title: n.title,
        summary: n.summary,
        kind: n.kind,
        certainty: n.certainty,
        span: n.span,
      },
    };
  });
}

function toFlowEdges(edges: FlowEdge[], hideGuesses: boolean): Edge[] {
  return edges
    .filter((e) => !(hideGuesses && e.certainty === "guess"))
    .map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.certainty === "guess" ? `${e.label ?? "link"} (guess)` : e.label,
      animated: e.certainty === "guess",
      style: {
        stroke: e.certainty === "guess" ? "#d97706" : "#64748b",
        strokeDasharray: e.certainty === "guess" ? "6 4" : undefined,
      },
      labelStyle: {
        fill: e.certainty === "guess" ? "#92400e" : "#475569",
        fontSize: 10,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: e.certainty === "guess" ? "#d97706" : "#64748b",
      },
      data: { reason: e.reason, certainty: e.certainty },
    }));
}

type Props = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  hideGuesses: boolean;
  focusNodeId: string | null;
  onSelectNode: (node: FlowNode) => void;
};

function CanvasInner({
  nodes,
  edges,
  hideGuesses,
  focusNodeId,
  onSelectNode,
}: Props) {
  const initialNodes = useMemo(() => layoutNodes(nodes), [nodes]);
  const initialEdges = useMemo(
    () => toFlowEdges(edges, hideGuesses),
    [edges, hideGuesses],
  );
  const [rfNodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(layoutNodes(nodes));
  }, [nodes, setNodes]);

  useEffect(() => {
    setEdges(toFlowEdges(edges, hideGuesses));
  }, [edges, hideGuesses, setEdges]);

  useEffect(() => {
    if (!focusNodeId) return;
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        selected: n.id === focusNodeId,
        style:
          n.id === focusNodeId
            ? { outline: "2px solid #2563eb", outlineOffset: 2 }
            : undefined,
      })),
    );
  }, [focusNodeId, setNodes]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.2}
      maxZoom={1.6}
      onNodeClick={(_, node) => {
        const flowNode = byId.get(node.id);
        if (flowNode) onSelectNode(flowNode);
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={18} color="#d7e3eb" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        className="!bg-white"
        nodeColor={(n) => {
          const kind = (n.data as { kind?: string } | undefined)?.kind;
          return KIND_COLOR[kind ?? ""] ?? "#94a3b8";
        }}
      />
    </ReactFlow>
  );
}

export function FlowMapCanvas(props: Props) {
  return (
    <div className="h-full min-h-[420px] w-full">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
