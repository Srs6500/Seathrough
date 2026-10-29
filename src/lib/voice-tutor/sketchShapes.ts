/**
 * Map Voice `tldraw_sketch` specs → Smart Tutor ExperimentShape IR
 * so we can draw with the same applyScene / tldraw path.
 *
 * Layouts (picked per topic by the planner):
 * - hub:      topic in the middle, features/parts around it (products, systems, organisms)
 * - flow:     numbered steps with arrows (processes, how-it-works, algorithms)
 * - cycle:    steps in a loop (water cycle, feedback loops)
 * - compare:  two columns of short points (X vs Y, pros/cons, before/after)
 * - timeline: dated events in order (history, product generations)
 */

import type { ExperimentColor, ExperimentShape } from "@/lib/experiment/scene";

export type SketchBox = {
  id: string;
  label: string;
  /** Short supporting fact shown under the label (numbers, specs, dates). */
  detail?: string;
};

export const SKETCH_LAYOUTS = [
  "hub",
  "flow",
  "cycle",
  "compare",
  "timeline",
] as const;
export type SketchLayout = (typeof SKETCH_LAYOUTS)[number];

export type SketchColumn = { title: string; points: string[] };

export type SketchSpec = {
  layout: SketchLayout;
  /** Hub center label (defaults to the board title). */
  center?: string;
  boxes: SketchBox[];
  /** compare only. */
  columns?: SketchColumn[];
  /** Optional short labels on flow arrows, index i = arrow from box i → i+1. */
  edgeLabels?: string[];
};

const COLORS: ExperimentColor[] = ["blue", "green", "orange", "violet", "red", "light-blue"];

