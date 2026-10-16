"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useStudioAccess } from "@/components/site/StudioAccess";
import { useTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

const HERO_VIDEOS = [
  {
    src: "/system-design-demo.mp4",
    label: "System design",
    caption: "Architecture drawn as you ask",
  },
  {
    src: "/magnetic-pole-basics.mp4",
    label: "Video explainer",
    caption: "Concepts rendered as film",
  },
  {
    src: "/demovid.mp4",
    label: "AI tutor",
    caption: "Watch and learn on the board",
  },
] as const;

function WaveFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] bg-[#e8e8ea] p-3 shadow-[0_40px_100px_-24px_rgba(0,0,0,0.75)] sm:rounded-[2rem] sm:p-4 md:rounded-[2.25rem] md:p-5">
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 800 500"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <path
          d="M0 380 C 120 340, 200 420, 320 390 S 520 330, 640 370 S 760 420, 800 400 L 800 500 L 0 500 Z"
          fill="rgba(20,20,22,0.14)"
        />
        <path
          d="M0 410 C 140 370, 220 450, 360 415 S 560 360, 680 400 S 760 440, 800 425 L 800 500 L 0 500 Z"
          fill="rgba(10,10,12,0.18)"
        />
        <path
          d="M0 0 C 180 40, 260 -10, 400 30 S 620 70, 800 20 L 800 0 Z"
          fill="rgba(20,20,22,0.1)"
        />
        <path
          d="M0 90 C 100 50, 180 120, 280 85 S 480 40, 600 75 S 720 110, 800 90 L 800 0 L 0 0 Z"
          fill="rgba(10,10,12,0.08)"
        />
      </svg>
      <div className="relative overflow-hidden rounded-[1.25rem] bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] sm:rounded-[1.5rem]">
        {children}
      </div>
    </div>
  );
}

function DemoCard({
  src,
  label,
  caption,
  active,
}: {
  src: string;
  label: string;
  caption: string;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(!active);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      video.pause();
      setPaused(true);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      video.pause();
      setPaused(true);
      return;
    }
    void video.play().then(() => setPaused(false)).catch(() => undefined);
  }, [active]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
      setPaused(false);
      return;
    }
    video.pause();
    setPaused(true);
  }

  return (
    <WaveFrame>
      <video
        ref={videoRef}
        src={src}
        className="aspect-video w-full bg-[#f4f4f5] object-contain"
        muted
        loop
        playsInline
        preload={active ? "auto" : "metadata"}
        aria-label={label}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/55 to-transparent px-4 pt-10 pb-3">
        <div className="min-w-0 text-left">
          <p className="truncate text-[13px] font-semibold text-white">
            {label}
          </p>
          <p className="truncate text-[11px] text-white/75">{caption}</p>
        </div>
        <button
          type="button"
          onClick={togglePlayback}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-black/75 text-white outline-none hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label={paused ? `Play ${label}` : `Pause ${label}`}
        >
          {paused ? (
            <Play className="size-4" />
          ) : (
            <Pause className="size-4" />
          )}
        </button>
      </div>
    </WaveFrame>
  );
}

