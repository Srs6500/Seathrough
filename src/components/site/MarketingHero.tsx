"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
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

function WaveFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] bg-[#e8e8ea] p-3 shadow-[0_40px_100px_-24px_rgba(0,0,0,0.75)] sm:rounded-[2rem] sm:p-4 md:rounded-[2.25rem] md:p-5",
        className,
      )}
    >
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
  variant = "framed",
}: {
  src: string;
  label: string;
  caption: string;
  active: boolean;
  variant?: "framed" | "cinema";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(!active);
  const cinema = variant === "cinema";

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

  const media = (
    <>
      <video
        ref={videoRef}
        src={src}
        className={cn(
          "w-full bg-black object-contain",
          cinema
            ? "aspect-video max-h-[min(72vh,760px)]"
            : "aspect-video bg-[#f4f4f5]",
        )}
        muted
        loop
        playsInline
        preload={active ? "auto" : "metadata"}
        aria-label={label}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 via-black/25 to-transparent",
          cinema ? "px-5 pt-16 pb-4" : "px-4 pt-10 pb-3",
        )}
      >
        <div className="min-w-0 text-left">
          <p
            className={cn(
              "truncate font-semibold text-white",
              cinema ? "text-[15px]" : "text-[13px]",
            )}
          >
            {label}
          </p>
          <p
            className={cn(
              "truncate text-white/70",
              cinema ? "text-[12px]" : "text-[11px]",
            )}
          >
            {caption}
          </p>
        </div>
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
    </>
  );

  if (cinema) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        {media}
      </div>
    );
  }

  return <WaveFrame>{media}</WaveFrame>;
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
    const child = el.children[next] as HTMLElement | undefined;
    if (!child) return;
    child.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  return { scrollerRef, index, scrollToIndex };
}

function SlideshowControls({
  index,
  onPrev,
  onNext,
  onJump,
  dark,
}: {
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  dark: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={onPrev}
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
            onClick={() => onJump(i)}
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
        onClick={onNext}
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
  );
}

function HeroDemoSlideshow({ dark }: { dark: boolean }) {
  const { scrollerRef, index, scrollToIndex } = useDemoSlideshow();

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

      <div className="mt-5">
        <SlideshowControls
          index={index}
          dark={dark}
          onPrev={() => scrollToIndex(Math.max(0, index - 1))}
          onNext={() =>
            scrollToIndex(Math.min(HERO_VIDEOS.length - 1, index + 1))
          }
          onJump={scrollToIndex}
        />
      </div>
    </div>
  );
}

function DemoFullscreen({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { scrollerRef, index, scrollToIndex } = useDemoSlideshow();
  const closeRef = useRef<HTMLButtonElement>(null);
  const indexRef = useRef(index);
  const scrollRef = useRef(scrollToIndex);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  indexRef.current = index;
  scrollRef.current = scrollToIndex;

  useEffect(() => {
    if (open) {
      setVisible(true);
      setExiting(false);
      return;
    }
    if (!visible) return;
    setExiting(true);
    const id = window.setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 220);
    return () => window.clearTimeout(id);
  }, [open, visible]);

  useEffect(() => {
    if (!visible || exiting) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        scrollRef.current(Math.max(0, indexRef.current - 1));
      }
      if (event.key === "ArrowRight") {
        scrollRef.current(
          Math.min(HERO_VIDEOS.length - 1, indexRef.current + 1),
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [visible, exiting, onClose]);

  if (!visible) return null;

  const motionClass = exiting ? "demo-overlay-exit" : "demo-overlay-enter";
  const stageClass = exiting ? "demo-stage-exit" : "demo-stage-enter";

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md",
        motionClass,
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Product demos"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "relative flex w-full max-w-5xl flex-col px-4 sm:px-6",
          stageClass,
        )}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute -top-1 right-4 z-20 inline-flex size-10 items-center justify-center rounded-full bg-white/10 text-white outline-none backdrop-blur-md transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/40 sm:right-6"
          aria-label="Close demo"
        >
          <X className="size-5" />
        </button>

        <div
          ref={scrollerRef}
          className="mt-10 flex snap-x snap-mandatory gap-0 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Product demos fullscreen"
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
                active={i === index && !exiting}
                variant="cinema"
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-center">
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-md">
            <SlideshowControls
              index={index}
              dark
              onPrev={() => scrollToIndex(Math.max(0, index - 1))}
              onNext={() =>
                scrollToIndex(Math.min(HERO_VIDEOS.length - 1, index + 1))
              }
              onJump={scrollToIndex}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketingHero() {
  const { openGetStarted } = useStudioAccess();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [demoOpen, setDemoOpen] = useState(false);

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
              onClick={openGetStarted}
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
              onClick={() => setDemoOpen(true)}
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

      <DemoFullscreen open={demoOpen} onClose={() => setDemoOpen(false)} />
    </section>
  );
}
