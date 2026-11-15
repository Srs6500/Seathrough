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
    href: "/smart-tutor",
    label: "Smart tutor",
    hint: "Talk through a topic. Diagrams and physics figures appear when they help.",
    icon: "/teacher.png",
  },
  {
    href: "/system-design",
    label: "System design",
    hint: "Architecture drawn on one board as you ask.",
    icon: "/systemd.png",
  },
  {
    href: "/vibe-coder",
    label: "Vibe coder",
    hint: "Understand what you built, starting with the database.",
    icon: "/debugger.png",
  },
  {
    href: "/browser",
    label: "Browser",
    hint: "Open a live page and learn with highlights.",
    icon: "/globe.png",
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
            ? "border-[#2a2a2e] bg-[#16161a] text-[#f4f4f5]"
            : "border-[#ececee] bg-white text-[#16161a]",
        )}
      >
        <DialogHeader
          className={cn(
            "space-y-2 border-b px-7 py-6 text-left sm:px-8 sm:py-7",
            dark ? "border-[#2a2a2e]" : "border-[#ececee]",
          )}
        >
          <DialogTitle
            className={cn(
              "text-xl font-medium tracking-tight sm:text-[1.5rem]",
              dark ? "text-white" : "text-[#16161a]",
            )}
          >
            What do you want to use?
          </DialogTitle>
          <DialogDescription
            className={cn(
              "text-base sm:text-[17px]",
              dark ? "text-white/55" : "text-[#71717a]",
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
                "flex items-start gap-4 rounded-lg border px-4 py-4 text-left transition outline-none focus-visible:ring-2 sm:px-5 sm:py-5",
                dark
                  ? "border-[#2a2a2e] bg-[#111113] hover:bg-white/[0.06] focus-visible:ring-white/30"
                  : "border-[#ececee] bg-[#fafafa] hover:border-[#ececee] hover:bg-[#f4f1ff] focus-visible:ring-[#5b4fd4]/30",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:size-14",
                  dark ? "bg-white/10" : "bg-white",
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
                    "block text-[14px] font-medium sm:text-[15px]",
                    dark ? "text-white" : "text-[#16161a]",
                  )}
                >
                  {option.label}
                </span>
                <span
                  className={cn(
                    "mt-1 block text-sm leading-snug sm:text-[15px] sm:leading-6",
                    dark ? "text-white/50" : "text-[#71717a]",
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
