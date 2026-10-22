"use client";

import { cn } from "@/lib/utils";

export type SketchBox = {
  id: string;
  label: string;
};

type SketchCardProps = {
  title?: string;
  boxes: SketchBox[];
  highlightIds?: string[];
  className?: string;
};

/**
 * @deprecated Prefer VoiceTldrawBoard (real Smart Tutor tldraw + applyScene).
 * Kept as a lightweight offline fallback only.
 */
export function SketchCard({
  title,
  boxes,
  highlightIds = [],
  className,
}: SketchCardProps) {
  const focus = new Set(highlightIds);
  const shown = boxes.slice(0, 4);
  if (!shown.length) return null;

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border border-board-edge bg-[#fbfaf7] shadow-[0_8px_22px_rgba(26,43,60,0.08)]",
        className,
      )}
      aria-label={title || "Concept sketch"}
    >
      {title ? (
        <figcaption className="border-b border-board-edge/70 px-3 py-2 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
          {title}
        </figcaption>
      ) : null}
      <svg
        viewBox="0 0 280 200"
        className="h-auto w-full"
        role="img"
        aria-hidden={Boolean(title)}
      >
        <rect x="0" y="0" width="280" height="200" fill="#fbfaf7" />
        {shown.map((box, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = 18 + col * 132;
          const y = 22 + row * 88;
          const hot = focus.has(box.id) || (focus.size === 0 && i === 0);
          return (
            <g key={box.id} data-vt-object={box.id}>
              <rect
                x={x}
                y={y}
                width={112}
                height={68}
                rx={10}
                ry={10}
                fill={hot ? "rgba(47, 122, 158, 0.12)" : "#fff"}
                stroke={hot ? "#2f7a9e" : "#8a9aab"}
                strokeWidth={hot ? 2.2 : 1.4}
                strokeDasharray={hot ? undefined : "3 2"}
              />
              <text
                x={x + 56}
                y={y + 38}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1a2b3c"
                fontSize={12}
                fontFamily="var(--font-newsreader), Georgia, serif"
              >
                {box.label.length > 18
                  ? `${box.label.slice(0, 17)}…`
                  : box.label}
              </text>
              {i > 0 && i % 2 === 1 ? (
                <path
                  d={`M ${x - 14} ${y + 34} C ${x - 8} ${y + 20}, ${x - 8} ${y + 48}, ${x - 2} ${y + 34}`}
                  fill="none"
                  stroke="#2f7a9e"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function sketchBoxesFromSpec(
  spec: Record<string, unknown> | undefined,
): SketchBox[] {
  const raw = spec?.boxes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { id?: unknown; label?: unknown };
      const label = typeof row.label === "string" ? row.label.trim() : "";
      if (!label) return null;
      const id =
        typeof row.id === "string" && row.id.trim()
          ? row.id.trim()
          : `box_${i + 1}`;
      return { id, label };
    })
    .filter((b): b is SketchBox => b != null);
}
