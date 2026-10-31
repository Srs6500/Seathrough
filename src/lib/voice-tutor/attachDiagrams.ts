/**
 * Attach gutter diagrams to a Voice lesson plan:
 * - VFPt SVG when electric-field topic gate + score clear
 * - Otherwise a lightweight Smart-style sketch card from key points (optional)
 *
 * Honors optional `draw.spec.policy` on the first teach beat:
 * - "auto" (default): VFPt if gated, else sketch
 * - "vfpt_svg": VFPt only (no sketch fallback)
 * - "tldraw_sketch": sketch only
 * - "none": never attach
 */

import { looksLikePhysicsAsk, pickVfptForVoiceTutor } from "@/lib/voice-tutor/vfptGate";
import type { DrawScene, VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";
import { clipWords, sketchSpecFromRaw } from "@/lib/voice-tutor/sketchShapes";

export type DiagramPolicy = "auto" | "vfpt_svg" | "tldraw_sketch" | "none";

function firstTeachBeatIndex(plan: VoiceLessonPlan): number {
  const i = plan.beats.findIndex((b) => !b.expectAnswer && b.board?.sourceText);
  if (i >= 0) return i;
  return plan.beats.findIndex((b) => !b.expectAnswer);
}

function isRealDiagram(draw: DrawScene | undefined): boolean {
  return Boolean(
    draw &&
      draw.kind !== "none" &&
      (draw.kind === "vfpt_svg" ||
        draw.kind === "tldraw_sketch" ||
        draw.kind === "svg_graph" ||
        draw.kind === "concept_boxes"),
  );
}

function alreadyHasDiagram(plan: VoiceLessonPlan): boolean {
  return plan.beats.some((b) => isRealDiagram(b.draw));
}

function policyFromDraw(draw: DrawScene | undefined): DiagramPolicy {
  const raw = draw?.spec?.policy;
  if (raw === "none" || raw === "vfpt_svg" || raw === "tldraw_sketch" || raw === "auto") {
    return raw;
  }
  return "auto";
}

/** Planner-authored diagram (hub / flow / cycle / compare / timeline). */
function sketchFromPlannerDiagram(
  topic: string,
  raw: unknown,
): DrawScene | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const spec = sketchSpecFromRaw({ ...obj, boxes: obj.boxes ?? obj.nodes });
  if (!spec) return null;
  return {
    kind: "tldraw_sketch",
    title: topic.slice(0, 48),
    spec: { ...spec, boxes: spec.boxes.slice(0, 6) },
    highlightIds: [],
  };
}

/**
 * "Computing power lets AI process data quickly." →
 * { label: "Computing power", detail: "lets AI process data quickly" }
 */
function conceptBox(sentence: string, i: number) {
  const t = sentence
    .replace(/^(first|second|third|fourth)[:,]\s*/i, "")
    .replace(/[.!]+$/, "")
    .trim();
  const split = t.match(
    /^(.{3,40}?)(?:\s*[:—–]\s*|\s+(?=(?:is|are|was|were|means|lets|let|helps|help|makes|make|decides?|shows?|gives?|turns?|uses?|drives?|causes?|controls?|allows?)\b))(.+)$/i,
  );
  const head = split?.[1]?.trim();
  if (head && head.split(/\s+/).length <= 5) {
    return { id: `box_${i + 1}`, label: head, detail: clipWords(split![2]!.trim(), 60) };
  }
  return { id: `box_${i + 1}`, label: clipWords(t, 40) };
}

/** Last resort: key concepts as a hub around the topic. */
function sketchFromKeyPoints(
  topic: string,
  keyPoints: string[],
): DrawScene | null {
  const boxes = keyPoints
    .map(conceptBox)
    .filter((b) => b.label.length > 0)
    .slice(0, 4);
  if (boxes.length === 1 && topic.trim()) {
    boxes.unshift({ id: "box_topic", label: topic.trim().slice(0, 48) });
  }
  if (boxes.length < 2) return null;
  return {
    kind: "tldraw_sketch",
    title: topic.slice(0, 48),
    spec: { layout: "hub", center: topic.trim().slice(0, 32), boxes },
    highlightIds: boxes[0] ? [boxes[0].id] : [],
  };
}

