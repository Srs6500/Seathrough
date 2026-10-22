"use client";

import { useMemo } from "react";
import type { SceneObject, VisualScene } from "@/lib/voice-tutor/schemas";
import { cn } from "@/lib/utils";

type SceneCanvasProps = {
  scene: VisualScene;
  focusObjectIds?: string[];
  traceTargetId?: string | null;
  className?: string;
};

function num(params: SceneObject["params"], key: string, fallback = 0): number {
  const value = params[key];
  return typeof value === "number" ? value : fallback;
}

function str(params: SceneObject["params"], key: string, fallback = ""): string {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}

function project(x: number, y: number, scale: number) {
  return { x: 200 + x * scale, y: 200 - y * scale };
}

function SidewaysParabolaPath(props: {
  a: number;
  vertexX: number;
  vertexY: number;
  yMin: number;
  yMax: number;
  scale: number;
  focused: boolean;
}) {
  const { a, vertexX, vertexY, yMin, yMax, scale, focused } = props;
  const points: string[] = [];
  for (let y = yMin; y <= yMax; y += 0.12) {
    const x = vertexX + a * y * y;
    const p = project(x, vertexY + y, scale);
    points.push(`${p.x},${p.y}`);
  }
  return (
    <polyline
      points={points.join(" ")}
      fill="none"
      stroke={focused ? "#085080" : "#4a6580"}
      strokeWidth={focused ? 3.2 : 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export function SceneCanvas({
  scene,
  focusObjectIds = [],
  traceTargetId = null,
  className,
}: SceneCanvasProps) {
  const focus = useMemo(() => new Set(focusObjectIds), [focusObjectIds]);
  const scale = 28;

  return (
    <div
      className={cn(
        "overflow-hidden border-b border-board-edge bg-white",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-board-edge px-4 py-2.5">
        <p className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
          {scene.title}
        </p>
        {traceTargetId ? (
          <p className="text-[11px] text-muted">Follow the highlight</p>
        ) : null}
      </div>
      <svg
        viewBox="0 0 400 400"
        className="h-auto w-full"
        role="img"
        aria-label={scene.title}
      >
        <rect width="400" height="400" fill="#fbfcfe" />
        {scene.objects.map((object) => {
          const focused =
            focus.has(object.id) || traceTargetId === object.id;
          const stroke = focused ? "#085080" : "#7a93a8";
          const width = focused ? 2.8 : 1.6;

          if (object.type === "axis") {
            const axis = str(object.params, "axis", "x");
            if (axis === "x") {
              const min = project(num(object.params, "min", -4), 0, scale);
              const max = project(num(object.params, "max", 4), 0, scale);
              return (
                <line
                  key={object.id}
                  x1={min.x}
                  y1={min.y}
                  x2={max.x}
                  y2={max.y}
                  stroke="#c8d6e4"
                  strokeWidth={1.2}
                />
              );
            }
            const min = project(0, num(object.params, "min", -4), scale);
            const max = project(0, num(object.params, "max", 4), scale);
            return (
              <line
                key={object.id}
                x1={min.x}
                y1={min.y}
                x2={max.x}
                y2={max.y}
                stroke="#c8d6e4"
                strokeWidth={1.2}
              />
            );
          }

          if (object.type === "circle") {
            const center = project(
              num(object.params, "cx"),
              num(object.params, "cy"),
              scale,
            );
            return (
              <circle
                key={object.id}
                data-vt-object={object.id}
                cx={center.x}
                cy={center.y}
                r={num(object.params, "r", 1) * scale}
                fill="none"
                stroke={stroke}
                strokeWidth={width}
              />
            );
          }

          if (object.type === "line") {
            const a = project(
              num(object.params, "x1"),
              num(object.params, "y1"),
              scale,
            );
            const b = project(
              num(object.params, "x2"),
              num(object.params, "y2"),
              scale,
            );
            return (
              <line
                key={object.id}
                data-vt-object={object.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={focused ? "#c45e1a" : stroke}
                strokeWidth={focused ? 2.6 : width}
                strokeDasharray={focused ? "6 4" : undefined}
              />
            );
          }

          if (object.type === "curve") {
            return (
              <g key={object.id} data-vt-object={object.id}>
                <SidewaysParabolaPath
                  a={num(object.params, "a", 0.35)}
                  vertexX={num(object.params, "vertexX")}
                  vertexY={num(object.params, "vertexY")}
                  yMin={num(object.params, "yMin", -3)}
                  yMax={num(object.params, "yMax", 3)}
                  scale={scale}
                  focused={focused}
                />
              </g>
            );
          }

          if (object.type === "label") {
            const p = project(
              num(object.params, "x"),
              num(object.params, "y"),
              scale,
            );
            return (
              <text
                key={object.id}
                x={p.x}
                y={p.y}
                fill={focused ? "#0f4f7c" : "#4a6580"}
                fontSize={13}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {str(object.params, "text")}
              </text>
            );
          }

          return null;
        })}
      </svg>
    </div>
  );
}
