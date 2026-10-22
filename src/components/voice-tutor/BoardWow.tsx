"use client";

import { useEffect, useId, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { SceneCanvas } from "@/components/voice-tutor/SceneCanvas";
import type { DrawScene } from "@/lib/voice-tutor/sessionTypes";
import type { VisualScene } from "@/lib/voice-tutor/schemas";
import { cn } from "@/lib/utils";

type BoardWowProps = {
  draw: DrawScene | null;
  className?: string;
};

function asVisualScene(draw: DrawScene): VisualScene | null {
  const scene = draw.spec?.scene;
  if (!scene || typeof scene !== "object") return null;
  return scene as VisualScene;
}

export function BoardWow({ draw, className }: BoardWowProps) {
  const rootId = useId().replace(/:/g, "");
  const highlighted = useRef<string | null>(null);

  useEffect(() => {
    if (!draw || draw.kind === "none") return;
    const targetId = draw.highlightIds[0];
    if (!targetId) return;
    const el = document.querySelector(
      `[data-vt-object="${CSS.escape(targetId)}"]`,
    );
    if (!el || highlighted.current === targetId) return;
    highlighted.current = targetId;
    const tour = driver({
      animate: true,
      duration: 280,
      overlayOpacity: 0.18,
      stagePadding: 6,
      showButtons: [],
      popoverClass: "vt-driver-popover",
    });
    tour.highlight({
      element: el as HTMLElement,
      popover: {
        title: draw.title || "Notice this",
        description: "Follow along with what I'm saying.",
        side: "bottom",
        align: "center",
      },
    });
    const timer = window.setTimeout(() => tour.destroy(), 3200);
    return () => {
      window.clearTimeout(timer);
      tour.destroy();
    };
  }, [draw]);

  if (!draw || draw.kind === "none") return null;
  const scene = asVisualScene(draw);

  return (
    <div
      id={`vt-board-${rootId}`}
      className={cn(
        "pointer-events-none absolute inset-x-6 top-16 z-10 mx-auto max-w-xl animate-fade-up md:inset-x-auto md:right-8 md:left-auto md:w-[min(22rem,34vw)]",
        className,
      )}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-board-edge bg-white/95 shadow-[0_16px_40px_rgba(26,43,60,0.12)] backdrop-blur-sm">
        {scene ? (
          <SceneCanvas
            scene={scene}
            focusObjectIds={draw.highlightIds}
            traceTargetId={draw.highlightIds[0] ?? null}
          />
        ) : (
          <div className="space-y-2 p-4">
            <p className="text-[12px] font-medium text-muted">
              {draw.title || "Concept"}
            </p>
            <div className="flex flex-wrap gap-2">
              {(draw.highlightIds.length
                ? draw.highlightIds
                : ["idea", "link", "check"]
              ).map((id) => (
                <span
                  key={id}
                  data-vt-object={id}
                  className="rounded-full bg-accent-soft px-3 py-1.5 text-[12px] font-medium text-accent-deep"
                >
                  {id}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
