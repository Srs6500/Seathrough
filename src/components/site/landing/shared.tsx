"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Caveat } from "next/font/google";
import { Pause, Play } from "lucide-react";
import { MorphOrb } from "@/components/voice-tutor/MorphOrb";
import type { VoiceOrbState } from "@/components/voice-tutor/VoiceOrb";
import { cn } from "@/lib/utils";

/** The whiteboard's handwriting face — used only for pen notes on the landing page. */
export const hand = Caveat({ subsets: ["latin"], weight: "600", display: "swap" });

const ORB_PX = 104;

/** The tutor's dotted orb at any size (MorphOrb is drawn at 104px and scaled). */
export function OrbGlyph({
  state,
  size,
  className,
}: {
  state: VoiceOrbState;
  size: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        // Hide MorphOrb's own status pill — too small to read at these sizes.
        "relative inline-block shrink-0 align-middle [&_div:has(>.morph-orb-label)]:hidden",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute top-1/2 left-1/2"
        style={{
          width: ORB_PX,
          height: ORB_PX,
          marginLeft: -ORB_PX / 2,
          marginTop: -ORB_PX / 2,
          transform: `scale(${size / ORB_PX})`,
        }}
      >
        <MorphOrb state={state} />
      </span>
    </span>
  );
}

/** True once the element has scrolled into view (stays true). */
export function useSeenOnce<T extends Element>(threshold = 0.4): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}

/**
 * Muted looping demo recording that plays only while on screen (and while
 * `active`), with its own pause button. Respects reduced motion.
 */
export function DemoVideo({
  src,
  poster,
  label,
  active = true,
  className,
  videoClassName,
  showControl = true,
}: {
  src: string;
  poster?: string;
  label: string;
  active?: boolean;
  className?: string;
  videoClassName?: string;
  showControl?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(true);
  const [onScreen, setOnScreen] = useState(false);
  const userPausedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(video);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (active && onScreen && !reduced && !userPausedRef.current) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [active, onScreen]);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPausedRef.current = false;
      void video.play().catch(() => undefined);
    } else {
      userPausedRef.current = true;
      video.pause();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <video
        ref={videoRef}
        className={cn("block size-full", videoClassName)}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        aria-label={label}
      />
      {showControl ? (
        <button
          type="button"
          onClick={toggle}
          tabIndex={active ? 0 : -1}
          className="absolute right-3 bottom-3 inline-flex size-8 items-center justify-center rounded-lg bg-black/45 text-white outline-none backdrop-blur-sm transition hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label={paused ? `Play: ${label}` : `Pause: ${label}`}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </button>
      ) : null}
    </div>
  );
}

/** Section heading + one supporting line, in the tutor's voice. */
export function SectionIntro({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <h2
        id={id}
        className="text-[2rem] leading-[1.08] font-medium tracking-[-0.03em] text-[var(--lp-ink)] sm:text-[2.6rem]"
      >
        {title}
      </h2>
      {children ? (
        <p className="mt-4 text-[16px] leading-relaxed text-[var(--lp-soft)] sm:text-[17px]">
          {children}
        </p>
      ) : null}
    </div>
  );
}
