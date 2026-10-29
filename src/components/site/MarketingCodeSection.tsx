"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useStudioAccess } from "@/components/site/StudioAccess";
import { useTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

const AUTO_MS = 5000;

const SLIDES = [
  {
    src: "/code-demo-1.png",
    alt: "Frontend inspect mapping pages and surfacing API issues",
  },
  {
    src: "/code-demo-2.png",
    alt: "Backend analyzer with stack layers and findings",
  },
  {
    src: "/code-demo-3.png",
    alt: "Repository explorer feature flow",
  },
] as const;

const FEATURES = [
  {
    title: "System design on one board",
    body: "Ask for an architecture. Diagrams stay put as you go from overview to failure modes.",
  },
  {
    title: "Vibe coder for frontend and backend",
    body: "Connect a repo. Map pages and components, then inspect the rest of the app.",
  },
  {
    title: "From ask to diagram in seconds",
    body: "No blank canvas. SeeThrough draws the path so you can follow what the code is doing.",
  },
] as const;

export function MarketingCodeSection() {
  const { openStudio } = useStudioAccess();
  const { theme } = useTheme();
  const dark = theme === "dark";

  return (
    <section
      className={cn(
        "flex min-h-dvh flex-col px-4 py-6 sm:px-6 sm:py-8 md:px-8 lg:px-10",
        dark ? "bg-[#111113] text-[#f4f4f5]" : "bg-[#f4f4f6] text-[#16161a]",
      )}
    >
      <div className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-5 lg:gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="max-w-3xl">
            <h2 className="text-[clamp(1.65rem,3.2vw,2.5rem)] leading-[1.08] font-medium tracking-[-0.03em]">
              See your software clearly
            </h2>
            <p
              className={cn(
                "mt-2 max-w-2xl text-[15px] leading-relaxed sm:text-[16px]",
                dark ? "text-[#a1a1aa]" : "text-[#3f3f46]",
              )}
            >
              From system design to the live app — architecture and pages drawn
              so you can follow the path, not guess it.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <button
              type="button"
              onClick={() => openStudio("/vibe-coder")}
              className={cn(
                "inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-medium outline-none transition",
                dark
                  ? "bg-white text-[#111] hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/40"
                  : "bg-[#16161a] text-white hover:bg-[#2a2a2e] focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/40",
              )}
            >
              Try vibe coder
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:items-stretch lg:gap-8">
          <ul
            className={cn(
              "flex flex-col justify-center rounded-lg border px-4 py-2 lg:py-3",
              dark
                ? "border-[#2a2a2e] bg-[#16161a]"
                : "border-[#ececee] bg-white",
            )}
          >
            {FEATURES.map((feature, i) => (
              <li
                key={feature.title}
                className={cn(
                  "py-3.5",
                  i > 0 &&
                    (dark
                      ? "border-t border-[#2a2a2e]"
                      : "border-t border-[#ececee]"),
                )}
              >
                <p className="text-[14px] font-medium">{feature.title}</p>
                <p
                  className={cn(
                    "mt-1 text-[13px] leading-6",
                    dark ? "text-[#a1a1aa]" : "text-[#71717a]",
                  )}
                >
                  {feature.body}
                </p>
              </li>
            ))}
          </ul>

          <div className="relative flex min-h-[min(62dvh,760px)] flex-1 flex-col lg:min-h-0">
            <CodeDemoSlideshow dark={dark} />
          </div>
        </div>
      </div>
    </section>
  );
}

function CodeDemoSlideshow({ dark }: { dark: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="relative flex h-full min-h-[min(62dvh,760px)] w-full flex-col">
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-lg border",
          dark
            ? "border-[#2a2a2e] bg-[#111113]"
            : "border-[#ececee] bg-white",
        )}
      >
        {SLIDES.map((slide, i) => (
          <div
            key={slide.src}
            className={cn(
              "absolute inset-0 transition-opacity duration-700 ease-out",
              i === index ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={i !== index}
          >
            <Image
              src={slide.src}
              alt={slide.alt}
              fill
              className="object-contain object-center p-1 sm:p-2"
              sizes="(max-width: 1024px) 100vw, 75vw"
              quality={92}
              priority={i === 0}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show slide ${i + 1}`}
            aria-current={i === index}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index
                ? dark
                  ? "w-6 bg-white"
                  : "w-6 bg-[#5b4fd4]"
                : dark
                  ? "w-1.5 bg-white/40 hover:bg-white/65"
                  : "w-1.5 bg-[#16161a]/20 hover:bg-[#16161a]/40",
            )}
          />
        ))}
      </div>
    </div>
  );
}
