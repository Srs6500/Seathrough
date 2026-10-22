"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DiagramGutter,
  estimateGutterCardHeight,
  type GutterDiagram,
} from "@/components/voice-tutor/DiagramGutter";
import { LivingPassage } from "@/components/voice-tutor/LivingPassage";
import {
  isTldrawDraw,
  VoiceTldrawBoard,
} from "@/components/voice-tutor/VoiceTldrawBoard";
import type {
  BoardAnnotation,
  BoardContent,
  DrawScene,
} from "@/lib/voice-tutor/sessionTypes";
import { packGutterPlacements } from "@/lib/voice-tutor/gutterLayout";
import { cn } from "@/lib/utils";

export type LessonSection = {
  heading: string;
  body: string;
};

/** One persistent lyric-style stanza on the board. */
export type LessonStanza = {
  id: string;
  text: string;
  /** Precise apply-units (preferred). */
  annotations?: BoardAnnotation[];
  highlight?: string;
  rememberTip?: string;
  examCue?: string;
  pointer?: "circle" | "arrow" | "both";
};

export type LessonDrawing = {
  title: string;
  scene: DrawScene;
};

type LessonStageProps = {
  userHeard?: string;
  formalStatement?: string;
  sections: LessonSection[];
  /** Latest board (title / keypoints / draw). */
  board: BoardContent | null;
  /** Accumulated paragraphs — each stays, next goes below. */
  stanzas: LessonStanza[];
  /** Index currently typing; older ones are frozen. */
  activeStanzaIndex: number;
  onStanzaComplete?: (index: number) => void;
  draw: DrawScene | null;
  /** Accumulated diagrams for the gutter (history + active). */
  drawings?: LessonDrawing[];
  lockLabel?: string | null;
  /** Pause active stanza typing (barge-in / X pause). */
  haltWriting?: boolean;
  className?: string;
};

/** Compact gutter hosts (VFPt / graphs) — not the Smart tldraw board. */
function isCompactGutterScene(
  draw: DrawScene | null | undefined,
): draw is DrawScene {
  return Boolean(
    draw &&
      draw.kind !== "none" &&
      (draw.kind === "vfpt_svg" || draw.kind === "svg_graph"),
  );
}

/**
 * Lyric-stack lesson stage: paragraphs persist below each other.
 * Smart-style sketches use a real tldraw board pane (same applyScene path).
 * Physics VFPt / svg_graph stay in the compact gutter.
 */
