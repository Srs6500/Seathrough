import { pickDiagramsForPrompt } from "@/lib/physics-tutor/diagrams";
import { loadPhysicsPedagogyRules } from "@/lib/physics-tutor/pedagogy";
import { retrievePhysicsChunks } from "@/lib/physics-tutor/retrieve";
import type { PhysicsTutorContext } from "@/lib/physics-tutor/types";

export function buildPhysicsTutorContext(
  prompt: string,
): PhysicsTutorContext {
  return {
    pedagogyRules: loadPhysicsPedagogyRules(),
    chunks: retrievePhysicsChunks(prompt, 4),
    diagrams: pickDiagramsForPrompt(prompt, 4),
  };
}

/** Injected into the Smart-tutor lesson planner for physics mode. */
export function formatPhysicsContextBlock(ctx: PhysicsTutorContext): string {
  const chunkBlock =
    ctx.chunks.length === 0
      ? "(No on-topic textbook chunks — teach from general physics carefully. Do NOT invent citations. Do NOT force electric/magnetic field diagrams unless the question is about fields.)"
      : ctx.chunks
          .map(
            (c, i) =>
              `[${i + 1}] (${c.source}/${c.topic}) ${c.title}\n${c.text}`,
          )
          .join("\n\n");

  const diagramBlock =
    ctx.diagrams.length === 0
      ? "(No local VFPt SVGs on disk — draw with geo/callout/arrow only. Do NOT invent an image src.)"
      : ctx.diagrams
          .map((d) => {
            const url = `/physics/vfpt/${encodeURIComponent(d.filename)}`;
            return `- ${d.label} [${d.topics.join(", ")}] src=${url}`;
          })
          .join("\n");

  const lines = [
    "PHYSICS MODE (high-school physics; corpus is strongest on electrostatics / E&M)",
    "Same Smart-tutor DNA: 3–5 beats, draw the mechanism, one idea per beat, optional single check on the confusable step.",
    "",
    "PEDAGOGY RULES:",
    ctx.pedagogyRules,
    "",
    "RETRIEVED CONTEXT (ground spoken say in these facts when present; do not invent textbook citations):",
    chunkBlock,
    "",
    "REFERENCE FIELD DIAGRAMS (only if listed — src must be exact):",
    diagramBlock,
    "",
    'When a reference diagram URL is listed, include ONE image shape on beat 1:',
    '{ "id":"vfpt_ref", "type":"image", "src":"<exact url>", "x":520, "y":60, "w":420, "h":320, "label":"short name" }',
    "Also draw simple geo/callout sketches so the board teaches, not only shows the SVG.",
    'If no diagram URL is listed, skip type:"image" entirely.',
    "",
    'In "say", prefer speakable wording: "electric field E", "charge q", "potential V", "force F", "one over r squared".',
    'For formulas in "say", use plain Unicode symbols (ε₀, μ₀, π, ∫, ·, ²) — never TeX backslash commands like \\frac or \\varepsilon (those break JSON).',
    "Prefer genre A/B mechanism sketches over stock coding metaphors. For graphs only when the student asked to plot.",
  ];
  return lines.join("\n");
}

/** Ground a voice lesson (glass board + spoken say), not ExperimentBoard JSON. */
export function formatPhysicsVoiceContextBlock(
  ctx: PhysicsTutorContext,
): string {
  const chunkBlock =
    ctx.chunks.length === 0
      ? "(No on-topic textbook chunks — teach careful general physics. Do not invent citations.)"
      : ctx.chunks
          .map(
            (c, i) =>
              `[${i + 1}] (${c.source}/${c.topic}) ${c.title}\n${c.text}`,
          )
          .join("\n\n");

  const diagramBlock =
    ctx.diagrams.length === 0
      ? "(No local field SVG — set diagramKind to tldraw_sketch or auto. Never invent an image filename.)"
      : ctx.diagrams
          .map((d) => {
            const url = `/physics/vfpt/${encodeURIComponent(d.filename)}`;
            return `- ${d.label} [${d.topics.join(", ")}] src=${url}`;
          })
          .join("\n");

  return [
    "PHYSICS (voice lesson: talk, write the passage, put a picture beside it when one exists).",
    "Ground spoken explanation in retrieved context when present. Do not invent textbook citations.",
    "",
    "PEDAGOGY:",
    ctx.pedagogyRules,
    "",
    "RETRIEVED CONTEXT:",
    chunkBlock,
    "",
    "FIELD DIAGRAMS (the server can pin one beside the lesson):",
    diagramBlock,
    "",
    "If a diagram src is listed, set diagramKind to vfpt_svg and explain what the picture shows.",
    "If none is listed, set diagramKind to tldraw_sketch (or auto) and sketch the mechanism.",
    "Never invent a field diagram for a non-physics topic.",
  ].join("\n");
}
