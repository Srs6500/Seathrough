"use client";

import {
  AssetRecordType,
  createShapeId,
  getHashForString,
  getIndices,
  toRichText,
  type Editor,
  type TLShapeId,
} from "tldraw";
import type { TLLineShapePoint } from "@tldraw/tlschema";
import {
  SHAPE_GAP,
  isOrganicGeo,
  layoutLesson,
  shapeBounds,
} from "@/lib/experiment/layout";
import { looksLikeCode } from "@/lib/experiment/boardText";
import { freshNodeIds } from "@/lib/experiment/systemDesign/diff";
import type {
  ExperimentBeat,
  ExperimentColor,
  ExperimentLesson,
  ExperimentScene,
  ExperimentShape,
} from "@/lib/experiment/scene";

export type ExperimentDrawSession = {
  dx: number;
  dy: number;
  idMap: Map<string, TLShapeId>;
  created: TLShapeId[];
  clusterOf: Map<TLShapeId, string>;
  diagram?: ExperimentBeat["diagram"];
  /** Every shape drawn for a sheet, arrows and highlights included, so the sheet can be redrawn. */
  sheets: Map<string, TLShapeId[]>;
  sheet?: string;
};

function track(session: ExperimentDrawSession, ...ids: TLShapeId[]) {
  if (!session.sheet || !ids.length) return;
  const list = session.sheets.get(session.sheet);
  if (list) list.push(...ids);
  else session.sheets.set(session.sheet, [...ids]);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function nodeBounds(shape: ExperimentShape): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const box = shapeBounds(shape);
  if (!box) return null;
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

function pageBoxesOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
  gap: number,
) {
  return (
    a.minX < b.maxX + gap &&
    a.maxX + gap > b.minX &&
    a.minY < b.maxY + gap &&
    a.maxY + gap > b.minY
  );
}

function nudgeClearOfPlaced(
  editor: Editor,
  id: TLShapeId,
  placed: TLShapeId[],
  options?: { skip?: Set<TLShapeId>; gap?: number },
) {
  if (!placed.length) return;
  const skip = options?.skip ?? new Set<TLShapeId>();
  const gap = options?.gap ?? SHAPE_GAP;
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const bounds = editor.getShapePageBounds(id);
    const shape = editor.getShape(id);
    if (!bounds || !shape) return;

    let hit: { minX: number; minY: number; maxX: number; maxY: number } | null =
      null;
    for (const otherId of placed) {
      if (otherId === id || skip.has(otherId)) continue;
      const other = editor.getShapePageBounds(otherId);
      if (other && pageBoxesOverlap(bounds, other, gap)) {
        hit = other;
        break;
      }
    }
    if (!hit) return;

    const overlapX = Math.min(bounds.maxX, hit.maxX) - Math.max(bounds.minX, hit.minX);
    const sameRow = Math.abs(bounds.minY - hit.minY) < 48;
    let nextX = shape.x;
    let nextY = shape.y;
    if (sameRow && overlapX < 140) {
      nextX += hit.maxX + gap - bounds.minX;
    } else {
      nextY += hit.maxY + gap - bounds.minY;
    }
    if (nextX === shape.x && nextY === shape.y) {
      nextY += gap;
    }
    editor.updateShape({ id, type: shape.type, x: nextX, y: nextY });
  }
}

function sceneOffset(editor: Editor, scene: ExperimentScene) {
  const boxes = scene.shapes
    .map(nodeBounds)
    .filter((b): b is NonNullable<typeof b> => Boolean(b));
  if (!boxes.length) return { dx: 0, dy: 0 };

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const viewport = editor.getViewportPageBounds();
  return {
    dx: viewport.center.x - (minX + maxX) / 2,
    dy: viewport.center.y - 40 - (minY + maxY) / 2,
  };
}

function colorOf(shape: { color?: ExperimentColor }, fallback: ExperimentColor) {
  return shape.color ?? fallback;
}

