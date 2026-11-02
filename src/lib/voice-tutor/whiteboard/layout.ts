import {
  WHITEBOARD_GAP,
  WHITEBOARD_MARGIN,
  WHITEBOARD_WIDTH,
  type WhiteboardDraftItem,
  type WhiteboardItem,
  type WhiteboardKind,
  type WhiteboardReveal,
  type WhiteboardSession,
} from "@/lib/voice-tutor/whiteboard/schema";

type Rect = { x: number; y: number; w: number; h: number };

type KindStyle = {
  fontSize: number;
  lineHeight: number;
  /** Widest a block of this kind may get before wrapping. */
  maxWidth: number;
  /** Inner padding (callout box) added around the text. */
  pad: number;
  reveal: WhiteboardReveal;
};

const STYLE: Record<WhiteboardKind, KindStyle> = {
  title: { fontSize: 64, lineHeight: 1.15, maxWidth: 1400, pad: 0, reveal: "write" },
  heading: { fontSize: 42, lineHeight: 1.2, maxWidth: 900, pad: 0, reveal: "write" },
  note: { fontSize: 34, lineHeight: 1.3, maxWidth: 680, pad: 0, reveal: "write" },
  explanation: { fontSize: 32, lineHeight: 1.35, maxWidth: 760, pad: 0, reveal: "wipe" },
  formula: { fontSize: 54, lineHeight: 1.25, maxWidth: 1400, pad: 0, reveal: "write" },
  callout: { fontSize: 32, lineHeight: 1.35, maxWidth: 640, pad: 22, reveal: "wipe" },
  // Caption style; the picture frame is sized separately.
  image: { fontSize: 26, lineHeight: 1.3, maxWidth: 560, pad: 0, reveal: "wipe" },
};

/** Largest picture frame on the board. */
const IMAGE_MAX_W = 560;
const IMAGE_MAX_H = 440;
/** Caption sits this far below the frame; one small credit line under it. */
export const IMAGE_CAPTION_GAP = 12;
export const IMAGE_CREDIT_H = 30;

export function whiteboardStyle(kind: WhiteboardKind): KindStyle {
  return STYLE[kind];
}

/**
 * Upper-bound glyph widths (in em) for a handwriting face. Estimates run a bit
 * wide on purpose: a box may have spare room, but text never spills past it,
 * so collision checks on boxes are collision checks on ink.
 */
function charEm(ch: string): number {
  if (ch === " ") return 0.3;
  if ("il.,:;'|!`".includes(ch)) return 0.26;
  if ("MWmw@%".includes(ch)) return 0.82;
  if (/[A-Z]/.test(ch)) return 0.62;
  if (/[0-9]/.test(ch)) return 0.52;
  if ("=+−-×÷<>→←^*/()[]{}".includes(ch)) return 0.56;
  return 0.5;
}

export function measureText(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return Math.ceil(em * fontSize);
}

