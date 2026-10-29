"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import { useTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

const AUTO_MS = 6500;

const HERO_VIDEOS = [
  {
    src: "/system-design-demo.mp4",
    label: "System design",
    title: "Maps the architecture",
    description: "Ask for a system and watch the design stay on one board.",
  },
  {
    src: "/magnetic-pole-basics.mp4",
    label: "Video explainer",
    title: "Renders the concept",
    description: "Type an idea. Get a visual explanation worth sharing.",
  },
  {
    src: "/demovid.mp4",
    label: "AI tutor",
    title: "Draws while it teaches",
    description: "The tutor talks, sketches the idea, then checks you got it.",
  },
] as const;

function DemoCard({
  src,
  label,
  active,
  dark,
}: {
  src: string;
  label: string;
  active: boolean;
  dark: boolean;
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
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border",
        dark
          ? "border-[#2a2a2e] bg-[#111113]"
          : "border-[#ececee] bg-white",
      )}
    >
      <div
        className={cn(
          "flex h-10 items-center border-b px-3",
          dark ? "border-[#2a2a2e]" : "border-[#ececee]",
        )}
      >
        <span
          className={cn(
            "text-[13px] font-medium",
            dark ? "text-[#f4f4f5]" : "text-[#16161a]",
          )}
        >
          {label}
        </span>
      </div>
      <div className="relative bg-[#111113]">
        <video
          ref={videoRef}
          src={src}
          className="aspect-video w-full bg-[#111113] object-contain"
          muted
          loop
          playsInline
          preload={active ? "auto" : "metadata"}
          aria-label={label}
        />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-end px-4 pt-10 pb-3">
          <button
            type="button"
            onClick={togglePlayback}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-black/55 text-white outline-none transition hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label={paused ? `Play ${label}` : `Pause ${label}`}
          >
            {paused ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function useDemoSlideshow() {
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
    el.scrollTo({
      left: el.clientWidth * next,
      behavior: "smooth",
    });
  }

  return { scrollerRef, index, scrollToIndex };
}

function DemoSteps({
  index,
  onJump,
  dark,
  progressKey,
}: {
  index: number;
  onJump: (i: number) => void;
  dark: boolean;
  progressKey: number;
}) {
  return (
    <div
      className="grid gap-6 sm:grid-cols-3 sm:gap-8"
      role="tablist"
      aria-label="Product demos"
    >
      {HERO_VIDEOS.map((video, i) => {
        const active = i === index;
        return (
          <button
            key={video.src}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onJump(i)}
            className="group text-left outline-none"
          >
            <span
              className={cn(
                "relative mb-3 block h-[2px] w-full overflow-hidden rounded-full",
                dark ? "bg-white/15" : "bg-[#ececee]",
              )}
            >
              <span
                key={active ? `active-${progressKey}` : `idle-${i}`}
                className={cn(
                  "absolute inset-y-0 left-0 origin-left rounded-full",
                  active
                    ? cn(
                        "hero-step-progress w-full",
                        dark ? "bg-white" : "bg-[#5b4fd4]",
                      )
                    : "w-0",
                )}
                style={
                  {
                    "--hero-step-ms": `${AUTO_MS}ms`,
                  } as CSSProperties
                }
              />
            </span>
            <span
              className={cn(
                "block text-[15px] font-medium transition-colors sm:text-[16px]",
                active
                  ? dark
                    ? "text-white"
                    : "text-[#16161a]"
                  : dark
                    ? "text-white/45 group-hover:text-white/70"
                    : "text-[#71717a] group-hover:text-[#16161a]",
              )}
            >
              {video.title}
            </span>
            <span
              className={cn(
                "mt-1.5 block text-[13px] leading-5 transition-colors sm:text-[14px] sm:leading-6",
                active
                  ? dark
                    ? "text-white/75"
                    : "text-[#3f3f46]"
                  : dark
                    ? "text-white/35 group-hover:text-white/55"
                    : "text-[#71717a] group-hover:text-[#3f3f46]",
              )}
            >
              {video.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HeroDemoSlideshow({ dark }: { dark: boolean }) {
  const { scrollerRef, index, scrollToIndex } = useDemoSlideshow();
  const [progressKey, setProgressKey] = useState(0);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    setProgressKey((k) => k + 1);
  }, [index]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;

    const id = window.setInterval(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const next = (indexRef.current + 1) % HERO_VIDEOS.length;
      el.scrollTo({
        left: el.clientWidth * next,
        behavior: "smooth",
      });
    }, AUTO_MS);

    return () => window.clearInterval(id);
  }, [scrollerRef]);

  return (
    <div className="relative w-full">
      <div
        ref={scrollerRef}
        className="flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Product demos"
      >
        {HERO_VIDEOS.map((video, i) => (
          <div
            key={video.src}
            className="w-full min-w-0 shrink-0 grow-0 basis-full snap-start snap-always"
          >
            <DemoCard
              src={video.src}
              label={video.label}
              active={i === index}
              dark={dark}
            />
          </div>
        ))}
      </div>

      <div className="mt-8 sm:mt-10">
        <DemoSteps
          index={index}
          dark={dark}
          progressKey={progressKey}
          onJump={scrollToIndex}
        />
      </div>
    </div>
  );
}

export function MarketingHero() {
  const { theme } = useTheme();
  const dark = theme === "dark";

  return (
    <section className="relative flex flex-1 flex-col overflow-hidden">
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pt-16 pb-14 md:px-10 md:pt-20 md:pb-20 lg:px-12">
        <div className="max-w-4xl text-left">
          <h1
            className={cn(
              "marketing-rise marketing-rise-1 text-[2.5rem] leading-[1.08] font-medium tracking-[-0.03em] sm:text-[3.25rem] md:text-[3.75rem]",
              dark ? "text-white" : "text-[#16161a]",
            )}
          >
            Visualize everything
          </h1>

          <p
            className={cn(
              "marketing-rise marketing-rise-2 mt-5 max-w-xl text-[16px] leading-relaxed sm:text-[17px]",
              dark ? "text-[#a1a1aa]" : "text-[#3f3f46]",
            )}
          >
            AI tutor walks you through ideas on a live board. System design maps
            architecture as you ask. Vibe coder turns a repo into clickable
            diagrams you can follow.
          </p>
        </div>

        <div className="marketing-rise marketing-rise-3 mt-14 w-full sm:mt-16">
          <HeroDemoSlideshow dark={dark} />
        </div>
      </div>
    </section>
  );
}