function createNode(
  editor: Editor,
  shape: ExperimentShape,
  dx: number,
  dy: number,
  extras: TLShapeId[],
): TLShapeId | null {
  try {
    return createNodeUnsafe(editor, shape, dx, dy, extras);
  } catch (error) {
    console.warn("[experiment-draw] skipped shape", shape.id, error);
    return null;
  }
}

function linePoints(
  coords: Array<{ x: number; y: number }>,
): Record<string, TLLineShapePoint> {
  const points: Record<string, TLLineShapePoint> = {};
  coords.forEach((point, i) => {
    const id = `a${i + 1}`;
    points[id] = {
      id,
      index: id as TLLineShapePoint["index"],
      x: point.x,
      y: point.y,
    };
  });
  return points;
}

function createRightTriangle(
  editor: Editor,
  shape: Extract<ExperimentShape, { type: "geo" }>,
  dx: number,
  dy: number,
  extras: TLShapeId[],
): TLShapeId {
  const x = shape.x + dx;
  const y = shape.y + dy;
  const w = Math.max(180, shape.w);
  const h = Math.max(140, shape.h);
  const color = colorOf(shape, "blue");
  const id = createShapeId();
  editor.createShape({
    id,
    type: "line",
    x,
    y,
    props: {
      color,
      dash: "draw",
      size: "l",
      spline: "line",
      scale: 1,
      points: linePoints([
        { x: 0, y: h },
        { x: w, y: h },
        { x: 0, y: 0 },
        { x: 0, y: h },
      ]),
    },
  });
  const mark = Math.max(20, Math.min(40, Math.round(Math.min(w, h) * 0.14)));
  const squareId = createShapeId();
  editor.createShape({
    id: squareId,
    type: "geo",
    x,
    y: y + h - mark,
    props: {
      geo: "rectangle",
      w: mark,
      h: mark,
      color,
      fill: "none",
      dash: "draw",
      size: "s",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      richText: toRichText(""),
    },
  });
  extras.push(squareId);
  const label = (shape.label ?? "").trim();
  if (label && !looksLikeCode(label)) {
    const textId = createShapeId();
    editor.createShape({
      id: textId,
      type: "text",
      x: x + 28,
      y: y + h * 0.42,
      props: {
        color: "black",
        size: "m",
        font: "draw",
        textAlign: "start",
        autoSize: true,
        w: Math.min(160, w * 0.5),
        richText: toRichText(label),
      },
    });
    extras.push(textId);
  }
  return id;
}

