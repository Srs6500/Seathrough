/**
 * Map Voice `tldraw_sketch` boxes → Smart Tutor ExperimentShape IR
 * so we can draw with the same applyScene / tldraw path.
 */

import type { ExperimentShape } from "@/lib/experiment/scene";

export type SketchBox = {
  id: string;
  label: string;
};

const COLORS = ["blue", "green", "orange", "violet"] as const;

/**
 * 2-column Smart-style geo layout with arrows between neighbors.
 * Sized for a real board viewport (not a tiny SVG card).
 */
export function boxesToExperimentShapes(
  boxes: SketchBox[],
  opts?: { highlightIds?: string[] },
): ExperimentShape[] {
  const shown = boxes
    .map((b) => ({
      id: b.id.trim() || `box_${Math.random().toString(36).slice(2, 7)}`,
      label: b.label.trim().slice(0, 64),
    }))
    .filter((b) => b.label.length > 0)
    .slice(0, 6);
  if (!shown.length) return [];

  const highlight = new Set(opts?.highlightIds ?? []);
  const shapes: ExperimentShape[] = [];
  const colW = 260;
  const rowH = 140;
  const boxW = 220;
  const boxH = 96;
  const originX = 40;
  const originY = 40;

  shown.forEach((box, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const hot = highlight.has(box.id) || (highlight.size === 0 && i === 0);
    shapes.push({
      id: box.id,
      type: "geo",
      geo: "rectangle",
      x: originX + col * colW,
      y: originY + row * rowH,
      w: boxW,
      h: boxH,
      label: box.label,
      color: hot ? "blue" : COLORS[i % COLORS.length],
      fill: hot ? "semi" : "none",
    });
  });

  for (let i = 1; i < shown.length; i += 1) {
    const from = shown[i - 1]!;
    const to = shown[i]!;
    shapes.push({
      id: `arr_${from.id}_${to.id}`,
      type: "arrow",
      from: from.id,
      to: to.id,
      color: "grey",
    });
  }

  return shapes;
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
