import { layoutLesson } from "@/lib/experiment/layout";
import {
  coerceGraph,
  overlayPromptGraph,
  mergeGraph,
  mentionsSecantAndTangent,
  type ExperimentGraph,
} from "@/lib/experiment/graph";
import { clipSpeech, formatBoardText } from "@/lib/experiment/boardText";
import { extractFunctionExpression } from "@/lib/topics/functionParse";

export const EXPERIMENT_GEO = [
  "rectangle",
  "ellipse",
  "triangle",
  "right-triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "cloud",
  "heart",
  "oval",
  "trapezoid",
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
] as const;

export const EXPERIMENT_COLORS = [
  "black",
  "grey",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "red",
  "light-red",
  "violet",
  "light-violet",
  "white",
] as const;

export const EXPERIMENT_FILLS = ["none", "semi", "solid", "pattern"] as const;

export const EXPERIMENT_ROLES = ["part", "label", "title", "note"] as const;
export const EXPERIMENT_SIDES = ["left", "right", "top", "bottom"] as const;

export type ExperimentGeo = (typeof EXPERIMENT_GEO)[number];
export type ExperimentColor = (typeof EXPERIMENT_COLORS)[number];
export type ExperimentFill = (typeof EXPERIMENT_FILLS)[number];
export type ExperimentRole = (typeof EXPERIMENT_ROLES)[number];
export type ExperimentSide = (typeof EXPERIMENT_SIDES)[number];

export type ExperimentShape =
  | {
      id: string;
      type: "geo";
      geo: ExperimentGeo;
      x: number;
      y: number;
      w: number;
      h: number;
      label?: string;
      color?: ExperimentColor;
      fill?: ExperimentFill;
      cluster?: string;
      role?: ExperimentRole;
    }
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      text: string;
      color?: ExperimentColor;
      cluster?: string;
      role?: ExperimentRole;
    }
  | {
      id: string;
      type: "note";
      x: number;
      y: number;
      text: string;
      color?: ExperimentColor;
      cluster?: string;
      role?: ExperimentRole;
    }
  | {
      id: string;
      type: "callout";
      x: number;
      y: number;
      text: string;
      to: string;
      side?: ExperimentSide;
      color?: ExperimentColor;
    }
  | {
      id: string;
      type: "arrow";
      from: string;
      to: string;
      label?: string;
      color?: ExperimentColor;
      /** Second arrow between the same boxes, so the two labels stay apart. */
      lane?: "above" | "below";
    }
  | {
      /** An arrow whose path was laid out ahead of time; drawn exactly, never rerouted. */
      id: string;
      type: "route";
      from: string;
      to: string;
      points: { x: number; y: number }[];
      label?: { text: string; x: number; y: number; w: number; h: number };
      color?: ExperimentColor;
    }
  | {
      /** Raster/SVG reference (e.g. VFPt field diagram) shown on the board. */
      id: string;
      type: "image";
      src: string;
      x: number;
      y: number;
      w: number;
      h: number;
      label?: string;
    };

export function isDrawableNode(
  shape: ExperimentShape,
): shape is Exclude<ExperimentShape, { type: "arrow" } | { type: "route" }> {
  return shape.type !== "arrow" && shape.type !== "route";
}

export function nodeCluster(shape: ExperimentShape): string | undefined {
  if (
    shape.type === "arrow" ||
    shape.type === "callout" ||
    shape.type === "route" ||
    shape.type === "image"
  ) {
    return undefined;
  }
  return shape.cluster;
}

export function nodeRole(shape: ExperimentShape): ExperimentRole | undefined {
  if (
    shape.type === "arrow" ||
    shape.type === "callout" ||
    shape.type === "route" ||
    shape.type === "image"
  ) {
    return undefined;
  }
  return shape.role;
}

export type ExperimentScene = {
  title: string;
  shapes: ExperimentShape[];
};

export type ExperimentCheck = {
  ask: string;
  expect: string;
  hint?: string;
};

