import OpenAI from "openai";
import { getLlmConfig } from "@/lib/env";
import {
  TurnResponseSchema,
  VoiceLessonPlanSchema,
  type ChatMessage,
  type TurnResponse,
  type VoiceLessonPlan,
} from "@/lib/voice-tutor/sessionTypes";
import { FUNCTIONS_LESSON } from "@/lib/voice-tutor/lessons/functions";
import {
  normalizeBoardAnnotations,
  withNormalizedAnnotations,
} from "@/lib/voice-tutor/boardAnnotations";
import {
  attachVoiceDiagrams,
  drawPolicyStub,
  type DiagramPolicy,
} from "@/lib/voice-tutor/attachDiagrams";
import {
  isMetaPedagogyText,
  pickHighlight,
} from "@/lib/voice-tutor/pickHighlight";
import { annotationFewShotBlock } from "@/lib/voice-tutor/annotationGold";
import {
  buildPhysicsTutorContext,
  formatPhysicsVoiceContextBlock,
} from "@/lib/physics-tutor/context";
import { looksLikePhysicsAsk } from "@/lib/voice-tutor/vfptGate";
import {
  sketchSpecFromRaw,
  type SketchLayout,
  type SketchSpec,
} from "@/lib/voice-tutor/sketchShapes";
import {
  researchPromptBlock,
  researchTopic,
} from "@/lib/voice-tutor/research";
import {
  MAX_TOPIC_CYCLES,
  casualFocusSay,
  cleanTopicLabel,
  extractTopicFromNudge,
  isTopicSwitchAway,
  looksLikeMumble,
  looksLikeTopicNudge,
  qualifyFocusWithParent,
  resolveFocusChoice,
  looksLikeInventedPersonTopic,
  looksLikeParkLanguage,
  looksLikeVagueTopic,
  looksLikeVoiceInjection,
  spokenTopicLockSay,
  stripTopicIntensifiers,
} from "@/lib/voice-tutor/intakeShared";
import {
  dynamicOverviewOption,
  focusTooSimilar,
  pickVariant,
} from "@/lib/voice-tutor/voiceVariety";

export {
  MAX_TOPIC_CYCLES,
  casualFocusSay,
  cleanTopicLabel,
  extractTopicFromNudge,
  isTopicSwitchAway,
  looksLikeMumble,
  looksLikeTopicNudge,
  looksLikeInventedPersonTopic,
  looksLikeVagueTopic,
  looksLikeVoiceInjection,
  matchListedFocus,
  qualifyFocusWithParent,
  resolveFocusChoice,
  spokenTopicLockSay,
  stripTopicIntensifiers,
} from "@/lib/voice-tutor/intakeShared";

function client() {
  const cfg = getLlmConfig();
  return {
    openai: new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }),
    model: cfg.model,
  };
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced?.[1]?.trim() ?? trimmed;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model returned no JSON object.");
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
  // gpt-oss on Groq sometimes wraps JSON as a fake tool call: { name, arguments }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>;
    if ("arguments" in rec) {
      const args = rec.arguments;
      if (typeof args === "string" && args.trim()) {
        return extractJson(args);
      }
      if (args && typeof args === "object") return args;
    }
  }
  return parsed;
}

function readFailedGeneration(error: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): string | null => {
    if (!value || depth > 6 || seen.has(value)) return null;
    if (typeof value !== "object") return null;
    seen.add(value);
    const rec = value as Record<string, unknown>;
    if (typeof rec.failed_generation === "string" && rec.failed_generation.trim()) {
      return rec.failed_generation;
    }
    for (const nested of [rec.error, rec.cause, rec.body, rec.data]) {
      const found = walk(nested, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(error, 0);
}

function messageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part && "text" in part
          ? String((part as { text?: string }).text ?? "")
          : "",
      )
      .join("")
      .trim();
  }
  return "";
}