function HeroDemoSlideshow({ dark }: { dark: boolean }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    function onScroll() {
      const node = scrollerRef.current;
      if (!node) return;
      const children = [...node.children] as HTMLElement[];
      if (!children.length) return;
      const mid = node.scrollLeft + node.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      children.forEach((child, i) => {
        const center = child.offsetLeft + child.offsetWidth / 2;
        const dist = Math.abs(center - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setIndex(best);
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToIndex(next: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const child = el.children[next] as HTMLElement | undefined;
    if (!child) return;
    child.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  return (
    <div className="relative w-full">
      <div
        className={cn(
          "pointer-events-none absolute -inset-x-16 -bottom-20 h-48 rounded-[100%] blur-3xl",
          dark
            ? "bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.12),transparent_70%)]"
            : "bg-[radial-gradient(ellipse_at_center,rgba(26,43,60,0.08),transparent_70%)]",
        )}
        aria-hidden
      />

      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-0 overflow-x-auto scroll-smooth pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Product demos"
      >
        {HERO_VIDEOS.map((video, i) => (
          <div
            key={video.src}
            className="w-full min-w-full shrink-0 snap-start snap-always"
          >
            <DemoCard
              src={video.src}
              label={video.label}
              caption={video.caption}
              active={i === index}
            />
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => scrollToIndex(Math.max(0, index - 1))}
          disabled={index === 0}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-lg border outline-none transition disabled:opacity-30",
            dark
              ? "border-white/15 bg-white/5 text-white hover:bg-white/10"
              : "border-[#d5e0ea] bg-white text-[#1a2b3c] hover:bg-[#f4f7fb]",
          )}
          aria-label="Previous demo"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex items-center gap-2">
          {HERO_VIDEOS.map((video, i) => (
            <button
              key={video.src}
              type="button"
              onClick={() => scrollToIndex(i)}
              className={
                i === index
                  ? cn(
                      "h-1.5 w-6 rounded-full",
                      dark ? "bg-white" : "bg-[#1a2b3c]",
                    )
                  : cn(
                      "h-1.5 w-1.5 rounded-full",
                      dark
                        ? "bg-white/35 hover:bg-white/55"
                        : "bg-[#1a2b3c]/25 hover:bg-[#1a2b3c]/45",
                    )
              }
              aria-label={`Show ${video.label}`}
              aria-current={i === index ? "true" : undefined}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            scrollToIndex(Math.min(HERO_VIDEOS.length - 1, index + 1))
          }
          disabled={index === HERO_VIDEOS.length - 1}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-lg border outline-none transition disabled:opacity-30",
            dark
              ? "border-white/15 bg-white/5 text-white hover:bg-white/10"
              : "border-[#d5e0ea] bg-white text-[#1a2b3c] hover:bg-[#f4f7fb]",
          )}
          aria-label="Next demo"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function MarketingHero() {
  const { openStudio } = useStudioAccess();
  const { theme } = useTheme();
  const dark = theme === "dark";

  return (
    <section className="relative flex flex-1 flex-col overflow-hidden">
      <div
        className={cn(
          "marketing-hero-dots pointer-events-none absolute inset-0 z-0",
          !dark && "marketing-hero-dots--light",
        )}
        aria-hidden
      />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-20 pb-16 md:px-16 md:pt-28 md:pb-24 lg:px-24">
        <div className="max-w-3xl text-left">
          <div className="marketing-rise marketing-rise-1 mb-5 inline-flex items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-3 rounded-full",
                dark ? "bg-white" : "bg-[#1a2b3c]",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "font-[family-name:var(--font-inter)] text-[14px] font-medium tracking-[-0.01em]",
                dark ? "text-white/90" : "text-[#1a2b3c]/85",
              )}
            >
              Visualize
            </span>
          </div>

          <h1
            className={cn(
              "marketing-rise marketing-rise-1 font-[family-name:var(--font-inter)] text-[2rem] leading-[1.12] font-medium tracking-[-0.035em] sm:text-[2.5rem] md:text-[2.85rem]",
              dark ? "text-white" : "text-[#1a2b3c]",
            )}
          >
            Learn systems, debug code, and see every step drawn for you.
          </h1>

          <p
            className={cn(
              "marketing-rise marketing-rise-2 mt-5 max-w-md font-[family-name:var(--font-inter)] text-[14px] leading-[1.55] font-normal sm:text-[15px] sm:leading-[1.6]",
              dark ? "text-[#e0e0e0]" : "text-[#3d5166]",
            )}
          >
            AI tutor walks you through ideas on a live board. System design maps
            architecture as you ask. Debugging visuals turn repo issues into
            clickable diagrams you can follow.
          </p>

          <div className="marketing-rise marketing-rise-2 mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => openStudio("/bug-analyzer")}
              className={cn(
                "inline-flex h-10 items-center rounded-lg px-5 font-[family-name:var(--font-inter)] text-[13px] font-bold outline-none transition",
                dark
                  ? "bg-white text-black hover:bg-white/92 focus-visible:ring-2 focus-visible:ring-white/50"
                  : "bg-[#1a2b3c] text-white hover:bg-[#24384c] focus-visible:ring-2 focus-visible:ring-[#1b6ca8]/40",
              )}
            >
              Get started now
            </button>
            <button
              type="button"
              onClick={() => openStudio("/video")}
              className={cn(
                "inline-flex h-10 items-center rounded-lg px-5 font-[family-name:var(--font-inter)] text-[13px] font-bold outline-none transition",
                dark
                  ? "bg-[#262626] text-white hover:bg-[#303030] focus-visible:ring-2 focus-visible:ring-white/30"
                  : "border border-[#d5e0ea] bg-white text-[#1a2b3c] hover:bg-[#f4f7fb] focus-visible:ring-2 focus-visible:ring-[#1b6ca8]/30",
              )}
            >
              Watch demo
            </button>
          </div>
        </div>

        <div className="marketing-rise marketing-rise-3 mt-14 w-full sm:mt-16">
          <HeroDemoSlideshow dark={dark} />
        </div>
      </div>
    </section>
  );
}
