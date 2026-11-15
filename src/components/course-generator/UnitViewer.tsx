"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, Loader2 } from "lucide-react";
import { WhiteboardBoard } from "@/components/voice-tutor/WhiteboardBoard";
import type {
  CourseUnit,
  QuestionsContent,
  WritingContent,
} from "@/lib/course-generator/types";
import { cn } from "@/lib/utils";

type Props = {
  unit: CourseUnit;
  onBack: () => void;
};

function WritingView({ data }: { data: WritingContent }) {
  return (
    <article className="mx-auto max-w-2xl space-y-6 px-1 py-2">
      <header>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#16161a]">
          {data.title}
        </h2>
        <p className="mt-2 text-[15px] leading-6 text-[#3f3f46]">{data.intro}</p>
      </header>
      {data.sections.map((section) => (
        <section key={section.heading}>
          <h3 className="text-[15px] font-semibold text-[#16161a]">
            {section.heading}
          </h3>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-6 text-[#3f3f46]">
            {section.body}
          </p>
        </section>
      ))}
      {data.takeaways.length > 0 ? (
        <section className="rounded-xl border border-[#ececee] bg-[#fafafa] p-4">
          <h3 className="text-[13px] font-semibold tracking-wide text-[#71717a] uppercase">
            Takeaways
          </h3>
          <ul className="mt-2 space-y-1.5">
            {data.takeaways.map((t) => (
              <li
                key={t}
                className="text-[14px] leading-5 text-[#3f3f46] before:mr-2 before:text-[#1b6ca8] before:content-['•']"
              >
                {t}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function QuestionsView({ data }: { data: QuestionsContent }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  return (
    <div className="mx-auto max-w-xl space-y-5 px-1 py-2">
      {data.intro ? (
        <p className="text-[14px] leading-6 text-[#71717a]">{data.intro}</p>
      ) : null}
      {data.items.map((item, i) => {
        const picked = answers[i];
        const show = revealed[i];
        return (
          <div
            key={`${item.question}-${i}`}
            className="rounded-xl border border-[#ececee] bg-white p-4 shadow-sm"
          >
            <p className="text-[14px] font-medium text-[#16161a]">
              {i + 1}. {item.question}
            </p>
            <div className="mt-3 grid gap-2">
              {item.options.map((opt, oi) => {
                const selected = picked === oi;
                const correct = show && oi === item.correctIndex;
                const wrong = show && selected && oi !== item.correctIndex;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={show}
                    onClick={() =>
                      setAnswers((prev) => ({ ...prev, [i]: oi }))
                    }
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-[13px] transition",
                      correct
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : wrong
                          ? "border-red-300 bg-red-50 text-red-900"
                          : selected
                            ? "border-[#1b6ca8] bg-[#eef6fc] text-[#16161a]"
                            : "border-[#ececee] bg-white text-[#3f3f46] hover:bg-[#fafafa]",
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={picked === undefined || show}
                onClick={() =>
                  setRevealed((prev) => ({ ...prev, [i]: true }))
                }
                className="h-8 rounded-lg bg-[#16161a] px-3 text-[12px] font-medium text-white disabled:opacity-40"
              >
                Check
              </button>
              {show ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-[#71717a]">
                  <Check className="size-3.5 text-emerald-600" />
                  {picked === item.correctIndex ? "Correct" : "See explanation"}
                </span>
              ) : null}
            </div>
            {show ? (
              <p className="mt-2 text-[13px] leading-5 text-[#52525b]">
                {item.explanation}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function UnitViewer({ unit, onBack }: Props) {
  const content = unit.content;
  const beatSpeechMs = useMemo(() => {
    if (content?.kind !== "whiteboard") return [];
    return content.data.plan.beats.map((b) =>
      Math.max(4000, Math.min(14000, b.say.split(/\s+/).length * 420)),
    );
  }, [content]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#ececee] bg-white px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#ececee] bg-white px-2.5 text-[13px] font-medium text-[#16161a] hover:bg-[#fafafa]"
        >
          <ChevronLeft className="size-3.5" />
          Course
        </button>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[#16161a]">
            {unit.title}
          </p>
          <p className="truncate text-[12px] text-[#71717a]">{unit.objective}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#f4f4f6] p-4">
        {unit.status === "generating" || !content ? (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-3 text-[#71717a]">
              <Loader2 className="size-6 animate-spin text-[#1b6ca8]" />
              <p className="text-[14px]">Generating this unit…</p>
            </div>
          </div>
        ) : content.kind === "whiteboard" ? (
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <WhiteboardBoard
              session={content.data.whiteboard}
              activeBeatIndex={content.data.plan.beats.length}
              beatSpeechMs={beatSpeechMs}
              instant
              className="overflow-hidden rounded-xl border border-[#ececee] bg-white shadow-sm"
            />
            <ol className="space-y-2 rounded-xl border border-[#ececee] bg-white p-4">
              {content.data.plan.beats.map((beat, i) => (
                <li key={beat.id} className="text-[13px] leading-5 text-[#3f3f46]">
                  <span className="mr-2 font-semibold text-[#1b6ca8]">
                    {i + 1}.
                  </span>
                  {beat.say}
                </li>
              ))}
            </ol>
          </div>
        ) : content.kind === "writing" ? (
          <WritingView data={content.data} />
        ) : (
          <QuestionsView data={content.data} />
        )}
      </div>
    </div>
  );
}
