"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  IntakeAnswer,
  IntakeQuestion,
} from "@/lib/course-generator/types";
import { cn } from "@/lib/utils";

type Props = {
  topic: string;
  questions: IntakeQuestion[];
  busy?: boolean;
  onSubmit: (answers: IntakeAnswer[]) => void;
  onBack: () => void;
};

export function IntakeCard({
  topic,
  questions,
  busy,
  onSubmit,
  onBack,
}: Props) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const ready = useMemo(() => {
    return questions.every((q) => {
      const chips = selected[q.id] ?? [];
      const text = (freeText[q.id] ?? "").trim();
      if (q.options.length === 0) return text.length > 0;
      return chips.length > 0 || text.length > 0;
    });
  }, [questions, selected, freeText]);

  function toggle(q: IntakeQuestion, option: string) {
    setSelected((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.allowMultiple) {
        return {
          ...prev,
          [q.id]: cur.includes(option)
            ? cur.filter((x) => x !== option)
            : [...cur, option],
        };
      }
      return { ...prev, [q.id]: [option] };
    });
  }

  function submit() {
    const answers: IntakeAnswer[] = questions.map((q) => {
      const chips = selected[q.id] ?? [];
      const text = (freeText[q.id] ?? "").trim();
      const values = [...chips];
      if (text && !values.includes(text)) values.push(text);
      return { questionId: q.id, values };
    });
    onSubmit(answers);
  }

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-[#ececee] bg-white p-5 shadow-sm sm:p-6">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-[#1b6ca8] uppercase">
        Shape your course
      </p>
      <h2 className="mt-1.5 text-[20px] font-semibold tracking-[-0.02em] text-[#16161a]">
        A few questions first
      </h2>
      <p className="mt-1.5 text-[13px] leading-5 text-[#71717a]">
        You asked for{" "}
        <span className="font-medium text-[#3f3f46]">“{topic}”</span>. Answer
        these so we cover the right ground.
      </p>

      <div className="mt-5 space-y-5">
        {questions.map((q, i) => (
          <div key={q.id}>
            <label className="block text-[13px] font-medium text-[#3f3f46]">
              {i + 1}. {q.prompt}
            </label>
            {q.options.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const on = (selected[q.id] ?? []).includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(q, opt)}
                      className={cn(
                        "h-8 rounded-lg border px-2.5 text-[12px] font-medium transition",
                        on
                          ? "border-[#1b6ca8] bg-[#eef6fc] text-[#0f4c75]"
                          : "border-[#ececee] bg-white text-[#3f3f46] hover:bg-[#fafafa]",
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {q.options.length === 0 || q.allowMultiple ? (
              <input
                value={freeText[q.id] ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setFreeText((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
                placeholder={
                  q.options.length === 0
                    ? "Type your answer"
                    : "Anything else? (optional)"
                }
                className="mt-2 h-9 w-full rounded-lg border border-[#e4e4e7] bg-white px-3 text-[13px] outline-none focus:border-[#1b6ca8] focus:ring-2 focus:ring-[#1b6ca8]/15"
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="h-10 rounded-lg border border-[#ececee] px-4 text-[13px] font-medium text-[#3f3f46] hover:bg-[#fafafa] disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          disabled={busy || !ready}
          onClick={submit}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#16161a] text-[14px] font-medium text-white transition hover:bg-[#2a2a2e] disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy ? "Building course…" : "Build my course"}
        </button>
      </div>
    </div>
  );
}
