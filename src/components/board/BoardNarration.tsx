"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatNarrationForDisplay,
  sameNarrationText,
} from "@/lib/math/formatNarrationForDisplay";
import type { LessonSource } from "@/types/lesson";

export type BoardNarrationLine = {
  id: string;
  text: string;
  kind?: "narration" | "summary" | "error" | "student";
};

type BoardNarrationProps = {
  lines: BoardNarrationLine[];
  sources?: LessonSource[];
  codeBuffer?: string;
  streaming?: boolean;
  title?: string;
  /** side = desktop rail; bottom = mobile sheet */
  placement?: "side" | "bottom";
  followUpValue?: string;
  onFollowUpChange?: (value: string) => void;
  onFollowUpSubmit?: () => void;
  followUpDisabled?: boolean;
  showFollowUp?: boolean;
};

function displayText(text: string): string {
  if (!text.trim()) return text;
  if (text.startsWith("[voice unavailable")) return text;
  return formatNarrationForDisplay(text);
}

/**
 * Lesson notes beside the board. Steps are numbered because they arrive
 * in teaching order — ask, then each beat, then the takeaway.
 */
export function BoardNarration({
  lines,
  sources = [],
  codeBuffer,
  streaming,
  title,
  placement = "side",
  followUpValue = "",
  onFollowUpChange,
  onFollowUpSubmit,
  followUpDisabled = false,
  showFollowUp = false,
}: BoardNarrationProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, codeBuffer, sources]);

  const isSide = placement === "side";
  const visibleLines = lines.reduce<BoardNarrationLine[]>((kept, line) => {
    const text = displayText(line.text);
    if (!text) return kept;
    if (line.kind === "summary") {
      const duplicateIndex = kept.findIndex(
        (prior) =>
          prior.kind !== "student" &&
          prior.kind !== "error" &&
          sameNarrationText(prior.text, text),
      );
      if (duplicateIndex >= 0) kept.splice(duplicateIndex, 1);
    }
    kept.push({ ...line, text });
    return kept;
  }, []);
  const empty = visibleLines.length === 0 && !codeBuffer?.trim();

  return (
    <aside
      className={`flex min-h-0 w-full flex-col bg-[#f4f8fb] ${
        isSide
          ? "h-full border-l border-[#d7e3eb]"
          : "h-full max-h-[38dvh] border-t border-[#d7e3eb]"
      }`}
      aria-label="Lesson notes"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-[#6a7d90]">Notes</p>
          {title ? (
            <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-tight text-[#17324a]">
              {title}
            </h2>
          ) : (
            <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-[#17324a]">
              Follow along
            </p>
          )}
        </div>
        {streaming ? (
          <span
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#2a7a5c]"
            aria-label="Explaining"
          />
        ) : null}
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3"
      >
        {empty ? (
          <p className="text-[14px] leading-6 text-[#6a7d90]">
            As the board draws, the spoken steps will land here so you can
            reread them.
          </p>
        ) : null}

        {visibleLines.map((line, index) => {
          const text = line.text;
          const lineKey = `${line.id}-${index}`;
          const numbered =
            line.kind !== "student" &&
            line.kind !== "error" &&
            line.kind !== "summary";
          const n = numbered
            ? visibleLines
                .slice(0, index + 1)
                .filter(
                  (candidate) =>
                    candidate.kind !== "student" &&
                    candidate.kind !== "error" &&
                    candidate.kind !== "summary",
                ).length
            : 0;

          if (line.kind === "error") {
            return (
              <p
                key={lineKey}
                className="animate-fade-up text-[14px] leading-6 text-error"
              >
                {text}
              </p>
            );
          }
          if (line.kind === "student") {
            return (
              <div key={lineKey} className="animate-fade-up">
                <p className="text-[11px] font-medium text-[#1b6ca8]">You</p>
                <p className="mt-1 text-[14px] leading-6 text-[#17324a]">
                  {text}
                </p>
              </div>
            );
          }
          if (line.kind === "summary") {
            return (
              <p
                key={lineKey}
                className="animate-fade-up border-l-2 border-[#2a7a5c] pl-3 text-[14.5px] leading-6 text-[#17324a]"
              >
                {text}
              </p>
            );
          }
          return (
            <div key={lineKey} className="animate-fade-up flex gap-3">
              <span
                className="mt-0.5 w-4 shrink-0 font-mono text-[11px] text-[#8a9aab]"
                aria-hidden
              >
                {String(n).padStart(2, "0")}
              </span>
              <p className="text-[15px] leading-7 text-[#1e3a5f]">{text}</p>
            </div>
          );
        })}

        {codeBuffer?.trim() ? (
          <pre className="animate-fade-up overflow-x-auto rounded-lg bg-white px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[#4a6580]">
            {codeBuffer}
          </pre>
        ) : null}

        {sources.length ? (
          <div className="border-t border-[#d7e3eb] pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-[#6a7d90] uppercase">
                Sources <span className="font-normal">({sources.length})</span>
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={sourcesExpanded}
                onClick={() => setSourcesExpanded((expanded) => !expanded)}
                className="h-7 rounded-md px-2 text-[11px] font-semibold text-[#1b6ca8] hover:bg-[#e8f2fa]"
              >
                {sourcesExpanded ? "Hide sources" : "View all sources"}
              </Button>
            </div>
            {sourcesExpanded ? (
              <ol className="mt-2.5 space-y-2.5">
                {sources.map((source, index) => (
                  <li key={source.url} className="flex gap-2.5">
                    <span className="mt-0.5 shrink-0 font-mono text-[10px] text-[#8a9aab]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 text-[12.5px] leading-5 text-[#1b6ca8] underline decoration-[#1b6ca8]/25 underline-offset-2 hover:decoration-[#1b6ca8]"
                    >
                      <span className="line-clamp-2">{source.title}</span>
                      <span className="block truncate text-[11px] text-[#8a9aab] no-underline">
                        {source.publisher}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>

      {showFollowUp ? (
        <form
          className="shrink-0 border-t border-[#d7e3eb] bg-white/70 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (followUpDisabled || !followUpValue.trim()) return;
            onFollowUpSubmit?.();
          }}
        >
          <label
            htmlFor={`lesson-follow-up-${placement}`}
            className="mb-1.5 block text-[11px] font-semibold tracking-[0.06em] text-[#6a7d90] uppercase"
          >
            Ask a follow-up
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`lesson-follow-up-${placement}`}
              value={followUpValue}
              onChange={(event) => onFollowUpChange?.(event.target.value)}
              disabled={followUpDisabled}
              placeholder="Ask about this lesson…"
              className="h-9 min-w-0 rounded-lg border-[#d7e3eb] bg-white px-3 text-[13px] shadow-none"
            />
            <Button
              type="submit"
              disabled={followUpDisabled || !followUpValue.trim()}
              className="h-9 shrink-0 rounded-lg px-3 text-[12px] font-semibold shadow-none"
            >
              Ask
            </Button>
          </div>
        </form>
      ) : null}
    </aside>
  );
}