export type ExperimentBeat = {
  say: string;
  /** Section heading for a system-design lesson. Spoken text stays in say. */
  section?: string;
  /** Stable key for a system-design sheet, so an edit can redraw just that sheet. */
  sheet?: string;
  /** When this changes, the board is cleared and a new diagram is drawn. */
  diagram?:
    | "architecture"
    | "data"
    | "flow"
    | "sequence"
    | "scale"
    | "reliability"
    | "security"
    | "observe"
    | "deploy";
  example?: string;
  shapes: ExperimentShape[];
  highlight?: string[];
  check?: ExperimentCheck;
  graph?: ExperimentGraph;
};

export type ExperimentLesson = {
  title: string;
  question?: string;
  beats: ExperimentBeat[];
  /** Physics RAG hits shown in the script panel (debug + trust). */
  rag?: {
    corpusTotal: number;
    chunks: Array<{
      id: string;
      source: string;
      title: string;
      topic: string;
      score: number;
      preview: string;
    }>;
    diagrams: Array<{ filename: string; label: string; url: string }>;
  };
};

export type ExperimentFollowup = {
  verdict: "continue" | "simplify" | "revisit";
  say: string;
  lesson: ExperimentLesson;
};

function slugId(value: unknown, fallback: string): string {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^[^a-zA-Z]+/, "s");
  return (cleaned || fallback).slice(0, 40);
}

function clipText(value: unknown, max: number): string {
  return clipSpeech(value, max);
}

function num(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const GEO_ALIAS: Record<string, ExperimentGeo> = {
  circle: "ellipse",
  disk: "ellipse",
  round: "ellipse",
  box: "rectangle",
  rect: "rectangle",
  square: "rectangle",
  rhombus: "diamond",
  "righttriangle": "right-triangle",
  "right_triangle": "right-triangle",
  "right-angled": "right-triangle",
  "rightangled": "right-triangle",
  hypotenuse: "right-triangle",
};

const COLOR_ALIAS: Record<string, ExperimentColor> = {
  gray: "grey",
  grayish: "grey",
  pink: "light-red",
  brown: "orange",
  teal: "green",
  cyan: "light-blue",
  purple: "violet",
};

function asGeo(value: unknown): ExperimentGeo | null {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if ((EXPERIMENT_GEO as readonly string[]).includes(key)) {
    return key as ExperimentGeo;
  }
  return GEO_ALIAS[key] ?? null;
}

function asColor(value: unknown): ExperimentColor | undefined {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (!key) return undefined;
  if ((EXPERIMENT_COLORS as readonly string[]).includes(key)) {
    return key as ExperimentColor;
  }
  return COLOR_ALIAS[key];
}

function asFill(value: unknown): ExperimentFill | undefined {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((EXPERIMENT_FILLS as readonly string[]).includes(key)) {
    return key as ExperimentFill;
  }
  if (key === "filled" || key === "full") return "solid";
  if (key === "empty" || key === "transparent") return "none";
  return undefined;
}

function asRole(value: unknown): ExperimentRole | undefined {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((EXPERIMENT_ROLES as readonly string[]).includes(key)) {
    return key as ExperimentRole;
  }
  if (key === "caption" || key === "callout") return "label";
  if (key === "heading") return "title";
  return undefined;
}

function asCluster(value: unknown): string | undefined {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 40);
  return cleaned || undefined;
}

function asSide(value: unknown): ExperimentSide | undefined {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((EXPERIMENT_SIDES as readonly string[]).includes(key)) {
    return key as ExperimentSide;
  }
  return undefined;
}

