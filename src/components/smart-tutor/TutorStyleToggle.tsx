"use client";

import type { TutorStyle } from "@/lib/smart-tutor/tutorStyle";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ id: TutorStyle; label: string; hint: string }> = [
  {
    id: "text",
    label: "Text",
    hint: "Talk-through lesson, voice tutor style",
  },
  {
    id: "diagram",
    label: "Diagram",
    hint: "Drawn on the board, Smart tutor style",
  },
  {
    id: "physics",
    label: "Physics",
    hint: "Field diagrams, short steps, then a check",
  },
];

export function TutorStyleToggle({
  value,
  onChange,
}: {
  value: TutorStyle;
  onChange: (style: TutorStyle) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Teaching style"
      className="inline-flex h-9 overflow-hidden rounded-lg border border-[#ececee] bg-white"
    >
      {OPTIONS.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={cn(
              "px-3 text-[13px] font-medium outline-none transition-colors",
              selected
                ? "bg-[#16161a] text-white"
                : "text-[#16161a] hover:bg-[#fafafa]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
