"use client";

import { useEffect, useMemo, useState } from "react";
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
import { X } from "lucide-react";
import { scenarioPath } from "@/lib/schema-guide/backendStory";
import { humanLabel } from "@/lib/schema-guide/overviewStory";
import type {
  BackendFeature,
  BackendScenarioId,
  BackendStep,
  BackendStepKind,
} from "@/lib/schema-guide/types";

const KIND_LABEL: Record<BackendStepKind, string> = {
  action: "Action",
  decision: "Decision",
  database: "Database",
  service: "Outside service",
};

type FlowNodeData = {
  step: BackendStep;
  active: boolean;
  done: boolean;
};

function FlowNode({ data }: NodeProps) {
  const { step, active, done } = data as FlowNodeData;
  return (
    <div
      className={`backend-node backend-node-${step.kind} ${
        active ? "is-active" : done ? "is-done" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} className="!border-0 !bg-[#9aa8b5]" />
      <p className="backend-node-kind">{KIND_LABEL[step.kind]}</p>
      <p className="backend-node-label">{step.label}</p>
      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-[#9aa8b5]" />
    </div>
  );
}

const nodeTypes = { backendStep: FlowNode };

function layoutFeature(
  feature: BackendFeature,
  path: string[],
  cursor: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const byId = new Map(feature.steps.map((step) => [step.id, step]));
  const layer = new Map<string, { x: number; y: number }>();
  const visiting = scenarioPath(feature, "success");
  visiting.forEach((id, index) => {
    layer.set(id, { x: 40, y: 24 + index * 150 });
  });
  for (const step of feature.steps) {
    if (layer.has(step.id)) continue;
    const parent = feature.steps.find(
      (item) => item.noTo === step.id || item.yesTo === step.id || item.next === step.id,
    );
    const from = parent ? layer.get(parent.id) : undefined;
    layer.set(step.id, {
      x: (from?.x ?? 40) + (parent?.noTo === step.id ? 280 : 0),
      y: (from?.y ?? 24) + 150,
    });
  }

  const cursorIndex = cursor ? path.indexOf(cursor) : -1;
  const nodes: Node[] = feature.steps.map((step) => ({
    id: step.id,
    type: "backendStep",
    position: layer.get(step.id) ?? { x: 40, y: 24 },
    data: {
      step,
      active: cursor === step.id,
      done: cursorIndex >= 0 && path.indexOf(step.id) >= 0 && path.indexOf(step.id) < cursorIndex,
    },
    draggable: false,
  }));

  const edges: Edge[] = [];
  for (const step of feature.steps) {
    const links: Array<{ to: string | null; label?: string; fail?: boolean }> = [];
    if (step.kind === "decision") {
      links.push({ to: step.yesTo, label: "Yes" });
      links.push({ to: step.noTo, label: "No", fail: true });
    } else {
      links.push({ to: step.next });
    }
    for (const link of links) {
      if (!link.to || !byId.has(link.to)) continue;
      const onPath =
        cursorIndex >= 0 &&
        path.includes(step.id) &&
        path.includes(link.to) &&
        path.indexOf(link.to) === path.indexOf(step.id) + 1;
      edges.push({
        id: `${step.id}->${link.to}`,
        source: step.id,
        target: link.to,
        label: link.label,
        animated: onPath && cursor === link.to,
        style: {
          stroke: onPath ? "#6d5efc" : link.fail ? "#c4b5b0" : "#9aa8b5",
          strokeWidth: onPath ? 2 : 1,
        },
        labelStyle: { fill: "#004f99", fontSize: 12, fontWeight: 600 },
        labelBgStyle: { fill: "#f5faff", fillOpacity: 1 },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 12,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: onPath ? "#6d5efc" : "#9aa8b5",
          width: 16,
          height: 16,
        },
      });
    }
  }

  return { nodes, edges };
}

function StepInspector({
  step,
  onClose,
  onOpenTable,
}: {
  step: BackendStep;
  onClose: () => void;
  onOpenTable: (tableId: string) => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const tech = step.tech;
  const techBits = [
    tech?.method && tech.route ? `${tech.method} ${tech.route}` : tech?.route,
    tech?.functionName ? `${tech.functionName}()` : null,
  ].filter(Boolean);

  return (
    <aside className="schema-inspector">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-[#71717a]">{KIND_LABEL[step.kind]}</p>
          <h2 className="mt-0.5 text-[18px] font-medium leading-snug tracking-[-0.02em] text-[#16161a]">
            {step.label}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#71717a]">{step.summary}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-[#71717a] hover:bg-[#f4f4f6]"
          aria-label="Close step"
        >
          <X className="size-4" />
        </button>
      </header>

      <section className="mt-5">
        <h3 className="text-[12px] text-[#71717a]">This sample request</h3>
        <dl className="mt-2 overflow-hidden rounded-2xl border border-[#ececee]">
          {(
            [
              ["What enters", step.sample.enter],
              ["What happens", step.sample.happen],
              ["What comes out", step.sample.leave],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="grid grid-cols-[96px_1fr] gap-3 border-b border-[#ececee] px-3 py-2 last:border-b-0"
            >
              <dt className="text-[12px] text-[#71717a]">{label}</dt>
              <dd className="text-[13px] text-[#16161a]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {step.fields.length ? (
        <section className="mt-5">
          <h3 className="text-[12px] text-[#71717a]">How it is stored</h3>
          <ul className="mt-2 space-y-1.5">
            {step.fields.map((field) => (
              <li key={field.field} className="text-[13px] text-[#16161a]">
                {field.human} → <span className="text-[#5b4fd4]">{field.field}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tech && (techBits.length || tech.file) ? (
        <section className="mt-5">
          <h3 className="text-[12px] text-[#71717a]">Under the hood</h3>
          <p className="mt-2 text-[13px] text-[#16161a]">{techBits.join(" · ")}</p>
          {tech.file ? (
            <button
              type="button"
              onClick={() => setSourceOpen((value) => !value)}
              className="mt-2 text-[13px] text-[#6d5efc]"
            >
              {sourceOpen ? "Hide source" : "View source"}
            </button>
          ) : null}
          {sourceOpen && tech.file ? (
            <div className="mt-2 rounded-xl bg-[#111] px-3 py-2">
              <p className="text-[11px] text-[#a1a1aa]">
                {tech.file}
                {tech.line ? `:${tech.line}` : ""}
              </p>
              {tech.snippet ? (
                <p className="mt-1 font-mono text-[12px] leading-relaxed text-[#f4f4f6]">
                  {tech.snippet}
                </p>
              ) : (
                <p className="mt-1 text-[12px] text-[#a1a1aa]">
                  We found this file, but not a short snippet.
                </p>
              )}
            </div>
          ) : null}
          {tech.tableId ? (
            <button
              type="button"
              onClick={() => onOpenTable(tech.tableId!)}
              className="mt-3 text-[13px] text-[#6d5efc]"
            >
              See {humanLabel(tech.tableId)}
            </button>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}

function FlowCanvas({
  feature,
  path,
  cursor,
  onSelect,
}: {
  feature: BackendFeature;
  path: string[];
  cursor: string | null;
  onSelect: (stepId: string) => void;
}) {
  const layout = useMemo(
    () => layoutFeature(feature, path, cursor),
    [feature, path, cursor],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.24, duration: 280 });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [fitView, layout, setEdges, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
      fitView
      fitViewOptions={{ padding: 0.24 }}
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#ececee" gap={22} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function BackendFlow({
  feature,
  onBack,
  onOpenTable,
}: {
  feature: BackendFeature;
  onBack: () => void;
  onOpenTable: (tableId: string) => void;
}) {
  const hasFailure = feature.scenarios.some((item) => item.id === "failure");
  const [scenario, setScenario] = useState<BackendScenarioId>("success");
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const path = useMemo(() => scenarioPath(feature, scenario), [feature, scenario]);
  const cursor = path[index] ?? path[0] ?? null;
  const selectedId = picked ?? cursor;
  const selected = feature.steps.find((step) => step.id === selectedId) ?? null;
  const currentScenario =
    feature.scenarios.find((item) => item.id === scenario) ?? feature.scenarios[0];

  useEffect(() => {
    setIndex(0);
    setPicked(null);
    setPanelOpen(true);
    setPlaying(true);
  }, [feature.id, scenario]);

  useEffect(() => {
    if (!playing || path.length === 0) return;
    if (index >= path.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIndex((value) => Math.min(value + 1, path.length - 1));
      setPanelOpen(true);
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [index, path.length, playing]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#ececee] bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="text-[13px] text-[#71717a]"
            >
              All features
            </button>
            <span className="text-[#d4d4d8]">/</span>
            <p className="truncate text-[15px] font-medium text-[#16161a]">{feature.title}</p>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[#71717a]">{feature.when}</p>
        </div>
        <span className="rounded-full bg-[#fff7ed] px-2.5 py-1 text-[11px] text-[#9a3412]">
          Simulated walk-through
        </span>
        {hasFailure ? (
          <div className="flex rounded-full bg-[#f4f4f6] p-1">
            {feature.scenarios.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setScenario(item.id);
                  setIndex(0);
                  setPicked(null);
                  setPanelOpen(true);
                  setPlaying(true);
                }}
                className={`rounded-full px-2.5 py-1 text-[12px] ${
                  scenario === item.id
                    ? "bg-white text-[#16161a] shadow-sm"
                    : "text-[#71717a]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (index >= path.length - 1) setIndex(0);
            setPicked(null);
            setPanelOpen(true);
            setPlaying(true);
          }}
          className="rounded-full bg-[#6d5efc] px-3 py-1.5 text-[12px] text-white"
        >
          {playing ? "Playing…" : "Play sample"}
        </button>
      </div>

      <p className="shrink-0 border-b border-[#ececee] bg-[#fafafa] px-4 py-2 text-[12px] text-[#71717a]">
        {currentScenario?.outcome} This is a labeled sample, not a live trace.
      </p>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f7f8fa]">
          <ReactFlowProvider>
            <FlowCanvas
              feature={feature}
              path={path}
              cursor={cursor}
              onSelect={(id) => {
                setPlaying(false);
                setPicked(id);
                setPanelOpen(true);
                const next = path.indexOf(id);
                if (next >= 0) setIndex(next);
              }}
            />
          </ReactFlowProvider>
        </div>
        {selected && panelOpen ? (
          <div className="h-full w-[320px] shrink-0 overflow-hidden">
            <StepInspector
              step={selected}
              onClose={() => {
                setPlaying(false);
                setPanelOpen(false);
              }}
              onOpenTable={onOpenTable}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
