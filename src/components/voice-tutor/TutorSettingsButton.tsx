"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TutorSettings } from "@/lib/voice-tutor/settings";
import { cn } from "@/lib/utils";

type Props = {
  value: TutorSettings;
  onChange: (next: TutorSettings) => void;
  className?: string;
};

/** Gear button that opens the tutor settings card. */
export function TutorSettingsButton({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Tutor settings"
          title="Settings"
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg bg-[#f4f4f6] text-[#16161a] transition hover:bg-[#ececee] data-[state=open]:bg-[#16161a] data-[state=open]:text-white",
            className,
          )}
        >
          <Settings className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-[min(20rem,calc(100vw-2rem))] border border-[#ececee] bg-white p-4 text-[#16161a] shadow-[0_12px_32px_rgba(22,22,26,0.12)] ring-0"
      >
        <p className="text-[14px] font-semibold tracking-[-0.01em]">Tutor settings</p>
        <p className="mt-0.5 text-[12px] text-[#71717a]">Saved on this device.</p>

        <label htmlFor="tutor-name" className="mt-4 block text-[12px] font-medium text-[#3f3f46]">
          Your name
        </label>
        <input
          id="tutor-name"
          value={value.name}
          maxLength={40}
          autoComplete="given-name"
          placeholder="So the tutor can greet you"
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") setOpen(false);
          }}
          className="mt-1.5 h-9 w-full rounded-lg border border-[#e4e4e7] bg-white px-3 text-[13px] outline-none placeholder:text-[#a1a1aa] focus:border-[#1b6ca8] focus:ring-2 focus:ring-[#1b6ca8]/15"
        />

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[#ececee] p-3 transition hover:bg-[#fafafa]">
          <input
            type="checkbox"
            checked={value.askQuestions}
            onChange={(e) => onChange({ ...value, askQuestions: e.target.checked })}
            className="mt-0.5 size-4 shrink-0 accent-[#1b6ca8]"
          />
          <span>
            <span className="block text-[13px] font-medium">Ask questions after explaining</span>
            <span className="mt-0.5 block text-[12px] leading-4 text-[#71717a]">
              The tutor checks your understanding with a quick question. Turn off to just listen.
            </span>
          </span>
        </label>
      </PopoverContent>
    </Popover>
  );
}
