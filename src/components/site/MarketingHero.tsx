"use client";

import { useEffect, useRef } from "react";
import { SectionIntro } from "@/components/site/landing/shared";

/**
 * A full lesson recording, presented as a video (framed player with controls)
 * rather than a background. Starts muted when scrolled into view.
 */
export function MarketingHero() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Autoplay once when it first comes into view; after that the controls are the visitor's.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        void video.play().catch(() => undefined);
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <section aria-labelledby="watch-heading" className="border-t border-[var(--lp-line)]">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
        <SectionIntro id="watch-heading" title="Watch a lesson">
          A real session: ask about architecture and the tutor writes the board
          by hand while it talks you through it.
        </SectionIntro>

        <div className="mt-12 rounded-2xl border border-[var(--lp-line)] bg-[var(--lp-paper)] p-2 shadow-[0_24px_60px_-32px_rgba(22,22,26,0.28)] sm:p-3">
          <video
            ref={videoRef}
            className="block aspect-[3456/1812] h-auto w-full rounded-xl bg-[#f4f4f6]"
            src="/hero-bg.mp4"
            poster="/hero-bg-poster.jpg"
            muted
            loop
            playsInline
            controls
            preload="metadata"
            aria-label="AI Tutor teaching the basics of architecture on the whiteboard"
          />
        </div>
      </div>
    </section>
  );
}
