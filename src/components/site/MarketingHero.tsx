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
    description: "Turn a topic into a short film you can follow step by step.",
  },
] as const;

function DemoCard({
  src,
  label,
  active,
}: {
  src: string;
  label: string;
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
    <div className="w-full overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white shadow-[0_28px_80px_-28px_rgba(15,30,50,0.45)] ring-1 ring-black/[0.04]">
      <div className="relative flex items-center border-b border-[#eef1f4] px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium text-[#0f172a]">
          {label}
        </span>
      </div>
      <div className="relative bg-[#0b1220]">
        <video
          ref={videoRef}
          src={src}
          className="aspect-video w-full bg-[#0b1220] object-contain"
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
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white outline-none backdrop-blur-md transition hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/50"
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
                dark ? "bg-white/15" : "bg-[#d5e0ea]",
              )}
            >
              <span
                key={active ? `active-${progressKey}` : `idle-${i}`}
                className={cn(
                  "absolute inset-y-0 left-0 origin-left rounded-full",
                  active
                    ? cn(
                        "hero-step-progress w-full",
                        dark ? "bg-white" : "bg-[#0f172a]",
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
                "block font-[family-name:var(--font-inter)] text-[15px] font-semibold tracking-[-0.015em] transition-colors sm:text-[16px]",
                active
                  ? dark
                    ? "text-white"
                    : "text-[#0f172a]"
                  : dark
                    ? "text-white/45 group-hover:text-white/70"
                    : "text-[#94a3b8] group-hover:text-[#64748b]",
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
                    : "text-[#334155]"
                  : dark
                    ? "text-white/35 group-hover:text-white/55"
                    : "text-[#94a3b8] group-hover:text-[#64748b]",
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
        className={cn(
          "relative overflow-hidden rounded-2xl px-3 py-8 sm:rounded-[1.75rem] sm:px-8 sm:py-12 md:px-12 md:py-14",
          dark ? "bg-[#0a0a0a]" : "bg-[#f3f6f9]",
        )}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div
            className={cn(
              "absolute -top-[20%] left-[-10%] h-[70%] w-[55%] rounded-full blur-3xl",
              dark
                ? "bg-[radial-gradient(circle,rgba(91,163,217,0.28),transparent_70%)]"
                : "bg-[radial-gradient(circle,rgba(125,198,232,0.75),transparent_70%)]",
            )}
          />
          <div
            className={cn(
              "absolute top-[10%] right-[-15%] h-[65%] w-[50%] rounded-full blur-3xl",
              dark
                ? "bg-[radial-gradient(circle,rgba(214,168,110,0.22),transparent_70%)]"
                : "bg-[radial-gradient(circle,rgba(244,206,150,0.8),transparent_70%)]",
            )}
          />
          <div
            className={cn(
              "absolute bottom-[-25%] left-[20%] h-[60%] w-[60%] rounded-full blur-3xl",
              dark
                ? "bg-[radial-gradient(circle,rgba(90,170,150,0.2),transparent_70%)]"
                : "bg-[radial-gradient(circle,rgba(170,220,205,0.7),transparent_70%)]",
            )}
          />
          <div
            className={cn(
              "absolute inset-0",
              dark
                ? "bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.35)_100%)]"
                : "bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(255,255,255,0.35)_100%)]",
            )}
          />
        </div>

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
                />
              </div>
            ))}
          </div>
        </div>
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
      <div
        className={cn(
          "marketing-hero-dots pointer-events-none absolute inset-0 z-0",
          !dark && "marketing-hero-dots--light",
        )}
        aria-hidden
      />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pt-20 pb-16 md:px-10 md:pt-28 md:pb-24 lg:px-12">
        <div className="max-w-4xl text-left">
          <h1
            className={cn(
              "marketing-rise marketing-rise-1 font-[family-name:var(--font-inter)] text-[2.75rem] leading-[1.05] font-medium tracking-[-0.04em] sm:text-[3.5rem] md:text-[4.25rem]",
              dark ? "text-white" : "text-[#1a2b3c]",
            )}
          >
            Visual AI for learning systems and code
          </h1>

          <p
            className={cn(
              "marketing-rise marketing-rise-2 mt-6 max-w-xl font-[family-name:var(--font-inter)] text-[17px] leading-[1.55] font-normal sm:text-[19px] sm:leading-[1.6] md:text-[20px]",
              dark ? "text-[#e0e0e0]" : "text-[#3d5166]",
            )}
          >
            System design maps architecture as you ask. Debugging visuals turn
            repo issues into clickable diagrams. Education tools draw physics,
            live pages, and short films so you can follow every step.
          </p>
        </div>

        <div className="marketing-rise marketing-rise-3 mt-14 w-full sm:mt-16">
          <HeroDemoSlideshow dark={dark} />
        </div>
      </div>
    </section>
  );
}
