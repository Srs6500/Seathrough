"use client";

import { MarketingProductPreview } from "@/components/site/MarketingProductPreview";
import { useStudioAccess } from "@/components/site/StudioAccess";

export function MarketingHero() {
  const { openStudio } = useStudioAccess();

  return (
    <section className="relative flex flex-1 flex-col overflow-hidden">
      {/* Centered light dot grid behind hero content */}
      <div
        className="marketing-hero-dots pointer-events-none absolute inset-0 z-0"
        aria-hidden
      />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-20 pb-16 md:px-16 md:pt-28 md:pb-24 lg:px-24">
        <div className="max-w-3xl text-left">
          <div className="marketing-rise marketing-rise-1 mb-5 inline-flex items-center gap-2">
            <span
              className="h-1.5 w-3 rounded-full bg-white"
              aria-hidden
            />
            <span className="font-[family-name:var(--font-inter)] text-[14px] font-medium tracking-[-0.01em] text-white/90">
              Visualize
            </span>
          </div>

          <h1 className="marketing-rise marketing-rise-1 font-[family-name:var(--font-inter)] text-[2rem] leading-[1.12] font-medium tracking-[-0.035em] text-white sm:text-[2.5rem] md:text-[2.85rem]">
            Learn systems, debug code, and see every step drawn for you.
          </h1>

          <p className="marketing-rise marketing-rise-2 mt-5 max-w-md font-[family-name:var(--font-inter)] text-[14px] leading-[1.55] font-normal text-[#e0e0e0] sm:text-[15px] sm:leading-[1.6]">
            AI tutor walks you through ideas on a live board. System design maps
            architecture as you ask. Debugging visuals turn repo issues into
            clickable diagrams you can follow.
          </p>

          <div className="marketing-rise marketing-rise-2 mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => openStudio("/bug-analyzer")}
              className="inline-flex h-10 items-center rounded-lg bg-white px-5 font-[family-name:var(--font-inter)] text-[13px] font-bold text-black outline-none transition hover:bg-white/92 focus-visible:ring-2 focus-visible:ring-white/50"
            >
              Get started now
            </button>
            <button
              type="button"
              onClick={() => openStudio("/video")}
              className="inline-flex h-10 items-center rounded-lg bg-[#262626] px-5 font-[family-name:var(--font-inter)] text-[13px] font-bold text-white outline-none transition hover:bg-[#303030] focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Watch demo
            </button>
          </div>
        </div>

        <div className="marketing-rise marketing-rise-3 mt-14 w-full sm:mt-16">
          <MarketingProductPreview />
        </div>
      </div>
    </section>
  );
}
