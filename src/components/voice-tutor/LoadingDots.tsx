"use client";

import { useEffect, useRef } from "react";
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

/**
 * Landing spot for the voice orb while a lesson loads: the dock orb flies
 * here (it looks for `[data-orb-target]`), loads in place, then flies home.
 */
export function LessonSkeleton({
  label,
  reveal = false,
  className,
}: {
  label: string;
  /** Scroll the spot into view (it sits under existing content). */
  reveal?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [reveal]);
  return (
    <div
      ref={ref}
      data-orb-target
      className={cn("h-64 w-full max-w-[40rem]", className)}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}
