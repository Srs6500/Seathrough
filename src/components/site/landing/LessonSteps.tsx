"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceOrbState } from "@/components/voice-tutor/VoiceOrb";
import { cn } from "@/lib/utils";
import { OrbGlyph, SectionIntro } from "./shared";

/** A real lesson, in order. The orb beside the list shows what the tutor is doing at each step. */
const STEPS: Array<{ title: string; body: string; orb: VoiceOrbState; status: string }> = [
  {
    title: "You name a topic",
    body: "Say it out loud, or type it. Drop in a picture if that's easier.",
    orb: "listening",
    status: "Listening",
  },
  {
    title: "It asks which part",
    body: "A big topic gets a few angles to choose from, so the lesson fits what you need.",
    orb: "thinking",
    status: "Thinking",
  },
  {
    title: "It teaches and draws",
    body: "Each idea is spoken while it's written and drawn. Cut in with a question whenever you like.",
    orb: "speaking",
    status: "Speaking",
  },
  {
    title: "It checks you got it",
    body: "A quick question at the right moment, with a hint if you're stuck.",
    orb: "listening",
    status: "Waiting for your answer",
  },
  {
    title: "It keeps the lesson",
    body: "Every board, diagram and video is saved in History. Reopen it later or export a PDF.",
    orb: "idle",
    status: "Saved",
  },
];

export function LessonSteps() {
  const [active, setActive] = useState(0);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  // The step crossing the middle of the screen is the active one.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = itemRefs.current.indexOf(entry.target as HTMLLIElement);
          if (i >= 0) setActive(i);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const el of itemRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  const step = STEPS[active];

  return (
    <section aria-labelledby="steps-heading" className="border-t border-[var(--lp-line)]">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-16 md:px-6 md:py-32">
        <div className="md:sticky md:top-24 md:self-start">
          <SectionIntro id="steps-heading" title="How a lesson goes">
            Talk to it like a tutor sitting next to you.
          </SectionIntro>
          {/* The orb mirrors the step you're reading. */}
          <div className="lp-dots mt-10 hidden aspect-[4/3] flex-col items-center justify-center rounded-2xl border border-[var(--lp-line)] bg-[var(--lp-paper)] md:flex">
            <OrbGlyph state={step.orb} size={168} />
            <p
              aria-live="polite"
              className="mt-6 rounded-full border border-[var(--lp-line)] bg-[var(--lp-paper)] px-3 py-1 text-[12px] font-medium text-[var(--lp-soft)]"
            >
              {step.status}
            </p>
          </div>
        </div>

        <ol className="flex flex-col md:pt-[38vh] md:pb-[30vh]">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className={cn(
                "grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-t border-[var(--lp-line)] py-8 transition-opacity duration-300 first:border-t-0 md:py-12",
                i === active ? "opacity-100" : "md:opacity-35",
              )}
            >
              <span className="pt-1 text-[14px] font-medium text-[var(--lp-muted)] tabular-nums">
                {i + 1}
              </span>
              <div>
                <h3 className="text-[20px] font-medium tracking-[-0.01em] text-[var(--lp-ink)] sm:text-[24px]">
                  {s.title}
                </h3>
                <p className="mt-2 max-w-md text-[15px] leading-7 text-[var(--lp-soft)]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
