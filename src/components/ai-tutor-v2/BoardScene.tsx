"use client";

import type { BoardNodes, SceneNode } from "@/lib/ai-tutor-v2";

type BoardSceneProps = {
  nodes: BoardNodes;
  pointedId: string | null;
};

function nodeLabel(node: SceneNode): string {
  if (node.type === "text") return node.text;
  if (node.type === "box") return node.label ?? "";
  return node.label ?? "";
}

function TextNodeView({
  node,
  pointed,
}: {
  node: Extract<SceneNode, { type: "text" }>;
  pointed: boolean;
}) {
  const size =
    node.role === "title" ? 36 : node.role === "label" ? 22 : 26;
  const weight = node.role === "title" ? 700 : 500;
  return (
    <g>
      {pointed ? (
        <rect
          x={node.x - 12}
          y={node.y - size}
          width={Math.min(520, 18 + node.text.length * size * 0.55)}
          height={size + 18}
          rx={8}
          fill="#dbeafe"
          stroke="#2563eb"
          strokeWidth={2}
        />
      ) : null}
      <text
        x={node.x}
        y={node.y}
        fontSize={size}
        fontWeight={weight}
        fill="#17324a"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        {node.text.length > 48 ? `${node.text.slice(0, 47)}…` : node.text}
      </text>
    </g>
  );
}

function BoxNodeView({
  node,
  pointed,
}: {
  node: Extract<SceneNode, { type: "box" }>;
  pointed: boolean;
}) {
  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={14}
        fill={pointed ? "#eff6ff" : "#f8fafc"}
        stroke={pointed ? "#2563eb" : "#94a3b8"}
        strokeWidth={pointed ? 3 : 2}
      />
      {node.label ? (
        <text
          x={node.x + node.width / 2}
          y={node.y + node.height / 2 + 8}
          textAnchor="middle"
          fontSize={24}
          fontWeight={600}
          fill="#17324a"
          style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          {node.label}
        </text>
      ) : null}
    </g>
  );
}

function ArrowNodeView({
  node,
  pointed,
}: {
  node: Extract<SceneNode, { type: "arrow" }>;
  pointed: boolean;
}) {
  const markerId = `arrow-${node.id}`;
  const midX = (node.start.x + node.end.x) / 2;
  const midY = (node.start.y + node.end.y) / 2;
  return (
    <g>
      <defs>
        <marker
          id={markerId}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill={pointed ? "#2563eb" : "#64748b"} />
        </marker>
      </defs>
      <line
        x1={node.start.x}
        y1={node.start.y}
        x2={node.end.x}
        y2={node.end.y}
        stroke={pointed ? "#2563eb" : "#64748b"}
        strokeWidth={pointed ? 4 : 3}
        markerEnd={`url(#${markerId})`}
      />
      {node.label ? (
        <text
          x={midX}
          y={midY - 10}
          textAnchor="middle"
          fontSize={20}
          fill="#475569"
          style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          {node.label}
        </text>
      ) : null}
    </g>
  );
}

export function BoardScene({ nodes, pointedId }: BoardSceneProps) {
  const list = Object.values(nodes);
  return (
    <div className="relative h-full min-h-[280px] overflow-hidden rounded-xl border border-[#d7e3eb] bg-[linear-gradient(180deg,#f8fbff_0%,#eef5fb_100%)]">
      {list.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">
          Ask a question. The board will draw text, boxes, and arrows as the
          lesson streams.
        </div>
      ) : null}
      <svg
        viewBox="0 0 1000 700"
        className="h-full w-full"
        role="img"
        aria-label={
          list.length
            ? `Whiteboard with ${list.length} shapes`
            : "Empty whiteboard"
        }
      >
        {list.map((node) => {
          const pointed = pointedId === node.id;
          if (node.type === "text") {
            return (
              <TextNodeView key={node.id} node={node} pointed={pointed} />
            );
          }
          if (node.type === "box") {
            return <BoxNodeView key={node.id} node={node} pointed={pointed} />;
          }
          return <ArrowNodeView key={node.id} node={node} pointed={pointed} />;
        })}
      </svg>
      {pointedId && nodes[pointedId] ? (
        <p className="absolute bottom-3 left-3 rounded-md bg-white/90 px-2 py-1 text-xs text-[#17324a] shadow-sm">
          Pointing at {nodeLabel(nodes[pointedId]) || pointedId}
        </p>
      ) : null}
    </div>
  );
}