/** Groq gpt-oss often emits tool-call wrappers; recover JSON instead of falling to templates. */
async function completeJson(input: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<unknown> {
  const { openai, model } = client();
  const groq = model.includes("gpt-oss") || model.includes("qwen");
  const messages = [
    { role: "system" as const, content: input.system },
    { role: "user" as const, content: input.user },
  ];

  const request = (jsonMode: boolean) =>
    openai.chat.completions.create({
      model,
      temperature: input.temperature ?? 0.4,
      max_tokens: 4096,
      ...(groq
        ? { reasoning_effort: "low" as const, include_reasoning: false }
        : {}),
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      messages: jsonMode
        ? messages
        : [
            {
              role: "system",
              content: `${input.system}\n\nReturn a single JSON object only. No markdown. No tool calls.`,
            },
            messages[1]!,
          ],
    });

  try {
    const completion = await request(true);
    const raw = messageText(completion.choices[0]?.message ?? {});
    if (raw) return extractJson(raw);
  } catch (error) {
    const refused = readFailedGeneration(error);
    if (refused) {
      try {
        return extractJson(refused);
      } catch {
        /* retry without json mode */
      }
    }
  }

  const retry = await request(false);
  const raw = messageText(retry.choices[0]?.message ?? {});
  return extractJson(raw || "{}");
}

/** Deterministic Functions plan when LLM is down or topic is clearly functions/VLT. */
export function functionsVoicePlan(): VoiceLessonPlan {
  const beats = FUNCTIONS_LESSON.steps
    .filter((step) => step.phase !== "complete")
    .map((step) => {
      const block = FUNCTIONS_LESSON.blocks.find((b) => b.id === step.blockId);
      const showScene = step.display.find((d) => d.type === "show_scene");
      const scene =
        showScene && showScene.type === "show_scene"
          ? FUNCTIONS_LESSON.scenes.find((s) => s.sceneId === showScene.sceneId)
          : undefined;
      const showSource = step.display.find((d) => d.type === "show_source");
      const highlightAction = step.display.find((d) => d.type === "highlight_source");
      const showKeys = step.display.find((d) => d.type === "show_keypoints");
      const sourceRef =
        showSource && showSource.type === "show_source"
          ? block?.sourceRefs.find(
              (ref) =>
                ref.sourceId === showSource.sourceId &&
                ref.passageId === showSource.passageId,
            )
          : undefined;
      const keyPoints =
        showKeys && showKeys.type === "show_keypoints"
          ? (FUNCTIONS_LESSON.blocks.find((b) => b.id === showKeys.blockId)?.lesson
              .keyPoints ?? [])
          : block && step.phase !== "introduce"
            ? block.lesson.keyPoints
            : [];
      const focus = step.display.find((d) => d.type === "focus_objects");

      return {
        id: step.id,
        say: step.speech,
        expectAnswer: step.expectResponse === "spoken_reasoning",
        rubricKeywords: block?.assessment?.expectKeywords ?? [],
        hintSay: block?.assessment?.hintSay,
        successSay: block?.assessment?.successSay,
        board: {
          formalStatement: block?.lesson.formalStatement,
          sourceTitle: sourceRef?.title,
          sourceText: sourceRef?.text,
          highlight:
            highlightAction && highlightAction.type === "highlight_source"
              ? highlightAction.highlight
              : sourceRef?.highlight,
          rememberTip: keyPoints[0],
          examCue: block?.lesson.socraticPrompts?.[0]?.slice(0, 140),
          pointer: "both" as const,
          keyPoints,
        },
        draw: scene
          ? {
              kind: "svg_graph" as const,
              title: scene.title,
              spec: { scene },
              highlightIds:
                focus && focus.type === "focus_objects"
                  ? focus.objectIds
                  : scene.objects
                      .filter(
                        (o) =>
                          o.type === "line" ||
                          o.type === "circle" ||
                          o.type === "curve",
                      )
                      .map((o) => o.id)
                      .slice(0, 2),
            }
          : { kind: "none" as const, highlightIds: [] },
      };
    });

  return {
    topic: FUNCTIONS_LESSON.title,
    label: FUNCTIONS_LESSON.title,
    objective: FUNCTIONS_LESSON.objective,
    beats: beats.length ? beats : [
      {
        id: "fallback",
        say: "Let's talk about functions: each input gets exactly one output.",
        expectAnswer: false,
        rubricKeywords: [],
        draw: { kind: "none", highlightIds: [] },
      },
    ],
  };
}

/** Only the curated Functions seed — not a hardwire for every chat. */
function looksLikeFunctions(text: string): boolean {
  return (
    /\bvertical[- ]?line(?:\s+test)?\b/i.test(text) ||
    /\b(?:math(?:ematics)?\s+)?functions?\b/i.test(text) ||
    /\bwhat is a function\b/i.test(text) ||
    /\bfunction\s+(?:vs|versus|as)\s+relation\b/i.test(text)
  );
}

type LessonDraft = {
  topic: string;
  objective?: string;
  /** What the thing IS — 2–3 plain sentences. */
  definition?: string;
  /** Three key pieces, each one short sentence. */
  keyConcepts?: string[] | string;
  /** One concrete worked example, 3–5 sentences. */
  example?: string;
  explanation?: string;
  plainExplain?: string;
  deepen?: string;
  plainDeepen?: string;
  highlight?: string;
  rememberTip?: string;
  examCue?: string;
  keyPoints?: string[];
  exampleSay?: string;
  checkAsk?: string;
  checkHint?: string;
  checkSuccess?: string;
  /**
   * Gutter diagram preference (Phase 3 routing).
   * Server still topic-gates VFPt — never invent field art for non-physics.
   */
  diagramKind?: DiagramPolicy;
  /** Structured board diagram (hub / flow / cycle / compare / timeline). */
  diagram?: unknown;
  /** Optional multi-marks; each targetPhrase must be copied from explanation. */
  annotations?: Array<{
    targetPhrase?: string;
    style?: "circle" | "underline" | "both";
    sideNote?: string;
    recallQuestion?: string;
    examCue?: string;
  }>;
};

/** Deterministic layout for obvious topic shapes ("" → let the model pick). */
function diagramLayoutHint(topic: string): SketchLayout | "" {
  const t = topic.toLowerCase();
  let layout: SketchLayout | "" = "";
  if (/\b(vs\.?|versus|difference between|compared? (to|with)|pros and cons|before and after)\b/.test(t)) {
    layout = "compare";
  } else if (/\bcycle\b|\bloop\b/.test(t)) {
    layout = "cycle";
  } else if (
    /\b(war|revolution|empire|dynasty|history of|rise of|fall of|reign|civilization|era|age of|independence|movement|timeline|evolution of)\b/.test(t)
  ) {
    layout = "timeline";
  } else if (
    /^how\b|\bhow .+ works?\b|\bprocess\b|\bsteps?\b|\bpathway\b|\b(synthesis|digestion|respiration|mitosis|meiosis|fermentation|algorithm|compil\w*|pipeline)\b/.test(t)
  ) {
    layout = "flow";
  }
  return layout;
}

const DIAGRAM_SYSTEM = `You design ONE whiteboard diagram that summarizes a topic at a glance — like a great teacher's board, not sentences chopped into boxes.
Return ONLY JSON:
{
  "layout": "hub" | "flow" | "cycle" | "compare" | "timeline",
  "center": "topic name, 1-3 words (hub only)",
  "nodes": [{ "label": "2-4 word NAME", "detail": "key fact, max 7 words, real numbers/specs/dates" }],
  "columns": [{ "title": "thing A", "points": ["max 6 words"] }, { "title": "thing B", "points": ["max 6 words"] }],
  "edgeLabels": ["1-3 word verb per arrow (flow only, optional)"]
}
Layouts:
- hub: a THING with features/parts (product, device, organ, organism, place, framework). center = topic; 4-6 nodes = the most important features/parts with real specs.
- flow: a process / mechanism / "how X works" / algorithm / pathway. 3-6 ordered steps, inputs → outputs.
- cycle: a repeating loop. 3-6 stages in loop order.
- compare: two things contrasted. Exactly 2 columns titled with the two things; 3-5 parallel points each (row n covers the same aspect on both sides). nodes = [].
- timeline: history, wars, eras, generations. 3-6 nodes in date order; label = date/era ("1939"), detail = what happened.
Examples: iPhone Duo → hub. human heart → hub. photosynthesis → flow. World War II → timeline. TCP vs UDP → compare. water cycle → cycle.
Rules: labels are noun phrases, never sentences. No "It ...", no "First:", no ellipses. Every node must teach a real fact.`;

/** Dedicated board-diagram call; null when the model can't produce a valid one. */
async function draftBoardDiagram(
  topic: string,
  research: string,
): Promise<SketchSpec | null> {
  const forced = diagramLayoutHint(topic);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = (await completeJson({
        temperature: attempt ? 0.2 : 0.35,
        system: `${DIAGRAM_SYSTEM}${forced ? `\nREQUIRED layout for this topic: "${forced}".` : ""}\n${research}`,
        user: `Topic: ${topic}`,
      })) as Record<string, unknown>;
      const spec = sketchSpecFromRaw({ ...raw, boxes: raw.boxes ?? raw.nodes });
      if (!spec) continue;
      if (forced && spec.layout !== forced) continue;
      if (spec.layout === "compare" && (spec.columns?.length ?? 0) < 2) continue;
      const sentencey = spec.boxes.some(
        (b) => b.label.split(/\s+/).length > 6 || /^(it|its|first|second|third)\b/i.test(b.label),
      );
      if (sentencey) continue;
      return spec;
    } catch (error) {
      console.warn("[voice-tutor/brain] diagram draft failed", error);
    }
  }
  return null;
}

function diagramPolicyFromDraft(draft: LessonDraft): DiagramPolicy {
  const raw = draft.diagramKind;
  if (raw === "none" || raw === "vfpt_svg" || raw === "tldraw_sketch" || raw === "auto") {
    return raw;
  }
  return "auto";
}

/**
 * Emergency offline stub only — never invent fake STEM shells for history/etc.
 * Real lessons must come from draftLessonFromLlm.
 */
function openTopicFallbackPlan(topic: string): VoiceLessonPlan {
  const clean = cleanTopicLabel(topic);
  // Honest stub if the model is unavailable — never invent STEM shells for other subjects.
  const explanation = `${clean} is worth a real explanation with specific facts. The connection briefly dropped, so ask once more and I will teach what ${clean} is, why it mattered, and one clear takeaway.`;
  return {
    topic: clean,
    label: clean.slice(0, 48),
    objective: `Learn the basics of ${clean}`,
    beats: [
      {
        id: "open_1",
        say: `I want to give you a proper explanation of ${clean}. Please ask me again in a second so I can pull the real lesson.`,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sourceText: explanation,
          highlight: pickHighlight(explanation, clean) || `what ${clean} is`,
          rememberTip: `Retry once — then keep one factual takeaway about ${clean}.`,
          examCue: `What is ${clean}?`,
          pointer: "circle",
          keyPoints: [`What ${clean} is`, "Why it mattered", "One clear takeaway"],
        },
        draw: { kind: "none", highlightIds: [] },
      },
      {
        id: "open_2",
        say: `When you're ready, ask about ${clean} again and we'll start properly.`,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sourceText: explanation,
          highlight: pickHighlight(explanation, clean) || `why it mattered`,
          rememberTip: `Specific angle helps: causes, events, or impact of ${clean}.`,
          examCue: `Why does ${clean} matter?`,
          pointer: "circle",
          keyPoints: [`What ${clean} is`, "Why it mattered", "One clear takeaway"],
        },
        draw: { kind: "none", highlightIds: [] },
      },
      {
        id: "open_3",
        say: `Quick check for later — what do you already know about ${clean}?`,
        expectAnswer: true,
        rubricKeywords: clean
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .slice(0, 4),
        hintSay: "Share any fact you remember — we'll build from there next turn.",
        successSay: "Good starting point. Ask me again and we'll deepen it.",
        board: {
          formalStatement: clean,
          sourceText: explanation,
          highlight: pickHighlight(explanation, clean) || clean,
          rememberTip: `One fact you know about ${clean}.`,
          examCue: `What do you know about ${clean}?`,
          pointer: "circle",
          keyPoints: [`What ${clean} is`, "Why it mattered", "One clear takeaway"],
        },
        draw: { kind: "none", highlightIds: [] },
      },
    ],
  };
}

