"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyExperimentScene } from "@/components/experiment/applyScene";
import {
  boxesToExperimentShapes,
  sketchBoxesFromSpec,
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
    const boxes = sketchBoxesFromSpec(draw.spec);
    const fallback =
      boxes.length > 0
        ? boxes
        : draw.highlightIds.map((id) => ({ id, label: id }));
    return JSON.stringify({
      title: draw.title ?? "",
      boxes: fallback,
      highlightIds: draw.highlightIds,
    });
  }, [draw.title, draw.spec, draw.highlightIds]);

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
        boxes: Array<{ id: string; label: string }>;
        highlightIds: string[];
      };
      const shapes = boxesToExperimentShapes(parsed.boxes, {
        highlightIds: parsed.highlightIds,
      });
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
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-board-edge bg-white shadow-[0_12px_32px_rgba(26,43,60,0.08)]",
        className,
      )}
      aria-label={draw.title || "Whiteboard"}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-board-edge px-4 py-2.5">
        <p className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">
          {draw.title || "Whiteboard"}
        </p>
        <p className="text-[11px] text-muted">Drag to pan · Smart Tutor board</p>
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
            <p className="text-[13px] text-muted">{status}</p>
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
