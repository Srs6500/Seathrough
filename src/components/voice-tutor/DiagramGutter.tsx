"use client";

import { SceneCanvas } from "@/components/voice-tutor/SceneCanvas";
import type { DrawScene } from "@/lib/voice-tutor/sessionTypes";
import type { VisualScene } from "@/lib/voice-tutor/schemas";
import { cn } from "@/lib/utils";

export type GutterDiagram = {
  id: string;
  title: string;
  scene: DrawScene;
  /** Absolute top within the board shell (px). */
  top: number;
};

type DiagramGutterProps = {
  diagrams: GutterDiagram[];
  className?: string;
  /** When true, stack under text instead of absolute right lane. */
  stacked?: boolean;
};

function visualFromDraw(draw: DrawScene): VisualScene | null {
  if (draw.kind === "svg_graph" && draw.spec?.scene) {
    return draw.spec.scene as VisualScene;
  }
  return null;
}

function vfptUrl(draw: DrawScene): string | null {
  if (draw.kind !== "vfpt_svg") return null;
  const url = draw.spec?.url;
  return typeof url === "string" && url.startsWith("/") ? url : null;
}

function DiagramBody({ scene }: { scene: DrawScene }) {
  if (scene.kind === "vfpt_svg") {
    const url = vfptUrl(scene);
    if (!url) return null;
    const label =
      (typeof scene.spec?.label === "string" && scene.spec.label) ||
      scene.title ||
      "Physics diagram";
    return (
      <figure className="overflow-hidden rounded-xl border border-board-edge bg-white shadow-[0_8px_22px_rgba(26,43,60,0.08)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- local VFPt corpus */}
        <img
          src={url}
          alt={label}
          className="max-h-[220px] w-full object-contain bg-[#f7fafc] p-2"
        />
        <figcaption className="border-t border-board-edge/70 px-3 py-2 text-[11px] leading-4 text-muted">
          {label}
        </figcaption>
      </figure>
    );
  }

  // tldraw_sketch / concept_boxes render in VoiceTldrawBoard (real tldraw pane).
  if (scene.kind === "tldraw_sketch" || scene.kind === "concept_boxes") {
    return null;
  }

  if (scene.kind === "svg_graph") {
    const visual = visualFromDraw(scene);
    if (!visual) return null;
    return (
      <div className="overflow-hidden rounded-xl border border-board-edge bg-white shadow-[0_8px_22px_rgba(26,43,60,0.08)]">
        <SceneCanvas
          scene={visual}
          focusObjectIds={scene.highlightIds}
          className="min-h-[180px] w-full border-0"
        />
      </div>
    );
  }

  return null;
}

/**
 * Diagram lane — cards sit at packed tops so they never crush the text column.
 * On narrow viewports pass `stacked` to flow under the passage instead.
 */
export function DiagramGutter({
  diagrams,
  className,
  stacked = false,
}: DiagramGutterProps) {
  if (!diagrams.length) return null;

  if (stacked) {
    return (
      <aside
        className={cn("mt-8 flex w-full flex-col gap-4 xl:hidden", className)}
        aria-label="Lesson diagrams"
      >
        {diagrams.map((item) => (
          <div key={item.id} data-diagram-id={item.id}>
            <DiagramBody scene={item.scene} />
          </div>
        ))}
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "pointer-events-none absolute top-0 right-0 hidden h-full w-[min(17.5rem,28%)] xl:block",
        className,
      )}
      aria-label="Lesson diagrams"
    >
      {diagrams.map((item) => (
        <div
          key={item.id}
          className="placed-diagram pointer-events-auto absolute right-0 left-0"
          style={{ top: item.top }}
          data-diagram-id={item.id}
        >
          <DiagramBody scene={item.scene} />
        </div>
      ))}
    </aside>
  );
}

/** Estimated card height for packing (before measure). */
export function estimateGutterCardHeight(scene: DrawScene): number {
  if (scene.kind === "vfpt_svg") return 248;
  if (scene.kind === "tldraw_sketch" || scene.kind === "concept_boxes") return 220;
  if (scene.kind === "svg_graph") return 240;
  return 180;
}
