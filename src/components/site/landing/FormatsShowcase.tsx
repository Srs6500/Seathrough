"use client";

import { useState } from "react";
import { Check, FileText, Presentation, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoVideo, SectionIntro } from "./shared";

const FORMATS = [
  {
    key: "whiteboard",
    label: "Whiteboard",
    Icon: Presentation,
    src: "/hero-bg.mp4",
    poster: "/hero-bg-poster.jpg",
    caption:
      "Writes the lesson by hand, a line at a time as it speaks, and pins up pictures from sources it credits.",
  },
  {
    key: "text",
    label: "Text + Diagram",
    Icon: FileText,
    src: "/text-diagram-demo.mp4",
    poster: "/text-diagram-demo-poster.jpg",
    caption:
      "A short written lesson with the key line highlighted and a diagram built beside it. Hover a line to see where it came from.",
  },
  {
    key: "video",
    label: "Video",
    Icon: Video,
    src: "/magnetic-pole-basics.mp4",
    poster: undefined,
    caption: "Turns the lesson into a short narrated film you can watch again or download.",
  },
] as const;

type FormatKey = (typeof FORMATS)[number]["key"];

/**
 * The tutor's "Teach with" picker, lifted straight from the app: choosing a
 * format crossfades to a recording of that format.
 */
export function FormatsShowcase() {
  const [active, setActive] = useState<FormatKey>("text");
  const current = FORMATS.find((f) => f.key === active)!;

  return (
    <section aria-labelledby="formats-heading" className="border-t border-[var(--lp-line)]">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 md:py-32">
        <SectionIntro id="formats-heading" title="Pick how it teaches">
          The same lesson, in the form that suits you. Mix them in the app, and
          it remembers your choice.
        </SectionIntro>

        <div className="mt-12 rounded-2xl border border-[var(--lp-line)] bg-[var(--lp-paper)] p-2 sm:p-3">
          <div className="relative aspect-[3456/1812] overflow-hidden rounded-xl bg-[#f4f4f6]">
            {FORMATS.map((format) => (
              <DemoVideo
                key={format.key}
                src={format.src}
                poster={format.poster}
                label={`${format.label} lesson demo`}
                active={format.key === active}
                className={cn(
                  "absolute inset-0 transition-opacity duration-500 ease-out",
                  format.key === active ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                videoClassName="object-cover object-top"
              />
            ))}
          </div>

          <div className="flex flex-col items-center gap-3 px-2 pt-4 pb-2 sm:pt-5">
            <div
              role="radiogroup"
              aria-label="Teach with"
              className="flex flex-wrap items-center justify-center gap-1.5"
            >
              <span className="mr-1 text-[12px] text-[var(--lp-muted)]" aria-hidden>
                Teach with
              </span>
              {FORMATS.map(({ key, label, Icon }) => {
                const on = key === active;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setActive(key)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/40",
                      on
                        ? "border-[var(--lp-ink)] bg-[var(--lp-ink)] text-[var(--lp-canvas)]"
                        : "border-[var(--lp-line)] bg-[var(--lp-paper)] text-[var(--lp-ink)] hover:border-[var(--lp-muted)]/40",
                    )}
                  >
                    {on ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                    {label}
                  </button>
                );
              })}
            </div>
            <p
              key={current.key}
              aria-live="polite"
              className="max-w-xl text-center text-[14px] leading-6 text-[var(--lp-soft)]"
            >
              {current.caption}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
