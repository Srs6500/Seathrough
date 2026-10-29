"use client";

import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Paper, Text } from "@mantine/core";
import type { FileGraphRole, FileRelationshipGraph } from "@/lib/repo-scan/types";

const ROLE_COLOR: Record<FileGraphRole, string> = {
  page: "#17324a",
  component: "#2f6b4f",
  api_route: "#6b4a1d",
  service: "#5a2d6b",
};

const ROLE_X: Record<FileGraphRole, number> = {
  page: 0,
  component: 1,
  api_route: 2,
  service: 3,
};

function GraphNode({ data }: NodeProps) {
  const d = data as { path: string; role: FileGraphRole };
  const color = ROLE_COLOR[d.role] ?? "#4a5560";
  const name = d.path.split("/").pop() || d.path;
  return (
    <div
      className="min-w-[160px] max-w-[220px] rounded-lg border bg-white px-3 py-2 shadow-sm"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#94a3b8]" />
      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color }}>
        {d.role.replace("_", " ")}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-[#17324a]" title={d.path}>
        {name}
      </p>
      <p className="mt-0.5 line-clamp-1 text-[10px] text-[#7a93a8]" title={d.path}>
        {d.path}
      </p>
      <Handle type="source" position={Position.Right} className="!bg-[#94a3b8]" />
    </div>
  );
}

const nodeTypes = { graphNode: GraphNode };

function layout(graph: FileRelationshipGraph): { nodes: Node[]; edges: Edge[] } {
  const colCount = [0, 0, 0, 0];
  const nodes: Node[] = graph.nodes.map((item) => {
    const col = ROLE_X[item.role] ?? 1;
    const row = colCount[col] ?? 0;
    colCount[col] = row + 1;
    return {
      id: item.id,
      type: "graphNode",
      position: { x: col * 280, y: row * 92 },
      data: { path: item.id, role: item.role },
    };
  });
  const edges: Edge[] = graph.edges.map((edge, index) => ({
    id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { stroke: "#94a3b8" },
  }));
  return { nodes, edges };
}

function GraphInner({
  graph,
  onSelectPath,
}: {
  graph: FileRelationshipGraph;
  onSelectPath: (path: string) => void;
}) {
  const laid = useMemo(() => layout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(laid.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laid.edges);

  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [laid, setEdges, setNodes]);

  if (graph.nodes.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No file relationship nodes were stored for this scan.
      </Text>
    );
  }

  return (
    <Paper withBorder h={560} style={{ overflow: "hidden" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => onSelectPath(String(node.id))}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </Paper>
  );
}

export function FileGraphCanvas({
  graph,
  onSelectPath,
}: {
  graph: FileRelationshipGraph;
  onSelectPath: (path: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <GraphInner graph={graph} onSelectPath={onSelectPath} />
    </ReactFlowProvider>
  );
}
