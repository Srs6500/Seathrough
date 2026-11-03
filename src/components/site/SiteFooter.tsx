"use client";

import Link from "next/link";
import { ArrowUpRight, Mic, Network } from "lucide-react";
import { BrandMark } from "@/components/lms/BrandMark";
import { useOptionalTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

type SiteFooterProps = {
  variant?: "default" | "marketing";
};

/** The two features the footer points to. */
const FEATURES = [
  {
    label: "AI tutor",
    href: "/smart-tutor",
    blurb: "Talk through any topic — it teaches on a live whiteboard and builds on every follow-up.",
    Icon: Mic,
  },
  {
    label: "System design",
    href: "/system-design",
    blurb: "Watch an architecture get drawn step by step, with the reasoning behind each box.",
    Icon: Network,
  },
] as const;

function SocialIcon({
  label,
  href,
  className,
  children,
}: {
  label: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border transition",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** Quiet footer for product; multi-column marketing footer on the landing page. */
export function SiteFooter({ variant = "default" }: SiteFooterProps) {
  const marketing = variant === "marketing";
  const { theme } = useOptionalTheme();
  const dark = marketing && theme === "dark";

  if (!marketing) {
    return (
      <footer className="border-t border-board-edge bg-chalk/80">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 md:flex-row md:items-end md:justify-between md:px-6">
          <div>
            <BrandMark />
            <p className="mt-3 max-w-sm text-sm leading-6 text-ink-soft">
              SeeThrough draws the explanation so you can see the steps.
            </p>
          </div>
          <nav aria-label="Features" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
            {FEATURES.map((f) => (
              <Link key={f.href} href={f.href} className="hover:text-ink">
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    );
  }

  const socialClass = dark
    ? "border-[#2a2a2e] bg-[#16161a] text-white/70 hover:bg-white/10 hover:text-white"
    : "border-[#ececee] bg-white text-[#71717a] hover:bg-[#fafafa] hover:text-[#16161a]";
  const muted = dark ? "text-white/45" : "text-[#71717a]";

  return (
    <footer
      className={cn(
        "border-t",
        dark ? "border-[#2a2a2e] bg-[#111113]" : "border-[#ececee] bg-[#f4f4f6]",
      )}
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:px-8 md:py-16 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)] lg:gap-14">
          {/* brand */}
          <div className="max-w-sm">
            <BrandMark
              onDark={dark}
              size="md"
              className={cn(!dark && "[&>span]:text-[#16161a]")}
            />
            <p
              className={cn(
                "mt-4 text-[14px] leading-7",
                dark ? "text-white/60" : "text-[#3f3f46]",
              )}
            >
              Visualize everything. Ask a question and watch every step get
              drawn.
            </p>
            <div className="mt-6 flex items-center gap-2.5">
              <SocialIcon
                label="YouTube"
                href="https://www.youtube.com/@SeeThrough-g8k"
                className={socialClass}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
                  <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
                </svg>
              </SocialIcon>
              <SocialIcon
                label="Instagram"
                href="https://www.instagram.com/seethrough_io/?hl=en"
                className={socialClass}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
                  <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm11 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                </svg>
              </SocialIcon>
              <SocialIcon
                label="TikTok"
                href="https://www.tiktok.com/@seethrough737"
                className={socialClass}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.76 2.89 2.89 0 0 1-2.88-2.76 2.89 2.89 0 0 1 2.88-2.76c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.9a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.73a8.19 8.19 0 0 0 4.76 1.52V6.84a4.84 4.84 0 0 1-1-.15z" />
                </svg>
              </SocialIcon>
            </div>
          </div>

          {/* the two features */}
          <nav aria-label="Features" className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ label, href, blurb, Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "group relative flex flex-col rounded-2xl border p-5 transition duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#1b6ca8]/40 focus-visible:outline-none motion-reduce:hover:translate-y-0",
                  dark
                    ? "border-[#2a2a2e] bg-[#16161a] hover:border-[#3a3a40]"
                    : "border-[#ececee] bg-white shadow-[0_1px_2px_rgba(22,22,26,0.04)] hover:shadow-[0_12px_32px_rgba(22,22,26,0.08)]",
                )}
              >
                <div className="flex items-start justify-between">
                  <span className="grid size-10 place-items-center rounded-xl bg-[radial-gradient(circle_at_35%_30%,#9fd0ff_0%,#1b6ca8_60%,#0d3f6b_100%)] text-white shadow-[0_4px_12px_rgba(27,108,168,0.28)]">
                    <Icon className="size-[18px]" />
                  </span>
                  <ArrowUpRight
                    className={cn(
                      "size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
                      dark ? "text-white/40 group-hover:text-white" : "text-[#a1a1aa] group-hover:text-[#16161a]",
                    )}
                  />
                </div>
                <p
                  className={cn(
                    "mt-5 text-[16px] font-semibold tracking-[-0.01em]",
                    dark ? "text-white" : "text-[#16161a]",
                  )}
                >
                  {label}
                </p>
                <p className={cn("mt-1.5 text-[13px] leading-6", muted)}>{blurb}</p>
              </Link>
            ))}
          </nav>
        </div>

        <div
          className={cn(
            "mt-12 flex flex-col gap-2 border-t pt-6 text-[13px] sm:flex-row sm:items-center sm:justify-between",
            dark ? "border-[#2a2a2e]" : "border-[#e4e4e7]",
            muted,
          )}
        >
          <p>© {new Date().getFullYear()} SeeThrough</p>
          <p>Draws the explanation so you can see the steps.</p>
        </div>
      </div>
    </footer>
  );
}
