"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { DrawCommandQueue } from "@/lib/draw-engine/resolve";

const KonvaDrawStage = dynamic(
  () =>
    import("@/components/draw-engine/KonvaDrawStage").then(
      (m) => m.KonvaDrawStage,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-[#7a90a3]">
        Glass loading…
      </div>
    ),
  },
);

type BrowserGlassPanelProps = {
  queue: DrawCommandQueue;
  /** Bump only on intentional reset (new ask) — not on URL change. */
  sessionKey: number | string;
  playing?: boolean;
  emptyHint?: string;
  className?: string;
};

/**
 * Persistent glass diagram beside the live browser.
 * Mount once per lesson session; draw commands append across Ground→Truth
 * and multi-page navigations until an explicit reset.
 */
export function BrowserGlassPanel({
  queue,
  sessionKey,
  playing = true,
  emptyHint = "Diagram builds as the tutor walks the page.",
  className,
}: BrowserGlassPanelProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#c9d7e3]/bg-white/88 shadow-[0_12px_40px_rgba(15,35,55,0.10)] backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-[#e8eef3] px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a90a3]">
          Glass
        </p>
        <p className="text-[10px] text-[#9fb3c4]">stays across pages</p>
      </div>
      <div className="relative min-h-0 flex-1 bg-[#f8fafc]/p-1">
        <KonvaDrawStage
          queue={queue}
          sessionKey={sessionKey}
          playing={playing}
          showPen
          className="h-full min-h-[220px] w-full"
        />
        {emptyHint ? (
          <p className="pointer-events-none absolute bottom-3 left-3 right-3 text-center text-[11px] text-[#9fb3c4]/opacity-70">
            {emptyHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