function coerceShape(raw: unknown, index: number): ExperimentShape | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = slugId(item.id ?? item.name, `s${index + 1}`);
  const typeRaw = String(item.type ?? item.kind ?? "")
    .trim()
    .toLowerCase();
  const geoHint = asGeo(item.geo ?? item.shape ?? typeRaw);

  const cluster = asCluster(item.cluster ?? item.group ?? item.figure);
  const role =
    asRole(item.role) ??
    (typeRaw === "title" ? "title" : undefined);
  const meta = {
    ...(cluster ? { cluster } : {}),
    ...(role ? { role } : {}),
  };

  if (
    typeRaw === "callout" ||
    typeRaw === "leader" ||
    ((typeRaw === "label" || typeRaw === "text") &&
      (item.to != null || item.target != null || item.for != null))
  ) {
    const text = formatBoardText(item.text ?? item.label ?? item.content, 80);
    const to = slugId(item.to ?? item.target ?? item.for, "");
    if (!text || !to) return null;
    const side = asSide(item.side);
    return {
      id,
      type: "callout",
      x: num(item.x, 40, -200, 1400),
      y: num(item.y, 80 + index * 28, -200, 900),
      text,
      to,
      ...(side ? { side } : {}),
      color: asColor(item.color),
    };
  }

  if (
    typeRaw === "arrow" ||
    (typeRaw === "line" && item.from != null && item.to != null) ||
    (item.from != null && item.to != null && typeRaw !== "callout")
  ) {
    const from = slugId(item.from ?? item.start ?? item.source, "");
    const to = slugId(item.to ?? item.end ?? item.target, "");
    if (!from || !to) return null;
    const label = clipText(item.label ?? item.text, 60);
    return {
      id,
      type: "arrow",
      from,
      to,
      ...(label ? { label } : {}),
      color: asColor(item.color),
    };
  }

  if (typeRaw === "note" || typeRaw === "sticky") {
    const text = formatBoardText(item.text ?? item.label ?? item.content, 400);
    if (!text) return null;
    return {
      id,
      type: "note",
      x: num(item.x, 80 + index * 24, -200, 1400),
      y: num(item.y, 80 + index * 16, -200, 900),
      text,
      color: asColor(item.color) ?? "yellow",
      ...meta,
    };
  }

  if (typeRaw === "text" || typeRaw === "label" || typeRaw === "title") {
    const text = formatBoardText(item.text ?? item.label ?? item.content, 500);
    if (!text) return null;
    return {
      id,
      type: "text",
      x: num(item.x, 80, -200, 1400),
      y: num(item.y, 40, -200, 900),
      text,
      color: asColor(item.color),
      ...meta,
    };
  }

  if (typeRaw === "image" || typeRaw === "svg" || typeRaw === "diagram") {
    const src = String(item.src ?? item.url ?? item.href ?? "").trim();
    if (!src.startsWith("/physics/") && !src.startsWith("https://")) {
      return null;
    }
    return {
      id,
      type: "image",
      src: src.slice(0, 500),
      x: num(item.x, 480, -200, 1400),
      y: num(item.y, 60, -200, 900),
      w: num(item.w ?? item.width, 400, 120, 900),
      h: num(item.h ?? item.height, 300, 90, 700),
      ...(formatBoardText(item.label ?? item.alt ?? item.title, 80)
        ? { label: formatBoardText(item.label ?? item.alt ?? item.title, 80) }
        : {}),
    };
  }

  if (geoHint || typeRaw === "geo" || typeRaw === "shape") {
    const label = formatBoardText(item.label ?? item.text, 400);
    return {
      id,
      type: "geo",
      geo: geoHint ?? "rectangle",
      x: num(item.x, 80 + (index % 4) * 220, -200, 1400),
      y: num(item.y, 100 + Math.floor(index / 4) * 180, -200, 900),
      w: num(item.w ?? item.width, 160, 32, 900),
      h: num(item.h ?? item.height, 120, 32, 900),
      ...(label ? { label } : {}),
      color: asColor(item.color),
      fill: asFill(item.fill),
      ...meta,
    };
  }

  return null;
}

export function sanitizeScene(scene: ExperimentScene): ExperimentScene {
  const seen = new Set<string>();
  const nodes: ExperimentShape[] = [];
  const arrows: ExperimentShape[] = [];

  for (const shape of scene.shapes) {
    if (seen.has(shape.id)) continue;
    seen.add(shape.id);
    if (shape.type === "arrow") arrows.push(shape);
    else nodes.push(shape);
  }

  const nodeIds = new Set(nodes.map((s) => s.id));
  const keptArrows = arrows.filter(
    (arrow) =>
      arrow.type === "arrow" &&
      nodeIds.has(arrow.from) &&
      nodeIds.has(arrow.to) &&
      arrow.from !== arrow.to,
  );
  const keptNodes = nodes.filter(
    (shape) => shape.type !== "callout" || nodeIds.has(shape.to),
  );

  const shapes = [...keptNodes, ...keptArrows];
  if (!shapes.length) {
    throw new Error("Could not draw that. Try a simpler request.");
  }

  return { title: scene.title || "Drawing", shapes };
}