function createNodeUnsafe(
  editor: Editor,
  shape: ExperimentShape,
  dx: number,
  dy: number,
  extras: TLShapeId[],
): TLShapeId | null {
  if (shape.type === "geo" && shape.geo === "right-triangle") {
    return createRightTriangle(editor, shape, dx, dy, extras);
  }
  const id = createShapeId();
  if (shape.type === "geo") {
    const label = shape.label ?? "";
    const code = looksLikeCode(label);
    // right-triangle is handled above; remaining geos match tldraw's geo styles.
    const geo =
      shape.geo === "right-triangle" ? "triangle" : shape.geo;
    editor.createShape({
      id,
      type: "geo",
      x: shape.x + dx,
      y: shape.y + dy,
      props: {
        geo: shape.geo === "right-triangle" ? "triangle" : shape.geo,
        w: shape.w,
        h: shape.h,
        color: colorOf(shape, "blue"),
        fill: shape.fill ?? "semi",
        dash: "draw",
        size: code ? "s" : "m",
        font: code ? "mono" : "draw",
        align: code ? "start" : "middle",
        verticalAlign: code ? "start" : "middle",
        richText: toRichText(label),
      },
    });
    return id;
  }
  if (shape.type === "text") {
    const box = shapeBounds(shape);
    const code = looksLikeCode(shape.text);
    editor.createShape({
      id,
      type: "text",
      x: shape.x + dx,
      y: shape.y + dy,
      props: {
        color: colorOf(shape, "black"),
        size: code ? "s" : "l",
        font: code ? "mono" : "draw",
        textAlign: code ? "start" : "middle",
        autoSize: true,
        w: box?.w ?? 320,
        richText: toRichText(shape.text),
      },
    });
    return id;
  }
  if (shape.type === "note") {
    editor.createShape({
      id,
      type: "note",
      x: shape.x + dx,
      y: shape.y + dy,
      props: {
        color: colorOf(shape, "yellow"),
        font: "draw",
        size: "s",
        align: "middle",
        verticalAlign: "middle",
        richText: toRichText(shape.text),
      },
    });
    return id;
  }
  if (shape.type === "image") {
    const assetId = AssetRecordType.createId(getHashForString(shape.src));
    try {
      editor.createAssets([
        {
          id: assetId,
          type: "image",
          typeName: "asset",
          props: {
            name: shape.label || shape.id,
            src: shape.src,
            w: shape.w,
            h: shape.h,
            mimeType: shape.src.toLowerCase().endsWith(".svg")
              ? "image/svg+xml"
              : "image/png",
            isAnimated: false,
          },
          meta: {},
        },
      ]);
      editor.createShape({
        id,
        type: "image",
        x: shape.x + dx,
        y: shape.y + dy,
        props: {
          assetId,
          w: shape.w,
          h: shape.h,
          playing: false,
          url: "",
          crop: null,
          flipX: false,
          flipY: false,
          altText: shape.label || "",
        },
      });
      return id;
    } catch (error) {
      console.warn("[experiment-draw] image failed", shape.id, error);
      return null;
    }
  }
  if (shape.type === "callout") {
    const box = shapeBounds(shape);
    editor.createShape({
      id,
      type: "text",
      x: shape.x + dx,
      y: shape.y + dy,
      props: {
        color: colorOf(shape, "black"),
        size: "m",
        font: "draw",
        textAlign: "start",
        autoSize: true,
        w: box?.w ?? 220,
        richText: toRichText(shape.text),
      },
    });
    return id;
  }
  return null;
}

function connectArrow(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
  label: string | undefined,
  color: ExperimentColor,
  lane?: "above" | "below",
): TLShapeId | null {
  const startBounds = editor.getShapePageBounds(fromId);
  const endBounds = editor.getShapePageBounds(toId);
  if (!startBounds || !endBounds) return null;

  const dx = endBounds.center.x - startBounds.center.x;
  const dy = endBounds.center.y - startBounds.center.y;
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const startAnchor = vertical
    ? { x: 0.5, y: dy >= 0 ? 1 : 0 }
    : { x: dx >= 0 ? 1 : 0, y: 0.5 };
  const endAnchor = vertical
    ? { x: 0.5, y: dy >= 0 ? 0 : 1 }
    : { x: dx >= 0 ? 0 : 1, y: 0.5 };
  const shift = lane === "above" ? -22 : lane === "below" ? 22 : 0;
  const start = {
    x: startBounds.minX + startBounds.width * startAnchor.x,
    y: startBounds.minY + startBounds.height * startAnchor.y + shift,
  };
  const end = {
    x: endBounds.minX + endBounds.width * endAnchor.x,
    y: endBounds.minY + endBounds.height * endAnchor.y + shift,
  };
  const origin = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
  };
  const arrowId = createShapeId();

  try {
    editor.createShape({
      id: arrowId,
      type: "arrow",
      x: origin.x,
      y: origin.y,
      props: {
        color,
        dash: "draw",
        size: "m",
        kind: "elbow",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        start: { x: start.x - origin.x, y: start.y - origin.y },
        end: { x: end.x - origin.x, y: end.y - origin.y },
        ...(label ? { richText: toRichText(label) } : {}),
      },
    });
  } catch (error) {
    console.warn("[experiment-draw] arrow create failed", error);
    return null;
  }
  try {
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: startAnchor,
          isExact: false,
          isPrecise: true,
          snap: "edge",
        },
      },
      {
        fromId: arrowId,
        toId: toId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: endAnchor,
          isExact: false,
          isPrecise: true,
          snap: "edge",
        },
      },
    ]);
  } catch (error) {
    console.warn("[experiment-draw] arrow binding failed", error);
  }
  return arrowId;
}

/**
 * Draws a path that was laid out ahead of time, exactly as given: a line
 * through every bend, an arrowhead on the last leg, and the label in the
 * spot that was kept free for it. Nothing here reroutes or moves.
 */