function firstSentences(text: string, n: number): string {
  const parts = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!parts?.length) return text.trim();
  return parts
    .slice(0, n)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeMetaTeachSay(text: string): boolean {
  return /\b(here's what .+ is about|let's (?:push|unpack|look at|dive)|the marked line|this is the text|way to remember it|in simple terms)\b/i.test(
    text,
  );
}

function usableTeachText(text: string | undefined): string {
  const t = text?.trim() ?? "";
  if (t.length < 24) return "";
  if (isMetaPedagogyText(t) || looksLikeMetaTeachSay(t)) return "";
  return t;
}

function asConceptList(raw: unknown): string[] {
  const items: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) items.push(item.trim());
    }
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(/\n+|•|;|\d+[.)]\s+/)) {
      const next = part.replace(/^(first|second|third|fourth)[:.\s-]+/i, "").trim();
      if (next) items.push(next);
    }
  }
  return items.slice(0, 4);
}

function finishSentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function formatConceptPassage(concepts: string[]): string {
  const labels = ["First", "Second", "Third", "Fourth"];
  return concepts
    .map((c, i) => {
      const body = finishSentence(
        c.replace(/^(first|second|third|fourth)[:.\s-]+/i, ""),
      );
      return `${labels[i] ?? "Next"}: ${body}`;
    })
    .join(" ");
}

function teachDefinition(draft: LessonDraft, clean: string): string {
  return (
    usableTeachText(draft.definition) ||
    usableTeachText(draft.plainExplain) ||
    firstSentences(usableTeachText(draft.explanation) || draft.explanation || "", 2) ||
    `${clean} is the idea we'll define, then break into key pieces, then see in an example.`
  );
}

function teachConcepts(draft: LessonDraft, definition: string): string[] {
  const fromDraft = asConceptList(draft.keyConcepts);
  if (fromDraft.length >= 2) return fromDraft.map(finishSentence);
  const fromPoints = asConceptList(draft.keyPoints);
  if (fromPoints.length >= 2) return fromPoints.map(finishSentence);
  const leftover = (usableTeachText(draft.explanation) || "")
    .replace(definition, "")
    .trim();
  const extra = leftover
    ? leftover.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? []
    : [];
  if (extra.length >= 2) return extra.slice(0, 3).map(finishSentence);
  return [
    finishSentence(firstSentences(definition, 1) || definition),
    "Notice the pieces that make the definition actually work in practice.",
    "You'll reuse those pieces when we look at an example.",
  ];
}

function teachExample(draft: LessonDraft, clean: string): string {
  return (
    usableTeachText(draft.example) ||
    usableTeachText(draft.deepen) ||
    usableTeachText(draft.plainDeepen) ||
    usableTeachText(draft.exampleSay) ||
    `Take a real case of ${clean}. Walk through it using the definition, then the key pieces, one step at a time.`
  );
}

function draftIsUsable(draft: LessonDraft): boolean {
  const body = (
    draft.definition ||
    draft.explanation ||
    draft.plainExplain ||
    ""
  ).trim();
  return body.length > 40 && !isMetaPedagogyText(body);
}

function planFromDraft(draft: LessonDraft): VoiceLessonPlan {
  const clean = cleanTopicLabel(draft.topic || "this topic");
  const definition = teachDefinition(draft, clean);
  const concepts = teachConcepts(draft, definition);
  const conceptText = formatConceptPassage(concepts);
  const example = teachExample(draft, clean);
  const rememberTip =
    draft.rememberTip?.trim() ||
    `Say the definition in one breath, then name one key piece.`;
  const examCue = draft.examCue?.trim() || `What is ${clean}, in your own words?`;
  const defHighlight =
    pickHighlight(definition, clean, draft.highlight) ||
    pickHighlight(definition, clean);
  const conceptHighlight = pickHighlight(conceptText, clean);
  const exampleHighlight = pickHighlight(example, clean);
  const defAnnotations = normalizeBoardAnnotations(definition, {
    annotations: Array.isArray(draft.annotations) ? draft.annotations : undefined,
    highlight: defHighlight,
    rememberTip,
    examCue,
    pointer: "both",
  });
  const conceptAnnotations = normalizeBoardAnnotations(conceptText, {
    highlight: conceptHighlight,
    rememberTip: concepts[0] || rememberTip,
    examCue,
    pointer: "both",
  });
  const exampleAnnotations = normalizeBoardAnnotations(example, {
    highlight: exampleHighlight,
    rememberTip: "The example is the definition doing work.",
    examCue,
    pointer: "both",
  });
  const diagramPolicy = diagramPolicyFromDraft(draft);
  const openDraw = drawPolicyStub(diagramPolicy, draft.diagram);

  return {
    topic: clean,
    label: clean.slice(0, 48),
    objective: draft.objective?.trim() || `Understand ${clean}`,
    beats: [
      {
        id: "open_def",
        say: definition,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sectionLabel: "Definition",
          sourceText: definition,
          highlight: defHighlight,
          rememberTip,
          examCue,
          pointer: "both",
          keyPoints: concepts,
          annotations: defAnnotations,
        },
        draw: openDraw,
      },
      {
        id: "open_concepts",
        say: formatConceptPassage(concepts),
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sectionLabel: "Key concepts",
          sourceText: conceptText,
          highlight: conceptHighlight,
          rememberTip: concepts[0] || rememberTip,
          examCue,
          pointer: "both",
          keyPoints: concepts,
          annotations: conceptAnnotations,
        },
        draw: { kind: "none", highlightIds: [] },
      },
      {
        id: "open_example",
        say: example,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sectionLabel: "Example",
          sourceText: example,
          highlight: exampleHighlight,
          rememberTip: "The example is the definition doing work.",
          examCue,
          pointer: "both",
          keyPoints: concepts,
          annotations: exampleAnnotations,
        },
        draw: { kind: "none", highlightIds: [] },
      },
      {
        id: "open_check",
        say:
          draft.checkAsk?.trim() ||
          `Quick check — in your own words, what is ${clean}, and give one piece from the example.`,
        expectAnswer: true,
        rubricKeywords: [
          ...clean
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 2)
            .slice(0, 4),
          ...concepts
            .join(" ")
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 4)
            .slice(0, 6),
        ],
        hintSay:
          draft.checkHint?.trim() ||
          "Start from the definition, then mention one key concept or the example.",
        successSay:
          draft.checkSuccess?.trim() ||
          "Good — you used the definition, not just the name.",
        board: {
          formalStatement: clean,
          sectionLabel: "Example",
          sourceText: example,
          highlight: exampleHighlight,
          rememberTip,
          examCue,
          pointer: "circle",
          keyPoints: concepts,
          annotations: exampleAnnotations,
        },
        draw: { kind: "none", highlightIds: [] },
      },
    ],
  };
}

