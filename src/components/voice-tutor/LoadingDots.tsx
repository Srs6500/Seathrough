"use client";

import { cn } from "@/lib/utils";

/** Three bouncing dots — the tutor's "working on it" mark. */
export function LoadingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** Placeholder passage while the lesson plan is being written. */
export function LessonSkeleton({ label }: { label: string }) {
  return (
    <div className="w-full max-w-[40rem]" role="status" aria-live="polite">
      <p className="mb-5 flex items-center gap-2 text-[14px] font-medium text-[#5b4fd4]">
        <LoadingDots />
        {label}
      </p>
      <div className="space-y-3 motion-safe:animate-pulse">
        <div className="h-7 w-3/4 rounded-md bg-[#e4e4e7]" />
        <div className="h-4 w-full rounded bg-[#ececee]" />
        <div className="h-4 w-11/12 rounded bg-[#ececee]" />
        <div className="h-4 w-4/6 rounded bg-[#ececee]" />
        <div className="h-4 w-5/6 rounded bg-[#ececee]" />
      </div>
    </div>
  );
}