export function coerceScene(raw: unknown): ExperimentScene {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.shapes)
    ? obj.shapes
    : Array.isArray(obj.nodes)
      ? obj.nodes
      : [];
  const shapes = list
    .map((item, index) => coerceShape(item, index))
    .filter((shape): shape is ExperimentShape => Boolean(shape));
  const title = clipText(obj.title, 80) || "Drawing";
  return sanitizeScene({ title, shapes });
}

function coerceCheck(raw: unknown): ExperimentCheck | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Record<string, unknown>;
  const ask = clipText(
    item.ask ?? item.question ?? item.prompt ?? item.check,
    180,
  );
  const expect = clipText(
    item.expect ?? item.answer ?? item.expected ?? item.ok,
    120,
  );
  const hint = clipText(item.hint ?? item.help, 160);
  if (!ask || !expect) return undefined;
  return { ask, expect, ...(hint ? { hint } : {}) };
}

function coerceHighlight(raw: unknown): string[] | undefined {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  const ids = list
    .map((item) => slugId(item, ""))
    .filter(Boolean);
  return ids.length ? ids.slice(0, 8) : undefined;
}

function normKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isThinExpect(
  expect: string,
  title: string,
  question?: string,
): boolean {
  const e = normKey(expect);
  const t = normKey(title);
  const q = normKey(question ?? "").replace(/^(what is|what's|explain|define)\s+/, "");
  if (!e) return true;
  if (e === t || e === q) return true;
  if (t.includes(e) && e.split(" ").length <= 2) return true;
  if (q.includes(e) && e.split(" ").length <= 2) return true;
  return false;
}

function isThinAsk(ask: string, title: string): boolean {
  return /exact phrase|keep it short|repeat the (word|title|topic|name)|say the word|the topic is/i.test(
    ask,
  ) || normKey(ask) === `what is ${normKey(title)}`;
}

function isWeakAsk(ask: string, title: string): boolean {
  return (
    isThinAsk(ask, title) ||
    /in your own words|what did that last step mean/i.test(ask)
  );
}

function isQuestionSay(say: string): boolean {
  const text = say.trim();
  if (!text) return false;
  if (text.endsWith("?")) return true;
  return /^(which|what|where|why|how|who|can you|do you)\b/i.test(text);
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normKey(a).split(" ").filter((part) => part.length > 1));
  const tb = new Set(normKey(b).split(" ").filter((part) => part.length > 1));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const token of ta) {
    if (tb.has(token)) hit += 1;
  }
  return hit / Math.max(ta.size, tb.size);
}

function nearDuplicateSay(a: string, b: string): boolean {
  const na = normKey(a);
  const nb = normKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length < 18 || nb.length < 18) return false;
  return tokenOverlap(a, b) >= 0.85;
}

function pickCheck(
  preferred: ExperimentCheck | undefined,
  fallback: ExperimentCheck | undefined,
  title: string,
): ExperimentCheck | undefined {
  if (preferred && !isWeakAsk(preferred.ask, title)) return preferred;
  if (fallback && !isWeakAsk(fallback.ask, title)) return fallback;
  return preferred ?? fallback;
}

function mergeBeatInto(target: ExperimentBeat, extra: ExperimentBeat) {
  const seen = new Set(target.shapes.map((shape) => shape.id));
  for (const shape of extra.shapes) {
    if (seen.has(shape.id)) continue;
    seen.add(shape.id);
    target.shapes.push(shape);
  }
  if (!target.example && extra.example) target.example = extra.example;
  target.graph = mergeGraph(target.graph, extra.graph);
  if (extra.highlight?.length) {
    target.highlight = [
      ...new Set([...(target.highlight ?? []), ...extra.highlight]),
    ];
  }
}

function mergeNearDuplicateBeats(beats: ExperimentBeat[], title: string) {
  for (let i = beats.length - 1; i >= 1; i -= 1) {
    const current = beats[i]!;
    const prev = beats[i - 1]!;
    if (!nearDuplicateSay(current.say, prev.say)) continue;
    mergeBeatInto(prev, current);
    prev.check = pickCheck(prev.check, current.check, title);
    beats.splice(i, 1);
  }
}

