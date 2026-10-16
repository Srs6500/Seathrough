import ELK from "elkjs/lib/elk.bundled.js";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type RouteLabel = Rect & { text: string };

export type LayoutBox = { id: string; w: number; h: number; partition?: number };
export type LayoutLink = { id: string; from: string; to: string; label?: string };

export type LaidOutRoute = { from: string; to: string; points: Point[]; label?: RouteLabel };
export type GraphLayout = {
  boxes: Map<string, Rect>;
  routes: Map<string, LaidOutRoute>;
};

/** Sized for tldraw's small draw font, with room so a label never wraps. */
const LABEL_CHAR_W = 11;
const LABEL_PAD_W = 20;
const LABEL_H = 30;
const ORIGIN = 24;

export function labelRect(text: string): { w: number; h: number } {
  return { w: Math.ceil(text.length * LABEL_CHAR_W + LABEL_PAD_W), h: LABEL_H };
}

type ElkPoint = { x: number; y: number };
type ElkLabel = { text?: string; x?: number; y?: number; width?: number; height?: number };
type ElkEdge = {
  id: string;
  sections?: { startPoint: ElkPoint; bendPoints?: ElkPoint[]; endPoint: ElkPoint }[];
  labels?: ElkLabel[];
};
type ElkNode = { id: string; x?: number; y?: number; width?: number; height?: number };
type ElkGraph = { children?: ElkNode[]; edges?: ElkEdge[] };

const elk = new ELK();

function layoutOptions(direction: "RIGHT" | "DOWN", spread: number, partitioned: boolean) {
  const px = (value: number) => String(Math.round(value * spread));
  return {
    "elk.algorithm": "layered",
    "elk.direction": direction,
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    "elk.spacing.nodeNode": px(48),
    "elk.layered.spacing.nodeNodeBetweenLayers": px(80),
    "elk.spacing.edgeNode": px(24),
    "elk.layered.spacing.edgeNodeBetweenLayers": px(28),
    "elk.spacing.edgeEdge": px(16),
    "elk.layered.spacing.edgeEdgeBetweenLayers": px(16),
    "elk.spacing.edgeLabel": "8",
    "elk.spacing.componentComponent": px(80),
    "elk.edgeLabels.placement": "CENTER",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.mergeEdges": "false",
    ...(partitioned ? { "elk.partitioning.activate": "true" } : {}),
  };
}

function cleanPoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const p = { x: Math.round(point.x), y: Math.round(point.y) };
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    if (last && before && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

async function runElk(
  boxes: LayoutBox[],
  links: LayoutLink[],
  direction: "RIGHT" | "DOWN",
  spread: number,
): Promise<GraphLayout> {
  const partitioned = boxes.some((box) => box.partition !== undefined);
  const graph = (await elk.layout({
    id: "root",
    layoutOptions: layoutOptions(direction, spread, partitioned),
    children: boxes.map((box) => ({
      id: box.id,
      width: box.w,
      height: box.h,
      ...(box.partition !== undefined
        ? { layoutOptions: { "elk.partitioning.partition": String(box.partition) } }
        : {}),
    })),
    edges: links.map((link) => ({
      id: link.id,
      sources: [link.from],
      targets: [link.to],
      ...(link.label
        ? { labels: [{ text: link.label, width: labelRect(link.label).w, height: LABEL_H }] }
        : {}),
    })),
  })) as unknown as ElkGraph;

  const placed = new Map<string, Rect>();
  for (const child of graph.children ?? []) {
    placed.set(child.id, {
      x: Math.round((child.x ?? 0) + ORIGIN),
      y: Math.round((child.y ?? 0) + ORIGIN),
      w: child.width ?? 0,
      h: child.height ?? 0,
    });
  }
  const byId = new Map(links.map((link) => [link.id, link]));
  const routes = new Map<string, LaidOutRoute>();
  for (const edge of graph.edges ?? []) {
    const link = byId.get(edge.id);
    const section = edge.sections?.[0];
    if (!link || !section) continue;
    const shift = (point: ElkPoint): Point => ({ x: point.x + ORIGIN, y: point.y + ORIGIN });
    const points = cleanPoints([
      shift(section.startPoint),
      ...(section.bendPoints ?? []).map(shift),
      shift(section.endPoint),
    ]);
    const elkLabel = edge.labels?.[0];
    const label =
      link.label && elkLabel
        ? {
            text: link.label,
            x: Math.round((elkLabel.x ?? 0) + ORIGIN),
            y: Math.round((elkLabel.y ?? 0) + ORIGIN),
            w: elkLabel.width ?? labelRect(link.label).w,
            h: elkLabel.height ?? LABEL_H,
          }
        : undefined;
    routes.set(link.id, { from: link.from, to: link.to, points, ...(label ? { label } : {}) });
  }
  return { boxes: placed, routes };
}

function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** Axis-aligned segment against a rectangle's interior (touching an edge is fine). */
function segmentHits(a: Point, b: Point, rect: Rect): boolean {
  const inset = 2;
  const r = { x: rect.x + inset, y: rect.y + inset, w: rect.w - inset * 2, h: rect.h - inset * 2 };
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return minX < r.x + r.w && maxX > r.x && minY < r.y + r.h && maxY > r.y;
}

/** Everything that would read as an overlap on the board. Empty means the layout is clean. */
export function layoutProblems(layout: GraphLayout): string[] {
  const problems: string[] = [];
  const boxes = [...layout.boxes.entries()];
  const routes = [...layout.routes.entries()];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (overlaps(boxes[i]![1], boxes[j]![1], 8)) problems.push(`boxes ${boxes[i]![0]} and ${boxes[j]![0]} overlap`);
    }
  }
  const labels = routes.flatMap(([id, route]) => (route.label ? [[id, route.label] as const] : []));
  for (const [id, label] of labels) {
    for (const [boxId, box] of boxes) {
      if (overlaps(label, box, 2)) problems.push(`label of ${id} sits on box ${boxId}`);
    }
  }
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      if (overlaps(labels[i]![1], labels[j]![1], 2)) problems.push(`labels of ${labels[i]![0]} and ${labels[j]![0]} overlap`);
    }
  }
  for (const [id, route] of routes) {
    for (let k = 1; k < route.points.length; k += 1) {
      for (const [boxId, box] of boxes) {
        if (boxId === route.from || boxId === route.to) continue;
        if (segmentHits(route.points[k - 1]!, route.points[k]!, box)) {
          problems.push(`arrow ${id} crosses box ${boxId}`);
        }
      }
      for (const [labelId, label] of labels) {
        if (labelId === id) continue;
        if (segmentHits(route.points[k - 1]!, route.points[k]!, label)) {
          problems.push(`arrow ${id} runs through the label of ${labelId}`);
        }
      }
    }
  }
  for (const [id, route] of routes) {
    const from = layout.boxes.get(route.from);
    const to = layout.boxes.get(route.to);
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    if (!from || !to || !first || !last || route.points.length < 2) {
      problems.push(`arrow ${id} is missing an end`);
    } else if (!onBorder(first, from) || !onBorder(last, to)) {
      problems.push(`arrow ${id} does not touch its boxes`);
    }
    route.points.slice(1).forEach((point, k) => {
      const prev = route.points[k]!;
      if (prev.x !== point.x && prev.y !== point.y) problems.push(`arrow ${id} has a diagonal segment`);
    });
  }
  const segments = routes.flatMap(([id, route]) =>
    route.points.slice(1).map((point, k) => ({ id, a: route.points[k]!, b: point })),
  );
  const reported = new Set<string>();
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const s = segments[i]!;
      const t = segments[j]!;
      if (s.id === t.id || reported.has(`${s.id}|${t.id}`)) continue;
      if (sharesRun(s.a, s.b, t.a, t.b)) {
        reported.add(`${s.id}|${t.id}`);
        problems.push(`arrows ${s.id} and ${t.id} are drawn on top of each other`);
      }
    }
  }
  return problems;
}

function onBorder(point: Point, rect: Rect): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
  const insideX = point.x >= rect.x - 1.5 && point.x <= rect.x + rect.w + 1.5;
  const insideY = point.y >= rect.y - 1.5 && point.y <= rect.y + rect.h + 1.5;
  return (
    insideX &&
    insideY &&
    (near(point.x, rect.x) || near(point.x, rect.x + rect.w) || near(point.y, rect.y) || near(point.y, rect.y + rect.h))
  );
}

