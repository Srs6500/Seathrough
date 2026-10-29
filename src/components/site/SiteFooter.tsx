"use client";

import Link from "next/link";
import { BrandMark } from "@/components/lms/BrandMark";
import { useOptionalTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

type SiteFooterProps = {
  variant?: "default" | "marketing";
};

const CODE_LINKS = [
  { label: "System design", href: "/system-design" },
  { label: "Debugger", href: "/bug-analyzer" },
  { label: "Repo-Scan", href: "/repo-scan" },
  { label: "Vibe coder", href: "/vibe-coder" },
] as const;

const EDUCATION_LINKS = [
  { label: "Voice", href: "/smart-tutor/voice-tutor" },
  { label: "Physics", href: "/smart-tutor/physics-tutor" },
  { label: "Browser", href: "/browser" },
  { label: "Video", href: "/video" },
  { label: "Course creator", href: "/course-creator" },
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
        "inline-flex size-10 items-center justify-center rounded-xl border transition",
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
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
            <Link href="/smart-tutor" className="hover:text-ink">
              Smart tutor
            </Link>
          </div>
        </div>
      </footer>
    );
  }

  const linkClass = cn(
    "text-[15px] transition-colors",
    dark
      ? "text-white/55 hover:text-white"
      : "text-[#475569] hover:text-[#1a2b3c]",
  );
  const socialClass = dark
    ? "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
    : "border-[#d5e0ea] bg-white text-[#3d5166] hover:bg-[#f4f7fb] hover:text-[#1a2b3c]";

  return (
    <footer
      className={cn(
        "border-t",
        dark ? "border-white/10 bg-black" : "border-[#e5eaf0] bg-[#f4f6f8]",
      )}
    >
      <div className="mx-auto max-w-6xl px-6 py-14 md:px-8 md:py-16 lg:px-12">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.8fr))] md:gap-10">
          <div className="max-w-sm">
            <BrandMark onDark={dark} size="md" />
            <p
              className={cn(
                "mt-4 font-[family-name:var(--font-inter)] text-[16px] leading-7",
                dark ? "text-white/55" : "text-[#3d5166]",
              )}
            >
              Visual AI for learning systems and code. Ask a question and watch
              every step get drawn.
            </p>
            <div className="mt-6 flex items-center gap-2.5">
              <SocialIcon
                label="YouTube"
                href="https://www.youtube.com/@SeeThrough-g8k"
                className={socialClass}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-4"
                  aria-hidden
                >
                  <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
                </svg>
              </SocialIcon>
              <SocialIcon
                label="Instagram"
                href="https://www.instagram.com/seethrough_io/?hl=en"
                className={socialClass}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-4"
                  aria-hidden
                >
                  <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm11 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                </svg>
              </SocialIcon>
              <SocialIcon
                label="TikTok"
                href="https://www.tiktok.com/@seethrough737"
                className={socialClass}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-4"
                  aria-hidden
                >
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.76 2.89 2.89 0 0 1-2.88-2.76 2.89 2.89 0 0 1 2.88-2.76c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.9a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.73a8.19 8.19 0 0 0 4.76 1.52V6.84a4.84 4.84 0 0 1-1-.15z" />
                </svg>
              </SocialIcon>
            </div>
          </div>

          <div>
            <p
              className={cn(
                "text-[12px] font-semibold tracking-[0.08em] uppercase",
                dark ? "text-white/35" : "text-[#94a3b8]",
              )}
            >
              Code
            </p>
            <ul className="mt-4 space-y-3">
              {CODE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p
              className={cn(
                "text-[12px] font-semibold tracking-[0.08em] uppercase",
                dark ? "text-white/35" : "text-[#94a3b8]",
              )}
            >
              Education
            </p>
            <ul className="mt-4 space-y-3">
              {EDUCATION_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p
              className={cn(
                "text-[12px] font-semibold tracking-[0.08em] uppercase",
                dark ? "text-white/35" : "text-[#94a3b8]",
              )}
            >
              Product
            </p>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/" className={linkClass}>
                  Home
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className={linkClass}>
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div
          className={cn(
            "mt-12 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between",
            dark ? "border-white/10" : "border-[#e5eaf0]",
          )}
        >
          <p
            className={cn(
              "text-[13px]",
              dark ? "text-white/35" : "text-[#94a3b8]",
            )}
          >
            © {new Date().getFullYear()} SeeThrough
          </p>
          <p
            className={cn(
              "text-[13px]",
              dark ? "text-white/35" : "text-[#94a3b8]",
            )}
          >
            Draws the explanation so you can see the steps.
          </p>
        </div>
      </div>
    </footer>
  );
}
