"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
import { humanLabel, shortRelationLabel } from "@/lib/schema-guide/overviewStory";
import type { SchemaGuide, TableGuide } from "@/lib/schema-guide/types";

type TableNodeData = {
  table: TableGuide;
  selected: boolean;
  highlighted: boolean;
};

function TableNode({ data }: NodeProps) {
  const { table, selected, highlighted } = data as TableNodeData;
  return (
    <div
      className={`w-[220px] overflow-hidden rounded-[10px] border bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(17,17,20,0.06)] ${
        selected
          ? "border-[#6d5efc]"
          : highlighted
            ? "border-[#b7aefc]"
            : "border-[#e6e6ea]"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!border-0 !bg-[#c4c0e8]" />
      <p className="text-[13px] font-medium text-[#16161a]">
        {humanLabel(table.tableName || table.id)}
      </p>
      <p className="mt-1 text-[12px] leading-snug text-[#71717a]">{table.purpose}</p>
      <Handle type="source" position={Position.Right} className="!border-0 !bg-[#c4c0e8]" />
    </div>
  );
}

const nodeTypes = { schemaTable: TableNode };

function neighborsOf(guide: SchemaGuide, tableId: string): Set<string> {
  const ids = new Set<string>([tableId]);
  for (const rel of guide.relations) {
    if (rel.origin !== "declared") continue;
    if (rel.fromTable === tableId) ids.add(rel.toTable);
    if (rel.toTable === tableId) ids.add(rel.fromTable);
  }
  return ids;
}

function layoutGuide(
  guide: SchemaGuide,
  selectedId: string | null,
  focusNearby: boolean,
  highlighted: string[],
): { nodes: Node[]; edges: Edge[] } {
  const focus = selectedId && focusNearby ? neighborsOf(guide, selectedId) : null;
  const tables = focus
    ? guide.tables.filter((table) => focus.has(table.id))
    : guide.tables;

  const groups = new Map<string, TableGuide[]>();
  for (const table of tables) {
    const list = groups.get(table.concept) ?? [];
    list.push(table);
    groups.set(table.concept, list);
  }

  const nodes: Node[] = [];
  if (focus && selectedId) {
    const selected = tables.find((table) => table.id === selectedId);
    const others = tables.filter((table) => table.id !== selectedId);
    const stack = Math.max(others.length, 1);
    const block = (stack - 1) * 130;
    if (selected) {
      nodes.push(
        nodeFor(selected, { x: 40, y: Math.max(40, block / 2) }, selectedId, highlighted),
      );
    }
    others.forEach((table, index) => {
      nodes.push(
        nodeFor(table, { x: 340, y: 40 + index * 130 }, selectedId, highlighted),
      );
    });
  } else {
    let col = 0;
    for (const [, group] of groups) {
      group.forEach((table, row) => {
        nodes.push(
          nodeFor(table, { x: col * 320, y: row * 220 }, selectedId, highlighted),
        );
      });
      col += 1;
    }
  }

  const visible = new Set(nodes.map((node) => node.id));
  const edges: Edge[] = guide.relations
    .filter((rel) => visible.has(rel.fromTable) && visible.has(rel.toTable))
    .map((rel) => ({
      id: rel.id,
      source: rel.fromTable,
      target: rel.toTable,
      label: shortRelationLabel(rel),
      labelStyle: { fill: "#71717a", fontSize: 11 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#c4c0e8" },
      style: {
        stroke: rel.origin === "declared" ? "#6d5efc" : "#c4c0e8",
        strokeDasharray: rel.origin === "implicit" ? "5 4" : undefined,
        strokeWidth: 1.4,
      },
    }));

  return { nodes, edges };
}

function nodeFor(
  table: TableGuide,
  position: { x: number; y: number },
  selectedId: string | null,
  highlighted: string[],
): Node {
  return {
    id: table.id,
    type: "schemaTable",
    position,
    width: 220,
    height: 76,
    data: {
      table,
      selected: table.id === selectedId,
      highlighted: highlighted.includes(table.id),
    },
  };
}

function ExploreInner({
  guide,
  selectedId,
  highlighted,
  focusNearby,
  onSelect,
}: {
  guide: SchemaGuide;
  selectedId: string | null;
  highlighted: string[];
  focusNearby: boolean;
  onSelect: (tableId: string) => void;
}) {
  const laid = useMemo(
    () => layoutGuide(guide, selectedId, focusNearby, highlighted),
    [guide, selectedId, focusNearby, highlighted],
  );
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(laid.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laid.edges);
  const frame = useRef<number>(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  function refit() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        void fitView({ padding: 0.2, duration: 180 });
      });
    });
  }

  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [laid, setEdges, setNodes]);

  useEffect(() => {
    refit();
    return () => cancelAnimationFrame(frame.current);
  }, [laid, fitView]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void fitView({ padding: 0.2, duration: 160 });
      }, 80);
    });
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [fitView]);

  return (
    <div ref={wrapRef} className="h-full min-h-0 w-full">
    <ReactFlow
      className="h-full"
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_event, node) => onSelect(String(node.id))}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.15}
      maxZoom={1.25}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#d8d8de" gap={22} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
    </div>
  );
}

const PANEL_KEY = "seethrough.vibe-coder.explore-panel-width";
const PANEL_MIN = 280;
const PANEL_MAX = 720;
const PANEL_DEFAULT = 360;

function clampPanelWidth(next: number, shellWidth: number): number {
  const room = Math.max(PANEL_MIN, shellWidth - 280);
  return Math.min(Math.min(PANEL_MAX, room), Math.max(PANEL_MIN, next));
}

export function SchemaExplore({
  guide,
  selectedId,
  highlighted,
  focusNearby,
  onSelect,
  onToggleFocus,
  onOpenPanel,
  panel,
}: {
  guide: SchemaGuide;
  selectedId: string | null;
  highlighted: string[];
  focusNearby: boolean;
  onSelect: (tableId: string) => void;
  onToggleFocus: () => void;
  onOpenPanel: () => void;
  panel: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(PANEL_DEFAULT);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PANEL_KEY);
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        setWidth(clampPanelWidth(parsed, shellRef.current?.clientWidth ?? 1200));
      }
    } catch {
      /* ignore */
    }
  }, []);

  function persist(next: number) {
    try {
      localStorage.setItem(PANEL_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  function onResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const shellWidth = shellRef.current?.clientWidth ?? 1200;
    setDragging(true);

    function onMove(move: PointerEvent) {
      setWidth(clampPanelWidth(startWidth + (startX - move.clientX), shellWidth));
    }

    function onUp(up: PointerEvent) {
      setDragging(false);
      const next = clampPanelWidth(startWidth + (startX - up.clientX), shellWidth);
      setWidth(next);
      persist(next);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={shellRef}
      className={`flex h-full min-h-0 w-full overflow-hidden ${
        dragging ? "select-none" : ""
      }`}
    >
      <div className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden">
        <button
          type="button"
          onClick={onToggleFocus}
          className="absolute left-4 top-4 z-10 rounded-full border border-[#e6e6ea] bg-white px-3 py-1.5 text-[12px] text-[#16161a]"
        >
          {focusNearby ? "Show every kind of record" : "Show only what this links to"}
        </button>
        {!panel && selectedId ? (
          <button
            type="button"
            onClick={onOpenPanel}
            className="absolute right-4 top-4 z-10 rounded-full border border-[#e6e6ea] bg-white px-3 py-1.5 text-[12px] text-[#16161a]"
          >
            Open details
          </button>
        ) : null}
        <ReactFlowProvider>
          <ExploreInner
            guide={guide}
            selectedId={selectedId}
            highlighted={highlighted}
            focusNearby={focusNearby}
            onSelect={onSelect}
          />
        </ReactFlowProvider>
      </div>
      <div
        className={`relative z-20 h-full shrink-0 overflow-hidden bg-white shadow-[-12px_0_24px_rgba(17,17,20,0.04)] ${
          dragging ? "" : "transition-[width] duration-300 ease-out"
        }`}
        style={{ width: panel ? width : 0 }}
      >
        {panel ? (
          <button
            type="button"
            aria-label="Resize details panel"
            onPointerDown={onResizePointerDown}
            className="absolute inset-y-0 left-0 z-30 w-3 cursor-col-resize touch-none"
          >
            <span
              className={`absolute inset-y-0 left-0 w-px ${
                dragging ? "bg-[#6d5efc]" : "bg-[#ececee] hover:bg-[#6d5efc]"
              }`}
            />
          </button>
        ) : null}
        <div className="h-full min-w-0" style={{ width }}>
          {panel}
        </div>
      </div>
    </div>
  );
}
