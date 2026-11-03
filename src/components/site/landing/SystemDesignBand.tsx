"use client";

import { useStudioAccess } from "@/components/site/StudioAccess";
import { DemoVideo, SectionIntro } from "./shared";

/** The second product: system design drawn on one board. */
export function SystemDesignBand() {
  const { openStudio } = useStudioAccess();
  return (
    <section aria-labelledby="system-heading" className="border-t border-[var(--lp-line)]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-14 md:px-6 md:py-32">
        <div>
          <SectionIntro id="system-heading" title="Systems, drawn on one board">
            Ask for a system and watch the architecture appear, box by box,
            down to what happens when a part fails.
          </SectionIntro>
          <button
            type="button"
            onClick={() => openStudio("/system-design")}
            className="mt-8 inline-flex h-10 items-center rounded-lg border border-[var(--lp-line)] bg-[var(--lp-paper)] px-4 text-[14px] font-medium text-[var(--lp-ink)] outline-none transition hover:border-[var(--lp-muted)]/50 focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/40"
          >
            Open System Design
          </button>
        </div>
        <div className="rounded-2xl border border-[var(--lp-line)] bg-[var(--lp-paper)] p-2 sm:p-3">
          <DemoVideo
            src="/system-design-demo.mp4"
            label="System Design drawing an architecture"
            className="aspect-[1920/1166] overflow-hidden rounded-xl bg-[#f4f4f6]"
            videoClassName="object-cover"
          />
        </div>
      </div>
    </section>
  );
}
