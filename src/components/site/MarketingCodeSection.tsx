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
    alt: "Frontend debugger mapping pages and surfacing API issues",
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
    title: "Debugger for frontend and backend",
    body: "Connect a repo. Map pages and components, then inspect backend bugs with file:line.",
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
        dark ? "bg-black text-white" : "bg-[#f4f6f8] text-[#1a2b3c]",
      )}
    >
      <div className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-5 lg:gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="max-w-3xl">
            <h2 className="font-[family-name:var(--font-inter)] text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.05] font-medium tracking-[-0.04em]">
              See your software clearly
            </h2>
            <p
              className={cn(
                "mt-2 max-w-2xl font-[family-name:var(--font-inter)] text-[clamp(0.95rem,1.4vw,1.125rem)] leading-[1.5]",
                dark ? "text-[#c8d0d8]" : "text-[#3d5166]",
              )}
            >
              From system design to debugging — architecture and issues drawn so
              you can follow the path, not guess it.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <button
              type="button"
              onClick={() => openStudio("/bug-analyzer")}
              className={cn(
                "inline-flex h-11 items-center rounded-xl px-5 font-[family-name:var(--font-inter)] text-[15px] font-bold outline-none transition",
                dark
                  ? "bg-white text-black hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/40"
                  : "bg-[#1a2b3c] text-white hover:bg-[#24384c] focus-visible:ring-2 focus-visible:ring-[#1b6ca8]/40",
              )}
            >
              Try debugger
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:items-stretch lg:gap-8">
          <ul className="flex flex-col justify-center lg:py-2">
            {FEATURES.map((feature, i) => (
              <li
                key={feature.title}
                className={cn(
                  "py-3.5",
                  i > 0 &&
                    (dark
                      ? "border-t border-white/10"
                      : "border-t border-[#e5eef4]"),
                )}
              >
                <p className="font-[family-name:var(--font-inter)] text-[1.05rem] font-semibold tracking-[-0.015em]">
                  {feature.title}
                </p>
                <p
                  className={cn(
                    "mt-1 font-[family-name:var(--font-inter)] text-[0.92rem] leading-6",
                    dark ? "text-[#9aa6b2]" : "text-[#3d5166]",
                  )}
                >
                  {feature.body}
                </p>
              </li>
            ))}
          </ul>

          <div className="relative flex min-h-[min(62dvh,760px)] flex-1 flex-col lg:min-h-0">
            <div
              className={cn(
                "pointer-events-none absolute -inset-4 rounded-[2rem] blur-2xl sm:-inset-8",
                dark
                  ? "bg-[radial-gradient(ellipse_at_center,rgba(91,163,217,0.18),transparent_65%)]"
                  : "bg-[radial-gradient(ellipse_at_center,rgba(125,198,232,0.35),transparent_65%)]",
              )}
              aria-hidden
            />
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
          "relative min-h-0 flex-1 overflow-hidden rounded-2xl border shadow-[0_28px_70px_-24px_rgba(15,30,50,0.4)] ring-1",
          dark
            ? "border-white/10 bg-[#0b1220] ring-white/5"
            : "border-black/10 bg-white ring-black/5",
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
                  : "w-6 bg-[#1a2b3c]"
                : dark
                  ? "w-1.5 bg-white/40 hover:bg-white/65"
                  : "w-1.5 bg-[#1a2b3c]/30 hover:bg-[#1a2b3c]/50",
            )}
          />
        ))}
      </div>
    </div>
  );
}