function isStageDirection(say: string): boolean {
  const text = say.trim();
  if (!text) return true;
  if (/^look at (the )?(board|graph|figure|diagram)\.?$/i.test(text)) return true;
  if (
    /^(now )?(draw|sketch|plot|add|make) (a |the |this )?(line|curve|graph|point|circle|box|triangle|arrow)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/^draw a line through points\b/i.test(text)) return true;
  return false;
}

function isOffTopicPrereq(say: string, title: string): boolean {
  if (!/\b(derivative|integral|limit|tangent|secant)\b/i.test(title)) return false;
  return /^(a )?function is a (rule|machine) that takes an input/i.test(say.trim());
}

function absorbNonTeachingBeats(beats: ExperimentBeat[], title: string) {
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    const beat = beats[i]!;
    const junk =
      isStageDirection(beat.say) || isOffTopicPrereq(beat.say, title);
    if (!junk) continue;
    if (beats.length === 1) {
      if (isStageDirection(beat.say) && beat.graph?.expression) {
        beat.say = `This is the graph of y = ${beat.graph.expression}.`;
      }
      continue;
    }
    const target = i > 0 ? beats[i - 1]! : beats[i + 1]!;
    mergeBeatInto(target, beat);
    target.check = pickCheck(target.check, beat.check, title);
    beats.splice(i, 1);
  }
}

function foldQuestionBeats(beats: ExperimentBeat[], title: string) {
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    const beat = beats[i]!;
    if (!isQuestionSay(beat.say)) continue;
    const ask = beat.say.replace(/\s+/g, " ").trim();
    const check: ExperimentCheck = {
      ask,
      expect: beat.check?.expect || ideaFromSay(ask, title) || "the idea just explained",
    };
    if (i === 0) {
      beat.check = pickCheck(check, beat.check, title);
      if (beat.graph?.expression) {
        beat.say = `This is the graph of y = ${beat.graph.expression}.`;
      } else if (beats.length > 1) {
        const next = beats[1]!;
        mergeBeatInto(next, beat);
        next.check = pickCheck(check, next.check, title);
        beats.splice(0, 1);
      }
      continue;
    }
    const prev = beats[i - 1]!;
    mergeBeatInto(prev, beat);
    prev.check = pickCheck(check, prev.check, title);
    beats.splice(i, 1);
  }
}

function isFillerBeat(beat: ExperimentBeat, title: string): boolean {
  const say = beat.say.trim();
  if (beat.shapes.length > 0 || beat.example || beat.graph) return false;
  if (isStageDirection(say) || isOffTopicPrereq(say, title)) return true;
  if (/exact phrase|keep it short|remember this word/i.test(say)) return true;
  const n = normKey(say);
  const t = normKey(title);
  return n === t || n === `remember ${t}` || n === t.replace(/\s+explained$/, "");
}

function isSubstantialBeat(beat: ExperimentBeat): boolean {
  const say = beat.say.trim();
  if (beat.example || beat.graph) return true;
  if (say.length >= 24) return true;
  if (beat.shapes.length > 0 && say.length >= 12) return true;
  return false;
}