export function LessonStage({
  userHeard,
  formalStatement,
  sections,
  board,
  stanzas,
  activeStanzaIndex,
  onStanzaComplete,
  draw,
  drawings = [],
  lockLabel,
  haltWriting = false,
  className,
}: LessonStageProps) {
  const scrollRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [gutterDiagrams, setGutterDiagrams] = useState<GutterDiagram[]>([]);

  const statement =
    formalStatement || board?.formalStatement || draw?.title || "";
  const keyPoints = board?.keyPoints ?? [];

  const activeTldraw = useMemo(() => {
    if (isTldrawDraw(draw)) return draw;
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
      const scene = drawings[i]?.scene;
      if (isTldrawDraw(scene)) return scene;
    }
    return null;
  }, [draw, drawings]);

  const gutterScenes = useMemo(() => {
    const fromHistory = drawings
      .map((d, i) => ({
        id: `hist_${i}_${d.scene.kind}`,
        title: d.title || d.scene.title || "Diagram",
        scene: d.scene,
      }))
      .filter((d) => isCompactGutterScene(d.scene));

    if (isCompactGutterScene(draw)) {
      const already = fromHistory.some(
        (d) =>
          d.scene.kind === draw.kind &&
          JSON.stringify(d.scene.spec ?? {}) ===
            JSON.stringify(draw.spec ?? {}),
      );
      if (!already) {
        return [
          ...fromHistory,
          {
            id: `active_${draw.kind}`,
            title: draw.title || "Diagram",
            scene: draw,
          },
        ];
      }
    }
    return fromHistory;
  }, [draw, drawings]);

  const hasPedagogy =
    Boolean(statement) ||
    sections.length > 0 ||
    stanzas.length > 0 ||
    keyPoints.length > 0 ||
    gutterScenes.length > 0 ||
    Boolean(activeTldraw);

  useLayoutEffect(() => {
    if (!activeRef.current || !scrollRef.current) return;
    activeRef.current.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }, [activeStanzaIndex, stanzas.length]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || !gutterScenes.length) {
      setGutterDiagrams([]);
      return;
    }

    const pack = () => {
      const shellBox = shell.getBoundingClientRect();
      const tipNodes = shell.querySelectorAll<HTMLElement>("[data-vt-tip]");
      const obstacles = Array.from(tipNodes).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          top: Math.max(0, r.top - shellBox.top),
          height: Math.max(24, r.height),
        };
      });

      const activeTop = activeRef.current
        ? Math.max(
            0,
            activeRef.current.getBoundingClientRect().top - shellBox.top,
          )
        : 24;

      const inputs = gutterScenes.map((item, index) => ({
        id: item.id,
        triggerTop: activeTop + index * 12,
        height: estimateGutterCardHeight(item.scene),
      }));

      const placed = packGutterPlacements(inputs, {
        gap: 16,
        minTop: 8,
        obstacles,
      });

      setGutterDiagrams(
        gutterScenes.map((item) => {
          const hit = placed.find((p) => p.id === item.id);
          return {
            ...item,
            top: hit?.top ?? 8,
          };
        }),
      );
    };

    pack();
    const ro = new ResizeObserver(() => pack());
    ro.observe(shell);
    return () => ro.disconnect();
  }, [gutterScenes, stanzas.length, activeStanzaIndex, board?.annotations]);

  const showCompactGutter = gutterScenes.length > 0 && !activeTldraw;

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col items-center px-5 pt-6",
        className,
      )}
    >
      {userHeard ? (
        <p
          className="mb-5 max-w-xl shrink-0 text-center text-[15px] leading-6 text-accent"
          aria-live="polite"
        >
          {userHeard}
        </p>
      ) : (
        <div className="mb-5 h-5 shrink-0" />
      )}

      {!hasPedagogy ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-36">
          {lockLabel ? (
            <div className="flex flex-col items-center gap-3 px-4 text-center">
              <p className="font-[family-name:var(--font-newsreader)] text-[2.75rem] leading-none tracking-tight text-ink tabular-nums md:text-[3.25rem]">
                {lockLabel.match(/\b(\d+)s\b/)?.[1] ?? ""}
                <span className="text-[1.25rem] text-muted">s</span>
              </p>
              <p className="max-w-md text-[15px] leading-6 text-ink-soft">
                {lockLabel}
              </p>
            </div>
          ) : (
            <p className="max-w-sm text-center text-[15px] leading-6 text-muted">
              Say what you want to learn. The lesson stays on the board — not a chat
              transcript.
            </p>
          )}
        </div>
      ) : (
        <div
          ref={shellRef}
          className={cn(
            "relative mx-auto flex min-h-0 w-full flex-1 gap-6",
            activeTldraw
              ? "max-w-[88rem] flex-col lg:flex-row"
              : "max-w-[72rem]",
          )}
        >
          <article
            ref={scrollRef}
            tabIndex={0}
            aria-label="Lesson board"
            className={cn(
              "flex min-h-0 flex-col overflow-y-auto scroll-smooth pb-40 outline-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              activeTldraw
                ? "w-full max-w-[40rem] shrink-0 lg:max-w-[min(40rem,46%)]"
                : cn(
                    "mx-auto w-full flex-1",
                    showCompactGutter
                      ? "max-w-[40rem] xl:mr-[min(18.5rem,30%)]"
                      : "max-w-[40rem]",
                  ),
            )}
          >
            {board?.sourceTitle ? (
              <p className="mb-3 text-[12px] font-medium tracking-[0.06em] text-muted uppercase">
                {board.sourceTitle}
              </p>
            ) : null}

            {statement ? (
              <h1 className="mb-6 font-[family-name:var(--font-newsreader)] text-[1.55rem] leading-snug tracking-[-0.02em] text-ink md:text-[1.75rem]">
                {statement}
              </h1>
            ) : null}

            <div className="flex flex-col gap-8">
              {stanzas.map((stanza, index) => {
                if (index > activeStanzaIndex) return null;
                const allDone = activeStanzaIndex >= stanzas.length;
                const isActive = !allDone && index === activeStanzaIndex;
                const isPast = index < activeStanzaIndex || allDone;
                return (
                  <div
                    key={stanza.id}
                    ref={
                      isActive || (allDone && index === stanzas.length - 1)
                        ? activeRef
                        : undefined
                    }
                    className={cn(
                      "vt-stanza scroll-mt-6",
                      isActive && "vt-stanza-active",
                      isPast && "vt-stanza-past",
                    )}
                  >
                    <LivingPassage
                      text={stanza.text}
                      annotations={stanza.annotations}
                      highlight={stanza.highlight}
                      rememberTip={stanza.rememberTip}
                      examCue={stanza.examCue}
                      pointer={stanza.pointer ?? "both"}
                      frozen={isPast}
                      haltWriting={isActive ? haltWriting : false}
                      onComplete={
                        isActive
                          ? () => onStanzaComplete?.(index)
                          : undefined
                      }
                    />
                  </div>
                );
              })}
            </div>

            {sections.map((section) => (
              <section key={section.heading} className="vt-stanza mt-8">
                <h2 className="mb-2 font-[family-name:var(--font-newsreader)] text-[1.05rem] font-semibold text-ink">
                  {section.heading}
                </h2>
                <p className="font-[family-name:var(--font-newsreader)] text-[1.05rem] leading-[1.85] text-ink md:text-[1.12rem]">
                  {section.body}
                </p>
              </section>
            ))}

            {keyPoints.length > 0 ? (
              <div className="mt-8 space-y-2 border-t border-board-edge/70 pt-5">
                <p className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
                  Keep these
                </p>
                {keyPoints.map((point) => (
                  <p
                    key={point}
                    className="font-[family-name:var(--font-newsreader)] text-[0.98rem] leading-7 text-ink-soft"
                  >
                    <span className="mr-2 text-accent">·</span>
                    {point}
                  </p>
                ))}
              </div>
            ) : null}

            {!activeTldraw ? (
              <DiagramGutter diagrams={gutterDiagrams} stacked />
            ) : null}

            {lockLabel ? (
              <div className="sticky bottom-4 mt-8 flex flex-col items-center gap-1 self-center rounded-xl border border-board-edge bg-white/95 px-5 py-3 text-center shadow-[0_8px_20px_rgba(26,43,60,0.1)]">
                <p className="font-[family-name:var(--font-newsreader)] text-[2rem] leading-none text-ink tabular-nums">
                  {lockLabel.match(/\b(\d+)s\b/)?.[1] ?? "—"}
                  <span className="text-[1rem] text-muted">s</span>
                </p>
                <p className="text-[13px] font-medium text-accent-deep">
                  {lockLabel}
                </p>
              </div>
            ) : null}
          </article>

          {activeTldraw ? (
            <aside className="mt-2 flex min-h-[min(50vh,420px)] w-full flex-1 lg:sticky lg:top-16 lg:mt-0 lg:max-h-[calc(100vh-6rem)] lg:min-h-0 lg:self-start">
              <VoiceTldrawBoard
                draw={activeTldraw}
                className="h-full min-h-[min(50vh,420px)] w-full lg:h-[calc(100vh-7.5rem)] lg:max-h-[720px]"
              />
            </aside>
          ) : (
            <DiagramGutter diagrams={gutterDiagrams} />
          )}
        </div>
      )}
    </div>
  );
}
