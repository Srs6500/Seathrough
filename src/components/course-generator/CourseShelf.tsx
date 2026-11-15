"use client";

import {
  BookOpen,
  HelpCircle,
  Loader2,
  PenLine,
  Sparkles,
} from "lucide-react";
import type { CourseOutline, CourseUnitKind } from "@/lib/course-generator/types";
import { cn } from "@/lib/utils";

type Props = {
  course: CourseOutline;
  generatingId?: string | null;
  onOpenUnit: (unitId: string) => void;
  onNew: () => void;
};

const KIND_META: Record<
  CourseUnitKind,
  { label: string; icon: typeof BookOpen }
> = {
  whiteboard: { label: "Whiteboard lesson", icon: Sparkles },
  writing: { label: "Written notes", icon: PenLine },
  questions: { label: "Practice questions", icon: HelpCircle },
};

export function CourseShelf({
  course,
  generatingId,
  onOpenUnit,
  onNew,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-2xl px-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#1b6ca8] uppercase">
            Your course
          </p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-[#16161a]">
            {course.title}
          </h2>
          <p className="mt-1.5 text-[14px] leading-6 text-[#71717a]">
            {course.description}
          </p>
          {course.level ? (
            <p className="mt-2 text-[12px] font-medium text-[#52525b]">
              Level: {course.level}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onNew}
          className="shrink-0 rounded-lg border border-[#ececee] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3f3f46] hover:bg-[#fafafa]"
        >
          New course
        </button>
      </div>

      <p className="mt-5 text-[12px] text-[#71717a]">
        Open a unit to generate it. Later units use what you already covered.
      </p>

      <ol className="mt-3 space-y-2">
        {course.units.map((unit, i) => {
          const meta = KIND_META[unit.kind];
          const Icon = meta.icon;
          const busy = generatingId === unit.id || unit.status === "generating";
          const ready = unit.status === "ready";
          return (
            <li key={unit.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenUnit(unit.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border bg-white p-4 text-left shadow-sm transition",
                  ready
                    ? "border-[#dbeafe] hover:border-[#93c5fd]"
                    : "border-[#ececee] hover:border-[#d4d4d8]",
                  busy && "opacity-80",
                )}
              >
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-[#f4f4f6] text-[#1b6ca8]">
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] font-medium tracking-wide text-[#a1a1aa] uppercase">
                      {i + 1}. {meta.label}
                    </span>
                    {ready ? (
                      <span className="rounded-full bg-[#eef6fc] px-1.5 py-0.5 text-[10px] font-semibold text-[#1b6ca8]">
                        Ready
                      </span>
                    ) : busy ? (
                      <span className="rounded-full bg-[#f4f4f6] px-1.5 py-0.5 text-[10px] font-semibold text-[#71717a]">
                        Generating…
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#fafafa] px-1.5 py-0.5 text-[10px] font-semibold text-[#a1a1aa]">
                        Tap to generate
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[15px] font-semibold text-[#16161a]">
                    {unit.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-[#71717a]">
                    {unit.objective}
                  </span>
                  {unit.error ? (
                    <span className="mt-1 block text-[12px] text-[#c24545]">
                      {unit.error}
                    </span>
                  ) : null}
                </span>
                <BookOpen className="mt-1 size-4 shrink-0 text-[#d4d4d8]" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
