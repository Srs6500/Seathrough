"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TOPIC_MAX } from "@/lib/explain-video/film";
import { cn } from "@/lib/utils";

export const EXAMPLE_TOPIC = "Explain how credit cards make money";

type PromptComposerProps = {
  topic: string;
  onTopic: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string;
};

export function PromptComposer({ topic, onTopic, onSubmit, busy, error }: PromptComposerProps) {
  const empty = topic.trim().length === 0;

  return (
    <form
      className="mx-auto w-full max-w-[40rem] px-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h1 className="text-center text-[1.65rem] leading-tight font-medium tracking-[-0.03em] text-[#16161a] sm:text-[2rem]">
        Type an idea. Get a visual explanation worth sharing.
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-center text-[14px] leading-6 text-[#3f3f46]">
        Paste a paragraph or name a topic. You will review five scenes, then we draw and narrate
        them. Edit anything before you send the link.
      </p>

      <label className="sr-only" htmlFor="explain-topic">
        Topic or source text
      </label>
      <Textarea
        id="explain-topic"
        name="topic"
        value={topic}
        maxLength={TOPIC_MAX}
        disabled={busy}
        autoComplete="off"
        placeholder={EXAMPLE_TOPIC}
        onChange={(event) => onTopic(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        className={cn(
          "mt-6 min-h-[8.5rem] resize-y rounded-lg border-[#ececee] bg-white px-3 py-3 text-[14px] leading-6 text-[#16161a] shadow-none placeholder:text-[#71717a] focus-visible:border-[#ececee] focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/30 disabled:opacity-60",
        )}
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-[#71717a]">
        <button
          type="button"
          disabled={busy}
          onClick={() => onTopic(EXAMPLE_TOPIC)}
          className="rounded-lg px-1 py-0.5 text-left font-medium text-[#5b4fd4] underline-offset-2 hover:underline disabled:opacity-50"
        >
          Try the credit-card example
        </button>
        <span>
          {topic.length.toLocaleString()} / {TOPIC_MAX.toLocaleString()}
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-[#ececee] bg-white px-3 py-2 text-center text-[13px] text-[#c24545]" role="alert">
          {error}
        </p>
      ) : (
        <p className="mt-3 min-h-5 text-center text-[12px] text-[#71717a]" role="status">
          {busy ? "Planning a five-scene outline" : "Next: review the outline, then generate the film."}
        </p>
      )}

      <div className="mt-3 flex justify-center">
        <Button
          type="submit"
          disabled={busy || empty}
          aria-busy={busy}
          className="h-9 rounded-lg bg-[#16161a] px-4 text-[13px] font-medium text-white hover:bg-[#2a2a2e]"
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          {busy ? "Planning" : "Review outline"}
        </Button>
      </div>
    </form>
  );
}
