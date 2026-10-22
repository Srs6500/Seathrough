"use client";

import { LivingPassage } from "@/components/voice-tutor/LivingPassage";
import { SceneCanvas } from "@/components/voice-tutor/SceneCanvas";
import type { BoardContent, DrawScene } from "@/lib/voice-tutor/sessionTypes";
import type { VisualScene } from "@/lib/voice-tutor/schemas";
import { cn } from "@/lib/utils";

type GlassBoardProps = {
  board: BoardContent | null;
  draw: DrawScene | null;
  className?: string;
};

export function GlassBoard({ board, draw, className }: GlassBoardProps) {
  const scene =
    draw?.kind === "svg_graph" && draw.spec?.scene
      ? (draw.spec.scene as VisualScene)
      : null;
  const hasBoard =
    Boolean(board?.sourceText) ||
    Boolean(board?.keyPoints?.length) ||
    Boolean(board?.formalStatement) ||
    Boolean(scene) ||
    (draw != null && draw.kind === "concept_boxes");

  if (!hasBoard) return null;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-board-edge/80 bg-white/70 shadow-[0_16px_40px_rgba(26,43,60,0.08)] backdrop-blur-md",
        className,
      )}
      aria-label="Lesson board"
    >
      <div className="border-b border-board-edge/70 px-4 py-2.5">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
          Glass board
        </p>
      </div>

      <div className="space-y-4 p-4">
        {board?.formalStatement ? (
          <p className="font-[family-name:var(--font-newsreader)] text-[1.05rem] leading-6 text-ink">
            {board.formalStatement}
          </p>
        ) : null}

        {board?.sourceText ? (
          <div className="rounded-xl border border-board-edge bg-[#f7fafc] p-3">
            <p className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-muted uppercase">
              {board.sourceTitle || "Source"}
            </p>
            <LivingPassage
              text={board.sourceText}
              highlight={board.highlight}
              rememberTip={board.rememberTip}
              examCue={board.examCue}
              pointer={board.pointer ?? "both"}
            />
          </div>
        ) : null}

        {board?.keyPoints && board.keyPoints.length > 0 ? (
          <ul className="space-y-2">
            {board.keyPoints.map((point) => (
              <li
                key={point}
                className="flex gap-2 text-[14px] leading-5 text-ink-soft"
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {scene ? (
          <SceneCanvas
            scene={scene}
            focusObjectIds={draw?.highlightIds ?? []}
            traceTargetId={draw?.highlightIds?.[0] ?? null}
            className="rounded-xl border border-board-edge"
          />
        ) : null}

        {draw?.kind === "concept_boxes" ? (
          <div className="flex flex-wrap gap-2">
            {(draw.highlightIds.length
              ? draw.highlightIds
              : ["concept", "relation", "check"]
            ).map((id) => (
              <span
                key={id}
                className="rounded-full bg-accent-soft px-3 py-1.5 text-[12px] font-medium text-accent-deep"
              >
                {id}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