/** Trim at a word boundary — never "make it ve". */
export function clipWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : t.slice(0, max)).replace(/[,;:.\-–—]+$/, "")}…`;
}

function boxText(box: SketchBox): string {
  const label = clipWords(box.label, 40);
  const detail = box.detail ? clipWords(box.detail, 60) : "";
  return detail ? `${label}\n${detail}` : label;
}

/** Rough height for a draw-font "m" label at width `w`. */
function fitHeight(texts: string[], w: number, min = 96): number {
  const charsPerLine = Math.max(8, Math.floor((w - 24) / 13));
  let lines = 1;
  for (const t of texts) {
    const n = t
      .split("\n")
      .reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / charsPerLine)), 0);
    lines = Math.max(lines, n);
  }
  return Math.max(min, lines * 34 + 32);
}

function geo(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  color: ExperimentColor,
  opts?: { fill?: "none" | "semi" | "solid"; geo?: "rectangle" | "ellipse" },
): ExperimentShape {
  return {
    id,
    type: "geo",
    geo: opts?.geo ?? "rectangle",
    x,
    y,
    w,
    h,
    label,
    color,
    fill: opts?.fill ?? "none",
  };
}

function hubShapes(title: string, spec: SketchSpec): ExperimentShape[] {
  const nodes = spec.boxes.slice(0, 6);
  const w = 280;
  const h = fitHeight(nodes.map(boxText), w);
  const gapY = 40;
  const left = nodes.filter((_, i) => i % 2 === 0);
  const right = nodes.filter((_, i) => i % 2 === 1);
  const colH = (n: number) => n * h + (n - 1) * gapY;
  const totalH = Math.max(colH(left.length), colH(right.length));
  const cw = 260;
  const ch = 130;
  const cx = w + 160;
  const cy = totalH / 2 - ch / 2;
  const shapes: ExperimentShape[] = [
    geo("hub_center", cx, cy, cw, ch, clipWords(spec.center || title, 32), "blue", {
      fill: "semi",
      geo: "ellipse",
    }),
  ];
  const place = (col: SketchBox[], x: number) => {
    const top = (totalH - colH(col.length)) / 2;
    col.forEach((box, i) => {
      const colorIdx = nodes.indexOf(box);
      shapes.push(geo(box.id, x, top + i * (h + gapY), w, h, boxText(box), COLORS[colorIdx % COLORS.length]!));
    });
  };
  place(left, 0);
  place(right, cx + cw + 160);
  for (const box of nodes) {
    shapes.push({ id: `arr_hub_${box.id}`, type: "arrow", from: "hub_center", to: box.id, color: "grey" });
  }
  return shapes;
}

function flowShapes(spec: SketchSpec, numbered: boolean): ExperimentShape[] {
  const nodes = spec.boxes.slice(0, 6);
  const perRow = nodes.length <= 4 ? nodes.length : 3;
  const w = 250;
  const texts = nodes.map((b, i) => (numbered ? `${i + 1}. ${boxText(b)}` : boxText(b)));
  const h = fitHeight(texts, w);
  const gapX = 110;
  const gapY = 90;
  const shapes: ExperimentShape[] = nodes.map((box, i) =>
    geo(
      box.id,
      (i % perRow) * (w + gapX),
      Math.floor(i / perRow) * (h + gapY),
      w,
      h,
      texts[i]!,
      COLORS[i % COLORS.length]!,
      { fill: i === 0 ? "semi" : "none" },
    ),
  );
  for (let i = 1; i < nodes.length; i += 1) {
    const label = spec.edgeLabels?.[i - 1]?.trim();
    shapes.push({
      id: `arr_${nodes[i - 1]!.id}_${nodes[i]!.id}`,
      type: "arrow",
      from: nodes[i - 1]!.id,
      to: nodes[i]!.id,
      color: "grey",
      ...(label ? { label: clipWords(label, 24) } : {}),
    });
  }
  return shapes;
}

function cycleShapes(spec: SketchSpec): ExperimentShape[] {
  const nodes = spec.boxes.slice(0, 6);
  const w = 240;
  const h = fitHeight(nodes.map(boxText), w);
  const n = nodes.length;
  const rx = 160 + n * 55;
  const ry = 110 + n * 40;
  const shapes: ExperimentShape[] = nodes.map((box, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return geo(
      box.id,
      rx + Math.cos(a) * rx - w / 2,
      ry + Math.sin(a) * ry - h / 2,
      w,
      h,
      boxText(box),
      COLORS[i % COLORS.length]!,
      { fill: i === 0 ? "semi" : "none" },
    );
  });
  nodes.forEach((box, i) => {
    const next = nodes[(i + 1) % n]!;
    shapes.push({ id: `arr_${box.id}_${next.id}`, type: "arrow", from: box.id, to: next.id, color: "grey" });
  });
  return shapes;
}

function compareShapes(spec: SketchSpec): ExperimentShape[] {
  const cols = (spec.columns ?? []).slice(0, 2);
  const w = 320;
  const gapX = 120;
  const shapes: ExperimentShape[] = [];
  const colColors: ExperimentColor[] = ["blue", "orange"];
  const pointH = fitHeight(
    cols.flatMap((c) => c.points.map((p) => clipWords(p, 60))),
    w,
    70,
  );
  cols.forEach((col, ci) => {
    const x = ci * (w + gapX);
    const color = colColors[ci]!;
    shapes.push(geo(`col_${ci}`, x, 0, w, 90, clipWords(col.title, 32), color, { fill: "semi" }));
    col.points.slice(0, 5).forEach((p, pi) => {
      shapes.push(geo(`col_${ci}_${pi}`, x, 120 + pi * (pointH + 20), w, pointH, clipWords(p, 60), color));
    });
  });
  if (cols.length === 2) {
    shapes.push({ id: "vs", type: "text", x: w + gapX / 2 - 20, y: 20, text: "vs", color: "grey" });
  }
  return shapes;
}

export function sketchToExperimentShapes(
  title: string,
  spec: SketchSpec,
): ExperimentShape[] {
  switch (spec.layout) {
    case "hub":
      return spec.boxes.length ? hubShapes(title, spec) : [];
    case "cycle":
      return spec.boxes.length >= 3 ? cycleShapes(spec) : flowShapes(spec, true);
    case "compare":
      return (spec.columns?.length ?? 0) >= 2
        ? compareShapes(spec)
        : hubShapes(title, spec);
    case "timeline":
      return flowShapes(spec, false);
    case "flow":
    default:
      return flowShapes(spec, true);
  }
}

/** @deprecated kept for older callers — plain boxes as a numbered flow. */
export function boxesToExperimentShapes(
  boxes: SketchBox[],
  _opts?: { highlightIds?: string[] },
): ExperimentShape[] {
  return flowShapes({ layout: "flow", boxes }, false);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

export function sketchBoxesFromSpec(
  spec: Record<string, unknown> | undefined,
): SketchBox[] {
  const raw = spec?.boxes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { id?: unknown; label?: unknown; detail?: unknown };
      const label = str(row.label);
      if (!label) return null;
      const id = str(row.id) || `box_${i + 1}`;
      const detail = str(row.detail);
      return detail ? { id, label, detail } : { id, label };
    })
    .filter((b): b is SketchBox => b != null);
}

/** Parse + validate a full sketch spec (layout, boxes, columns, edge labels). */
export function sketchSpecFromRaw(
  spec: Record<string, unknown> | undefined,
): SketchSpec | null {
  if (!spec) return null;
  const layoutRaw = str(spec.layout).toLowerCase();
  const layout = (SKETCH_LAYOUTS as readonly string[]).includes(layoutRaw)
    ? (layoutRaw as SketchLayout)
    : "flow";
  const boxes = sketchBoxesFromSpec(spec);
  const columns = Array.isArray(spec.columns)
    ? (spec.columns as unknown[])
        .map((c) => {
          const col = (c ?? {}) as { title?: unknown; points?: unknown };
          const title = str(col.title);
          const points = Array.isArray(col.points)
            ? col.points.map(str).filter(Boolean)
            : [];
          return title && points.length ? { title, points } : null;
        })
        .filter((c): c is SketchColumn => c != null)
    : undefined;
  const edgeLabels = Array.isArray(spec.edgeLabels)
    ? spec.edgeLabels.map(str)
    : undefined;
  const center = layout === "hub" ? str(spec.center) || undefined : undefined;
  const ok =
    layout === "compare"
      ? (columns?.length ?? 0) >= 2 || boxes.length >= 2
      : boxes.length >= 2;
  if (!ok) return null;
  return { layout, center, boxes, columns, edgeLabels };
}
