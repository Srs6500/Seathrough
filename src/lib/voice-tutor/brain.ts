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
  MAX_TOPIC_CYCLES,
  TOPIC_LOCK_SECONDS,
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
  TOPIC_LOCK_SECONDS,
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
  explanation: string;
  deepen?: string;
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
  /** Optional multi-marks; each targetPhrase must be copied from explanation. */
  annotations?: Array<{
    targetPhrase?: string;
    style?: "circle" | "underline" | "both";
    sideNote?: string;
    recallQuestion?: string;
    examCue?: string;
  }>;
};

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

function planFromDraft(draft: LessonDraft): VoiceLessonPlan {
  const clean = cleanTopicLabel(draft.topic || "this topic");
  const explanation = draft.explanation.trim();
  const deepen = (draft.deepen || explanation).trim();
  const highlight =
    pickHighlight(explanation, clean, draft.highlight) ||
    pickHighlight(explanation, clean);
  const rememberTip =
    draft.rememberTip?.trim() ||
    `Keep the highlighted fact about ${clean} in one short phrase.`;
  const examCue = draft.examCue?.trim() || `What is important about ${clean}?`;
  const keyPoints =
    draft.keyPoints?.filter(Boolean).slice(0, 4) ||
    ["Main fact", "Why it matters", "One example or episode"];
  const draftAnnotations = normalizeBoardAnnotations(explanation, {
    annotations: Array.isArray(draft.annotations) ? draft.annotations : undefined,
    highlight,
    rememberTip,
    examCue,
    pointer: "both",
  });
  const diagramPolicy = diagramPolicyFromDraft(draft);
  const openDraw = drawPolicyStub(diagramPolicy);

  return {
    topic: clean,
    label: clean.slice(0, 48),
    objective: draft.objective?.trim() || `Understand ${clean}`,
    beats: [
      {
        id: "open_1",
        say: `Here's what ${clean} is about.`,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sourceText: explanation,
          highlight,
          rememberTip,
          examCue,
          pointer: "both",
          keyPoints,
          annotations: draftAnnotations,
        },
        draw: openDraw,
      },
      {
        id: "open_2",
        say:
          draft.exampleSay?.trim() ||
          `Let's push one step further on ${clean}.`,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sourceText: deepen,
          highlight:
            pickHighlight(deepen, clean, draft.highlight) || highlight,
          rememberTip,
          examCue,
          pointer: "both",
          keyPoints,
          annotations: draftAnnotations,
        },
        draw: { kind: "none", highlightIds: [] },
      },
      {
        id: "open_3",
        say: `That's the piece to keep: the marked line, plus this way to remember it.`,
        expectAnswer: false,
        rubricKeywords: [],
        board: {
          formalStatement: clean,
          sourceText: explanation,
          highlight,
          rememberTip,
          examCue,
          pointer: "both",
          keyPoints,
          annotations: draftAnnotations,
        },
        draw: { kind: "none", highlightIds: [] },
      },
      {
        id: "open_4",
        say:
          draft.checkAsk?.trim() ||
          `Quick check — in your own words, what should someone know about ${clean}?`,
        expectAnswer: true,
        rubricKeywords: clean
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .slice(0, 5),
        hintSay:
          draft.checkHint?.trim() ||
          "Include the main fact and why it matters.",
        successSay:
          draft.checkSuccess?.trim() ||
          "Good — that shows you understood the idea, not just the name.",
        board: {
          formalStatement: clean,
          sourceText: explanation,
          highlight,
          rememberTip,
          examCue,
          pointer: "circle",
          keyPoints,
          annotations: draftAnnotations,
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
              ? fromBoard.slice(0, 280)
              : `Here's the idea behind ${topic}: ${beat.say.replace(/\?+$/, ".")}`,
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
            ? fromBoard.slice(0, 280)
            : `Before I check you — ${topic} means this: focus on the core definition and one clear example.`
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
  return spokenTopicLockSay(plan.topic, TOPIC_LOCK_SECONDS, {
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
- Last option should be a short overview chip like "big picture of ${parent}" or "intro to ${parent}" (never "general ${parent}").
- ${avoidedBlock}
- No numbers. No full sentences.`,
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
  /** After a countdown interrupt — always offer subtopics for the new topic. */
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
        lockSeconds: TOPIC_LOCK_SECONDS,
        plan,
        showOnBoard: false,
      };
    }
    // Plan mode path uses buildOpenPlan below once we're in the try; for early
    // awaitingFocus we build a minimal propose and let the workspace plan if needed.
    return {
      say: say?.trim() || spokenTopicLockSay(cleaned, TOPIC_LOCK_SECONDS),
      action: "propose_topic",
      topic: cleaned,
      label: cleaned,
      lockSeconds: TOPIC_LOCK_SECONDS,
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

  // Topic switch mid-countdown (or forced re-clarify): ALWAYS offer angles
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
      lockSeconds: TOPIC_LOCK_SECONDS,
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

      // Simple draft first — much more reliable than a huge beats schema on Groq.
      const draftRaw = await completeJson({
        temperature: 0.45,
        system: `You are a clear, accurate tutor for ANY subject (history, science, math, literature, etc.).
Return ONLY JSON (no tool calls, no markdown):
{
  "topic": string,
  "objective": one sentence,
  "explanation": "3-5 sentences of REAL factual explanation a good teacher would give. History must include real historical facts (who/when/what/why). Science must include real scientific meaning. NEVER write generic lines about 'object, rule, or construction', 'solving a problem', or 'reasoning becomes valid' unless the topic is literally math/CS formalism.",
  "deepen": "2-4 more sentences that add a concrete example, episode, cause, or consequence.",
  "highlight": "exact 5-14 word phrase copied from explanation (a fact worth underlining)",
  "rememberTip": "short way to remember THAT highlighted fact",
  "examCue": "one exam-style question about the highlight",
  "annotations": [
    {
      "targetPhrase": "exact contiguous substring copied from explanation (3-12 words)",
      "style": "circle|underline|both",
      "sideNote": "one short apply/remember line",
      "recallQuestion": "application question, not trivia",
      "examCue": "optional formal exam phrasing"
    }
  ],
  "keyPoints": ["3 short bullets"],
  "exampleSay": "one spoken sentence introducing the example/deepen part",
  "checkAsk": "spoken check question",
  "checkHint": "short hint",
  "checkSuccess": "short praise if correct",
  "diagramKind": "auto|vfpt_svg|tldraw_sketch|none"
}
Write like Smart Tutor: plain, specific, true. No filler pedagogy.
highlight = the one clause a confused student needs circled to *understand the idea* (not a textbook keyword, not "definition"). Prefer "what it is / why it matters / how it works" in plain words.
annotations: 1-2 apply-units max. Every targetPhrase MUST be copied verbatim from explanation. Prefer short apply/condition spans.
diagramKind routing (gutter figure — never overlaps the passage):
- vfpt_svg: ONLY for electrostatics / electric fields / point charges / dipoles / capacitors / conductors / image charge. Server rejects if the topic does not match.
- tldraw_sketch: when a small structure/compare sketch helps (processes, parts, relations) and the topic is NOT a VFPt electric-field ask.
- none: circles + text are enough (most history / pure verbal topics).
- auto: let the server choose (preferred default).
Never invent a physics field diagram for non-physics subjects.
${annotationFewShotBlock()}`,
        user: `Teach me about: ${clean}`,
      });

      const draft = draftRaw as LessonDraft;
      if (
        typeof draft?.explanation === "string" &&
        draft.explanation.trim().length > 60 &&
        !isMetaPedagogyText(draft.explanation)
      ) {
        return normalizePlanTeachFirst(
          planFromDraft({ ...draft, topic: draft.topic || clean }),
        );
      }

      // Retry once with an even tighter prompt.
      const retryRaw = await completeJson({
        temperature: 0.3,
        system: `Return JSON only: { "topic", "explanation", "deepen", "highlight", "rememberTip", "examCue", "keyPoints", "checkAsk" }.
explanation = 3-5 factual sentences about the topic. For World War II include years, sides, and why it mattered. Never use template phrases about solving problems.`,
        user: clean,
      });
      const retry = retryRaw as LessonDraft;
      if (
        typeof retry?.explanation === "string" &&
        retry.explanation.trim().length > 60 &&
        !isMetaPedagogyText(retry.explanation)
      ) {
        return normalizePlanTeachFirst(
          planFromDraft({ ...retry, topic: retry.topic || clean }),
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
        lockSeconds: TOPIC_LOCK_SECONDS,
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
          lockSeconds: TOPIC_LOCK_SECONDS,
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
        lockSeconds: TOPIC_LOCK_SECONDS,
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
      lockSeconds: TOPIC_LOCK_SECONDS,
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
      lockSeconds: TOPIC_LOCK_SECONDS,
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