/** Greedy word wrap to `maxWidth`; hard-breaks words longer than a line. */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // Break a single overlong word into chunks that fit.
    let rest = word;
    while (measureText(rest, fontSize) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && measureText(rest.slice(0, cut), fontSize) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

function fitsBoard(r: Rect): boolean {
  return r.x >= WHITEBOARD_MARGIN && r.x + r.w <= WHITEBOARD_WIDTH - WHITEBOARD_MARGIN && r.y >= WHITEBOARD_MARGIN;
}

/**
 * Find the free spot closest to `want`. Candidate corners come from the board
 * margin and every placed box's right / bottom edge (the classic bottom-left
 * packing set), so a free spot always exists: below everything at the margin.
 */
function findFreeSpot(size: { w: number; h: number }, want: { x: number; y: number }, placed: Rect[]): { x: number; y: number } {
  const xs = new Set<number>([WHITEBOARD_MARGIN, want.x]);
  const ys = new Set<number>([WHITEBOARD_MARGIN, want.y]);
  for (const r of placed) {
    xs.add(r.x);
    xs.add(r.x + r.w + WHITEBOARD_GAP);
    ys.add(r.y);
    ys.add(r.y + r.h + WHITEBOARD_GAP);
  }

  let best: { x: number; y: number; cost: number } | null = null;
  for (const x of xs) {
    for (const y of ys) {
      const rect = { x, y, ...size };
      if (!fitsBoard(rect)) continue;
      if (placed.some((p) => overlaps(rect, p, WHITEBOARD_GAP))) continue;
      // Reading order matters: moving up the board costs far more than moving
      // sideways, so content keeps flowing top-to-bottom like a real board.
      const dy = y - want.y;
      const cost = (dy < 0 ? -dy * 6 : dy * 1.4) + Math.abs(x - want.x);
      if (!best || cost < best.cost) best = { x, y, cost };
    }
  }
  if (best) return best;

  const floor = placed.reduce((m, r) => Math.max(m, r.y + r.h), WHITEBOARD_MARGIN);
  return { x: WHITEBOARD_MARGIN, y: floor + WHITEBOARD_GAP };
}

/**
 * Lay drafts out in order. Each item checks the boxes of every earlier item
 * and takes the nearest free spot to where the model asked for it.
 */
export function layoutWhiteboard(input: {
  topic: string;
  drafts: WhiteboardDraftItem[];
  beatOrder: string[];
}): WhiteboardSession {
  const beatIndexOf = new Map(input.beatOrder.map((id, i) => [id, i]));
  const placed: WhiteboardItem[] = [];
  const seenIds = new Set<string>();
  /** Bottom of the previous beat's content — a new beat starts below it. */
  let lastBeatIndex = -1;
  let beatFloor = WHITEBOARD_MARGIN;

  const ordered = input.drafts
    .map((d, i) => ({ d, i, beat: beatIndexOf.get(d.beatId) ?? input.beatOrder.length }))
    .sort((a, b) => a.beat - b.beat || a.i - b.i);

  for (const { d, beat } of ordered) {
    let id = d.id.trim();
    while (seenIds.has(id)) id = `${id}_`;
    seenIds.add(id);

    const style = STYLE[d.kind];
    const lineBox = Math.ceil(style.fontSize * style.lineHeight);
    let lines: string[];
    let w: number;
    let h: number;
    let frame: { w: number; h: number } | undefined;
    if (d.kind === "image" && d.image) {
      // Fit the picture's aspect ratio inside the max frame.
      const k = Math.min(IMAGE_MAX_W / d.image.width, IMAGE_MAX_H / d.image.height);
      frame = { w: Math.round(d.image.width * k), h: Math.round(d.image.height * k) };
      w = Math.max(frame.w, 320);
      lines = wrapText(d.text, style.fontSize, w);
      h = frame.h + IMAGE_CAPTION_GAP + lineBox * lines.length + IMAGE_CREDIT_H;
    } else {
      const innerMax = style.maxWidth - style.pad * 2;
      lines = wrapText(d.text, style.fontSize, innerMax);
      const textW = Math.max(...lines.map((l) => measureText(l, style.fontSize)));
      w = Math.min(WHITEBOARD_WIDTH - WHITEBOARD_MARGIN * 2, textW + style.pad * 2);
      h = lineBox * lines.length + style.pad * 2;
    }

    const newBeat = beat !== lastBeatIndex;
    if (newBeat) {
      beatFloor = placed.reduce((m, r) => Math.max(m, r.y + r.h + WHITEBOARD_GAP), WHITEBOARD_MARGIN);
      lastBeatIndex = beat;
    }

    // Default anchor is the last *written* item — text keeps flowing in its own
    // column instead of dropping under a picture placed beside it.
    const lastText = [...placed].reverse().find((p) => p.kind !== "image");
    const anchor = d.place?.near ? placed.find((p) => p.id === d.place?.near) : lastText;
    let want: { x: number; y: number };
    // A new beat or section starts back at the left margin, below everything.
    if (!anchor || (!d.place?.near && (newBeat || d.kind === "heading"))) {
      want = { x: WHITEBOARD_MARGIN, y: beatFloor };
    } else if (d.place?.side === "right") {
      want = { x: anchor.x + anchor.w + WHITEBOARD_GAP * 2, y: anchor.y };
    } else {
      // Notes under a heading indent slightly, like a teacher's bullets.
      const indent = anchor.kind === "heading" && d.kind === "note" ? 24 : 0;
      want = { x: anchor.x + indent, y: Math.max(anchor.y + anchor.h + WHITEBOARD_GAP, d.place?.near ? 0 : beatFloor) };
    }

    const spot = findFreeSpot({ w, h }, want, placed);
    placed.push({
      id,
      kind: d.kind,
      text: d.text,
      beatId: d.beatId,
      beatIndex: beat,
      reveal: d.reveal ?? style.reveal,
      place: d.place,
      x: spot.x,
      y: spot.y,
      w,
      h,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      lines,
      image: d.image,
      frame,
    });
  }

  const height = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0) + WHITEBOARD_MARGIN;
  return {
    topic: input.topic,
    board: { width: WHITEBOARD_WIDTH, height: Math.max(height, 900) },
    items: placed,
  };
}

/** True if any two items' boxes touch — used by tests / dev checks. */
export function findOverlap(items: WhiteboardItem[]): [string, string] | null {
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (overlaps(items[i]!, items[j]!, 0)) return [items[i]!.id, items[j]!.id];
    }
  }
  return null;
}