function drawRoute(
  editor: Editor,
  shape: Extract<ExperimentShape, { type: "route" }>,
  dx: number,
  dy: number,
): TLShapeId[] {
  const points = shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  if (points.length < 2) return [];
  const color = colorOf(shape, "grey");
  const ids: TLShapeId[] = [];
  try {
    if (points.length > 2) {
      const body = points.slice(0, -1);
      const origin = body[0]!;
      const indices = getIndices(body.length);
      const lineId = createShapeId();
      editor.createShape({
        id: lineId,
        type: "line",
        x: origin.x,
        y: origin.y,
        props: {
          color,
          dash: "draw",
          size: "m",
          spline: "line",
          scale: 1,
          points: Object.fromEntries(
            body.map((point, index) => {
              const key = indices[index]!;
              return [key, { id: key, index: key, x: point.x - origin.x, y: point.y - origin.y }];
            }),
          ),
        },
      });
      ids.push(lineId);
    }
    const start = points[points.length - 2]!;
    const end = points[points.length - 1]!;
    const arrowId = createShapeId();
    editor.createShape({
      id: arrowId,
      type: "arrow",
      x: start.x,
      y: start.y,
      props: {
        color,
        dash: "draw",
        size: "m",
        kind: "arc",
        bend: 0,
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        start: { x: 0, y: 0 },
        end: { x: end.x - start.x, y: end.y - start.y },
      },
    });
    ids.push(arrowId);
    if (shape.label) {
      const labelId = createShapeId();
      editor.createShape({
        id: labelId,
        type: "text",
        x: shape.label.x + dx,
        y: shape.label.y + dy,
        props: {
          color: "black",
          size: "s",
          font: "draw",
          textAlign: "middle",
          autoSize: false,
          w: shape.label.w,
          richText: toRichText(shape.label.text),
        },
      });
      ids.push(labelId);
    }
  } catch (error) {
    console.warn("[experiment-draw] route failed", shape.id, error);
  }
  return ids;
}

export async function applyExperimentShapes(
  editor: Editor,
  shapes: ExperimentShape[],
  session: ExperimentDrawSession,
  options: { pace?: number } = {},
) {
  const pace = options.pace ?? 70;
  const nodes = shapes.filter(
    (s) => s.type !== "arrow" && s.type !== "callout" && s.type !== "route",
  );
  const callouts = shapes.filter((s) => s.type === "callout");
  const arrows = shapes.filter((s) => s.type === "arrow");
  const routes = shapes.filter((s) => s.type === "route");

  for (const shape of nodes) {
    const extras: TLShapeId[] = [];
    const id = createNode(editor, shape, session.dx, session.dy, extras);
    if (!id) continue;
    const cluster =
      shape.type === "geo" || shape.type === "text" || shape.type === "note"
        ? shape.cluster
        : undefined;
    if (cluster) {
      session.clusterOf.set(id, cluster);
      for (const extra of extras) session.clusterOf.set(extra, cluster);
    }
    const isOrganicPart =
      shape.type === "geo" && Boolean(cluster) && isOrganicGeo(shape);
    // A system-design sheet arrives fully laid out; nudging a box would detach its arrows.
    if (!isOrganicPart && !session.sheet) {
      const skip = new Set<TLShapeId>();
      for (const [placedId, placedCluster] of session.clusterOf) {
        if (!cluster || placedCluster !== cluster) continue;
        const placed = editor.getShape(placedId);
        if (placed?.type === "geo") {
          const geo = (placed.props as { geo?: string }).geo;
          if (
            geo === "ellipse" ||
            geo === "oval" ||
            geo === "heart" ||
            geo === "cloud"
          ) {
            skip.add(placedId);
          }
        }
      }
      nudgeClearOfPlaced(editor, id, session.created, { skip });
    }
    session.idMap.set(shape.id, id);
    session.created.push(id, ...extras);
    track(session, id, ...extras);
    await sleep(pace);
  }

  for (const shape of callouts) {
    const id = createNode(editor, shape, session.dx, session.dy, []);
    if (!id) continue;
    nudgeClearOfPlaced(editor, id, session.created);
    session.idMap.set(shape.id, id);
    session.created.push(id);
    track(session, id);
    const toId = session.idMap.get(shape.to);
    if (toId) {
      const arrowId = connectArrow(editor, id, toId, undefined, colorOf(shape, "grey"));
      if (arrowId) track(session, arrowId);
    }
    await sleep(pace);
  }

  for (const shape of arrows) {
    if (shape.type !== "arrow") continue;
    const fromId = session.idMap.get(shape.from);
    const toId = session.idMap.get(shape.to);
    if (!fromId || !toId) continue;
    const arrowId = connectArrow(
      editor,
      fromId,
      toId,
      shape.label,
      colorOf(shape, "grey"),
      shape.lane,
    );
    if (arrowId) track(session, arrowId);
    await sleep(pace);
  }

  for (const shape of routes) {
    if (shape.type !== "route") continue;
    const ids = drawRoute(editor, shape, session.dx, session.dy);
    if (!ids.length) continue;
    session.created.push(...ids);
    track(session, ...ids);
    await sleep(pace);
  }
}

