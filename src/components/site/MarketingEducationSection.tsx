"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const VIDEO_SRC = "/electromagnetic-induction.webm";

const ITEMS = [
  {
    title: "Physics",
    badge: "Field diagrams",
    tone: "blue" as const,
    body: "Forces, fields, and circuits — short visual steps with a check at the end.",
  },
  {
    title: "Browser",
    badge: "Live page",
    tone: "blue" as const,
    body: "Open a real page and learn with highlights while the explanation runs.",
  },
  {
    title: "Video",
    badge: "Short film",
    tone: "blue" as const,
    body: "Type a topic and get a short explainer film you can follow step by step.",
  },
] as const;

export function MarketingEducationSection() {
  return (
    <section className="flex h-dvh min-h-dvh items-center justify-center overflow-hidden bg-black px-5 py-8 text-white sm:px-8 md:px-10 lg:px-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col justify-center">
        <div className="mx-auto max-w-3xl text-center lg:mx-0 lg:max-w-2xl lg:text-left">
          <h2 className="font-[family-name:var(--font-inter)] text-[clamp(1.85rem,4vw,3.25rem)] leading-[1.05] font-medium tracking-[-0.04em]">
            Learn by watching it drawn
            <span className="text-[#5ba3d9]">.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl font-[family-name:var(--font-inter)] text-[clamp(0.95rem,1.5vw,1.2rem)] leading-[1.5] text-[#c8d0d8] lg:mx-0">
            Not another wall of text. Physics, live pages, and short films —
            every explanation gets drawn so you can see the steps.
          </p>
        </div>

        <div className="mt-8 grid items-center gap-8 lg:mt-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.35fr)] lg:gap-12">
          <ul className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
            {ITEMS.map((item, i) => (
              <li
                key={item.title}
                className={cn(
                  "py-3.5 sm:py-4",
                  i > 0 && "border-t border-white/10",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-[family-name:var(--font-inter)] text-[1.05rem] font-semibold tracking-[-0.015em] sm:text-[1.15rem]">
                    {item.title}
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[12px] font-medium sm:text-[13px]",
                      item.tone === "amber"
                        ? "text-[#e8c07a]"
                        : "text-[#7eb8e0]",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        item.tone === "amber"
                          ? "bg-[#e8c07a]"
                          : "bg-[#5ba3d9]",
                      )}
                    />
                    {item.badge}
                  </span>
                </div>
                <p className="mt-1.5 font-[family-name:var(--font-inter)] text-[0.95rem] leading-6 text-[#9aa6b2] sm:text-[1rem]">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>

          <div className="relative w-full">
            <div
              className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,rgba(91,163,217,0.18),transparent_65%)] blur-2xl sm:-inset-10"
              aria-hidden
            />
            <EducationVideo />
          </div>
        </div>
      </div>
    </section>
  );
}

function EducationVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      video.pause();
      return;
    }
    void video.play().catch(() => undefined);
  }, []);

  return (
    <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-[0_32px_80px_-24px_rgba(0,0,0,0.8)] ring-1 ring-white/5">
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        aria-label="Electromagnetic induction explainer"
      />
    </div>
  );
}
