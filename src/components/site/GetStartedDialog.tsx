"use client";

import {
  Bug,
  Film,
  FlaskConical,
  Globe2,
  GraduationCap,
  Network,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOptionalTheme } from "@/components/site/ThemeProvider";
import { cn } from "@/lib/utils";

const START_OPTIONS = [
  {
    href: "/bug-analyzer",
    label: "Debugger",
    hint: "Scan a repo for intent gaps and issues",
    icon: Bug,
  },
  {
    href: "/smart-tutor",
    label: "Tutor",
    hint: "Learn with a live board that draws each step",
    icon: GraduationCap,
  },
  {
    href: "/smart-tutor/physics-tutor",
    label: "Physics",
    hint: "High-school physics with field diagrams",
    icon: FlaskConical,
  },
  {
    href: "/browser",
    label: "Browser",
    hint: "Open real pages and explain by highlighting",
    icon: Globe2,
  },
  {
    href: "/video",
    label: "Video",
    hint: "Turn a topic into a short explainer film",
    icon: Film,
  },
  {
    href: "/system-design",
    label: "Systems",
    hint: "Map architecture as you ask questions",
    icon: Network,
  },
] as const;

type GetStartedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (href: string) => void;
};

export function GetStartedDialog({
  open,
  onOpenChange,
  onPick,
}: GetStartedDialogProps) {
  const { theme } = useOptionalTheme();
  const dark = theme === "dark";

  function pick(href: string) {
    onOpenChange(false);
    onPick(href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-lg gap-0 overflow-hidden p-0 sm:max-w-xl",
          dark
            ? "border-white/10 bg-[#0a0a0a] text-white"
            : "border-[#d5e0ea] bg-white text-[#1a2b3c]",
        )}
      >
        <DialogHeader
          className={cn(
            "space-y-1 border-b px-6 py-5 text-left",
            dark ? "border-white/10" : "border-[#e6ebf0]",
          )}
        >
          <DialogTitle
            className={cn(
              "font-[family-name:var(--font-inter)] text-xl font-semibold tracking-tight",
              dark ? "text-white" : "text-[#1a2b3c]",
            )}
          >
            What do you want to use?
          </DialogTitle>
          <DialogDescription
            className={cn(
              "text-[14px]",
              dark ? "text-white/55" : "text-[#6a7d90]",
            )}
          >
            Pick a starting point. You can switch anytime from the navbar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 p-4 sm:grid-cols-2">
          {START_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.href}
                type="button"
                onClick={() => pick(option.href)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-3.5 py-3.5 text-left transition outline-none focus-visible:ring-2",
                  dark
                    ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.08] focus-visible:ring-white/30"
                    : "border-[#e6ebf0] bg-[#f8fafc] hover:border-[#c8d6e4] hover:bg-[#f2f6fa] focus-visible:ring-[#1b6ca8]/30",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                    dark
                      ? "bg-white/10 text-white"
                      : "bg-white text-[#1b6ca8] shadow-sm",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[14px] font-semibold",
                      dark ? "text-white" : "text-[#1a2b3c]",
                    )}
                  >
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[12px] leading-snug",
                      dark ? "text-white/50" : "text-[#6a7d90]",
                    )}
                  >
                    {option.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