function sanitizeBeatBoard(
  topic: string,
  board: NonNullable<VoiceLessonPlan["beats"][number]["board"]>,
): NonNullable<VoiceLessonPlan["beats"][number]["board"]> {
  const sourceText = board.sourceText?.trim() || "";
  // Never overwrite a real explanation with a template. Only re-rank highlight.
  if (!sourceText || isMetaPedagogyText(sourceText)) {
    const highlight = sourceText
      ? pickHighlight(sourceText, topic, board.highlight)
      : board.highlight;
    return withNormalizedAnnotations(
      {
        ...board,
        highlight,
        pointer: board.pointer || "both",
      },
      topic,
    );
  }

  return withNormalizedAnnotations(
    {
      ...board,
      highlight: pickHighlight(sourceText, topic, board.highlight),
      pointer: board.pointer || "both",
    },
    topic,
  );
}

function looksLikeQuizLine(say: string): boolean {
  const t = say.trim();
  return (
    /\?\s*$/.test(t) ||
    /^(what|why|how|can you|could you|quick check|true or false|which of)\b/i.test(
      t,
    )
  );
}

/** Guarantee real teaching before the first check — including quiz-worded early beats. */
function normalizePlanTeachFirst(plan: VoiceLessonPlan): VoiceLessonPlan {
  const topic = cleanTopicLabel(plan.topic);
  let beats = plan.beats.map((b) => ({ ...b }));

  // Do NOT inject template beats — that produced nonsense for history topics.
  // Only demote early quiz flags so explanation can land first.

  let explainCount = 0;
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i]!;
    if (!beat.expectAnswer) {
      explainCount += 1;
      if (explainCount <= 2 && looksLikeQuizLine(beat.say)) {
        const fromBoard =
          beat.board?.sourceText?.trim() ||
          beat.board?.formalStatement?.trim() ||
          "";
        beats[i] = {
          ...beat,
          expectAnswer: false,
          say:
            fromBoard.length > 40
              ? fromBoard.slice(0, 400)
              : `${topic}: ${beat.say.replace(/\?+$/, ".")}`,
        };
      }
      continue;
    }
    if (explainCount < 2) {
      const fromBoard =
        beat.board?.sourceText?.trim() ||
        beat.board?.formalStatement?.trim() ||
        "";
      beats[i] = {
        ...beat,
        expectAnswer: false,
        say: looksLikeQuizLine(beat.say)
          ? fromBoard.length > 40
            ? fromBoard.slice(0, 400)
            : `Before I check you — start from the definition of ${topic}.`
          : beat.say,
      };
      explainCount += 1;
    }
  }

  if (!beats.some((b) => b.expectAnswer)) {
    const check = openTopicFallbackPlan(topic).beats.find((b) => b.expectAnswer);
    if (check) beats = [...beats, check];
  }

  // Carry pedagogy forward so check beats don't blank the board.
  let lastBoard = beats[0]?.board;
  beats = beats.map((beat) => {
    const board = beat.board;
    if (!board) {
      return lastBoard ? { ...beat, board: lastBoard } : beat;
    }
    const merged = sanitizeBeatBoard(topic, {
      ...lastBoard,
      ...board,
      formalStatement:
        board.formalStatement || lastBoard?.formalStatement || topic,
      sourceText: board.sourceText || lastBoard?.sourceText,
      sectionLabel: board.sectionLabel || lastBoard?.sectionLabel,
      plainExplain: board.plainExplain || lastBoard?.plainExplain,
      sourceTitle: board.sourceTitle || lastBoard?.sourceTitle,
      highlight: board.highlight || lastBoard?.highlight,
      keyPoints:
        board.keyPoints?.length ? board.keyPoints : lastBoard?.keyPoints ?? [],
      pointer: board.pointer || lastBoard?.pointer || ("both" as const),
      rememberTip: board.rememberTip || lastBoard?.rememberTip,
      examCue: board.examCue || lastBoard?.examCue,
      annotations:
        board.annotations?.length
          ? board.annotations
          : lastBoard?.annotations,
    });
    lastBoard = merged;
    return { ...beat, board: merged };
  });

  const normalized: VoiceLessonPlan = {
    ...plan,
    topic: cleanTopicLabel(topic),
    beats: beats.slice(0, 12),
  };
  return attachVoiceDiagrams(normalized);
}

function generalFocusOption(parent: string, avoided: string[] = []): string {
  // Try a few rotating overview labels that aren't in the avoid list.
  for (let i = 0; i < 6; i += 1) {
    const candidate = dynamicOverviewOption(parent);
    const hit = avoided.some(
      (a) =>
        a.toLowerCase() === candidate.toLowerCase() ||
        focusTooSimilar(a, candidate),
    );
    if (!hit) return candidate;
  }
  return dynamicOverviewOption(parent);
}

function lockSayForPlan(
  plan: VoiceLessonPlan,
  opts?: { final?: boolean },
): string {
  const teasers =
    plan.beats[0]?.board?.keyPoints?.filter(Boolean).slice(0, 3) ?? [];
  return spokenTopicLockSay(plan.topic, {
    final: opts?.final,
    teasers,
  });
}

function isGenericFocusShell(option: string, parent: string): boolean {
  const o = option.trim().toLowerCase();
  const p = parent.trim().toLowerCase();
  const bare = o
    .replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "")
    .replace(/\b(of|in|for|about|the|and|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Hollow chips: "Java concepts", "examples", "core ideas", "the topic in general"
  return /^(basics?|theory|applications?|concepts?|examples?|fundamentals?|core ideas?|worked examples?|common mistakes?|key terms?|practice problems?|step by step|how it works|overview|intro|introduction|general|in general|main (topic|idea)s?)$/i.test(
    bare || o,
  );
}

/**
 * Soft on-topic check: allow real subtopics ("inheritance") that omit the parent word.
 * Only reject clear foreign-subject smuggling / person-name junk.
 */
function optionStaysOnParent(option: string, parent: string): boolean {
  const o = option.trim().toLowerCase();
  const p = parent.trim().toLowerCase();
  if (!o || !p) return false;
  if (looksLikeInventedPersonTopic(option)) return false;
  if (isGenericFocusShell(option, parent)) return false;
  // If it repeats the parent, fine.
  if (o.includes(p)) return true;
  const parentTokens = p
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 2);
  if (parentTokens.some((t) => o.includes(t))) return true;
  // Concrete subtopic without parent word — allow unless it looks like another big subject.
  const foreign =
    /\b(java|python|javascript|physics|chemistry|biology|history|calculus|algebra|geometry|react|kubernetes|docker|aws)\b/i;
  const foreignHit = o.match(foreign)?.[0]?.toLowerCase();
  if (foreignHit && !p.includes(foreignHit)) return false;
  // Short concrete phrases (1–5 words) are OK as sub-angles.
  const words = o.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 6;
}

