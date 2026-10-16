"use client";

import { useEffect } from "react";
import { MarketingHero } from "@/components/site/MarketingHero";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { StudioAccessProvider } from "@/components/site/StudioAccess";

export function MarketingHome() {
  useEffect(() => {
    document.documentElement.classList.add("marketing-page");
    return () => {
      document.documentElement.classList.remove("marketing-page");
    };
  }, []);

  return (
    <StudioAccessProvider>
      <div className="marketing-shell marketing-shell--dark flex min-h-dvh flex-col text-white">
        <div className="relative z-10 flex min-h-dvh flex-col">
          <SiteHeader variant="marketing" />
          <main className="flex flex-1 flex-col">
            <MarketingHero />
          </main>
          <SiteFooter variant="marketing" />
        </div>
      </div>
    </StudioAccessProvider>
  );
}
