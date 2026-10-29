"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

const VIDEO_SRC = "/electromagnetic-induction.webm";

const ITEMS: {
  title: string;
  badge: string;
  body: string;
}[] = [
  {
    title: "Physics",
    badge: "Field diagrams",
    body: "Forces, fields, and circuits — short visual steps with a check at the end.",
  },
  {
    title: "Browser",
    badge: "Live page",
    body: "Open a real page and learn with highlights while the explanation runs.",
  },
  {
    title: "Video",
    badge: "Short film",
    body: "Type an idea. Get a visual explanation worth sharing.",
  },
];

export function MarketingEducationSection() {
  const { theme } = useTheme();
  const dark = theme === "dark";

  return (
    <section
      className={cn(
        "flex min-h-dvh items-center justify-center overflow-hidden px-5 py-8 sm:px-8 md:px-10 lg:px-12",
        dark ? "bg-[#111113] text-[#f4f4f5]" : "bg-[#f4f4f6] text-[#16161a]",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col justify-center">
        <div className="mx-auto max-w-3xl text-center lg:mx-0 lg:max-w-2xl lg:text-left">
          <h2 className="text-[clamp(1.75rem,3.6vw,2.75rem)] leading-[1.08] font-medium tracking-[-0.03em]">
            Learn by watching it drawn<span className={dark ? "text-[#a89bff]" : "text-[#5b4fd4]"}>.</span>
          </h2>
          <p
            className={cn(
              "mx-auto mt-3 max-w-xl text-[15px] leading-relaxed sm:text-[16px] lg:mx-0",
              dark ? "text-[#a1a1aa]" : "text-[#3f3f46]",
            )}
          >
            Not another wall of text. Physics, live pages, and short films —
            every explanation gets drawn so you can see the steps.
          </p>
        </div>

        <div className="mt-8 grid items-center gap-8 lg:mt-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.35fr)] lg:gap-12">
          <ul
            className={cn(
              "mx-auto w-full max-w-md rounded-lg border px-4 py-2 lg:mx-0 lg:max-w-none",
              dark
                ? "border-[#2a2a2e] bg-[#16161a]"
                : "border-[#ececee] bg-white",
            )}
          >
            {ITEMS.map((item, i) => (
              <li
                key={item.title}
                className={cn(
                  "py-3.5 sm:py-4",
                  i > 0 &&
                    (dark
                      ? "border-t border-[#2a2a2e]"
                      : "border-t border-[#ececee]"),
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[14px] font-medium sm:text-[15px]">
                    {item.title}
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:text-[12px]",
                      dark
                        ? "bg-white/8 text-[#a89bff]"
                        : "bg-[#f4f1ff] text-[#5b4fd4]",
                    )}
                  >
                    {item.badge}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-[13px] leading-6 sm:text-[14px]",
                    dark ? "text-[#a1a1aa]" : "text-[#71717a]",
                  )}
                >
                  {item.body}
                </p>
              </li>
            ))}
          </ul>

          <div className="relative w-full">
            <EducationVideo dark={dark} />
          </div>
        </div>
      </div>
    </section>
  );
}

function EducationVideo({ dark }: { dark: boolean }) {
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
    <div
      className={cn(
        "relative mx-auto aspect-video w-full overflow-hidden rounded-lg border",
        dark
          ? "border-[#2a2a2e] bg-[#111113]"
          : "border-[#ececee] bg-white",
      )}
    >
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
