"use client";

import Link from "next/link";
import { BrandMark } from "@/components/lms/BrandMark";
import { useOptionalTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

type SiteFooterProps = {
  variant?: "default" | "marketing";
};

function SocialIcon({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="transition hover:opacity-80"
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
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
            <Link href="/smart-tutor" className="hover:text-ink">
              Smart tutor
            </Link>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer
      className={cn(
        "border-t",
        dark
          ? "border-white/10 bg-black"
          : "border-[#d5e0ea] bg-[#f8fafc]",
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 md:flex-row md:items-end md:justify-between md:px-8 md:py-12">
        <div className="max-w-sm">
          <BrandMark onDark={dark} size="sm" />
          <p
            className={cn(
              "mt-3 text-[14px] leading-6",
              dark ? "text-white/45" : "text-[#6a7d90]",
            )}
          >
            Infer intent from code. See the gaps. Learn by watching.
          </p>
        </div>
        <div
          className={cn(
            "flex flex-wrap gap-x-6 gap-y-2 text-[13px]",
            dark ? "text-white/45" : "text-[#6a7d90]",
          )}
        >
          <Link
            href="/bug-analyzer"
            className={dark ? "hover:text-white" : "hover:text-[#1a2b3c]"}
          >
            Debugger
          </Link>
          <Link
            href="/smart-tutor"
            className={dark ? "hover:text-white" : "hover:text-[#1a2b3c]"}
          >
            Tutor
          </Link>
          <Link
            href="/smart-tutor/physics-tutor"
            className={dark ? "hover:text-white" : "hover:text-[#1a2b3c]"}
          >
            Physics
          </Link>
          <Link
            href="/browser"
            className={dark ? "hover:text-white" : "hover:text-[#1a2b3c]"}
          >
            Browser
          </Link>
          <Link
            href="/video"
            className={dark ? "hover:text-white" : "hover:text-[#1a2b3c]"}
          >
            Video
          </Link>
          <Link
            href="/system-design"
            className={dark ? "hover:text-white" : "hover:text-[#1a2b3c]"}
          >
            Systems
          </Link>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <div
            className={cn(
              "flex items-center gap-3.5",
              dark ? "text-white/70" : "text-[#3d5166]",
            )}
          >
            <SocialIcon label="YouTube" href="https://www.youtube.com/@SeeThrough-g8k">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-5"
                aria-hidden
              >
                <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
              </svg>
            </SocialIcon>
            <SocialIcon
              label="Instagram"
              href="https://www.instagram.com/seethrough_io/?hl=en"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-5"
                aria-hidden
              >
                <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm11 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
              </svg>
            </SocialIcon>
            <SocialIcon label="TikTok" href="https://www.tiktok.com/@seethrough737">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-5"
                aria-hidden
              >
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.76 2.89 2.89 0 0 1-2.88-2.76 2.89 2.89 0 0 1 2.88-2.76c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.9a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.73a8.19 8.19 0 0 0 4.76 1.52V6.84a4.84 4.84 0 0 1-1-.15z" />
              </svg>
            </SocialIcon>
          </div>
          <p
            className={cn(
              "text-[13px]",
              dark ? "text-white/35" : "text-[#8a9aab]",
            )}
          >
            © {new Date().getFullYear()} SeeThrough
          </p>
        </div>
      </div>
    </footer>
  );
}
