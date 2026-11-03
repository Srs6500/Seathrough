"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { VoiceOrbState } from "@/components/voice-tutor/VoiceOrb";
import { cn } from "@/lib/utils";
import { OrbGlyph, hand, useSeenOnce } from "./shared";

/** The orb runs through a short exchange while the sentence is on screen. */
const CYCLE: Array<{ state: VoiceOrbState; ms: number }> = [
  { state: "listening", ms: 2600 },
  { state: "thinking", ms: 2200 },
  { state: "speaking", ms: 3400 },
];

const SMALL = "(max-width: 639px)";
function subscribeSmall(cb: () => void) {
  const mq = window.matchMedia(SMALL);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * What SeeThrough is, said in one sentence, with the tutor's orb sitting in
 * the line like a word and a pen note pointing at it.
 */
export function Statement() {
  const [ref, seen] = useSeenOnce<HTMLDivElement>(0.5);
  const [step, setStep] = useState(0);
  /** Phones get a smaller orb so "[orb] teaches it out loud" fits one line. */
  const small = useSyncExternalStore(
    subscribeSmall,
    () => window.matchMedia(SMALL).matches,
    () => false,
  );

  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(
      () => setStep((s) => (s + 1) % CYCLE.length),
      CYCLE[step].ms,
    );
    return () => window.clearTimeout(id);
  }, [seen, step]);

  return (
    <section aria-label="What SeeThrough does" className="lp-dots relative overflow-hidden">
      <div
        ref={ref}
        className={cn(
          "mx-auto max-w-5xl px-5 py-24 text-center sm:py-28 md:px-6 md:py-36",
          seen && "lp-drawn",
        )}
      >
        <h2 className="text-[1.6rem] leading-[1.25] text-balance min-[400px]:text-[1.85rem] font-medium tracking-[-0.03em] text-[var(--lp-ink)] sm:text-[2.9rem] md:text-[3.5rem]">
          <span className="block">Say what you want to learn.</span>
          <span className="block whitespace-nowrap">
            <span className="relative inline-block align-middle">
              <OrbGlyph
                state={seen ? CYCLE[step].state : "idle"}
                size={small ? 50 : 76}
                className="-my-3 mr-1.5 sm:-my-4 sm:mr-3"
              />
              {/* Pen note to the left of the orb, written once the line is in view. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-full mr-1 hidden -translate-y-[85%] items-end gap-1 lg:flex"
              >
                <span
                  className={cn(
                    hand.className,
                    "lp-hand-note mb-7 text-[26px] leading-none whitespace-nowrap text-[var(--lp-pen)]",
                  )}
                >
                  that&apos;s your tutor
                </span>
                <svg
                  viewBox="0 0 90 60"
                  className="h-[60px] w-[90px] overflow-visible text-[var(--lp-pen)]"
                  fill="none"
                >
                  <path
                    className="lp-ink-stroke"
                    pathLength={1}
                    d="M4 16 C 34 6, 66 18, 80 46"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <path
                    className="lp-ink-stroke"
                    pathLength={1}
                    d="M68 40 L 81 48 L 86 33"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </span>
            teaches it out loud
          </span>
          <span className="block">and draws while it talks.</span>
        </h2>
      </div>
    </section>
  );
}
