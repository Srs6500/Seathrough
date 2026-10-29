"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ExternalLink, PenLine } from "lucide-react";
import { TeachingCursor } from "@/components/voice-tutor/TeachingCursor";
import { normalizeBoardAnnotations } from "@/lib/voice-tutor/boardAnnotations";
import {
  citeSentence,
  type SentenceCitation,
} from "@/lib/voice-tutor/citeSources";
import type {
  BoardAnnotation,
  LessonSourceRef,
} from "@/lib/voice-tutor/sessionTypes";
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
  /** Called after write → highlight → cursor tour are done. */
  onComplete?: () => void;
  /** Researched pages — hovering a sentence shows its source link. */
  sources?: LessonSourceRef[];
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

type SentenceGroup = {
  text: string;
  segments: TextSegment[];
  citation: SentenceCitation | null;
};

/** Regroup segments into sentences (marks stay whole) for hover citations. */
function groupSentences(
  segments: TextSegment[],
  sources: LessonSourceRef[] | undefined,
): SentenceGroup[] {
  const groups: SentenceGroup[] = [];
  let current: SentenceGroup = { text: "", segments: [], citation: null };
  const close = () => {
    if (!current.segments.length) return;
    current.citation = citeSentence(current.text, sources);
    groups.push(current);
    current = { text: "", segments: [], citation: null };
  };
  for (const seg of segments) {
    if (seg.kind === "mark") {
      current.segments.push(seg);
      current.text += seg.text;
      continue;
    }
    const pieces = seg.text.match(/[^.!?]*[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [seg.text];
    for (const piece of pieces) {
      current.segments.push({ kind: "text", text: piece });
      current.text += piece;
      if (/[.!?]\s*$/.test(piece)) close();
    }
  }
  close();
  return groups;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Sentence-complete typewriter → highlighter → teaching cursor.
 * Remember notes sit under the passage so they never cover the text.
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
  sources,
}: LivingPassageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const markRefs = useRef<Map<string, HTMLElement>>(new Map());
  const doneRef = useRef(false);
  const haltRef = useRef(haltWriting);
  haltRef.current = haltWriting;
  const tourKeyRef = useRef("");
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

  const sentenceGroups = useMemo(
    () => (sources?.length ? groupSentences(segments, sources) : null),
    [segments, sources],
  );
  const [citeState, setCite] = useState<{
    index: number;
    top: number;
    left: number;
    text: string;
  } | null>(null);
  // A card opened for an older passage never shows on the new one.
  const cite = citeState?.text === text ? citeState : null;
  const citeCloseRef = useRef<number | null>(null);
  const cancelCiteClose = () => {
    if (citeCloseRef.current) window.clearTimeout(citeCloseRef.current);
    citeCloseRef.current = null;
  };
  const scheduleCiteClose = () => {
    cancelCiteClose();
    citeCloseRef.current = window.setTimeout(() => setCite(null), 220);
  };
  // Card is portaled to <body> with fixed coords so later stanzas (their own
  // stacking contexts) can never paint over it.
  const openCite = (index: number, el: HTMLElement) => {
    cancelCiteClose();
    const rects = Array.from(el.getClientRects());
    const last = rects[rects.length - 1] ?? el.getBoundingClientRect();
    const first = rects[0] ?? last;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(320, vw - 16);
    const estH = 190;
    const below = last.bottom + 6;
    const top = below + estH > vh && first.top - estH - 6 > 8 ? first.top - estH - 6 : below;
    setCite({
      index,
      top,
      left: Math.max(8, Math.min(last.left, vw - cardW - 8)),
      text,
    });
  };
  useEffect(() => () => cancelCiteClose(), []);
  const citeOpen = citeState != null;
  useEffect(() => {
    if (!citeOpen) return;
    // Fixed card would drift from its sentence on scroll — just close it.
    const close = () => setCite(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [citeOpen]);
  const citeCardHas = (node: EventTarget | null) =>
    Boolean(
      node instanceof Node &&
        document.getElementById(`vt-cite-${uid}`)?.contains(node),
    );

  const [visibleText, setVisibleText] = useState(frozen ? text : "");
  const [writing, setWriting] = useState(!frozen);
  const [active, setActive] = useState(frozen);
  const [drawn, setDrawn] = useState(frozen);
  const [markBoxes, setMarkBoxes] = useState<
    Array<{ id: string; boxes: LineBox[] }>
  >([]);
  const [cursor, setCursor] = useState({
    x: 0,
    y: 0,
    visible: false,
    clicking: false,
  });
  const markBoxesRef = useRef(markBoxes);
  markBoxesRef.current = markBoxes;

  useEffect(() => {
    doneRef.current = false;
    tourKeyRef.current = "";
    if (frozen) {
      setVisibleText(text);
      setWriting(false);
      setActive(true);
      setDrawn(true);
      setCursor({ x: 0, y: 0, visible: false, clicking: false });
      return;
    }

    setVisibleText("");
    setWriting(true);
    setActive(false);
    setDrawn(false);
    setMarkBoxes([]);
    setCursor({ x: 0, y: 0, visible: false, clicking: false });

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
    return () => window.clearTimeout(start);
  }, [writing, text, frozen]);

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
    if (!active && !frozen) return;
    measureMarks();
  }, [active, frozen, text, visibleText, annotations]);

  useEffect(() => {
    if (!active && !frozen) return;
    const onResize = () => measureMarks();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active, frozen, annotations]);

  useEffect(() => {
    if (frozen || writing || !active || haltWriting) return;
    const key = `${text}::${annotations.map((a) => a.id).join(",")}`;
    if (tourKeyRef.current === key) return;
    tourKeyRef.current = key;
    let cancelled = false;
    const reduce = prefersReducedMotion();

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, reduce ? Math.min(ms, 40) : ms);
      });

    const finish = () => {
      if (cancelled || doneRef.current) return;
      doneRef.current = true;
      setCursor((prev) => ({ ...prev, clicking: false }));
      onComplete?.();
    };

    const run = async () => {
      for (let i = 0; i < 12; i += 1) {
        if (cancelled || haltRef.current) return;
        if (annotations.length === 0 || markBoxesRef.current.length > 0) break;
        await wait(50);
      }
      if (cancelled || haltRef.current) return;

      setDrawn(true);
      const boxes = markBoxesRef.current;
      if (boxes.length === 0) {
        await wait(400);
        finish();
        return;
      }

      const root = rootRef.current?.getBoundingClientRect();
      const startX = root ? root.width * 0.55 : 180;
      const startY = root ? Math.max(24, root.height - 12) : 80;
      setCursor({ x: startX, y: startY, visible: true, clicking: false });
      await wait(80);
      if (cancelled || haltRef.current) return;

      for (const mark of boxes) {
        if (cancelled || haltRef.current) return;
        const box = mark.boxes[0];
        if (!box) continue;
        const x = box.left + Math.min(18, box.width * 0.28);
        const y = box.top + box.height * 0.45;
        setCursor({ x, y, visible: true, clicking: false });
        await wait(580);
        if (cancelled || haltRef.current) return;
        setCursor({ x, y, visible: true, clicking: true });
        await wait(150);
        if (cancelled || haltRef.current) return;
        setCursor({ x, y, visible: true, clicking: false });
        await wait(420);
      }

      await wait(280);
      finish();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [frozen, writing, active, haltWriting, text, annotations, onComplete]);

  const renderSegment = (seg: TextSegment, key: string) =>
    seg.kind === "text" ? (
      <span key={`t-${key}`}>{seg.text}</span>
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
    );

  const writingDone = !writing || frozen;
  const showSegmented = writingDone && visibleText.length >= text.length;
  const showNotes = (drawn || frozen) && annotations.some((a) => a.sideNote.trim());
  const showCursor = cursor.visible && !frozen;

  return (
    <div ref={rootRef} className={cn("relative overflow-visible", className)}>
      {writing && !frozen ? (
        <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[#5b4fd4]">
          <PenLine className="size-3.5 animate-pulse" aria-hidden />
          Writing
        </div>
      ) : null}

      <p className="text-[1.05rem] leading-[1.9] text-[#16161a] md:text-[1.12rem] md:leading-[1.95]">
        {showSegmented
          ? sentenceGroups
            ? sentenceGroups.map((group, gi) =>
                group.citation ? (
                  <span
                    key={`s-${gi}`}
                    tabIndex={0}
                    aria-describedby={cite?.index === gi ? `vt-cite-${uid}` : undefined}
                    className={cn(
                      "cursor-help rounded-[3px] outline-none transition-colors",
                      "hover:bg-[#5b4fd4]/[0.07] focus-visible:bg-[#5b4fd4]/[0.07]",
                      cite?.index === gi && "bg-[#5b4fd4]/[0.07]",
                    )}
                    onMouseEnter={(e) => openCite(gi, e.currentTarget)}
                    onMouseLeave={scheduleCiteClose}
                    onFocus={(e) => openCite(gi, e.currentTarget)}
                    onBlur={(e) => {
                      if (!citeCardHas(e.relatedTarget)) {
                        scheduleCiteClose();
                      }
                    }}
                    onClick={(e) =>
                      cite?.index === gi ? setCite(null) : openCite(gi, e.currentTarget)
                    }
                  >
                    {group.segments.map((seg, i) => renderSegment(seg, `${gi}-${i}`))}
                  </span>
                ) : (
                  <span key={`s-${gi}`}>
                    {group.segments.map((seg, i) => renderSegment(seg, `${gi}-${i}`))}
                  </span>
                ),
              )
            : segments.map((seg, i) => renderSegment(seg, `${i}`))
          : visibleText}
        {writing && !frozen ? (
          <span
            className="ml-0.5 inline-flex translate-y-[2px] text-[#5b4fd4]"
            aria-hidden
          >
            <PenLine className="size-3.5 animate-pulse" />
          </span>
        ) : null}
      </p>

      {cite && sentenceGroups?.[cite.index]?.citation ? createPortal(
        <div
          id={`vt-cite-${uid}`}
          role="tooltip"
          className="fixed z-[1000] w-[min(320px,calc(100vw-16px))] rounded-lg border border-[#ececee] bg-white p-3 shadow-[0_8px_24px_rgba(22,22,26,0.12)]"
          style={{ top: cite.top, left: cite.left }}
          onMouseEnter={cancelCiteClose}
          onMouseLeave={scheduleCiteClose}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#71717a]">
            {sentenceGroups[cite.index]!.citation!.specific
              ? sentenceGroups[cite.index]!.citation!.sources.length > 1
                ? "Sources"
                : "Source"
              : "From lesson research"}
          </p>
          <ul className="mt-1.5 space-y-2">
            {sentenceGroups[cite.index]!.citation!.sources.map((src) => (
              <li key={src.url}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-1.5 text-[13px] leading-snug text-[#16161a] hover:text-[#5b4fd4]"
                  onBlur={(e) => {
                    if (!citeCardHas(e.relatedTarget)) {
                      scheduleCiteClose();
                    }
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-medium underline decoration-[#5b4fd4]/30 underline-offset-2 group-hover:decoration-[#5b4fd4]">
                      {src.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-[#71717a]">
                      {src.publisher}
                    </span>
                  </span>
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-[#71717a] group-hover:text-[#5b4fd4]" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      ) : null}

      {showNotes ? (
        <ul className="vt-remember-tip mt-4 space-y-3" aria-label="Remember">
          {annotations.map((ann) =>
            ann.sideNote.trim() ? (
              <li
                key={`tip-${ann.id}`}
                data-vt-tip={ann.id}
                className="border-l-2 border-[#5b4fd4]/35 pl-3"
              >
                <p className="text-[12px] font-medium text-[#5b4fd4]">
                  Remember
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-[#16161a]">
                  {ann.sideNote}
                </p>
                {ann.examCue?.trim() && ann.examCue !== ann.sideNote ? (
                  <p className="mt-1 text-[12px] leading-snug text-[#71717a]">
                    {ann.examCue}
                  </p>
                ) : null}
              </li>
            ) : null,
          )}
        </ul>
      ) : null}

      {showCursor ? (
        <TeachingCursor
          x={cursor.x}
          y={cursor.y}
          visible={cursor.visible}
          clicking={cursor.clicking}
        />
      ) : null}

      <span id={`vt-tip-${uid}`} className="sr-only">
        {annotations.map((a) => a.sideNote).join(" ")}
      </span>
    </div>
  );
}
