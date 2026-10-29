"use client";

import { useEffect, useRef } from "react";
import type { ExperimentCheck, ExperimentLesson } from "@/lib/experiment/scene";
import type { DesignMessage } from "@/lib/experiment/systemDesign/session";
import { BoxesLoader } from "@/components/ui/BoxesLoader";

type ExperimentScriptProps = {
  lesson: ExperimentLesson | null;
  currentBeat: number;
  streaming?: boolean;
  pausedCheck?: ExperimentCheck | null;
  note?: string;
  intro?: string;
  messages?: DesignMessage[];
};

function Message({ message }: { message: DesignMessage }) {
  if (message.role === "user") {
    return (
      <div className="animate-fade-up flex flex-col items-end">
        <p className="max-w-[92%] whitespace-pre-wrap rounded-lg bg-[#16161a] px-3 py-2 text-[14px] leading-6 text-white">
          {message.text}
        </p>
        {message.failed ? (
          <p className="mt-1 text-[11px] text-error">Not applied</p>
        ) : null}
      </div>
    );
  }
  return (
    <p className="animate-fade-up border-l-2 border-[#ececee] pl-3 text-[14px] leading-6 text-[#3f3f46]">
      {message.text}
    </p>
  );
}

export function ExperimentScript({
  lesson,
  currentBeat,
  streaming = false,
  pausedCheck = null,
  note = "",
  intro = "Ask a question. The tutor talks in short steps, draws on the board, then pauses to check you understood.",
  messages = [],
}: ExperimentScriptProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const beats = lesson?.beats ?? [];
  const visible = beats.slice(0, Math.max(0, currentBeat + 1));
  const lastVisible = visible.length - 1;
  const question = lesson?.question?.trim() ?? "";
  const ownPromptMissing =
    Boolean(question) &&
    !messages.some((message) => message.role === "user" && message.text === question);
  const thread: DesignMessage[] = ownPromptMissing
    ? [{ id: "original-question", role: "user", text: question, afterBeat: -1 }, ...messages]
    : messages;
  const placed = (message: DesignMessage) => Math.min(message.afterBeat, lastVisible);
  const leading = thread.filter((message) => placed(message) < 0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length, currentBeat, pausedCheck, note, messages.length]);

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border-l border-[#ececee] bg-white"
      aria-label="Explanation script"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <p className="text-[11px] text-[#71717a]">Script</p>
          <h2 className="mt-0.5 truncate text-[15px] font-medium tracking-tight text-[#16161a]">
            {lesson?.title || "Ask a question"}
          </h2>
          {question && !thread.some((message) => message.role === "user") ? (
            <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-[#71717a]">
              {question}
            </p>
          ) : null}
        </div>
        {streaming ? (
          <span
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success"
            aria-label="Explaining"
          />
        ) : null}
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3"
      >
        {!lesson && !streaming && !leading.length ? (
          <p className="text-[14px] leading-6 text-[#71717a]">
            {intro}
          </p>
        ) : null}

        {leading.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {!lesson && streaming ? (
          <div className="flex justify-start pt-2">
            <BoxesLoader />
          </div>
        ) : null}

        {visible.map((beat, index) => {
          const active = index === currentBeat;
          const after = thread.filter((message) => placed(message) === index);
          return (
            <div key={`${lesson?.title ?? "beat"}-${index}`} className="space-y-4">
              <div
                className={`animate-fade-up flex gap-3 ${
                  active ? "" : "opacity-80"
                }`}
              >
                <span
                  className="mt-0.5 w-4 shrink-0 font-mono text-[11px] text-[#71717a]"
                  aria-hidden
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  {beat.section ? (
                    <p className="mb-1 text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
                      {beat.section}
                    </p>
                  ) : null}
                  <p
                    className={`text-[15px] leading-7 ${
                      active ? "text-[#16161a]" : "text-[#3f3f46]"
                    }`}
                  >
                    {beat.say}
                  </p>
                  {beat.example ? (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-[#ececee] bg-[#fafafa] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[#3f3f46]">
                      {beat.example}
                    </pre>
                  ) : null}
                </div>
              </div>
              {after.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </div>
          );
        })}

        {pausedCheck ? (
          <div className="rounded-lg border border-[#ececee] bg-[#f4f1ff] px-3 py-3">
            <p className="text-[11px] font-medium tracking-wide text-[#5b4fd4] uppercase">
              Your turn
            </p>
            <p className="mt-1 text-[15px] leading-6 text-[#16161a]">
              {pausedCheck.ask}
            </p>
            {pausedCheck.hint ? (
              <p className="mt-1 text-[12px] text-[#71717a]">{pausedCheck.hint}</p>
            ) : null}
          </div>
        ) : null}

        {note ? (
          <p className="text-[13px] leading-6 text-[#3f3f46]">{note}</p>
        ) : null}
      </div>
    </aside>
  );
}
