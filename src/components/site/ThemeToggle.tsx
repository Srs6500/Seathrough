"use client";

import { Moon, Sun } from "lucide-react";
import { useOptionalTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  className?: string;
  variant?: "marketing" | "default";
};

export function ThemeToggle({
  className,
  variant = "marketing",
}: ThemeToggleProps) {
  const { theme, toggleTheme } = useOptionalTheme();
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
            ? "border border-[#2a2a2e] bg-[#16161a] text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
            : "border border-[#ececee] bg-white text-[#16161a] hover:bg-[#fafafa] focus-visible:ring-2 focus-visible:ring-[#5b4fd4]/40"
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
