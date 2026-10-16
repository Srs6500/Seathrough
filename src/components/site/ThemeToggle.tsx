"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  className?: string;
  variant?: "marketing" | "default";
};

export function ThemeToggle({
  className,
  variant = "marketing",
}: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const marketing = variant === "marketing";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg outline-none transition",
        marketing
          ? dark
            ? "border border-white/15 bg-white/5 text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
            : "border border-[#d5e0ea] bg-white text-[#1a2b3c] hover:bg-[#f4f7fb] focus-visible:ring-2 focus-visible:ring-[#1b6ca8]/40"
          : "border border-border bg-background text-foreground hover:bg-secondary",
        className,
      )}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
