"use client";

import { useEffect } from "react";
import { MarketingHero } from "@/components/site/MarketingHero";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { StudioAccessProvider } from "@/components/site/StudioAccess";
import { ThemeProvider, useTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

function MarketingShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  return (
    <div
      className={cn(
        "marketing-shell flex min-h-dvh flex-col",
        dark
          ? "marketing-shell--dark text-white"
          : "marketing-shell--light text-[#1a2b3c]",
      )}
    >
      {children}
    </div>
  );
}

export function MarketingHome() {
  useEffect(() => {
    document.documentElement.classList.add("marketing-page");
    return () => {
      document.documentElement.classList.remove(
        "marketing-page",
        "marketing-theme-light",
        "marketing-theme-dark",
      );
      delete document.documentElement.dataset.theme;
    };
  }, []);

  return (
    <ThemeProvider>
      <StudioAccessProvider>
        <MarketingShell>
          <div className="relative z-10 flex min-h-dvh flex-col">
            <SiteHeader variant="marketing" />
            <main className="flex flex-1 flex-col">
              <MarketingHero />
            </main>
            <SiteFooter variant="marketing" />
          </div>
        </MarketingShell>
      </StudioAccessProvider>
    </ThemeProvider>
  );
}