async function buildClarifyForTopic(
  parentRaw: string,
  avoided: string[] = [],
  softRetry = false,
): Promise<TurnResponse> {
  const parent = cleanTopicLabel(parentRaw);

  // "random (ass) things" / "anything" — ask for a real subject; never invent names/subjects.
  if (
    looksLikeVagueTopic(parent) ||
    looksLikeVagueTopic(parentRaw) ||
    looksLikeInventedPersonTopic(parent)
  ) {
    return {
      say: pickVariant([
        "Random is great — name one thing that sounds fun, even roughly.",
        "I can go anywhere — give me a subject word, like stars, cooking, or chess.",
        "Surprise me with a topic name and we'll lock a focus from there.",
      ]),
      action: "speak",
      showOnBoard: false,
    };
  }

  // Only avoid options for THIS parent — never bleed other subjects in.
  // Soft retry: keep a short avoid tail so stress-testing doesn't collapse to shells.
  const recentAvoid = avoided
    .filter((a) => optionStaysOnParent(a, parent))
    .slice(softRetry ? -3 : -12);
  const varietySeed = `${Date.now() % 997}-${recentAvoid.length}-${softRetry ? "r" : "0"}`;
  const avoidedBlock = recentAvoid.length
    ? `Prefer fresh angles. Softly avoid close copies of:\n- ${recentAvoid.join("\n- ")}`
    : `Invent fresh angles for "${parent}" only.`;
  // Research first so chips reflect what the topic really is (new products, events).
  const research = researchPromptBlock(
    parent,
    (await researchTopic(parent)).notes,
  );
  try {
    const angleJson = (await completeJson({
      temperature: softRetry ? 0.7 : 0.55,
      system: `Student wants to learn about "${parent}". Variety seed: ${varietySeed}.
Return ONLY JSON: {
  "focusOptions": [exactly 5 short SPECIFIC subtopics, 1-5 words each]
}
Hard rules:
- Give REAL named subtopics a beginner would recognize for "${parent}".
- BAD (never): "concepts", "examples", "core ideas", "theory", "applications", "basics", "key terms", "practice problem", "how it works", "${parent} concepts", "${parent} examples", "${parent} in general", "general ${parent}".
- GOOD: concrete nouns/skills inside the subject (if parent were Java: inheritance, for-loops, ArrayList — if parent were photosynthesis: chlorophyll, light reactions, glucose).
- Do NOT invent people names. Do NOT drag in unrelated subjects.
- Options may omit the parent word; the app already knows the parent is "${parent}".
- Never use pronouns ("its", "it", "their", "this") — each option must make sense on its own.
- Last option should be a short overview chip like "big picture of ${parent}" or "intro to ${parent}" (never "general ${parent}").
- ${avoidedBlock}
- No numbers. No full sentences.
${research}`,
      user: `Parent topic (only this): ${parent}`,
    })) as { focusOptions?: string[] };
    // Keep raw specific names; don't force "X of parent" on every chip.
    const options = (angleJson.focusOptions ?? [])
      .map((o) => o.trim())
      .filter(Boolean)
      .filter((o) => optionStaysOnParent(o, parent));

    const picked: string[] = [];
    for (const o of options) {
      const blocked = recentAvoid.some(
        (a) =>
          a.toLowerCase() === o.toLowerCase() || focusTooSimilar(a, o),
      );
      const dup = picked.some((p) => focusTooSimilar(p, o));
      if (blocked || dup) continue;
      // Prefer non-overview chips first.
      const isOverview =
        /overview|intro to|general |from scratch|big picture|touring |first look/i.test(
          o,
        );
      if (isOverview) continue;
      picked.push(o);
      if (picked.length >= 3) break;
    }

    const overview = generalFocusOption(parent, [...recentAvoid, ...picked]);
    const focusOptions = [...picked, overview].slice(0, 4);
    if (picked.length < 2) {
      throw new Error("weak focus options");
    }
    return {
      say: casualFocusSay(parent, focusOptions),
      action: "clarify_focus",
      parentTopic: parent,
      topic: parent,
      focusOptions,
      showOnBoard: false,
    };
  } catch {
    // Soften once: shorter avoid list + hotter sample before offline chips.
    if (!softRetry && recentAvoid.length > 3) {
      return buildClarifyForTopic(parentRaw, avoided, true);
    }
    // Subject-shaped offline fallbacks — avoid hollow theory/apps/general shells.
    const overview = generalFocusOption(parent, recentAvoid);
    const focusOptions = [
      `${parent} mechanisms`,
      `${parent} landmark ideas`,
      `hands-on ${parent}`,
      overview,
    ].filter((o) => !isGenericFocusShell(o, parent) || /big picture|from scratch|touring|intro to|first look|foundations/i.test(o));
    const chips =
      focusOptions.length >= 2
        ? focusOptions.slice(0, 4)
        : [`${parent} mechanisms`, `hands-on ${parent}`, overview].slice(0, 4);
    return {
      say: casualFocusSay(parent, chips),
      action: "clarify_focus",
      parentTopic: parent,
      topic: parent,
      focusOptions: chips,
      showOnBoard: false,
    };
  }
}

function looksLikeOffTopicChitchat(text: string, activeTopic?: string): boolean {
  if (!activeTopic?.trim()) return false;
  // Answers / lesson engagement stay on-topic.
  if (
    /\b(because|since|so|therefore|input|output|example|means|equals|force|energy|light|space|time)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /\b(how many languages|what languages|who are you|your name|joke|weather|sing|favorite|boyfriend|girlfriend)\b/i.test(
      text,
    ) ||
    (/\b(languages?|chatgpt|openai|are you (an )?ai)\b/i.test(text) &&
      !new RegExp(activeTopic.split(/\s+/)[0] ?? "____", "i").test(text))
  );
}