export async function highlightExperimentIds(
  editor: Editor,
  session: ExperimentDrawSession,
  ids: string[],
) {
  for (const key of ids) {
    const targetId = session.idMap.get(key);
    if (!targetId) continue;
    const bounds = editor.getShapePageBounds(targetId);
    if (!bounds) continue;
    const id = createShapeId();
    try {
      editor.createShape({
        id,
        type: "geo",
        x: bounds.minX - 12,
        y: bounds.minY - 12,
        props: {
          geo: "rectangle",
          w: Math.max(36, bounds.width + 24),
          h: Math.max(36, bounds.height + 24),
          color: "yellow",
          fill: "none",
          dash: "dashed",
          size: "m",
          font: "draw",
          align: "middle",
          verticalAlign: "middle",
          richText: toRichText(""),
        },
      });
      session.created.push(id);
      track(session, id);
    } catch (error) {
      console.warn("[experiment-draw] highlight failed", key, error);
    }
    await sleep(40);
  }
}

export function prepareExperimentSession(
  editor: Editor,
  lesson: ExperimentLesson,
): ExperimentDrawSession {
  const systemDesign = lesson.beats.some((beat) => beat.section);
  if (!systemDesign) layoutLesson(lesson);
  const allShapes = lesson.beats.flatMap((beat) => beat.shapes);
  const { dx, dy } = sceneOffset(editor, {
    title: lesson.title,
    shapes: allShapes,
  });
  try {
    const existing = [...editor.getCurrentPageShapeIds()];
    if (existing.length) editor.deleteShapes(existing);
  } catch {
    /* keep going */
  }
  return {
    dx,
    dy,
    idMap: new Map<string, TLShapeId>(),
    created: [] as TLShapeId[],
    clusterOf: new Map<TLShapeId, string>(),
    sheets: new Map<string, TLShapeId[]>(),
  };
}

export async function playExperimentBeat(
  editor: Editor,
  beat: ExperimentBeat,
  session: ExperimentDrawSession,
) {
  if (beat.diagram) session.diagram = beat.diagram;
  session.sheet = beat.sheet;
  if (beat.sheet) session.sheets.set(beat.sheet, []);
  const before = session.created.length;
  if (beat.shapes.length) {
    await applyExperimentShapes(editor, beat.shapes, session);
  } else if (!beat.graph) {
    await sleep(180);
  }
  if (beat.highlight?.length) {
    await highlightExperimentIds(editor, session, beat.highlight);
  }
  const added = session.created.slice(before);
  if (added.length) zoomCreated(editor, added);
}

/**
 * Draws a whole lesson at once, as when a saved design is reopened. Sheets are
 * tracked exactly as in playback so later edits can redraw them.
 */
