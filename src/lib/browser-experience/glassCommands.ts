import type { DrawCommand } from "@/lib/draw-engine/commands";
import {
  DRAW_CANVAS_HEIGHT,
  DRAW_CANVAS_WIDTH,
} from "@/lib/draw-engine/commands";
import type { BrowserTeachBeat } from "@/lib/browser-experience/types";

const MARGIN_X = 36;
const CHIP_W = DRAW_CANVAS_WIDTH - MARGIN_X * 2;
const LINE_H = 28;
const SECTION_GAP = 36;

function clipText(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function roleLabel(role: BrowserTeachBeat["role"], pageUrl?: string): string {
  if (role === "ground") return "Ground";
  if (role === "truth") {
    try {
      if (pageUrl) return `Truth · ${new URL(pageUrl).hostname.replace(/^www\./, "")}`;
    } catch {
      /* ignore */
    }
    return "Truth";
  }
  return "Lesson";
}

export type GlassLayoutState = {
  nextY: number;
  t0: number;
  lastRole: BrowserTeachBeat["role"] | null;
  lastPageUrl: string | null;
};

export function createGlassLayout(): GlassLayoutState {
  return { nextY: 48, t0: 0, lastRole: null, lastPageUrl: null };
}

/**
 * Deterministic glass-panel strokes for one teach beat.
 * Keeps drawing under a stable Konva session across page navigations.
 */
export function glassCommandsForBeat(
  beat: BrowserTeachBeat,
  layout: GlassLayoutState,
  opts?: { question?: string; beatIndex?: number },
): { commands: DrawCommand[]; layout: GlassLayoutState } {
  const commands: DrawCommand[] = [];
  let y = layout.nextY;
  let t0 = layout.t0;
  const idBase = `glass-${beat.id}`;

  if (beat.diagramAction === "reset" || y > DRAW_CANVAS_HEIGHT - 80) {
    commands.push({
      type: "clear",
      id: `${idBase}-clear`,
      t0,
      durationMs: 0,
    });
    y = 48;
    t0 += 40;
    if (opts?.question) {
      commands.push({
        type: "text",
        id: `${idBase}-q`,
        t0,
        durationMs: 500,
        text: clipText(opts.question, 48),
        x: MARGIN_X,
        y,
        color: "#0f1720",
        fontSize: 22,
      });
      y += 40;
      t0 += 520;
    }
  }

  const pageChanged =
    Boolean(beat.pageUrl) &&
    beat.pageUrl !== layout.lastPageUrl &&
    layout.lastPageUrl != null;
  const roleChanged =
    beat.role != null &&
    beat.role !== layout.lastRole &&
    layout.lastRole != null;

  if (roleChanged || pageChanged || layout.lastRole == null) {
    if (y > 60) {
      commands.push({
        type: "line",
        id: `${idBase}-div`,
        t0,
        durationMs: 280,
        x1: MARGIN_X,
        y1: y,
        x2: MARGIN_X + CHIP_W,
        y2: y,
        color: "#c9d7e3",
        width: 2,
      });
      y += SECTION_GAP / 2;
      t0 += 300;
    }
    commands.push({
      type: "text",
      id: `${idBase}-role`,
      t0,
      durationMs: 400,
      text: roleLabel(beat.role, beat.pageUrl),
      x: MARGIN_X,
      y,
      color: "#3d566c",
      fontSize: 16,
    });
    y += 28;
    t0 += 420;
  }

  const markerX = MARGIN_X + 10;
  const textX = MARGIN_X + 28;
  commands.push({
    type: "circle",
    id: `${idBase}-dot`,
    t0,
    durationMs: 280,
    x: markerX,
    y: y + 8,
    radius: 5,
    color: beat.role === "ground" ? "#0ea5e9" : "#059669",
    fill: beat.role === "ground" ? "#0ea5e9" : "#059669",
    width: 2,
  });

  const speech = clipText(beat.speech, 90);
  commands.push({
    type: "text",
    id: `${idBase}-speech`,
    t0: t0 + 40,
    durationMs: 650,
    text: speech,
    x: textX,
    y,
    color: "#0f1720",
    fontSize: 18,
  });
  y += LINE_H + 6;
  t0 += 700;

  const anchor = beat.annotation.text || beat.annotation.label;
  if (anchor && beat.annotation.kind !== "clear") {
    const chip = clipText(anchor, 42);
    commands.push({
      type: "highlight",
      id: `${idBase}-hl`,
      t0,
      durationMs: 450,
      x: textX - 4,
      y: y - 2,
      w: Math.min(CHIP_W - 24, 16 + chip.length * 9),
      h: 26,
      color: "#fde68a",
    });
    commands.push({
      type: "text",
      id: `${idBase}-anchor`,
      t0: t0 + 60,
      durationMs: 400,
      text: chip,
      x: textX,
      y,
      color: "#92400e",
      fontSize: 15,
    });
    y += LINE_H + 10;
    t0 += 480;
  }

  if (layout.lastRole != null && y - layout.nextY > 20) {
    // Subtle connector from prior block — only when continuing.
    if (beat.diagramAction !== "reset") {
      commands.push({
        type: "arrow",
        id: `${idBase}-link`,
        t0: layout.t0,
        durationMs: 220,
        x1: markerX,
        y1: Math.max(40, layout.nextY - 8),
        x2: markerX,
        y2: y - LINE_H - 18,
        color: "#94a3b8",
        width: 1.5,
      });
    }
  }

  return {
    commands,
    layout: {
      nextY: y + 10,
      t0: t0 + 80,
      lastRole: beat.role ?? layout.lastRole,
      lastPageUrl: beat.pageUrl ?? layout.lastPageUrl,
    },
  };
}
