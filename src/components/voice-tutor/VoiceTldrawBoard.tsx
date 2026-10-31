"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { applyExperimentScene } from "@/components/experiment/applyScene";
import {
  sketchSpecFromRaw,
  sketchToExperimentShapes,
  type SketchSpec,
} from "@/lib/voice-tutor/sketchShapes";
import type { DrawScene } from "@/lib/voice-tutor/sessionTypes";
import { cn } from "@/lib/utils";

type VoiceTldrawBoardProps = {
  draw: DrawScene;
  className?: string;
};

/**
 * Real Smart Tutor tldraw board for Voice — same hideUi + applyScene DNA.
 * Fills its parent (a proper board pane), not a tiny SVG card.
 */
export function VoiceTldrawBoard({ draw, className }: VoiceTldrawBoardProps) {
  const editorRef = useRef<import("tldraw").Editor | null>(null);
  const drawnKey = useRef("");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string | null>("Loading whiteboard…");
  const [TldrawComp, setTldrawComp] = useState<
    typeof import("tldraw").Tldraw | null
  >(null);

  const sceneKey = useMemo(() => {
    return JSON.stringify({
      title: draw.title ?? "",
      spec: sketchSpecFromRaw(draw.spec),
    });
  }, [draw.title, draw.spec]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await import("tldraw/tldraw.css");
        const mod = await import("tldraw");
        if (alive) setTldrawComp(() => mod.Tldraw);
      } catch {
        if (alive) setStatus("Could not load the whiteboard.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor) return;
    if (sceneKey === drawnKey.current) return;

    let cancelled = false;
    void (async () => {
      const parsed = JSON.parse(sceneKey) as {
        title: string;
        spec: SketchSpec | null;
      };
      const shapes = parsed.spec
        ? sketchToExperimentShapes(parsed.title, parsed.spec)
        : [];
      if (shapes.length < 1) {
        setStatus("Nothing to draw yet.");
        return;
      }

      drawnKey.current = sceneKey;
      setStatus("Drawing on the board…");
      try {
        const existing = [...editor.getCurrentPageShapeIds()];
        if (existing.length) editor.deleteShapes(existing);
        await applyExperimentScene(editor, {
          title: parsed.title || "Concept sketch",
          shapes,
        });
        editor.zoomToFit({ animation: { duration: 0 } });
        editor.setCurrentTool("hand");
        editor.selectNone();
        if (!cancelled) setStatus(null);
      } catch (err) {
        console.warn("[voice-tldraw] draw failed", err);
        drawnKey.current = "";
        if (!cancelled) setStatus("Could not draw that sketch.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, sceneKey]);

  const Tldraw = TldrawComp;

  return (
    <section
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#ececee] bg-white",
        className,
      )}
      aria-label={draw.title || "Whiteboard"}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#ececee] px-3">
        <p className="text-[13px] font-medium text-[#16161a]">
          {draw.title || "Whiteboard"}
        </p>
        <p className="text-[11px] text-[#71717a]">Drag to pan</p>
      </div>
      <div className="relative min-h-[min(55vh,480px)] flex-1 lg:min-h-0">
        {Tldraw ? (
          <Tldraw
            hideUi
            onMount={(editor) => {
              editorRef.current = editor;
              editor.selectNone();
              editor.setCurrentTool("hand");
              setReady(true);
            }}
          />
        ) : null}
        {status ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <p className="flex items-center gap-2 text-[13px] text-muted">
              {status.endsWith("…") ? (
                <Loader2 className="size-4 animate-spin text-[#5b4fd4]" aria-hidden />
              ) : null}
              {status}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function isTldrawDraw(draw: DrawScene | null | undefined): boolean {
  return Boolean(
    draw && (draw.kind === "tldraw_sketch" || draw.kind === "concept_boxes"),
  );
}
