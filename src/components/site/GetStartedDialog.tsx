"use client";

import Image from "next/image";
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
    href: "/system-design",
    label: "System design",
    hint: "Architecture drawn on one board as you ask.",
    icon: "/systemd.png",
  },
  {
    href: "/bug-analyzer",
    label: "Debugger",
    hint: "Map frontend pages and inspect backend bugs.",
    icon: "/debugger.png",
  },
  {
    href: "/smart-tutor/voice-tutor",
    label: "Voice tutor",
    hint: "Talk through a structured Socratic lesson.",
    icon: "/teacher.png",
  },
  {
    href: "/smart-tutor/physics-tutor",
    label: "Physics",
    hint: "Field diagrams, short steps, then a check.",
    icon: "/electrical-circuit.png",
  },
  {
    href: "/browser",
    label: "Browser",
    hint: "Open a live page and learn with highlights.",
    icon: "/globe.png",
  },
  {
    href: "/video",
    label: "Video",
    hint: "Turn a topic into a short explainer film.",
    icon: "/video.png",
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
          "w-[calc(100%-1.5rem)] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl",
          dark
            ? "border-white/10 bg-[#0a0a0a] text-white"
            : "border-[#d5e0ea] bg-white text-[#1a2b3c]",
        )}
      >
        <DialogHeader
          className={cn(
            "space-y-2 border-b px-7 py-6 text-left sm:px-8 sm:py-7",
            dark ? "border-white/10" : "border-[#e6ebf0]",
          )}
        >
          <DialogTitle
            className={cn(
              "font-[family-name:var(--font-inter)] text-2xl font-semibold tracking-tight sm:text-[1.75rem]",
              dark ? "text-white" : "text-[#1a2b3c]",
            )}
          >
            What do you want to use?
          </DialogTitle>
          <DialogDescription
            className={cn(
              "text-base sm:text-[17px]",
              dark ? "text-white/55" : "text-[#6a7d90]",
            )}
          >
            Pick a starting point. You can switch anytime from the navbar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:gap-3.5 sm:p-6">
          {START_OPTIONS.map((option) => (
            <button
              key={option.href}
              type="button"
              onClick={() => pick(option.href)}
              className={cn(
                "flex items-start gap-4 rounded-2xl border px-4 py-4 text-left transition outline-none focus-visible:ring-2 sm:px-5 sm:py-5",
                dark
                  ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.08] focus-visible:ring-white/30"
                  : "border-[#e6ebf0] bg-[#f8fafc] hover:border-[#c8d6e4] hover:bg-[#f2f6fa] focus-visible:ring-[#1b6ca8]/30",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:size-14",
                  dark ? "bg-white/10" : "bg-white shadow-sm",
                )}
              >
                <Image
                  src={option.icon}
                  alt=""
                  width={36}
                  height={36}
                  className="size-8 object-contain sm:size-9"
                />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-base font-semibold sm:text-lg",
                    dark ? "text-white" : "text-[#1a2b3c]",
                  )}
                >
                  {option.label}
                </span>
                <span
                  className={cn(
                    "mt-1 block text-sm leading-snug sm:text-[15px] sm:leading-6",
                    dark ? "text-white/50" : "text-[#6a7d90]",
                  )}
                >
                  {option.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