export async function runVoiceTurn(input: {
  mode: "greet" | "chat" | "plan";
  userText?: string;
  messages: ChatMessage[];
  /** When set, off-topic chitchat is voice-only redirect; lesson board stays. */
  activeTopic?: string;
  teaching?: boolean;
  /** True while waiting for the student to pick a subtopic (never re-clarify). */
  awaitingFocus?: boolean;
  parentTopic?: string;
  focusOptions?: string[];
  /** After a topic switch — always offer subtopics for the new topic. */
  preferClarify?: boolean;
  /** Mid-lesson “I didn’t get that” — short clarify for voice + board. */
  clarifyAside?: boolean;
  /** Partial voice-only doubt answer (no board). */
  partialAside?: boolean;
  /** End-of-lesson deferred follow-up the student asked to revisit. */
  deferredClose?: boolean;
  /** Previously offered focus chips for this parent — do not repeat. */
  avoidedFocusOptions?: string[];
  /** Current beat context for mid-lesson doubt answers. */
  lessonContext?: {
    beatSay?: string;
    highlight?: string;
    rememberTip?: string;
  };
  /** False when the student turned diagrams off (skip the diagram draft). */
  diagrams?: boolean;
}): Promise<TurnResponse> {
  if (input.mode === "greet") {
    return {
      say: pickVariant([
        "Hey — I'm your voice tutor. Ask about anything you want to learn — math, physics, code, history, whatever — and we'll lock a topic in.",
        "Welcome in. Tell me what you're curious about — any subject — and we'll pick a clear focus.",
        "Good to have you. What should we learn today? Name a topic and we'll narrow it.",
        "Ready when you are — throw me a topic, big or small, and we'll start shaping a lesson.",
      ]),
      action: "speak",
      showOnBoard: false,
    };
  }

  const userText = (input.userText ?? "").trim();
  if (!userText) {
    return {
      say: "I didn't catch that. Try again whenever you're ready.",
      action: "speak",
      showOnBoard: false,
    };
  }

  // Mid-lesson clarify / partial, or end-of-lesson deferred scaffold.
  if (
    (input.clarifyAside || input.partialAside || input.deferredClose) &&
    input.activeTopic
  ) {
    const partial = input.partialAside === true && !input.deferredClose;
    const deferred = input.deferredClose === true;
    const topic = cleanTopicLabel(input.activeTopic);
    const ctx = input.lessonContext;
    const ctxBlock = [
      ctx?.beatSay ? `Tutor was saying: ${ctx.beatSay}` : "",
      ctx?.highlight ? `Marked line: ${ctx.highlight}` : "",
      ctx?.rememberTip ? `Remember tip: ${ctx.rememberTip}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // End-of-lesson parked doubts → 25% / 25% / full scaffold for the client to drip.
    if (deferred) {
      try {
        const scaffoldJson = (await completeJson({
          temperature: 0.35,
          system: `You are SeeThrough Voice Tutor closing a lesson on "${topic}".
The student parked a doubt mid-lesson. Build an INCREMENTAL spoken scaffold.
Student speech may be messy — never echo their raw words.
${ctxBlock ? `Lesson context:\n${ctxBlock}` : ""}
Return ONLY JSON:
{
  "piece1": "≈25% — ONE short new lever only (1-2 sentences). Do not fully solve.",
  "piece2": "≈25% MORE — a different concrete piece than piece1 (do not repeat piece1).",
  "full": "2 short sentences that finish cleanly. Do NOT restate piece1/piece2 verbatim — just the missing close.",
  "boardNote": "2-4 written sentences for the board: clarified idea + how to remember/apply (may be fuller than speech)"
}
Rules:
- piece1, piece2, and full must be NON-OVERLAPPING spoken slices — never lecture the same point three times.
- Do NOT refuse or say you can't answer. This IS the close-out — answer them.
- Never start with "You said". Never invent unrelated subjects.
- Do not include "coming back to" / "as promised" intros — the app already adds that.`,
          user: userText,
        })) as {
          piece1?: string;
          piece2?: string;
          full?: string;
          boardNote?: string;
        };
        const piece1 =
          scaffoldJson.piece1?.trim() ||
          (ctx?.highlight
            ? `Start here: ${ctx.highlight}. What would you do with that in an answer?`
            : `Here's the first lever on ${topic}. What's the next step you'd take?`);
        const piece2 =
          scaffoldJson.piece2?.trim() ||
          (ctx?.rememberTip
            ? `Next piece: ${ctx.rememberTip}. Can you finish from there?`
            : `Next piece: apply that lever to the stuck point. Want to try closing it?`);
        const full =
          scaffoldJson.full?.trim() ||
          `Full picture for ${topic}: ${ctx?.rememberTip || ctx?.highlight || "use the marked idea on the board when you answer."}`;
        const boardNote =
          scaffoldJson.boardNote?.trim() ||
          `Parked doubt: ${userText.slice(0, 120)}\n\n${full}`;
        return {
          say: piece1,
          action: "speak",
          showOnBoard: true,
          boardNote,
          topic,
          deferredPieces: { piece1, piece2, full },
        };
      } catch {
        const piece1 = ctx?.highlight
          ? `Start here: ${ctx.highlight}. What's the move you'd make with that?`
          : `Here's the first lever on ${topic}. What's your next step?`;
        const piece2 = ctx?.rememberTip
          ? `Next piece: ${ctx.rememberTip}. Can you finish it?`
          : `Next piece: connect that lever to the stuck point. Try the rest?`;
        const full = `Full picture on ${topic}: ${ctx?.rememberTip || ctx?.highlight || "re-read the marked line and apply that piece when you answer."}`;
        return {
          say: piece1,
          action: "speak",
          showOnBoard: true,
          boardNote: `Parked doubt revisited on ${topic}.\n\n${full}`,
          topic,
          deferredPieces: { piece1, piece2, full },
        };
      }
    }

    try {
      const asideJson = (await completeJson({
        temperature: 0.35,
        system: `You are SeeThrough Voice Tutor mid-lesson clarifier.
Active topic: "${topic}".
Student spoke by voice — may be messy. Never echo their raw words.
${ctxBlock ? `Lesson context:\n${ctxBlock}` : ""}
Return ONLY JSON:
{
  "say": "${partial ? "2 short spoken sentences that PARTIALLY answer their doubt NOW using the lesson context — not a full lecture, not 'look at the marked line' alone" : "2-4 short spoken sentences that clear up THEIR confusion (application-first)"}",
  "boardNote": "${partial ? "omit or empty" : "2-4 sentences for the lesson board: the clarified idea + how to remember/apply it"}"
}
Rules:
- Answer the stuck point using the active topic and lesson context when given.
${
  partial
    ? `- PARTIAL mode (live mid-lesson): give a real but incomplete answer (~half a useful piece) RIGHT NOW.
- Do NOT fully solve it. boardNote must be empty. Do NOT only say 'look at the board'.
- NEVER say you will answer later, at the end, park it, save it, or come back after the lesson. Live doubts get content now.`
    : "- boardNote must be useful written notes, not a transcript of say."
}
- Never start say with "You said" or repeat their question verbatim.`,
        user: userText,
      })) as { say?: string; boardNote?: string };
      let say =
        asideJson.say?.trim() ||
        `Here's the key piece of ${topic} again in plain words.`;
      // Guard: models sometimes slip into park language on live partials.
      if (partial && looksLikeParkLanguage(say)) {
        say = ctx?.highlight
          ? `Here's one piece now: ${ctx.highlight}. Hold onto that — we'll keep building.`
          : `Here's one piece of ${topic} now — use that lever, and we'll keep moving.`;
      }
      const boardNote = partial
        ? undefined
        : asideJson.boardNote?.trim() || say;
      return {
        say,
        action: "speak",
        showOnBoard: !partial,
        boardNote,
        topic,
      };
    } catch {
      if (partial) {
        return {
          say: ctx?.highlight
            ? `Quick piece now: ${ctx.highlight}. We'll keep building from there.`
            : `Quick piece on ${topic} now — stay with the thread and we'll unpack more as we go.`,
          action: "speak",
          showOnBoard: false,
          topic,
        };
      }
      return {
        say: `Here's the idea again for ${topic}: focus on the marked line and how you'd use it in an answer.`,
        action: "speak",
        showOnBoard: true,
        boardNote: `Quick clarify on ${topic}: re-read the highlighted line — that's the piece to apply, not the whole paragraph.`,
        topic,
      };
    }
  }

  if (looksLikeVoiceInjection(userText)) {
    return {
      say: "Let's keep this about what you want to learn. Name a topic — even a messy one is fine.",
      action: "speak",
      showOnBoard: false,
    };
  }

  // Onboarding: never start a lesson from a mumble / filler.
  if (!input.teaching && !input.awaitingFocus && looksLikeMumble(userText)) {
    return {
      say: "I didn't quite catch a topic there. What would you like to learn — even just a subject name is fine.",
      action: "speak",
      showOnBoard: false,
    };
  }

  async function proposeFocus(focus: string, say?: string): Promise<TurnResponse> {
    const cleaned = cleanTopicLabel(focus);
    if (looksLikeFunctions(cleaned)) {
      const plan = normalizePlanTeachFirst(functionsVoicePlan());
      return {
        say: say?.trim() || lockSayForPlan(plan),
        action: "propose_topic",
        topic: plan.topic,
        label: plan.label,
        plan,
        showOnBoard: false,
      };
    }
    // Plan mode path uses buildOpenPlan below once we're in the try; for early
    // awaitingFocus we build a minimal propose and let the workspace plan if needed.
    return {
      say: say?.trim() || spokenTopicLockSay(cleaned),
      action: "propose_topic",
      topic: cleaned,
      label: cleaned,
      showOnBoard: false,
    };
  }

  // After options were offered: pick a focus, or switch to a new topic (nudge-aware).
  if (input.awaitingFocus && !input.teaching) {
    const parent = cleanTopicLabel(input.parentTopic || "this topic");
    const options = (input.focusOptions ?? []).filter(Boolean);
    if (looksLikeMumble(userText)) {
      return {
        say: casualFocusSay(parent, options),
        action: "speak",
        parentTopic: parent,
        focusOptions: options,
        showOnBoard: false,
      };
    }
    if (isTopicSwitchAway(userText, parent, options)) {
      const next = extractTopicFromNudge(userText);
      return buildClarifyForTopic(next, input.avoidedFocusOptions);
    }
    const focus = qualifyFocusWithParent(
      resolveFocusChoice(userText, parent, options) || cleanTopicLabel(userText),
      parent,
    );
    return proposeFocus(focus);
  }

  // Topic switch (or forced re-clarify): ALWAYS offer angles
  // for the 2nd/3rd topic too — never jump straight to propose_topic.
  if (input.preferClarify && !input.teaching) {
    if (looksLikeMumble(userText)) {
      return {
        say: "What topic do you want instead?",
        action: "speak",
        showOnBoard: false,
      };
    }
    return buildClarifyForTopic(
      extractTopicFromNudge(userText) || userText,
      input.avoidedFocusOptions,
    );
  }

  // Mid-lesson chitchat: answer briefly in voice, keep the board on the lesson.
  if (
    input.teaching &&
    input.activeTopic &&
    looksLikeOffTopicChitchat(userText, input.activeTopic)
  ) {
    return {
      say: `I can chat about lots of things, but right now I'm focused on ${input.activeTopic}. Let's stay with that.`,
      action: "redirect",
      showOnBoard: false,
      topic: input.activeTopic,
    };
  }

  // Optional curated seed ONLY when the user clearly asked for math functions / VLT.
  if (looksLikeFunctions(userText) && input.mode === "plan") {
    const plan = normalizePlanTeachFirst(functionsVoicePlan());
    return {
      say: lockSayForPlan(plan),
      action: "propose_topic",
      topic: plan.topic,
      label: plan.label,
      plan,
      showOnBoard: false,
    };
  }

  try {
    async function buildOpenPlan(topic: string): Promise<VoiceLessonPlan> {
      if (looksLikeFunctions(topic)) {
        return normalizePlanTeachFirst(functionsVoicePlan());
      }
      const clean = cleanTopicLabel(topic);
      const physicsBlock = looksLikePhysicsAsk(clean)
        ? `\n${formatPhysicsVoiceContextBlock(buildPhysicsTutorContext(clean))}\n`
        : "";
      // Research before explaining — never guess what an unfamiliar name means.
      const found = await researchTopic(clean);
      const research = researchPromptBlock(clean, found.notes);
      const withSources = (plan: VoiceLessonPlan): VoiceLessonPlan =>
        found.sources.length ? { ...plan, sources: found.sources } : plan;

      // Board diagram is its own small call (parallel) — far more reliable than
      // bolting it onto the lesson JSON.
      const diagramPromise =
        input.diagrams === false
          ? Promise.resolve(null)
          : draftBoardDiagram(clean, research);

      // Simple draft first — much more reliable than a huge beats schema on Groq.
      // A malformed draft falls through to the tighter retry (not the offline stub).
      const draftRaw = await completeJson({
        temperature: 0.45,
        system: `You are a clear, accurate tutor for ANY subject (history, science, math, literature, etc.).
Teach in this exact order: definition → key concepts → one example.
Return ONLY JSON (no tool calls, no markdown):
{
  "topic": string,
  "objective": one sentence,
  "definition": "2-3 short sentences. What it IS, in plain words. After any hard word, say what it means. History: real who/when/what. Science: real meaning. NOT a textbook paragraph. NOT 'here's what X is about'.",
  "keyConcepts": ["one short sentence", "one short sentence", "one short sentence"],
  "example": "3-5 short sentences walking through ONE concrete example. Use real details. Show the definition and the key concepts at work. Do not announce 'for example' — just teach the case.",
  "highlight": "exact 5-14 word phrase copied from definition",
  "rememberTip": "short way to remember the definition",
  "examCue": "one exam-style question",
  "annotations": [
    {
      "targetPhrase": "exact contiguous substring copied from definition (3-12 words)",
      "style": "circle|underline|both",
      "sideNote": "one short apply/remember line",
      "recallQuestion": "application question, not trivia",
      "examCue": "optional formal exam phrasing"
    }
  ],
  "checkAsk": "spoken check: ask for the definition in their words, plus one piece from the example",
  "checkHint": "short hint pointing at the definition",
  "checkSuccess": "short praise",
  "diagramKind": "auto|vfpt_svg|tldraw_sketch|none"
}
keyConcepts MUST be 3 items. Each item is one teaching sentence, not a two-word label like "target market".
Bad keyConcepts: ["Target market", "Positioning", "Promotion"]
Good keyConcepts: ["The target market is who you want to buy.", "Positioning is why they would pick you over someone else.", "Promotion is how you actually reach them."]
Never write generic lines about 'object, rule, or construction' unless the topic is literally math/CS formalism.
Never say "here's what X is about", "let's unpack", or "the marked line".
highlight and every targetPhrase MUST be copied verbatim from definition.
annotations: 1-2 apply-units max.
diagramKind routing (gutter figure — never overlaps the passage):
- vfpt_svg: ONLY for electrostatics / electric fields / point charges / dipoles / capacitors / conductors / image charge. Server rejects if the topic does not match.
- tldraw_sketch: when a small structure/compare sketch helps (processes, parts, relations) and the topic is NOT a VFPt electric-field ask.
- none: circles + text are enough (most history / pure verbal topics).
- auto: let the server choose (preferred default).
Never invent a physics field diagram for non-physics subjects.
${physicsBlock}${research}${annotationFewShotBlock()}`,
        user: `Teach me about: ${clean}`,
      }).catch((error: unknown) => {
        console.warn("[voice-tutor/brain] draft failed, retrying", error);
        return {};
      });

      const diagram = await diagramPromise;
      const draft = draftRaw as LessonDraft;
      if (draftIsUsable(draft)) {
        return withSources(
          normalizePlanTeachFirst(
            planFromDraft({ ...draft, topic: draft.topic || clean, diagram }),
          ),
        );
      }

      // Retry once with an even tighter prompt.
      const retryRaw = await completeJson({
        temperature: 0.3,
        system: `Return JSON only: { "topic", "definition", "keyConcepts", "example", "highlight", "rememberTip", "checkAsk" }.
definition = 2-3 sentences of what it IS. keyConcepts = 3 short teaching sentences. example = one concrete case, 3-5 sentences. For World War II include years, sides, and why it mattered. Never use "here's what X is about".
${research}`,
        user: clean,
      });
      const retry = retryRaw as LessonDraft;
      if (draftIsUsable(retry)) {
        return withSources(
          normalizePlanTeachFirst(
            planFromDraft({ ...retry, topic: retry.topic || clean, diagram }),
          ),
        );
      }

      return normalizePlanTeachFirst(openTopicFallbackPlan(clean));
    }

    if (input.mode === "plan") {
      const plan = await buildOpenPlan(userText);
      return {
        say: lockSayForPlan(plan),
        action: "propose_topic",
        topic: plan.topic,
        label: plan.label,
        plan,
        showOnBoard: false,
      };
    }

    // During an active lesson, keep redirects voice-only when the model flags chitchat.
    if (input.teaching && input.activeTopic) {
      try {
        const gateJson = (await completeJson({
          temperature: 0.2,
          system: `Active lesson topic: "${input.activeTopic}".
Return ONLY JSON: { "offTopic": boolean, "say": string }
- offTopic=true for chitchat / unrelated questions (languages you speak, jokes, weather, identity).
- offTopic=false if the student is engaging the lesson (answers, follow-ups, confusion about the topic).
- If offTopic, say a short redirect that you'll stay focused on the lesson topic, then continue.
- Never put the redirect text as lesson content.
- Voice transcripts may stutter or cut off. Never echo the student's raw words back. Answer the intent; stay on the lesson.`,
          user: userText,
        })) as { offTopic?: boolean; say?: string };
        if (gateJson.offTopic) {
          return {
            say:
              gateJson.say?.trim() ||
              `I'm focused on ${input.activeTopic} right now — let's stay with that.`,
            action: "redirect",
            showOnBoard: false,
            topic: input.activeTopic,
          };
        }
      } catch {
        /* fall through to normal chat */
      }
    }

    // Intake: mumble / chat / need a focus angle / ready to plan a specific focus.
    // Vague / fresh "random…" asks: skip history so prior topics (Java, names) can't bleed in.
    const vagueNow =
      looksLikeVagueTopic(userText) ||
      looksLikeVagueTopic(stripTopicIntensifiers(userText));
    if (vagueNow) {
      return buildClarifyForTopic(userText, input.avoidedFocusOptions);
    }

    const historyBlock = input.messages
      .slice(-8)
      .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.text}`)
      .join("\n");
    const alreadyAskedFocus = /focus on|which angle|what specific|A\)|1\)/i.test(
      historyBlock,
    );

    const intake = (await completeJson({
      temperature: 0.2,
      system: `You are SeeThrough Voice Tutor topic intake (NOT teaching yet).