/** Drop invalid VFPt draws (wrong topic / missing url). Keep svg_graph / sketches. */
function sanitizeDraw(
  plan: VoiceLessonPlan,
  draw: DrawScene | undefined,
): DrawScene | undefined {
  if (!draw || draw.kind === "none") return draw;
  if (draw.kind === "vfpt_svg") {
    const prompt = [plan.topic, plan.objective, plan.label].filter(Boolean).join(" ");
    const pick = pickVfptForVoiceTutor(prompt);
    const url = typeof draw.spec?.url === "string" ? draw.spec.url : "";
    if (!pick || !url.startsWith("/physics/vfpt/")) {
      return { kind: "none", highlightIds: [], spec: { policy: "auto" } };
    }
    // Re-pin to the scored pick so filenames stay consistent.
    return {
      kind: "vfpt_svg",
      title: pick.diagram.label.slice(0, 60),
      spec: {
        url: pick.url,
        filename: pick.diagram.filename,
        label: pick.diagram.label,
        score: pick.score,
      },
      highlightIds: [],
    };
  }
  if (draw.kind === "tldraw_sketch") {
    if (!sketchSpecFromRaw(draw.spec)) {
      return { kind: "none", highlightIds: [], spec: { policy: "tldraw_sketch" } };
    }
  }
  return draw;
}

/**
 * Mutates a normalized plan: pin at most one diagram on the first teach beat.
 * Physics VFPt wins when gated; else a sketch card from key points (per policy).
 */
export function attachVoiceDiagrams(plan: VoiceLessonPlan): VoiceLessonPlan {
  if (!plan.beats.length) return plan;

  const beats: VoiceLessonPlan["beats"] = plan.beats.map((b) => {
    const sanitized = sanitizeDraw(plan, b.draw);
    if (sanitized === undefined) return b;
    return { ...b, draw: sanitized };
  });
  const next: VoiceLessonPlan = { ...plan, beats };

  if (alreadyHasDiagram(next)) return next;

  const idx = firstTeachBeatIndex(next);
  if (idx < 0) return next;
  const beat = next.beats[idx]!;
  const prompt = [
    next.topic,
    next.objective,
    next.label,
    beat.board?.formalStatement,
    beat.board?.sourceText?.slice(0, 200),
  ]
    .filter(Boolean)
    .join(" ");

  let policy = policyFromDraw(beat.draw);
  if (policy === "none" && looksLikePhysicsAsk(prompt)) {
    policy = "auto";
  }
  if (policy === "none") return next;

  let draw: DrawScene | null = null;

  if (policy === "auto" || policy === "vfpt_svg") {
    const vfpt = pickVfptForVoiceTutor(prompt);
    if (vfpt) {
      draw = {
        kind: "vfpt_svg",
        title: vfpt.diagram.label.slice(0, 60),
        spec: {
          url: vfpt.url,
          filename: vfpt.diagram.filename,
          label: vfpt.diagram.label,
          score: vfpt.score,
        },
        highlightIds: [],
      };
    } else if (policy === "vfpt_svg") {
      return next;
    }
  }

  if (!draw && (policy === "auto" || policy === "tldraw_sketch")) {
    draw = sketchFromPlannerDiagram(next.topic, beat.draw?.spec?.diagram);
  }
  if (!draw && (policy === "auto" || policy === "tldraw_sketch")) {
    // Concept sentences become "label + detail" boxes (see conceptBox).
    const keys = (beat.board?.keyPoints ?? []).filter(
      (k) => k && k.split(/\s+/).length <= 20 && !/^highlight\.?$/i.test(k.trim()),
    );
    draw = sketchFromKeyPoints(next.topic, keys);
  }

  if (!draw) return next;
  const attached = draw;

  return {
    ...next,
    beats: next.beats.map((b, i) => (i === idx ? { ...b, draw: attached } : b)),
  };
}

/** Helper for planner drafts: stamp policy onto a none draw. */
export function drawPolicyStub(
  policy: DiagramPolicy,
  diagram?: unknown,
): DrawScene {
  return {
    kind: "none",
    highlightIds: [],
    spec: diagram ? { policy, diagram } : { policy },
  };
}
