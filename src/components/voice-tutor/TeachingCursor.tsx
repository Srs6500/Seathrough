"use client";

import { cn } from "@/lib/utils";

type TeachingCursorProps = {
  x: number;
  y: number;
  visible: boolean;
  clicking?: boolean;
  className?: string;
};

/**
 * Classic arrow pointer that rides the lesson board — reads as a tutor
 * pointing at the current phrase, not a decorative overlay.
 */
export function TeachingCursor({
  x,
  y,
  visible,
  clicking = false,
  className,
}: TeachingCursorProps) {
  return (
    <div
      className={cn("vt-teach-cursor", className)}
      data-hidden={visible ? "false" : "true"}
      data-clicking={clicking ? "true" : "false"}
      style={{ left: x, top: y }}
      aria-hidden
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path
          d="M4.2 2.8 4.2 21.6 8.8 17.1 12.4 25.2 15.6 23.8 11.9 15.6 18.6 15.6Z"
          fill="#ffffff"
          stroke="#16161a"
          strokeWidth="1.45"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
