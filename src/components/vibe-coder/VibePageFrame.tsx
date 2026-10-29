"use client";

import { useEffect } from "react";

/** Keep the site-wide sky wash off this page. */
export function VibePageFrame({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("vibe-coder-page");
    return () => {
      document.documentElement.classList.remove("vibe-coder-page");
    };
  }, []);

  return children;
}
