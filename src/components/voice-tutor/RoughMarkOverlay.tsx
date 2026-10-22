"use client";

import { useEffect, useRef } from "react";
import rough from "roughjs";
import type { BoardAnnotation } from "@/lib/voice-tutor/sessionTypes";

type LineBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type MarkBox = {
  id: string;
  boxes: LineBox[];
};

type TipLayout = {
  ann: BoardAnnotation;
  first: LineBox;
  tipLeft: number;
  tipTop: number;
  tipWidth: number;
};

type RoughMarkOverlayProps = {
  markBoxes: MarkBox[];
  annotations: BoardAnnotation[];
  tips: TipLayout[];
  pointer: "circle" | "arrow" | "both";
  active: boolean;
};

const STROKE = "#c45e1a";

/**
 * Hand-drawn circles / underlines / tip arrows via roughjs (plan §B).
 */
export function RoughMarkOverlay({
  markBoxes,
  annotations,
  tips,
  pointer,
  active,
}: RoughMarkOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !active) return;

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const rc = rough.svg(svg);
    const seedBase = markBoxes.reduce(
      (n, m) => n + m.id.length * 17 + m.boxes.length,
      41,
    );

    tips.forEach((tip, tipIndex) => {
      const style = tip.ann.style;
      const drawArrow =
        style === "underline" ||
        style === "both" ||
        pointer === "arrow" ||
        pointer === "both";
      if (!drawArrow) return;
      const fromX = tip.tipLeft + tip.tipWidth / 2;
      const fromY = tip.tipTop + 52;
      const toX = tip.first.left + tip.first.width / 2;
      const toY = tip.first.top - 2;
      svg.appendChild(
        rc.curve(
          [
            [fromX, fromY],
            [fromX - 10, fromY + 14],
            [toX + 8, toY - 16],
            [toX, toY],
          ],
          {
            stroke: STROKE,
            strokeWidth: 1.6,
            roughness: 1.2,
            bowing: 1,
            seed: seedBase + tipIndex * 3,
          },
        ),
      );
      svg.appendChild(
        rc.linearPath(
          [
            [toX - 7, toY - 8],
            [toX, toY],
            [toX + 7, toY - 8],
          ],
          {
            stroke: STROKE,
            strokeWidth: 1.6,
            roughness: 0.9,
            seed: seedBase + tipIndex * 3 + 1,
          },
        ),
      );
    });

    markBoxes.forEach((mark, mi) => {
      const resolved =
        annotations.find((a) => a.id === mark.id)?.style ?? "both";
      const drawCircle = resolved === "circle" || resolved === "both";
      const drawUnderline = resolved === "underline" || resolved === "both";

      mark.boxes.forEach((box, i) => {
        if (drawCircle) {
          const cx = box.left + box.width / 2;
          const cy = box.top + box.height / 2;
          svg.appendChild(
            rc.ellipse(cx, cy, box.width + 12, box.height + 8, {
              stroke: STROKE,
              strokeWidth: 1.85,
              roughness: 1.45,
              bowing: 1.15,
              seed: seedBase + mi * 11 + i,
            }),
          );
        }
        if (drawUnderline) {
          const y = box.top + box.height - 1;
          const x0 = box.left - 2;
          const x1 = box.left + box.width + 2;
          const mid = (x0 + x1) / 2;
          svg.appendChild(
            rc.curve(
              [
                [x0, y],
                [mid, y + 3.5],
                [x1, y],
              ],
              {
                stroke: STROKE,
                strokeWidth: 1.7,
                roughness: 1.2,
                seed: seedBase + mi * 11 + i + 5,
              },
            ),
          );
        }
      });
    });
  }, [markBoxes, annotations, tips, pointer, active]);

  if (!active) return null;

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible"
      aria-hidden
    />
  );
}
