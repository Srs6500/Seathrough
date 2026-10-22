"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PenLine } from "lucide-react";
import { RoughMarkOverlay } from "@/components/voice-tutor/RoughMarkOverlay";
import { normalizeBoardAnnotations } from "@/lib/voice-tutor/boardAnnotations";
import type { BoardAnnotation } from "@/lib/voice-tutor/sessionTypes";
import { cn } from "@/lib/utils";

type PointerKind = "circle" | "arrow" | "both";

export type LivingPassageProps = {
  text: string;
  /** Preferred: precise apply-units (exact substrings). */
  annotations?: BoardAnnotation[];
  /** Legacy single mark — used when annotations are empty. */
  highlight?: string;
  rememberTip?: string;
  examCue?: string;
  pointer?: PointerKind;
  className?: string;
  /** Skip typing — show finished stanza (older lyric lines). */
  frozen?: boolean;
  /** Freeze mid-write (barge-in / pause) without wiping what's already shown. */
  haltWriting?: boolean;
  /** Called after write → highlight → circle → tip are done. */
  onComplete?: () => void;
};

type LineBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "mark"; id: string; text: string };

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!parts?.length) return [text];
  return parts.map((p) => p.replace(/\s+$/g, "")).filter(Boolean);
}

function segmentPassage(
  text: string,
  annotations: BoardAnnotation[],
): TextSegment[] {
  if (!annotations.length) return [{ kind: "text", text }];
  const hayLower = text.toLowerCase();
  const ranges = annotations
    .map((ann) => {
      const start = hayLower.indexOf(ann.targetPhrase.toLowerCase());
      if (start < 0) return null;
      return {
        id: ann.id,
        start,
        end: start + ann.targetPhrase.length,
      };
    })
    .filter((r): r is { id: string; start: number; end: number } => Boolean(r))
    .sort((a, b) => a.start - b.start);

  if (!ranges.length) return [{ kind: "text", text }];

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, range.start) });
    }
    segments.push({
      kind: "mark",
      id: range.id,
      text: text.slice(range.start, range.end),
    });
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

/**
 * Sentence-complete typewriter → DOM-validated marks → Rough circles/tips.
 * Missing phrases never get a stroke (normalized away before render).
 */
