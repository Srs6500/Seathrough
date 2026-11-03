"use client";

import { Caveat } from "next/font/google";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LessonSkeleton } from "@/components/voice-tutor/LoadingDots";
import { IMAGE_CAPTION_GAP, IMAGE_CREDIT_H } from "@/lib/voice-tutor/whiteboard/layout";
import type { WhiteboardItem, WhiteboardSession } from "@/lib/voice-tutor/whiteboard/schema";
import { cn } from "@/lib/utils";

const hand = Caveat({ subsets: ["latin"], weight: "600", display: "swap" });

/** Marker colours per kind — like a teacher switching pens. */
const INK: Record<WhiteboardItem["kind"], string> = {
  title: "#1b1f3b",
  heading: "#2456c7",
  note: "#1f2328",
  explanation: "#2f3640",
  formula: "#b4380f",
  callout: "#1f2328",
  image: "#3f3f46",
};

/** Time to move the pen to the next spot before writing. */
const TRAVEL_MS = 380;
/** Pen lift after finishing an item. */
const REST_MS = 220;

type Point = { x: number; y: number };

type Engine = {
  idx: number;
  p: number;
  stage: "travel" | "draw" | "rest" | "idle";
  t: number;
  from: Point;
  to: Point;
  cursor: Point;
  idleMs: number;
};

type Frame = {
  idx: number;
  p: number;
  stage: Engine["stage"];
  cursor: Point;
  idleMs: number;
};

function charCount(item: WhiteboardItem): number {
  return item.lines.reduce((n, l) => n + l.length, 0);
}

function naturalMs(item: WhiteboardItem): number {
  if (item.kind === "image") return 1700;
  const perChar = item.reveal === "write" ? 52 : 18;
  return Math.max(600, charCount(item) * perChar + item.lines.length * 140);
}

function padOf(item: WhiteboardItem): number {
  return item.kind === "callout" ? 22 : 0;
}

function lineBox(item: WhiteboardItem): number {
  return Math.ceil(item.fontSize * item.lineHeight);
}

/** Per-line reveal (0..1) for a "write" item at overall progress p. */
function lineProgress(item: WhiteboardItem, p: number): number[] {
  const total = Math.max(1, charCount(item));
  let before = 0;
  return item.lines.map((line) => {
    const len = Math.max(1, line.length);
    const lp = Math.min(1, Math.max(0, (p * total - before) / len));
    before += len;
    return lp;
  });
}

