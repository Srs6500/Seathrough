"use client";

import { cn } from "@/lib/utils";
import { TutorOrbLauncher } from "@/components/site/TutorOrbLauncher";
import { hand } from "./shared";

/**
 * Hero: the page opens where the product starts — the tutor's orb on its
 * dotted board. Tap it and it flies down into Smart Tutor and starts listening.
 */
export function StartLessonHero() {
  return (
    <section
      aria-labelledby="start-heading"
      className="lp-dots relative flex min-h-[calc(100dvh-3rem)] items-center"
    >
      <div className="marketing-rise marketing-rise-1 mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center">
        <TutorOrbLauncher scale={1.75} />
        <h1
          id="start-heading"
          className="mt-12 text-[2.6rem] leading-[1.04] font-medium tracking-[-0.035em] text-[var(--lp-ink)] sm:text-[3.6rem] md:text-[4.25rem]"
        >
          Start a lesson
        </h1>
        <p className="mt-5 max-w-md text-[16px] leading-relaxed text-[var(--lp-soft)] sm:text-[18px]">
          Tap the orb and say a topic. It starts listening right away.
        </p>
        <p
          aria-hidden
          className={cn(hand.className, "mt-7 -rotate-2 text-[26px] text-[var(--lp-pen)]")}
        >
          try “how do vaccines work?”
        </p>
      </div>
    </section>
  );
}
