"use client";

import type { ConceptBlock, SourceRef, VisualScene } from "@/lib/voice-tutor/schemas";
import { SceneCanvas } from "@/components/voice-tutor/SceneCanvas";
import { cn } from "@/lib/utils";

export type LessonPanelView = {
  title: string;
  objective: string;
  progressLabel: string;
  phaseLabel: string;
  source: SourceRef | null;
  highlight: string | null;
  keyPoints: string[];
  scene: VisualScene | null;
  focusObjectIds: string[];
  traceTargetId: string | null;
  askPrompt: string | null;
  caption: string | null;
};

type LessonPanelProps = {
  view: LessonPanelView;
  className?: string;
};

export function emptyLessonPanelView(
  title = "Voice tutor",
  objective = "Start a lesson to begin.",
): LessonPanelView {
  return {
    title,
    objective,
    progressLabel: "Not started",
    phaseLabel: "Idle",
    source: null,
    highlight: null,
    keyPoints: [],
    scene: null,
    focusObjectIds: [],
    traceTargetId: null,
    askPrompt: null,
    caption: null,
  };
}

export function blockKeyPoints(block: ConceptBlock | null): string[] {
  return block?.lesson.keyPoints ?? [];
}

function HighlightedPassage({
  text,
  highlight,
}: {
  text: string;
  highlight: string | null;
}) {
  if (!highlight) {
    return <p className="text-[14px] leading-6 text-[#d5e6f7]">{text}</p>;
  }
  const index = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (index < 0) {
    return <p className="text-[14px] leading-6 text-[#d5e6f7]">{text}</p>;
  }
  const before = text.slice(0, index);
  const match = text.slice(index, index + highlight.length);
  const after = text.slice(index + highlight.length);
  return (
    <p className="text-[14px] leading-6 text-[#d5e6f7]">
      {before}
      <mark className="rounded bg-[#1f4f7c] px-1 text-[#e8f4ff] ring-1 ring-[#4f8fc4]/50">
        {match}
      </mark>
      {after}
    </p>
  );
}

export function LessonPanel({ view, className }: LessonPanelProps) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-3xl border border-[#243f61] bg-[#0d2038]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        className,
      )}
      aria-label="Lesson content"
    >
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#163456] px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#8fb4d6] uppercase">
            {view.phaseLabel}
          </span>
          <span className="text-[12px] text-[#6d93b5]">{view.progressLabel}</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#eef5fc]">
          {view.title}
        </h1>
        <p className="text-[13px] leading-5 text-[#9eb6d0]">{view.objective}</p>
      </header>

      {view.source ? (
        <div className="rounded-2xl border border-[#2a4a6e] bg-[#0a182c] p-4">
          <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-[#6d93b5] uppercase">
            Grounded passage · {view.source.title}
          </p>
          <HighlightedPassage
            text={view.source.text}
            highlight={view.highlight}
          />
        </div>
      ) : null}

      {view.keyPoints.length > 0 ? (
        <div className="rounded-2xl border border-[#2a4a6e]/80 bg-[#10263f]/80 p-4">
          <p className="mb-2 text-[11px] font-medium tracking-[0.08em] text-[#6d93b5] uppercase">
            Key points
          </p>
          <ul className="space-y-2">
            {view.keyPoints.map((point) => (
              <li
                key={point}
                className="flex gap-2 text-[14px] leading-5 text-[#d5e6f7]"
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#5aa8ef]" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.scene ? (
        <SceneCanvas
          scene={view.scene}
          focusObjectIds={view.focusObjectIds}
          traceTargetId={view.traceTargetId}
        />
      ) : null}

      {view.askPrompt ? (
        <div className="rounded-2xl border border-[#3d6fa0] bg-[#143252] p-4">
          <p className="mb-1 text-[11px] font-medium tracking-[0.08em] text-[#8fb4d6] uppercase">
            Your turn
          </p>
          <p className="text-[15px] leading-6 text-[#eef5fc]">{view.askPrompt}</p>
        </div>
      ) : null}

      {view.caption ? (
        <p className="text-[13px] leading-5 text-[#9eb6d0]">{view.caption}</p>
      ) : null}
    </section>
  );
}