/** Two axis-aligned segments on the same line that overlap for more than a few pixels. */
function sharesRun(a: Point, b: Point, c: Point, d: Point): boolean {
  const run = 6;
  if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < 3) {
    const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    return hi - lo > run;
  }
  if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < 3) {
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    return hi - lo > run;
  }
  return false;
}

/**
 * Lays out boxes and arrows together so nothing overlaps: boxes are placed
 * to cut crossings, every arrow gets its own path and attachment point, and
 * labels get reserved room. A crowded result is retried with more spacing.
 */
export async function layoutGraph(
  boxes: LayoutBox[],
  links: LayoutLink[],
  direction: "RIGHT" | "DOWN",
  options?: { spreads?: number[] },
): Promise<GraphLayout> {
  const ids = new Set(boxes.map((box) => box.id));
  const usable = links.filter((link) => ids.has(link.from) && ids.has(link.to) && link.from !== link.to);
  let best: GraphLayout | null = null;
  let bestProblems = Infinity;
  const spreads = options?.spreads ?? [1, 1.4, 1.9];
  for (const spread of spreads) {
    const layout = await runElk(boxes, usable, direction, spread);
    const problems = layoutProblems(layout).length;
    if (problems < bestProblems) {
      best = layout;
      bestProblems = problems;
    }
    if (!problems) break;
  }
  return best!;
}

function pathCandidates(from: Rect, to: Rect, shift: number): Point[][] {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const towardX = (rect: Rect, other: number) => (other >= rect.x + rect.w / 2 ? rect.x + rect.w : rect.x);
  const candidates: Point[][] = [];
  const sameColumn = Math.abs(fc.x - tc.x) < Math.min(from.w, to.w) / 2;
  if (sameColumn) {
    const x = tc.x + shift;
    candidates.push(
      tc.y > fc.y
        ? [{ x, y: from.y + from.h }, { x, y: to.y }]
        : [{ x, y: from.y }, { x, y: to.y + to.h }],
    );
  }
  if (tc.y > from.y + from.h) {
    candidates.push([
      { x: towardX(from, tc.x), y: fc.y + shift },
      { x: tc.x + shift, y: fc.y + shift },
      { x: tc.x + shift, y: to.y },
    ]);
    candidates.push([
      { x: fc.x + shift, y: from.y + from.h },
      { x: fc.x + shift, y: tc.y + shift },
      { x: towardX(to, fc.x), y: tc.y + shift },
    ]);
    const lane = to.y - 16 + shift / 2;
    candidates.push([
      { x: fc.x + shift, y: from.y + from.h },
      { x: fc.x + shift, y: lane },
      { x: tc.x + shift, y: lane },
      { x: tc.x + shift, y: to.y },
    ]);
  } else {
    const startX = towardX(from, tc.x);
    const endX = towardX(to, fc.x);
    const midX = Math.round((startX + endX) / 2) + shift;
    candidates.push([
      { x: startX, y: fc.y + shift },
      { x: midX, y: fc.y + shift },
      { x: midX, y: tc.y + shift },
      { x: endX, y: tc.y + shift },
    ]);
  }
  return candidates;
}

/**
 * An orthogonal path between two placed boxes that avoids every other box and
 * every path already taken. For sheets whose positions are fixed by meaning,
 * like a sequence of steps. Exits slide along the box side when the middle is taken.
 */
export function routeAround(from: Rect, to: Rect, obstacles: Rect[], taken: Point[][] = []): Point[] {
  const clear = (path: Point[]) =>
    path.every(
      (point, index) =>
        index === 0 ||
        (obstacles.every((rect) => !segmentHits(path[index - 1]!, point, rect)) &&
          taken.every((other) =>
            other.every((q, k) => k === 0 || !sharesRun(path[index - 1]!, point, other[k - 1]!, q)),
          )),
    );
  const room = Math.min(from.w, from.h, to.w, to.h) / 2 - 8;
  const shifts = [0, 14, -14, 28, -28].filter((shift) => Math.abs(shift) <= room);
  let fallback: Point[] | null = null;
  for (const shift of shifts) {
    for (const candidate of pathCandidates(from, to, shift)) {
      const path = cleanPoints(candidate);
      fallback ??= path;
      if (clear(path)) return path;
    }
  }
  return fallback!;
}
