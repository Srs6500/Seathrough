"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu } from "lucide-react";
import { listModesByGroup } from "@/modes/registry";
import { AccountMenu } from "@/components/lms/AccountMenu";
import { BrandMark } from "@/components/lms/BrandMark";
import { MODE_UI } from "@/components/lms/modeUi";
import { useStudioAccess } from "@/components/site/StudioAccess";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type SiteHeaderProps = {
  variant?: "default" | "marketing";
};

const NAV_LINK =
  "text-[15px] font-medium tracking-[-0.01em] text-[#1a2b3c] transition-colors hover:text-[#1b6ca8]";

function FeatureRow({
  href,
  title,
  hint,
  icon: Icon,
  onPick,
  badge,
}: {
  href: string;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  onPick: (href: string) => void;
  badge?: "new" | "beta" | "lab";
}) {
  return (
    <Link
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onPick(href);
      }}
      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 no-underline outline-none transition-colors hover:bg-[#f4f7fb] focus-visible:bg-[#f4f7fb]"
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#d4e8f6] text-[#0f4f7c]">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] font-medium tracking-[-0.01em] text-[#1a2b3c]">
          <span>{title}</span>
          {badge ? (
            <span className="rounded-full bg-[#d5efe4] px-1.5 py-0.5 text-[9px] font-bold tracking-[0.08em] text-[#2a7a5c] uppercase">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-5 text-[#6a7d90]">
          {hint}
        </span>
      </span>
    </Link>
  );
}

export function SiteHeader({ variant = "default" }: SiteHeaderProps) {
  const { openStudio, openAuth } = useStudioAccess();
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const studios = listModesByGroup("studio");
  const more = listModesByGroup("more");
  const labs = listModesByGroup("lab");
  const marketing = variant === "marketing";
  const pathname = usePathname();

  function pick(href: string) {
    setFeaturesOpen(false);
    openStudio(href);
  }

  const marketingLinks = [
    { label: "Overview", href: "/" },
    { label: "Features", href: "/bug-analyzer" },
    { label: "Analyzer", href: "/bug-analyzer" },
    { label: "Video", href: "/video" },
    { label: "Tutor", href: "/smart-tutor" },
    { label: "Systems", href: "/system-design" },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b",
        marketing
          ? "border-white/10 bg-black/80 backdrop-blur-md"
          : "border-border/80 bg-glass backdrop-blur-md",
      )}
    >
      <div
        className={cn(
          "relative mx-auto flex items-center",
          marketing
            ? "marketing-rise h-[4.25rem] max-w-6xl px-6 md:px-8"
            : "min-h-16 max-w-7xl gap-6 px-5 py-2.5 lg:px-10",
        )}
      >
        <BrandMark
          compact={!marketing}
          size={marketing ? "sm" : "lg"}
          onDark={marketing}
        />

        <nav
          className={cn(
            "hidden items-center md:flex",
            marketing
              ? "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 gap-6 lg:gap-7"
              : "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 gap-8",
          )}
          aria-label="Primary"
        >
          {marketing
            ? marketingLinks.map((link) => (
                <button
                  key={`${link.label}:${link.href}`}
                  type="button"
                  onClick={() => {
                    if (link.href === "/") {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                      return;
                    }
                    openStudio(link.href);
                  }}
                  className={cn(
                    "text-[13px] font-medium outline-none transition-colors hover:text-white focus-visible:text-white",
                    pathname === link.href ? "text-white" : "text-white/70",
                  )}
                >
                  {link.label}
                </button>
              ))
            : null}
          {!marketing ? (
          <Popover open={featuresOpen} onOpenChange={setFeaturesOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 outline-none transition-colors",
                  NAV_LINK,
                  featuresOpen && "text-[#1b6ca8]",
                )}
              >
                Try it out!
                <ChevronDown
                  className={cn(
                    "size-3.5 text-[#6a7d90] transition duration-200",
                    featuresOpen && "rotate-180",
                  )}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="center"
              sideOffset={14}
              collisionPadding={16}
              className="w-88 rounded-xl border border-[#d5e0ea] bg-white p-1.5 text-[#1a2b3c] shadow-[0_16px_40px_-16px_rgba(26,43,60,0.28)] ring-0"
            >
              <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-[#8a9aab] uppercase">
                Start learning
              </p>
              <div className="flex flex-col">
                {studios.map((mode) => (
                  <FeatureRow
                    key={mode.id}
                    href={mode.href}
                    title={mode.navLabel}
                    hint={MODE_UI[mode.id].hint}
                    icon={MODE_UI[mode.id].icon}
                    onPick={pick}
                    badge={mode.badge}
                  />
                ))}
              </div>

              {more.length > 0 ? (
                <>
                  <Separator className="my-1.5 bg-[#e6ebf0]" />
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-[0.06em] text-[#8a9aab] uppercase">
                    More
                  </p>
                  <div className="flex flex-col">
                    {more.map((mode) => (
                      <FeatureRow
                        key={mode.id}
                        href={mode.href}
                        title={mode.title}
                        hint={MODE_UI[mode.id].hint}
                        icon={MODE_UI[mode.id].icon}
                        onPick={pick}
                        badge={mode.badge}
                      />
                    ))}
                  </div>
                </>
              ) : null}

              {labs.length > 0 ? (
                <>
                  <Separator className="my-1.5 bg-[#e6ebf0]" />
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-[0.06em] text-[#8a9aab] uppercase">
                    Labs
                  </p>
                  <div className="flex flex-col">
                    {labs.map((mode) => (
                      <FeatureRow
                        key={mode.id}
                        href={mode.href}
                        title={mode.title}
                        hint={MODE_UI[mode.id].hint}
                        icon={MODE_UI[mode.id].icon}
                        onPick={pick}
                        badge={mode.badge}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </PopoverContent>
          </Popover>
          ) : null}
        </nav>

        <div
          className={cn(
            "flex items-center",
            marketing ? "ml-auto gap-3" : "ml-auto gap-2",
          )}
        >
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "md:hidden",
                  marketing
                    ? "text-white hover:bg-white/10"
                    : "text-[#1a2b3c] hover:bg-[#f2f4f7]",
                )}
                aria-label="Open menu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className={cn(
                "w-[min(100%,20rem)] p-0",
                marketing && "border-white/10 bg-[#0a0a0a] text-white",
              )}
            >
              <SheetHeader
                className={cn(
                  "border-b px-5 py-4",
                  marketing ? "border-white/10" : "border-[#e6ebf0]",
                )}
              >
                <SheetTitle
                  className={cn(
                    "text-[15px] font-medium",
                    marketing && "text-white",
                  )}
                >
                  Menu
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col p-2" aria-label="Mobile">
                {marketing ? (
                  <>
                    {marketingLinks.map((link) => (
                      <SheetClose asChild key={`m:${link.label}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (link.href === "/") return;
                            openStudio(link.href);
                          }}
                          className="rounded-lg px-3 py-2.5 text-left text-[14px] text-white/80 hover:bg-white/8 hover:text-white"
                        >
                          {link.label}
                        </button>
                      </SheetClose>
                    ))}
                    <SheetClose asChild>
                      <button
                        type="button"
                        onClick={() => openStudio("/bug-analyzer")}
                        className="mt-2 rounded-lg bg-white px-3 py-2.5 text-center text-[14px] font-bold text-black"
                      >
                        Get started
                      </button>
                    </SheetClose>
                  </>
                ) : (
                  <>
                    <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-[#8a9aab] uppercase">
                      Start learning
                    </p>
                    {studios.map((mode) => {
                      const Icon = MODE_UI[mode.id].icon;
                      return (
                        <SheetClose asChild key={mode.id}>
                          <button
                            type="button"
                            onClick={() => openStudio(mode.href)}
                            className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f2f4f7]"
                          >
                            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#eef4f9] text-[#1b6ca8]">
                              <Icon className="size-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 text-[14px] font-medium text-[#1a2b3c]">
                                <span>{mode.navLabel}</span>
                                {mode.badge ? (
                                  <span className="rounded-full bg-[#e4f5ee] px-1.5 py-0.5 text-[9px] font-bold tracking-[0.08em] text-[#2a7a5c] uppercase">
                                    {mode.badge}
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block text-[12px] font-normal text-[#6a7d90]">
                                {MODE_UI[mode.id].hint}
                              </span>
                            </span>
                          </button>
                        </SheetClose>
                      );
                    })}
                    {more.length > 0 ? (
                      <>
                        <Separator className="my-2 bg-[#e6ebf0]" />
                        <p className="px-3 pt-1 pb-1 text-[11px] font-medium tracking-[0.06em] text-[#8a9aab] uppercase">
                          More
                        </p>
                        {more.map((mode) => {
                          const Icon = MODE_UI[mode.id].icon;
                          return (
                            <SheetClose asChild key={mode.id}>
                              <button
                                type="button"
                                onClick={() => openStudio(mode.href)}
                                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f2f4f7]"
                              >
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#eef4f9] text-[#1b6ca8]">
                                  <Icon className="size-4" />
                                </span>
                                <span className="text-[14px] text-[#1a2b3c]">
                                  {mode.title}
                                </span>
                              </button>
                            </SheetClose>
                          );
                        })}
                      </>
                    ) : null}
                    {labs.length > 0 ? (
                      <>
                        <Separator className="my-2 bg-[#e6ebf0]" />
                        <p className="px-3 pt-1 pb-1 text-[11px] font-medium tracking-[0.06em] text-[#8a9aab] uppercase">
                          Labs
                        </p>
                        {labs.map((mode) => {
                          const Icon = MODE_UI[mode.id].icon;
                          return (
                            <SheetClose asChild key={mode.id}>
                              <button
                                type="button"
                                onClick={() => openStudio(mode.href)}
                                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f2f4f7]"
                              >
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#eef4f9] text-[#1b6ca8]">
                                  <Icon className="size-4" />
                                </span>
                                <span className="text-[14px] text-[#1a2b3c]">
                                  {mode.title}
                                </span>
                              </button>
                            </SheetClose>
                          );
                        })}
                      </>
                    ) : null}
                  </>
                )}
              </nav>
            </SheetContent>
          </Sheet>

          {marketing ? (
            <>
              <AccountMenu
                variant="marketing"
                onLogin={() => openAuth("login")}
                onSignup={() => openAuth("signup")}
              />
              <button
                type="button"
                onClick={() => openStudio("/bug-analyzer")}
                className="hidden h-9 items-center rounded-lg bg-white px-4 font-[family-name:var(--font-inter)] text-[13px] font-bold text-black outline-none transition hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/40 sm:inline-flex"
              >
                Get started
              </button>
            </>
          ) : (
            <AccountMenu
              variant="default"
              onLogin={() => openAuth("login")}
              onSignup={() => openAuth("signup")}
            />
          )}
        </div>
      </div>
    </header>
  );
}