The student is speaking by voice — transcripts may contain stutters, filler words, or incomplete thoughts.
Return ONLY JSON:
{
  "clarity": "mumble" | "chat" | "need_focus" | "ready",
  "say": ONE short spoken sentence (max ~20 words),
  "topic": string | omit,
  "parentTopic": string | omit,
  "focusOptions": string[] | omit,
  "label": string | omit
}
Rules:
- mumble: unclear filler → ask what they want to learn.
- chat: greeting / small talk → short nudge toward a topic.
- need_focus: ONLY if they named a brand-new BROAD real subject (e.g. physics, Java) AND you have NOT already asked for a focus. Set parentTopic only.
- ready: they named a specific focus, chose an option, OR you already asked for focus and they answered anything substantive → set topic to that focus NOW. Do NOT ask again.
- If they said vague words like "random things", "random ass things", "anything", "stuff" → clarity=chat and ask them to name a real subject. Do NOT invent Java, person names (Megan, etc.), or any other subject.
- If recent turns already asked for focus, clarity MUST be ready (or mumble), never need_focus.
- Never invent a lesson from noise. Never mention UI. Never say "1)" or "option 2".
- Never invent people's names as topics.
- Never repeat the student's words verbatim. Extract the topic/intent and respond naturally.
- topic / parentTopic must be the clean concept name only (e.g. "astrophysics"), NEVER phrases like "I want to learn…".
- say must never paste the student's raw transcript; if naming the topic, use the clean concept only.
- NEVER pull subjects or names from earlier chat history into a new topic.`,
      user: `${historyBlock ? `Recent turns:\n${historyBlock}\n\n` : ""}Student: ${userText}`,
    })) as {
      clarity?: string;
      say?: string;
      topic?: string;
      parentTopic?: string;
      focusOptions?: string[];
      label?: string;
    };

    let clarity = intake.clarity ?? "chat";
    if (alreadyAskedFocus && clarity === "need_focus") {
      clarity = "ready";
    }

    if (clarity === "mumble" || looksLikeMumble(userText)) {
      return {
        say:
          intake.say?.trim() ||
          "I didn't quite catch a topic. What would you like to learn?",
        action: "speak",
        showOnBoard: false,
      };
    }

    if (
      looksLikeVagueTopic(userText) ||
      looksLikeVagueTopic(intake.topic || "") ||
      looksLikeVagueTopic(intake.parentTopic || "")
    ) {
      return buildClarifyForTopic(
        cleanTopicLabel(intake.parentTopic || intake.topic || userText),
        input.avoidedFocusOptions,
      );
    }

    if (clarity === "need_focus") {
      const parent =
        cleanTopicLabel(intake.parentTopic || intake.topic || userText);
      // Always generate dynamic content angles (never theory/apps shells).
      return buildClarifyForTopic(parent, input.avoidedFocusOptions);
    }

    if (clarity === "ready" || alreadyAskedFocus) {
      const focus = cleanTopicLabel(
        intake.topic || userText,
      );
      if (
        looksLikeVagueTopic(focus) ||
        looksLikeInventedPersonTopic(focus) ||
        looksLikeInventedPersonTopic(intake.topic || "")
      ) {
        return buildClarifyForTopic(
          looksLikeInventedPersonTopic(focus) ? userText : focus,
          input.avoidedFocusOptions,
        );
      }
      if (looksLikeFunctions(focus)) {
        const plan = normalizePlanTeachFirst(functionsVoicePlan());
        return {
          say: lockSayForPlan(plan),
          action: "propose_topic",
          topic: plan.topic,
          label: plan.label,
          plan,
          showOnBoard: false,
        };
      }
      const plan = await buildOpenPlan(focus);
      return {
        say: lockSayForPlan(plan),
        action: "propose_topic",
        topic: plan.topic,
        label: cleanTopicLabel(intake.label || plan.label || plan.topic),
        plan,
        showOnBoard: false,
      };
    }

    // Chat / nudge — never speak the raw transcript back.
    const chatSay = intake.say?.trim() || "";
    const echoesUser =
      chatSay.length > 0 &&
      (chatSay.toLowerCase().includes(userText.toLowerCase().slice(0, 24)) ||
        /\bi want to learn\b/i.test(chatSay));
    return {
      say: echoesUser || !chatSay
        ? "Tell me the topic in a few words — like astrophysics or World War II — and we'll pick a clear focus."
        : chatSay,
      action: "speak",
      showOnBoard: false,
    };
  } catch (error) {
    console.warn("[voice-tutor/brain]", error);
  }

  // Mid-lesson: never invent a new topic offline — redirect voice-only and keep the board.
  if (input.teaching && input.activeTopic) {
    return {
      say: `I'm focused on ${input.activeTopic} right now — let's stay with that.`,
      action: "redirect",
      showOnBoard: false,
      topic: input.activeTopic,
    };
  }

  // Offline: ask for clarity — do NOT invent a lesson from unknown speech.
  if (looksLikeMumble(userText)) {
    return {
      say: "I didn't catch that clearly. What topic do you want to learn?",
      action: "speak",
      showOnBoard: false,
    };
  }

  if (looksLikeFunctions(userText)) {
    const plan = normalizePlanTeachFirst(functionsVoicePlan());
    return {
      say: lockSayForPlan(plan),
      action: "propose_topic",
      topic: plan.topic,
      label: plan.label,
      plan,
      showOnBoard: false,
    };
  }

  // Explicit plan requests (smoke / API) still get a fallback lesson offline.
  if (input.mode === "plan") {
    const plan = normalizePlanTeachFirst(
      openTopicFallbackPlan(cleanTopicLabel(userText)),
    );
    return {
      say: lockSayForPlan(plan),
      action: "propose_topic",
      topic: plan.topic,
      label: plan.label,
      plan,
      showOnBoard: false,
    };
  }

  // Broad offline guess → clarify, never auto-plan filler lessons.
  const parent = cleanTopicLabel(userText);
  if (parent.split(/\s+/).length <= 3) {
    return buildClarifyForTopic(parent, input.avoidedFocusOptions);
  }

  return {
    say: "Tell me any topic — math, physics, code, history, whatever you're stuck on — and we'll lock a clear focus.",
    action: "speak",
    showOnBoard: false,
  };
}

export async function planVoiceLesson(topic: string): Promise<VoiceLessonPlan> {
  const result = await runVoiceTurn({
    mode: "plan",
    userText: topic,
    messages: [],
  });
  if (result.plan) return result.plan;
  return openTopicFallbackPlan(topic);
}
