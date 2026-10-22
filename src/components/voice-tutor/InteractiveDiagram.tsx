"use client";

/**
 * View-only diagram host for Voice gutters.
 * Learner tracing / reconstruct (Phase 4) stays parked — do not re-wire
 * scenePaths / traceScore into the live lesson loop yet.
 */

import { SceneCanvas } from "@/components/voice-tutor/SceneCanvas";
import type { VisualScene } from "@/lib/voice-tutor/schemas";
import { cn } from "@/lib/utils";

export type DiagramMode = "view" | "trace" | "reconstruct";

export type TraceCompletePayload = {
  passed: boolean;
  feedback: string;
  coverage: number;
  mode: DiagramMode;
};

type InteractiveDiagramProps = {
  scene: VisualScene;
  focusObjectIds?: string[];
  /** Tracing modes are accepted for API stability but render as view. */
  mode?: DiagramMode;
  targetId?: string | null;
  prompt?: string | null;
  socraticAsk?: string | null;
  onTraceComplete?: (result: TraceCompletePayload) => void;
  className?: string;
};

export function InteractiveDiagram({
  scene,
  focusObjectIds = [],
  className,
}: InteractiveDiagramProps) {
  return (
    <div className={cn("overflow-hidden rounded-xl", className)}>
      <SceneCanvas
        scene={scene}
        focusObjectIds={focusObjectIds}
        className="min-h-[180px] w-full border-0"
      />
    </div>
  );
}