export function LivingPassage({
  text,
  annotations: annotationsProp,
  highlight,
  rememberTip,
  examCue,
  pointer = "both",
  className,
  frozen = false,
  haltWriting = false,
  onComplete,
}: LivingPassageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markRefs = useRef<Map<string, HTMLElement>>(new Map());
  const doneRef = useRef(false);
  const haltRef = useRef(haltWriting);
  haltRef.current = haltWriting;
  const uid = useId().replace(/:/g, "");

  const annotations = useMemo(
    () =>
      normalizeBoardAnnotations(text, {
        annotations: annotationsProp,
        highlight,
        rememberTip,
        examCue,
        pointer,
      }),
    [text, annotationsProp, highlight, rememberTip, examCue, pointer],
  );

  const sentences = useMemo(() => splitSentences(text), [text]);
  const segments = useMemo(
    () => segmentPassage(text, annotations),
    [text, annotations],
  );

  const [visibleText, setVisibleText] = useState(frozen ? text : "");
  const [writing, setWriting] = useState(!frozen);
  const [active, setActive] = useState(frozen);
  const [drawn, setDrawn] = useState(frozen);
  const [markBoxes, setMarkBoxes] = useState<
    Array<{ id: string; boxes: LineBox[] }>
  >([]);

  useEffect(() => {
    doneRef.current = false;
    if (frozen) {
      setVisibleText(text);
      setWriting(false);
      setActive(true);
      setDrawn(true);
      return;
    }

    setVisibleText("");
    setWriting(true);
    setActive(false);
    setDrawn(false);
    setMarkBoxes([]);

    let cancelled = false;
    let built = "";

    const run = async () => {
      for (let s = 0; s < sentences.length; s += 1) {
        if (cancelled) return;
        const sentence = sentences[s] ?? "";
        const words = sentence.split(/(\s+)/).filter((t) => t.length > 0);
        for (let w = 0; w < words.length; w += 1) {
          if (cancelled || haltRef.current) {
            setWriting(false);
            return;
          }
          const token = words[w] ?? "";
          built += token;
          setVisibleText(built);
          const delay = /^\s+$/.test(token) ? 12 : 58;
          await new Promise((r) => window.setTimeout(r, delay));
        }
        if (s < sentences.length - 1) {
          await new Promise((r) => window.setTimeout(r, 720));
        }
      }
      if (cancelled || haltRef.current) {
        setWriting(false);
        return;
      }
      setVisibleText(text);
      setWriting(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [text, frozen, sentences]);

  useEffect(() => {
    if (haltWriting) setWriting(false);
  }, [haltWriting]);

  useEffect(() => {
    if (frozen || writing || !text) return;
    const start = window.setTimeout(() => setActive(true), 120);
    const tipAt = window.setTimeout(() => setDrawn(true), 1100);
    const doneAt = window.setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onComplete?.();
      }
    }, 2200);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(tipAt);
      window.clearTimeout(doneAt);
    };
  }, [writing, text, frozen, onComplete]);

  const measureMarks = () => {
    if (!rootRef.current) return;
    const root = rootRef.current.getBoundingClientRect();
    const next: Array<{ id: string; boxes: LineBox[] }> = [];
    for (const ann of annotations) {
      const el = markRefs.current.get(ann.id);
      if (!el) continue;
      const rects = Array.from(el.getClientRects());
      if (!rects.length) continue;
      next.push({
        id: ann.id,
        boxes: rects.map((r) => ({
          top: r.top - root.top,
          left: r.left - root.left,
          width: r.width,
          height: r.height,
        })),
      });
    }
    setMarkBoxes(next);
  };

  useLayoutEffect(() => {
    if (!drawn && !frozen) return;
    measureMarks();
  }, [drawn, frozen, text, visibleText, annotations]);

  useEffect(() => {
    if (!drawn && !frozen) return;
    const onResize = () => measureMarks();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawn, frozen, annotations]);

  const showMarks = (drawn || frozen) && markBoxes.length > 0 && active;
  const writingDone = !writing || frozen;
  const showSegmented = writingDone && visibleText.length >= text.length;

  const tips = useMemo(() => {
    if (!showMarks) return [];
    const tipWidth = 200;
    return annotations
      .map((ann, index) => {
        const mark = markBoxes.find((m) => m.id === ann.id);
        const first = mark?.boxes[0];
        if (!first || !ann.sideNote.trim()) return null;
        // Stagger tips horizontally when multiple marks share a line band.
        const stagger = (index % 3) * 12;
        const tipLeft = Math.max(
          0,
          first.left + first.width / 2 - tipWidth / 2 + stagger,
        );
        const tipTop = Math.max(0, first.top - 78 - (index % 2) * 8);
        return { ann, first, tipLeft, tipTop, tipWidth };
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
  }, [annotations, markBoxes, showMarks]);

  const topPad = tips.length > 0 ? 86 : showMarks ? 12 : 0;

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      style={{ paddingTop: topPad }}
    >
      {writing && !frozen ? (
        <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-accent">
          <PenLine className="size-3.5 animate-pulse" aria-hidden />
          Writing
        </div>
      ) : null}

      <p className="font-[family-name:var(--font-newsreader)] text-[1.05rem] leading-[1.9] text-ink md:text-[1.12rem] md:leading-[1.95]">
        {showSegmented
          ? segments.map((seg, i) =>
              seg.kind === "text" ? (
                <span key={`t-${i}`}>{seg.text}</span>
              ) : (
                <mark
                  key={seg.id}
                  ref={(el) => {
                    if (el) markRefs.current.set(seg.id, el);
                    else markRefs.current.delete(seg.id);
                  }}
                  className="vt-highlight highlight-target bg-transparent"
                  data-id={seg.id}
                  data-active={!writing && active ? "true" : "false"}
                >
                  {seg.text}
                </mark>
              ),
            )
          : visibleText}
        {writing && !frozen ? (
          <span
            className="ml-0.5 inline-flex translate-y-[2px] text-accent"
            aria-hidden
          >
            <PenLine className="size-3.5 animate-pulse" />
          </span>
        ) : null}
      </p>

      <RoughMarkOverlay
        markBoxes={markBoxes}
        annotations={annotations}
        tips={tips}
        pointer={pointer}
        active={showMarks}
      />

      {tips.map((tip) => (
        <div
          key={`tip-${tip.ann.id}`}
          data-vt-tip={tip.ann.id}
          className="vt-remember-tip pointer-events-none absolute z-[2] max-w-[13.5rem]"
          style={{
            left: tip.tipLeft,
            top: tip.tipTop,
            width: tip.tipWidth,
          }}
          aria-label="Way to remember"
        >
          <p className="font-[family-name:var(--font-newsreader)] text-[10px] font-semibold tracking-[0.06em] text-accent uppercase">
            {tip.ann.examCue?.trim() ? "Remember" : "Way to remember"}
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-newsreader)] text-[13px] leading-snug text-accent-deep">
            {tip.ann.sideNote}
          </p>
          {tip.ann.examCue?.trim() && tip.ann.examCue !== tip.ann.sideNote ? (
            <p className="mt-1 text-[11px] leading-snug text-ink-soft">
              {tip.ann.examCue}
            </p>
          ) : null}
        </div>
      ))}

      <span id={`vt-tip-${uid}`} className="sr-only">
        {annotations.map((a) => a.sideNote).join(" ")}
      </span>
    </div>
  );
}