function definitionFromSay(say: string, title: string): string | null {
  const titleRe = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${titleRe}\\s+is\\s+(?:when\\s+)?(.+)`, "i"),
    /\bis\s+when\s+(.+)/i,
    /\bis\s+(?:a|an)\s+(.{12,90})/i,
  ];
  for (const pattern of patterns) {
    const match = say.match(pattern);
    const def = match?.[1]?.replace(/[.?!]+$/g, "").trim();
    if (!def || def.length < 12) continue;
    if (isThinExpect(def, title)) continue;
    return def.slice(0, 100);
  }
  return null;
}

function ideaFromSay(say: string, title: string): string {
  const defined = definitionFromSay(say, title);
  if (defined) return defined;
  const first = (say.split(/(?<=[.!?])\s+/)[0] ?? say)
    .replace(/^[.?!,\s]+|[.?!,\s]+$/g, "")
    .slice(0, 100);
  if (first.length >= 12 && !isThinExpect(first, title)) return first;
  return say.replace(/[.?!]+$/g, "").trim().slice(0, 100);
}

function checkForBeat(
  beat: ExperimentBeat,
  title: string,
  question?: string,
): ExperimentCheck | undefined {
  const existing = beat.check;
  if (
    existing &&
    !isThinExpect(existing.expect, title, question) &&
    !isWeakAsk(existing.ask, title)
  ) {
    return existing;
  }
  if (isQuestionSay(beat.say) && !isWeakAsk(beat.say, title)) {
    return {
      ask: beat.say.replace(/\s+/g, " ").trim(),
      expect:
        existing && !isThinExpect(existing.expect, title, question)
          ? existing.expect
          : ideaFromSay(beat.say, title) || "the idea just explained",
    };
  }
  if (isStageDirection(beat.say)) return undefined;
  return existing && !isWeakAsk(existing.ask, title) ? existing : undefined;
}

function beatStatesClaim(beat: ExperimentBeat): boolean {
  return /\b(because|so that|means|measures|equals|causes|therefore|difference|compared|instead|unless|only if|is when)\b/i.test(
    beat.say,
  );
}

/** One check, and only on a step that states a claim. A picture tour gets none. */
function keepChecksWhenNeeded(beats: ExperimentBeat[]) {
  const withCheck = beats.flatMap((beat, index) =>
    beat.check ? [{ beat, index }] : [],
  );
  if (!withCheck.length) return;
  const onClaim = withCheck.filter(
    (item) => beatStatesClaim(item.beat) && isSubstantialBeat(item.beat),
  );
  const keep =
    onClaim.length > 0
      ? onClaim[onClaim.length - 1]!.index
      : beats.length === 1 && isSubstantialBeat(beats[0]!)
        ? withCheck[0]!.index
        : -1;
  for (let i = 0; i < beats.length; i += 1) {
    if (i !== keep) delete beats[i]!.check;
  }
}

function normalizeLessonChecks(
  beats: ExperimentBeat[],
  title: string,
  question?: string,
) {
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    if (isFillerBeat(beats[i]!, title)) beats.splice(i, 1);
  }
  if (!beats.length) return;
  absorbNonTeachingBeats(beats, title);
  mergeNearDuplicateBeats(beats, title);
  foldQuestionBeats(beats, title);
  absorbNonTeachingBeats(beats, title);
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    if (isFillerBeat(beats[i]!, title) && beats.length > 1) beats.splice(i, 1);
  }
  if (!beats.length) return;
  for (const beat of beats) {
    const check = checkForBeat(beat, title, question);
    if (check) beat.check = check;
    else delete beat.check;
  }
  keepChecksWhenNeeded(beats);
}

function lessonMentionsRightTriangle(
  title: string,
  question: string | undefined,
  beats: ExperimentBeat[],
): boolean {
  const blob = [title, question ?? "", ...beats.map((beat) => beat.say)].join(
    " ",
  );
  return /right\s*-?\s*angle|right\s*-?\s*triangle|pythagor|hypotenuse|90\s*(deg|degree|°)|\ba\^2\s*\+\s*b\^2/i.test(
    blob,
  );
}

function useRightTrianglesWhenNeeded(
  title: string,
  question: string | undefined,
  beats: ExperimentBeat[],
) {
  if (!lessonMentionsRightTriangle(title, question, beats)) return;
  for (const beat of beats) {
    for (const shape of beat.shapes) {
      if (shape.type !== "geo") continue;
      if (shape.geo !== "triangle" && shape.geo !== "right-triangle") continue;
      shape.geo = "right-triangle";
      shape.fill = "none";
      shape.cluster = shape.cluster ?? "triangle";
      if (Math.abs(shape.w - shape.h) < 24) {
        shape.h = Math.max(140, Math.round(shape.w * 0.75));
      }
      shape.w = Math.max(180, shape.w);
      shape.h = Math.max(140, shape.h);
    }
  }
}

function promptAsksForPlot(title: string, question: string | undefined): boolean {
  const blob = [question ?? "", title].join("\n");
  if (extractFunctionExpression(blob)) return true;
  if (mentionsSecantAndTangent(blob)) return true;
  return /\b(graph|plot|sketch)\b/i.test(blob);
}

function isBlobCurveShape(shape: ExperimentShape): boolean {
  if (shape.type !== "geo") return false;
  if (shape.geo !== "ellipse" && shape.geo !== "oval") return false;
  const label = (shape.label ?? "").trim();
  return !label || /^(the\s+)?(curve|function|graph)$/i.test(label);
}

function stripFakeCurveDrawings(beats: ExperimentBeat[]) {
  const hasPlot = beats.some((beat) => Boolean(beat.graph?.expression));
  if (!hasPlot) return;
  for (const beat of beats) {
    const drop = new Set(
      beat.shapes.filter(isBlobCurveShape).map((shape) => shape.id),
    );
    if (!drop.size) continue;
    beat.shapes = beat.shapes.filter((shape) => {
      if (drop.has(shape.id)) return false;
      if (shape.type === "callout" && drop.has(shape.to)) return false;
      if (shape.type === "arrow" && (drop.has(shape.from) || drop.has(shape.to))) {
        return false;
      }
      if (shape.type === "callout" && /^(the\s+)?curve$/i.test(shape.text.trim())) {
        return false;
      }
      return true;
    });
  }
}

function ensureLessonGraph(
  title: string,
  question: string | undefined,
  beats: ExperimentBeat[],
) {
  if (!beats.length) return;
  const blob = [question ?? "", title].join("\n");
  if (!promptAsksForPlot(title, question)) {
    for (const beat of beats) {
      if ((beat.graph?.points.length ?? 0) >= 2) continue;
      delete beat.graph;
    }
    return;
  }
  const host =
    beats.find((beat) => beat.graph) ??
    beats.find(isSubstantialBeat) ??
    beats[0]!;
  host.graph = overlayPromptGraph(host.graph, blob);
  stripFakeCurveDrawings(beats);
}

function coerceBeatShapes(raw: unknown, startIndex: number): ExperimentShape[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => coerceShape(item, startIndex + index))
    .filter((shape): shape is ExperimentShape => Boolean(shape));
}

export function coerceLesson(raw: unknown): ExperimentLesson {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = clipText(obj.title, 80) || "Explanation";
  const question = clipText(obj.question, 160) || undefined;
  const rawBeats = Array.isArray(obj.beats)
    ? obj.beats
    : Array.isArray(obj.script)
      ? obj.script
      : Array.isArray(obj.steps)
        ? obj.steps
        : [];

  const beats: ExperimentBeat[] = [];
  let shapeCursor = 0;
  for (const item of rawBeats) {
    if (typeof item === "string") {
      const say = clipText(item, 400);
      if (!say) continue;
      beats.push({ say, shapes: [] });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const beat = item as Record<string, unknown>;
    const say = clipText(
      beat.say ?? beat.text ?? beat.narration ?? beat.script,
      400,
    );
    const example = formatBoardText(
      beat.example ?? beat.code ?? beat.snippet,
      500,
    );
    const shapes = coerceBeatShapes(
      beat.shapes ?? beat.draw ?? beat.board,
      shapeCursor,
    );
    shapeCursor += shapes.length;
    const graph = coerceGraph(beat.graph ?? beat.plot ?? beat.chart);
    if (!say && !shapes.length && !graph) continue;
    const check = coerceCheck(beat.check ?? beat.quiz ?? beat.pause);
    const highlight = coerceHighlight(
      beat.highlight ?? beat.highlights ?? beat.focus,
    );
    beats.push({
      say: say || "Look at the board.",
      ...(example ? { example } : {}),
      shapes,
      ...(graph ? { graph } : {}),
      ...(highlight ? { highlight } : {}),
      ...(check ? { check } : {}),
    });
  }

  const leftover = coerceBeatShapes(
    obj.shapes ?? obj.nodes,
    shapeCursor,
  );
  if (leftover.length) {
    if (!beats.length) {
      beats.push({
        say: title,
        shapes: leftover,
      });
    } else if (beats.every((beat) => beat.shapes.length === 0)) {
      beats[0] = { ...beats[0]!, shapes: leftover };
    } else {
      const last = beats[beats.length - 1]!;
      beats[beats.length - 1] = {
        ...last,
        shapes: [...last.shapes, ...leftover],
      };
    }
  }

  if (!beats.length) {
    throw new Error("Could not explain that. Try another question.");
  }

  const allShapes = beats.flatMap((beat) => beat.shapes);
  if (allShapes.length) {
    try {
      const cleaned = sanitizeScene({ title, shapes: allShapes }).shapes;
      const keep = new Set(cleaned.map((shape) => shape.id));
      for (const beat of beats) {
        beat.shapes = beat.shapes.filter((shape) => keep.has(shape.id));
      }
    } catch {
      for (const beat of beats) beat.shapes = [];
    }
  }

  normalizeLessonChecks(beats, title, question);
  useRightTrianglesWhenNeeded(title, question, beats);
  ensureLessonGraph(title, question, beats);

  return layoutLesson({
    title,
    ...(question ? { question } : {}),
    beats,
  });
}

export function lessonToScene(lesson: ExperimentLesson): ExperimentScene {
  return {
    title: lesson.title,
    shapes: lesson.beats.flatMap((beat) => beat.shapes),
  };
}

const SIMPLE_SHAPES: Array<{
  re: RegExp;
  geo: ExperimentGeo;
  title: string;
  w: number;
  h: number;
}> = [
  { re: /^(an?\s+)?square\b/, geo: "rectangle", title: "Square", w: 220, h: 220 },
  { re: /^(an?\s+)?circle\b/, geo: "ellipse", title: "Circle", w: 220, h: 220 },
  { re: /^(an?\s+)?ellipse\b/, geo: "ellipse", title: "Ellipse", w: 280, h: 170 },
  { re: /^(an?\s+)?oval\b/, geo: "oval", title: "Oval", w: 280, h: 170 },
  { re: /^(an?\s+)?right[-\s]?triangle\b/, geo: "right-triangle", title: "Right triangle", w: 260, h: 190 },
  { re: /^(an?\s+)?triangle\b/, geo: "triangle", title: "Triangle", w: 240, h: 210 },
  { re: /^(an?\s+)?diamond\b/, geo: "diamond", title: "Diamond", w: 220, h: 220 },
  { re: /^(an?\s+)?pentagon\b/, geo: "pentagon", title: "Pentagon", w: 230, h: 230 },
  { re: /^(an?\s+)?hexagon\b/, geo: "hexagon", title: "Hexagon", w: 240, h: 220 },
  { re: /^(an?\s+)?octagon\b/, geo: "octagon", title: "Octagon", w: 230, h: 230 },
  { re: /^(an?\s+)?star\b/, geo: "star", title: "Star", w: 230, h: 230 },
  { re: /^(an?\s+)?heart\b/, geo: "heart", title: "Heart", w: 220, h: 210 },
  { re: /^(an?\s+)?cloud\b/, geo: "cloud", title: "Cloud", w: 280, h: 170 },
  { re: /^(an?\s+)?rectangle\b/, geo: "rectangle", title: "Rectangle", w: 300, h: 180 },
];

/**
 * Instant board for prompts that are only a single named shape.
 * Leaves richer requests for the model.
 */
export function simpleShapeScene(prompt: string): ExperimentScene | null {
  const cleaned = prompt
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/^(please\s+)?(draw|sketch|make|add|show)\s+/i, "")
    .trim();
  if (!cleaned) return null;

  for (const entry of SIMPLE_SHAPES) {
    if (!entry.re.test(cleaned)) continue;
    const rest = cleaned.replace(entry.re, "").trim();
    if (rest.length > 0) return null;
    return {
      title: entry.title,
      shapes: [
        {
          id: "shape",
          type: "geo",
          geo: entry.geo,
          x: 120,
          y: 80,
          w: entry.w,
          h: entry.h,
          label: entry.title,
          color: "blue",
          fill: "semi",
        },
      ],
    };
  }
  return null;
}

export function simpleShapeLesson(prompt: string): ExperimentLesson | null {
  const scene = simpleShapeScene(prompt);
  if (!scene) return null;
  const name = scene.title.toLowerCase();
  return {
    title: scene.title,
    beats: [
      {
        say: `Here is a ${name}. I'll put it on the board so you can see the shape.`,
        shapes: scene.shapes,
      },
    ],
  };
}