function startPoint(item: WhiteboardItem): Point {
  if (item.kind === "image") return { x: item.x + 8, y: item.y };
  const pad = padOf(item);
  return item.reveal === "write"
    ? { x: item.x + pad, y: item.y + pad + item.fontSize * 0.85 }
    : { x: item.x, y: item.y + item.h / 2 };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

type WhiteboardBoardProps = {
  session: WhiteboardSession | null;
  /** Beat the tutor is speaking now; items up to this beat get written. */
  activeBeatIndex: number;
  /** Estimated spoken length per beat (ms) — writing paces itself to the voice. */
  beatSpeechMs: number[];
  /** Barge-in / pause: the pen stops mid-stroke. */
  halted?: boolean;
  preparing?: string | null;
  /** Reopened from History: show the whole board at once, no pen. */
  instant?: boolean;
  className?: string;
};

/**
 * Zoom-style whiteboard: items from the session JSON are written one by one at
 * their laid-out coordinates while a pen / pointer rides the reveal edge.
 */
export function WhiteboardBoard({
  session,
  activeBeatIndex,
  beatSpeechMs,
  halted = false,
  preparing,
  instant = false,
  className,
}: WhiteboardBoardProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  /** Rendered line spans — measured so the pen tip lands at the real ink edge. */
  const [lineEls] = useState(() => new Map<string, HTMLSpanElement>());
  const [scale, setScale] = useState(0.5);
  const items = useMemo(() => session?.items ?? [], [session]);

  // Fit the logical 1600-wide board into the available width.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !session) return;
    const fit = () => setScale(shell.clientWidth / session.board.width);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [session]);

  // Each beat's writing is squeezed to fit inside that beat's speech.
  const durations = useMemo(() => {
    const byBeat = new Map<number, number>();
    for (const item of items) {
      byBeat.set(item.beatIndex, (byBeat.get(item.beatIndex) ?? 0) + naturalMs(item) + TRAVEL_MS + REST_MS);
    }
    return items.map((item) => {
      const natural = naturalMs(item);
      const budget = (beatSpeechMs[item.beatIndex] ?? 6000) * 0.9;
      const total = byBeat.get(item.beatIndex) ?? natural;
      const squeeze = total > budget ? budget / total : 1;
      return Math.max(420, natural * squeeze);
    });
  }, [items, beatSpeechMs]);

  const prefersReducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const reduceMotion = prefersReducedMotion || instant;

  const engine = useRef<Engine>({
    idx: 0,
    p: 0,
    stage: "idle",
    t: 0,
    from: { x: 64, y: 64 },
    to: { x: 64, y: 64 },
    cursor: { x: 64, y: 64 },
    idleMs: 0,
  });
  const [frame, setFrame] = useState<Frame>({ idx: 0, p: 0, stage: "idle", cursor: { x: 64, y: 64 }, idleMs: 0 });

  // New session → start from the top. A follow-up that only appends items to
  // the same board keeps its place, so only the new section gets written.
  const prevItemsRef = useRef<WhiteboardItem[]>([]);
  useEffect(() => {
    const prev = prevItemsRef.current;
    const next = session?.items ?? [];
    prevItemsRef.current = next;
    const extends_ =
      prev.length > 0 &&
      next.length >= prev.length &&
      prev.every((item, i) => next[i]?.id === item.id);
    if (extends_) return;
    const e = engine.current;
    e.idx = 0;
    e.p = 0;
    e.stage = "idle";
    e.idleMs = 0;
  }, [session]);

  const live = useRef({ activeBeatIndex, halted, durations, items, reduceMotion });
  useLayoutEffect(() => {
    live.current = { activeBeatIndex, halted, durations, items, reduceMotion };
  }, [activeBeatIndex, halted, durations, items, reduceMotion]);

  useEffect(() => {
    if (!session) return;
    let raf = 0;
    let last = performance.now();

    const writeCursor = (item: WhiteboardItem, p: number): Point => {
      if (item.kind === "image" && item.frame) {
        // Pointer pulls the picture down into view, sweeping side to side.
        const sweep = 0.5 + 0.42 * Math.sin(p * Math.PI * 2.5);
        return { x: item.x + item.frame.w * sweep, y: item.y + item.frame.h * Math.min(1, p * 1.15) };
      }
      if (item.reveal === "wipe") {
        return { x: item.x + item.w * p, y: item.y + item.h / 2 + Math.sin(p * Math.PI * 3) * item.h * 0.18 };
      }
      const lps = lineProgress(item, p);
      let i = lps.findIndex((lp) => lp < 1);
      if (i < 0) i = item.lines.length - 1;
      const el = lineEls.get(`${item.id}:${i}`);
      const width = el?.offsetWidth ?? item.w;
      const pad = padOf(item);
      // Small vertical wobble reads as handwriting rather than a scanner.
      const wobble = Math.sin(p * 90) * item.fontSize * 0.08;
      return {
        x: item.x + pad + width * (lps[i] ?? 1),
        y: item.y + pad + i * lineBox(item) + item.fontSize * 0.85 + wobble,
      };
    };

    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const { activeBeatIndex: beat, halted: stop, durations: durs, items: list, reduceMotion: instant } = live.current;
      const e = engine.current;
      const item = list[e.idx];

      if (!stop) {
        if (!item || item.beatIndex > beat) {
          e.stage = "idle";
          e.idleMs += dt;
        } else {
          e.idleMs = 0;
          // Behind the voice (beat already moved on) → write faster to catch up.
          const speed = item.beatIndex < beat ? 3 : 1;
          if (instant) {
            e.idx += 1;
            e.p = 0;
            e.cursor = startPoint(list[e.idx] ?? item);
            e.stage = "rest";
          } else if (e.stage === "idle" || (e.stage === "rest" && e.t >= REST_MS)) {
            e.stage = "travel";
            e.t = 0;
            e.from = e.cursor;
            e.to = startPoint(item);
          } else if (e.stage === "rest") {
            e.t += dt * speed;
          } else if (e.stage === "travel") {
            e.t += dt * speed;
            const k = easeInOut(Math.min(1, e.t / TRAVEL_MS));
            e.cursor = { x: e.from.x + (e.to.x - e.from.x) * k, y: e.from.y + (e.to.y - e.from.y) * k };
            if (e.t >= TRAVEL_MS) {
              e.stage = "draw";
              e.p = 0;
            }
          } else if (e.stage === "draw") {
            e.p = Math.min(1, e.p + (dt * speed) / (durs[e.idx] ?? 1000));
            e.cursor = writeCursor(item, e.p);
            if (e.p >= 1) {
              e.idx += 1;
              e.p = 0;
              e.stage = "rest";
              e.t = 0;
            }
          }
        }
      }

      setFrame((prev) => {
        const same =
          prev.idx === e.idx &&
          prev.p === e.p &&
          prev.stage === e.stage &&
          prev.cursor === e.cursor &&
          (prev.idleMs === e.idleMs || (prev.idleMs > 1500 && e.idleMs > 1500));
        return same ? prev : { idx: e.idx, p: e.p, stage: e.stage, cursor: e.cursor, idleMs: e.idleMs };
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session, lineEls]);

  // Keep the pen in view as it moves down the board.
  useEffect(() => {
    cursorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [frame.idx]);

  if (!session) {
    return preparing ? (
      <div className={cn("flex flex-1 items-center justify-center pb-36", className)}>
        <LessonSkeleton label={preparing} />
      </div>
    ) : null;
  }

  const current = items[frame.idx];
  const writing = frame.stage === "draw" && current;
  // Board grows as content is written, like scrolling down a long whiteboard.
  const shownBottom = items
    .slice(0, frame.idx + (writing ? 1 : 0))
    .reduce((m, it) => Math.max(m, it.y + it.h), 0);
  const boardHeight = Math.max(720, shownBottom + 220);
  const penMode = writing ? current.reveal : current?.reveal ?? "write";
  const cursorFaded = frame.stage === "idle" && frame.idleMs > 1500;

  return (
    <div ref={shellRef} className={cn("vt-whiteboard relative w-full", className)}>
      <div
        className="relative overflow-hidden rounded-xl border border-[#e4e4e7] bg-white shadow-[0_1px_2px_rgba(22,22,26,0.04)]"
        style={{ height: boardHeight * scale }}
      >
        <div
          className={cn("absolute top-0 left-0 origin-top-left", hand.className)}
          style={{
            width: session.board.width,
            height: boardHeight,
            transform: `scale(${scale})`,
            backgroundImage: "radial-gradient(circle, #e7e7ec 1.6px, transparent 1.6px)",
            backgroundSize: "40px 40px",
          }}
        >
          {items.map((item, index) => {
            if (index > frame.idx) return null;
            const done = index < frame.idx;
            if (!done && !writing) return null;
            const p = done ? 1 : frame.p;
            return <BoardItem key={item.id} item={item} progress={p} done={done} lineEls={lineEls} />;
          })}

          <div
            ref={cursorRef}
            data-pdf-skip
            aria-hidden
            className="pointer-events-none absolute z-10"
            style={{
              left: frame.cursor.x,
              top: frame.cursor.y,
              opacity: cursorFaded ? 0.35 : 1,
              transition: "opacity 0.4s ease",
              scrollMarginBlock: 160,
            }}
          >
            {penMode === "write" ? <PenCursor /> : <PointerCursor />}
          </div>
        </div>
      </div>
    </div>
  );
}

function BoardItem({
  item,
  progress,
  done,
  lineEls,
}: {
  item: WhiteboardItem;
  progress: number;
  done: boolean;
  lineEls: Map<string, HTMLSpanElement>;
}) {
  const pad = padOf(item);
  const box = lineBox(item);
  const lps = item.reveal === "write" ? lineProgress(item, progress) : null;
  const color = INK[item.kind];

  if (item.kind === "image" && item.image && item.frame) {
    return <BoardImage item={item} progress={progress} />;
  }

  return (
    <div
      data-wb-id={item.id}
      className="absolute"
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
    >
      {item.kind === "callout" ? (
        <div
          className="absolute inset-0 rounded-[14px] border-[3px] border-[#e0a526] bg-[#fff7df]"
          style={{ opacity: Math.min(1, progress * 4 + (done ? 1 : 0)) }}
        />
      ) : null}

      <div
        className="absolute"
        style={{
          left: pad,
          top: pad,
          clipPath: lps || progress >= 1 ? undefined : penClip(progress, "-20%", "0"),
        }}
      >
        {item.lines.map((line, i) => (
          <div key={i} style={{ height: box, lineHeight: `${box}px` }}>
            <span
              ref={(el) => {
                const key = `${item.id}:${i}`;
                if (el) lineEls.set(key, el);
                else lineEls.delete(key);
              }}
              className="inline-block whitespace-nowrap"
              style={{
                fontSize: item.fontSize,
                color,
                clipPath: lps && (lps[i] ?? 0) < 1 ? penClip(lps[i] ?? 0, "-30%", "-4%") : undefined,
              }}
            >
              {line}
            </span>
          </div>
        ))}
      </div>

      {item.kind === "title" && done ? (
        <svg className="absolute left-0" style={{ top: item.h - 4 }} width={item.w} height={16} aria-hidden>
          <path
            d={`M2 9 Q ${item.w * 0.35} 3, ${item.w * 0.6} 8 T ${item.w - 4} 6`}
            fill="none"
            stroke="#2456c7"
            strokeWidth={4}
            strokeLinecap="round"
            pathLength={1}
            className="vt-wb-underline"
          />
        </svg>
      ) : null}
    </div>
  );
}

/** A sourced picture taped to the board: wipes in top-down, then caption + credit. */
function BoardImage({ item, progress }: { item: WhiteboardItem; progress: number }) {
  const image = item.image!;
  const frame = item.frame!;
  const shown = Math.min(1, progress * 1.15);
  const captionIn = Math.max(0, Math.min(1, (progress - 0.75) * 4));
  const box = lineBox(item);
  return (
    <figure
      data-wb-id={item.id}
      className="absolute m-0"
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
    >
      <div
        className="relative overflow-hidden rounded-[10px] border-2 border-[#d4d4d8] bg-[#fafafa] shadow-[0_6px_18px_rgba(22,22,26,0.10)]"
        style={{ width: frame.w, height: frame.h, clipPath: `inset(0 0 ${(1 - shown) * 100}% 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote, licensed source image */}
        <img
          src={image.url}
          alt={image.alt}
          width={frame.w}
          height={frame.h}
          referrerPolicy="no-referrer"
          className="size-full object-contain"
        />
      </div>
      <figcaption style={{ opacity: captionIn, marginTop: IMAGE_CAPTION_GAP, transition: "opacity 0.2s" }}>
        {item.lines.map((line, i) => (
          <div key={i} style={{ height: box, lineHeight: `${box}px`, fontSize: item.fontSize, color: INK.image }}>
            {line}
          </div>
        ))}
        <a
          href={image.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`${image.credit}${image.license ? ` · ${image.license}` : ""} — ${image.sourceName}`}
          className="block truncate font-sans text-[#71717a] underline-offset-4 hover:underline"
          style={{ height: IMAGE_CREDIT_H, lineHeight: `${IMAGE_CREDIT_H}px`, fontSize: 17 }}
        >
          {image.sourceName} · {image.credit}
          {image.license ? ` · ${image.license}` : ""}
        </a>
      </figcaption>
    </figure>
  );
}

/** Marker pen, tip at (0,0) so the tip sits on the reveal edge. */
function PenCursor() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" style={{ marginTop: -40, marginLeft: -2 }} fill="none">
      <path d="M3 41 L7 30 L33 4 L40 11 L14 37 Z" fill="#16161a" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 41 L7 30 L14 37 Z" fill="#2456c7" />
      <path d="M29 8 L36 15" stroke="#fff" strokeWidth="1.4" />
    </svg>
  );
}

/** Arrow pointer used for wipe reveals. */
function PointerCursor() {
  return (
    <svg width="40" height="40" viewBox="0 0 28 28" style={{ marginTop: -4, marginLeft: -6 }} fill="none">
      <path
        d="M4.2 2.8 4.2 21.6 8.8 17.1 12.4 25.2 15.6 23.8 11.9 15.6 18.6 15.6Z"
        fill="#ffffff"
        stroke="#16161a"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Left-to-right pen reveal. The handwriting font is slanted, so the last
 * letter overhangs its measured box; the reveal runs a bit past the right
 * edge so that letter isn't cut off.
 */
const PEN_OVERHANG = "0.35em";
function penClip(p: number, vertical: string, left: string) {
  const q = Math.max(0, Math.min(1, p));
  return `inset(${vertical} calc(${((1 - q) * 100).toFixed(2)}% - ${q.toFixed(3)} * ${PEN_OVERHANG}) ${vertical} ${left})`;
}