export async function drawExperimentLessonNow(
  editor: Editor,
  lesson: ExperimentLesson,
): Promise<ExperimentDrawSession> {
  const session = prepareExperimentSession(editor, lesson);
  for (const beat of lesson.beats) {
    if (beat.diagram) session.diagram = beat.diagram;
    session.sheet = beat.sheet;
    if (beat.sheet) session.sheets.set(beat.sheet, []);
    if (beat.shapes.length) {
      await applyExperimentShapes(editor, beat.shapes, session, { pace: 0 });
    }
    if (beat.highlight?.length) {
      await highlightExperimentIds(editor, session, beat.highlight);
    }
  }
  const focus = session.sheets.get("architecture") ?? [];
  zoomCreated(editor, focus.length ? focus : session.created);
  return session;
}

/**
 * Brings sheets already on the board in line with a revised lesson. Only
 * sheets whose shapes changed are touched: all of them are erased first so a
 * taller sheet never collides with a stale one, then each is redrawn and its
 * new or relabeled boxes are outlined. Sheets not yet drawn are left for playback.
 */
export async function redrawExperimentSheets(
  editor: Editor,
  session: ExperimentDrawSession,
  previous: ExperimentLesson,
  next: ExperimentLesson,
  changed: string[],
): Promise<void> {
  const oldBeats = new Map(
    previous.beats.flatMap((beat) => (beat.sheet ? [[beat.sheet, beat] as const] : [])),
  );
  const targets = next.beats.filter(
    (beat) => beat.sheet && changed.includes(beat.sheet) && session.sheets.has(beat.sheet),
  );
  if (!targets.length) return;

  const doomed = new Set<TLShapeId>();
  for (const beat of targets) {
    for (const id of session.sheets.get(beat.sheet!) ?? []) doomed.add(id);
  }
  try {
    const live = [...doomed].filter((id) => editor.getShape(id));
    if (live.length) editor.deleteShapes(live);
  } catch {
    /* already gone */
  }
  session.created = session.created.filter((id) => !doomed.has(id));
  for (const [key, id] of session.idMap) {
    if (doomed.has(id)) session.idMap.delete(key);
  }
  for (const id of doomed) session.clusterOf.delete(id);

  const redrawn: TLShapeId[] = [];
  const resume = session.sheet;
  for (const beat of targets) {
    session.sheet = beat.sheet;
    session.sheets.set(beat.sheet!, []);
    await applyExperimentShapes(editor, beat.shapes, session, { pace: 25 });
    const fresh = freshNodeIds(oldBeats.get(beat.sheet!), beat).filter(
      (id) => !id.startsWith("heading-"),
    );
    if (fresh.length) await highlightExperimentIds(editor, session, fresh);
    redrawn.push(...(session.sheets.get(beat.sheet!) ?? []));
  }
  session.sheet = resume;
  if (redrawn.length) zoomCreated(editor, redrawn);
}

export async function applyExperimentScene(
  editor: Editor,
  scene: ExperimentScene,
) {
  const { dx, dy } = sceneOffset(editor, scene);
  const session = {
    dx,
    dy,
    idMap: new Map<string, TLShapeId>(),
    created: [] as TLShapeId[],
    clusterOf: new Map<TLShapeId, string>(),
    sheets: new Map<string, TLShapeId[]>(),
  };
  await applyExperimentShapes(editor, scene.shapes, session);
  if (!session.created.length) {
    throw new Error("Could not explain that. Try another question.");
  }
  zoomCreated(editor, session.created);
}

export async function playExperimentLesson(
  editor: Editor,
  lesson: ExperimentLesson,
  options?: {
    signal?: AbortSignal;
    onBeat?: (index: number) => void;
  },
) {
  const session = prepareExperimentSession(editor, lesson);

  for (let index = 0; index < lesson.beats.length; index += 1) {
    if (options?.signal?.aborted) return;
    options?.onBeat?.(index);
    await playExperimentBeat(editor, lesson.beats[index]!, session);
  }
}

function zoomCreated(editor: Editor, created: TLShapeId[]) {
  try {
    editor.select(...created);
    editor.zoomToSelection({ animation: { duration: 280 } });
    editor.selectNone();
  } catch {
    /* shapes are already on the board */
  }
}
