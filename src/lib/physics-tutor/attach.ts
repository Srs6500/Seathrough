import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExperimentLesson, ExperimentShape } from "@/lib/experiment/scene";
import type { PhysicsTutorContext } from "@/lib/physics-tutor/types";

export type PhysicsRagMeta = {
  corpus: { seed: number; ingested: number; total: number };
  chunks: Array<{
    id: string;
    source: string;
    title: string;
    topic: string;
    score: number;
    preview: string;
  }>;
  diagrams: Array<{ filename: string; label: string; url: string }>;
};

function publicVfptUrl(filename: string): string {
  return `/physics/vfpt/${encodeURIComponent(filename)}`;
}

function vfptOnDisk(filename: string): boolean {
  return existsSync(join(process.cwd(), "public", "physics", "vfpt", filename));
}

export function summarizePhysicsRag(
  ctx: PhysicsTutorContext,
  corpus: { seed: number; ingested: number; total: number },
): PhysicsRagMeta {
  return {
    corpus,
    chunks: ctx.chunks.map((c) => ({
      id: c.id,
      source: c.source,
      title: c.title,
      topic: c.topic,
      score: c.score,
      preview: c.text.slice(0, 160),
    })),
    diagrams: ctx.diagrams
      .filter((d) => vfptOnDisk(d.filename))
      .map((d) => ({
        filename: d.filename,
        label: d.label,
        url: publicVfptUrl(d.filename),
      })),
  };
}

/**
 * Guarantee the top VFPt SVG appears on beat 1 so RAG diagrams are visible,
 * even if the model only drew boxes.
 */
export function attachPhysicsDiagramToLesson(
  lesson: ExperimentLesson,
  ctx: PhysicsTutorContext,
): ExperimentLesson {
  const diagram = ctx.diagrams.find((d) => vfptOnDisk(d.filename));
  if (!diagram || !lesson.beats.length) return lesson;

  const url = publicVfptUrl(diagram.filename);
  const already = lesson.beats.some((beat) =>
    beat.shapes.some(
      (s) => s.type === "image" && "src" in s && s.src === url,
    ),
  );
  if (already) return lesson;

  const image: ExperimentShape = {
    id: "vfpt_ref",
    type: "image",
    src: url,
    x: 520,
    y: 80,
    w: 420,
    h: 320,
    label: diagram.label.slice(0, 60),
  };

  const caption: ExperimentShape = {
    id: "vfpt_caption",
    type: "note",
    x: 520,
    y: 420,
    text: `Field diagram: ${diagram.label}`,
    color: "light-blue",
  };

  const beat0 = lesson.beats[0]!;
  lesson.beats[0] = {
    ...beat0,
    shapes: [...beat0.shapes, image, caption],
  };
  return lesson;
}
