import OpenAI from "openai";
import { getLlmConfig } from "@/lib/env";
import {
  actPlanSchema,
  teachPlanSchema,
  type ActPlanParsed,
  type TeachPlanParsed,
} from "@/lib/browser-experience/schemas";
import type {
  BrowserActQuestion,
  BrowserChatMessage,
  BrowserTeachBeat,
} from "@/lib/browser-experience/types";
import type { LessonSource } from "@/types/lesson";

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    /* continue */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return JSON.parse(fence[1].trim()) as unknown;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }
  throw new Error("invalid json");
}

function failedGeneration(error: unknown): string | undefined {
  if (!(error instanceof OpenAI.APIError)) return undefined;
  const body = error.error as { failed_generation?: unknown } | undefined;
  return typeof body?.failed_generation === "string"
    ? body.failed_generation
    : undefined;
}

function messageText(message: {
  content?: unknown;
  reasoning?: unknown;
}): string {
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) =>
        typeof part === "object" && part && "text" in part
          ? String((part as { text?: string }).text ?? "")
          : "",
      )
      .join("")
      .trim();
    if (joined) return joined;
  }
  return "";
}

async function completeJson(system: string, user: string): Promise<unknown> {
  const config = getLlmConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const groq = config.provider === "groq";

  const request = (jsonMode: boolean) =>
    client.chat.completions.create({
      model: config.model,
      temperature: 0.2,
      // Reasoning models spend budget on hidden chain-of-thought first.
      max_tokens: groq ? 4096 : 2200,
      ...(groq
        ? { reasoning_effort: "low" as const, include_reasoning: false }
        : {}),
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        {
          role: "system",
          content: jsonMode
            ? system
            : `${system}\n\nReturn a single JSON object only. No markdown fences.`,
        },
        { role: "user", content: user },
      ],
    });

  let content = "";
  try {
    const completion = await request(true);
    content = messageText(completion.choices[0]?.message ?? {});
  } catch (error) {
    const refused = failedGeneration(error);
    if (refused) {
      try {
        return extractJsonObject(refused);
      } catch {
        /* retry without json mode below */
      }
    } else if (!(error instanceof OpenAI.APIError)) {
      throw error;
    }
  }

  if (!content.trim()) {
    const completion = await request(false);
    content = messageText(completion.choices[0]?.message ?? {});
  }

  if (!content.trim()) {
    throw new Error("empty model response");
  }
  return extractJsonObject(content);
}

const SYSTEM = `You are SeeThrough Browser Tutor.
You teach on a real webpage with a Zoom-style tutor cursor. You may also click links/buttons when needed.

Return ONLY a JSON object with this shape:
{
  "title": "short title",
  "summary": "1-2 sentence overview",
  "beats": [
    {
      "id": "b1",
      "speech": "short spoken line, max 2 sentences",
      "annotation": {
        "kind": "highlight" | "click" | "clear",
        "text": "exact short label from POINTABLE ANCHORS or PAGE TEXT",
        "label": "optional short callout",
        "seconds": 0
      },
      "holdMs": 900
    }
  ]
}

Rules:
- 4 to 7 beats. Prefer pointing at DIFFERENT parts/sections.
- Use kind "highlight" to point. Use kind "click" when the student needs a tab, accordion, "show more", or in-page link opened (text = visible button/link label).
- annotation.text MUST be copied VERBATIM from POINTABLE ANCHORS (same spelling/casing). Never invent labels.
- Prefer short concrete labels (2–6 words) that appear on the page.
- speech: clear tutor voice, 1–2 short sentences, tie the highlight to the QUESTION. No filler (“basically”, “as you can see”).
- First beat orients on the page; middle beats teach; last beat wraps up.
- JSON only.`;

const YOUTUBE_SYSTEM = `You are SeeThrough Browser Tutor for YouTube.
You teach by seeking to the most relevant moments, pausing, and explaining.

Return ONLY JSON:
{
  "title": "short title",
  "summary": "1-2 sentence overview",
  "beats": [
    {
      "id": "b1",
      "speech": "short spoken line",
      "annotation": {
        "kind": "youtube_play" | "youtube_seek" | "youtube_pause" | "clear",
        "seconds": 35,
        "label": "optional"
      },
      "holdMs": 1200
    }
  ]
}

Rules:
- 5 to 8 beats.
- Beat 1 MUST be youtube_seek to the first on-topic moment (not 0 unless the intro is the topic). Include seconds.
- Then youtube_play briefly, then more youtube_seek beats at increasing timestamps.
- Every youtube_seek MUST include integer seconds under DURATION_SECONDS when known.
- Prefer moments that answer the QUESTION; skip unrelated chapters.
- speech: 1–2 short sentences about what is on screen at that timestamp.
- End with youtube_pause wrap-up.
- JSON only.`;

function pickPhrases(
  pageText: string,
  anchors: string[],
  limit = 5,
): string[] {
  const fromAnchors = anchors
    .map((a) => a.trim())
    .filter((a) => a.length >= 3 && a.length <= 60)
    .slice(0, limit);
  if (fromAnchors.length >= 2) return fromAnchors;

  const sentences = pageText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 40 && s.length <= 220);
  const phrases: string[] = [...fromAnchors];
  for (const sentence of sentences) {
    const words = sentence.split(" ").filter(Boolean);
    if (words.length < 4) continue;
    const slice = words.slice(0, Math.min(8, words.length)).join(" ");
    if (!phrases.includes(slice)) phrases.push(slice);
    if (phrases.length >= limit) break;
  }
  if (!phrases.length) {
    const words = pageText.split(/\s+/).filter(Boolean).slice(0, 8);
    if (words.length >= 3) phrases.push(words.join(" "));
  }
  return phrases;
}

/** Deterministic backup when the model returns unusable JSON. */
export function fallbackTeachPlan(input: {
  question: string;
  source: LessonSource;
  pageTitle: string;
  pageText: string;
  anchors?: string[];
}): TeachPlanParsed {
  const phrases = pickPhrases(input.pageText, input.anchors ?? [], 5);
  const title = clip(input.pageTitle || input.source.title || "Browser lesson", 160);
  const summary = clip(
    `Using ${input.source.publisher}, here is what matters for: ${input.question}`,
    600,
  );
  const beats =
    phrases.length > 0
      ? phrases.map((text, index) => ({
          id: `b${index + 1}`,
          speech: clip(
            index === 0
              ? `Let's start with this part of the page: ${text}.`
              : index === phrases.length - 1
                ? `Finally, notice ${text} — that rounds out the picture.`
                : `Next, look at ${text}.`,
            500,
          ),
          annotation: {
            kind: "highlight" as const,
            text,
            label: text,
          },
          holdMs: 1100,
        }))
      : [
          {
            id: "b1",
            speech: clip(
              `I opened ${input.source.publisher}. Ask a follow-up and I will point to the exact lines.`,
              500,
            ),
            annotation: { kind: "clear" as const },
            holdMs: 900,
          },
        ];

  return teachPlanSchema.parse({ title, summary, beats });
}

const ACTION_KINDS = new Set([
  "highlight",
  "circle",
  "clear",
  "click",
  "youtube_play",
  "youtube_pause",
  "youtube_seek",
]);

function normalizeAnnotation(value: unknown): {
  kind:
    | "highlight"
    | "circle"
    | "clear"
    | "click"
    | "youtube_play"
    | "youtube_pause"
    | "youtube_seek";
  text?: string;
  selector?: string;
  label?: string;
  seconds?: number;
} {
  if (!value || typeof value !== "object") return { kind: "clear" };
  const a = value as Record<string, unknown>;
  const kindRaw = String(a.kind ?? "highlight").toLowerCase();
  const kind = ACTION_KINDS.has(kindRaw)
    ? (kindRaw as
        | "highlight"
        | "circle"
        | "clear"
        | "click"
        | "youtube_play"
        | "youtube_pause"
        | "youtube_seek")
    : "highlight";
  const text =
    typeof a.text === "string" && a.text.trim()
      ? clip(a.text, 400)
      : undefined;
  const selector =
    typeof a.selector === "string" && a.selector.trim()
      ? clip(a.selector, 300)
      : undefined;
  const label =
    typeof a.label === "string" && a.label.trim()
      ? clip(a.label, 160)
      : undefined;
  const secondsRaw = a.seconds ?? a.time ?? a.t;
  const seconds =
    typeof secondsRaw === "number"
      ? secondsRaw
      : typeof secondsRaw === "string" && Number.isFinite(Number(secondsRaw))
        ? Number(secondsRaw)
        : undefined;

  if (kind === "youtube_play" || kind === "youtube_pause") {
    return { kind, ...(label ? { label } : {}) };
  }
  if (kind === "youtube_seek") {
    return {
      kind,
      seconds: Math.max(0, Math.floor(seconds ?? 0)),
      ...(label ? { label } : {}),
    };
  }
  if (kind === "clear") return { kind: "clear" };
  if (!text && !selector) return { kind: "clear" };
  return {
    kind,
    ...(text ? { text } : {}),
    ...(selector ? { selector } : {}),
    ...(label ? { label } : {}),
  };
}

function normalizePlan(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const rawBeats = Array.isArray(obj.beats)
    ? obj.beats
    : Array.isArray(obj.steps)
      ? obj.steps
      : [];

  const beats = rawBeats
    .map((beat, index) => {
      if (!beat || typeof beat !== "object") return null;
      const b = beat as Record<string, unknown>;
      const speech =
        typeof b.speech === "string"
          ? b.speech
          : typeof b.narration === "string"
            ? b.narration
            : typeof b.text === "string"
              ? b.text
              : "";
      const trimmedSpeech = clip(speech, 500);
      if (!trimmedSpeech) return null;
      const holdRaw = b.holdMs ?? b.hold_ms ?? b.pauseMs;
      const holdMs =
        typeof holdRaw === "number"
          ? holdRaw
          : typeof holdRaw === "string" && Number.isFinite(Number(holdRaw))
            ? Number(holdRaw)
            : 900;
      return {
        id:
          typeof b.id === "string" && b.id.trim()
            ? clip(b.id, 40)
            : `b${index + 1}`,
        speech: trimmedSpeech,
        holdMs: Math.max(0, Math.min(20_000, Math.round(holdMs))),
        annotation: normalizeAnnotation(b.annotation ?? b.highlight ?? b.mark),
      };
    })
    .filter(Boolean);

  return {
    title: clip(
      typeof obj.title === "string" && obj.title.trim()
        ? obj.title
        : "Browser lesson",
      160,
    ),
    summary: clip(
      typeof obj.summary === "string" && obj.summary.trim()
        ? obj.summary
        : typeof obj.overview === "string" && obj.overview.trim()
          ? obj.overview
          : "Here is what this page is saying.",
      600,
    ),
    beats,
  };
}

function fallbackYouTubePlan(input: {
  question: string;
  source: LessonSource;
  pageTitle: string;
  durationSec?: number | null;
}): TeachPlanParsed {
  const duration = input.durationSec && input.durationSec > 30 ? input.durationSec : 240;
  const marks = [25, 55, 95, 140, 190]
    .map((s) => Math.min(s, Math.max(8, duration - 5)))
    .filter((s, i, arr) => i === 0 || s > arr[i - 1]!);
  const title = clip(input.pageTitle || input.source.title || "YouTube lesson", 160);
  const summary = clip(
    `We'll jump to the parts of this video that matter for: ${input.question}`,
    600,
  );
  const first = marks[0] ?? 20;
  const beats = [
    {
      id: "b1",
      speech: clip(
        `Jumping to ${first}s — a moment that should relate to your question.`,
        500,
      ),
      annotation: {
        kind: "youtube_seek" as const,
        seconds: first,
        label: `${first}s`,
      },
      holdMs: 1400,
    },
    {
      id: "b2",
      speech: "I'll play from here, then pause on the next key spots.",
      annotation: { kind: "youtube_play" as const },
      holdMs: 1600,
    },
    ...marks.slice(1).map((seconds, index) => ({
      id: `b${index + 3}`,
      speech: clip(
        index === marks.length - 2
          ? "That covers the main idea from this clip for your question."
          : `Here's another useful moment for your question — pausing so we can look.`,
        500,
      ),
      annotation: {
        kind: "youtube_seek" as const,
        seconds,
        label: `${seconds}s`,
      },
      holdMs: 1400,
    })),
  ];
  return teachPlanSchema.parse({ title, summary, beats });
}

/** Ensure Ground video plans always seek before long play. */
export function ensureYouTubeSeeks(plan: TeachPlanParsed): TeachPlanParsed {
  const hasSeek = plan.beats.some((b) => b.annotation.kind === "youtube_seek");
  if (hasSeek) {
    const first = plan.beats[0];
    if (first && first.annotation.kind !== "youtube_seek") {
      const seekBeat = plan.beats.find((b) => b.annotation.kind === "youtube_seek");
      if (seekBeat) {
        const rest = plan.beats.filter((b) => b.id !== seekBeat.id);
        return {
          ...plan,
          beats: [
            {
              ...seekBeat,
              id: "b1",
              speech:
                seekBeat.speech ||
                "Jumping to a relevant moment in the video first.",
            },
            ...rest.map((b, i) => ({ ...b, id: `b${i + 2}` })),
          ],
        };
      }
    }
    return plan;
  }
  return {
    ...plan,
    beats: [
      {
        id: "b0",
        speech: "Jumping to a relevant moment in the video first.",
        annotation: { kind: "youtube_seek", seconds: 25, label: "25s" },
        holdMs: 1200,
      },
      ...plan.beats,
    ],
  };
}

export async function planBrowserLesson(input: {
  question: string;
  source: LessonSource;
  pageTitle: string;
  pageUrl: string;
  pageText: string;
  anchors?: string[];
  hasLargeFigure?: boolean;
  isYouTube?: boolean;
  durationSec?: number | null;
  history?: BrowserChatMessage[];
  followUp?: boolean;
}): Promise<TeachPlanParsed> {
  const historyBlock =
    input.history && input.history.length
      ? input.history
          .slice(-8)
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n")
      : "";

  const anchors = input.anchors ?? [];

  if (input.isYouTube) {
    const user = [
      input.followUp ? "MODE: follow-up on this video" : "MODE: first video explanation",
      `QUESTION: ${input.question}`,
      `VIDEO TITLE: ${input.pageTitle}`,
      `VIDEO URL: ${input.pageUrl}`,
      `DESCRIPTION/EXCERPT: ${input.source.excerpt}`,
      input.durationSec ? `DURATION_SECONDS: ${input.durationSec}` : "",
      historyBlock ? `CHAT:\n${historyBlock}` : "",
      `PAGE TEXT / DESCRIPTION:\n${input.pageText.slice(0, 4_000)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const raw = await completeJson(YOUTUBE_SYSTEM, user);
      const plan = teachPlanSchema.safeParse(normalizePlan(raw));
      if (plan.success) return ensureYouTubeSeeks(plan.data);
    } catch (error) {
      console.warn(
        "[browser-experience] youtube plan failed",
        error instanceof Error ? error.message : error,
      );
    }
    return ensureYouTubeSeeks(fallbackYouTubePlan(input));
  }

  const user = [
    input.followUp
      ? "MODE: follow-up on the same page"
      : "MODE: first explanation",
    `QUESTION: ${input.question}`,
    `SOURCE TITLE: ${input.source.title}`,
    `SOURCE URL: ${input.source.url}`,
    `SOURCE EXCERPT: ${input.source.excerpt}`,
    `PAGE TITLE: ${input.pageTitle}`,
    `PAGE URL: ${input.pageUrl}`,
    input.hasLargeFigure
      ? "PAGE HAS A LARGE DIAGRAM/FIGURE — walk part-by-part using anchors so the cursor moves."
      : "",
    anchors.length
      ? `POINTABLE ANCHORS (prefer these verbatim for annotation.text):\n${anchors
          .slice(0, 30)
          .map((a) => `- ${a}`)
          .join("\n")}`
      : "",
    historyBlock ? `CHAT:\n${historyBlock}` : "",
    `PAGE TEXT:\n${input.pageText.slice(0, 8_000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await completeJson(SYSTEM, user);
    const plan = teachPlanSchema.safeParse(normalizePlan(raw));
    if (plan.success) return rewriteBeatsToAnchors(plan.data, anchors);
    console.warn(
      "[browser-experience] teach plan schema failed",
      plan.error.issues.slice(0, 4),
    );
  } catch (error) {
    console.warn(
      "[browser-experience] teach plan LLM failed",
      error instanceof Error ? error.message : error,
    );
  }

  return fallbackTeachPlan(input);
}

/** If the model invents labels, snap annotation.text onto the closest real anchor. */
function rewriteBeatsToAnchors(
  plan: TeachPlanParsed,
  anchors: string[],
): TeachPlanParsed {
  if (!anchors.length) return plan;
  const normalized = anchors.map((a) => ({
    raw: a,
    key: a.toLowerCase(),
  }));
  const beats = plan.beats.map((beat) => {
    const text = beat.annotation.text?.trim();
    if (!text) return beat;
    const key = text.toLowerCase();
    const exact = normalized.find((a) => a.key === key);
    if (exact) {
      return {
        ...beat,
        annotation: {
          ...beat.annotation,
          text: exact.raw,
          label: beat.annotation.label || exact.raw,
        },
      };
    }
    const partial = normalized.find(
      (a) => a.key.includes(key) || key.includes(a.key),
    );
    if (partial) {
      return {
        ...beat,
        annotation: {
          ...beat.annotation,
          text: partial.raw,
          label: beat.annotation.label || partial.raw,
        },
      };
    }
    return {
      ...beat,
      annotation: {
        ...beat.annotation,
        label: beat.annotation.label || text,
      },
    };
  });
  return { ...plan, beats };
}

export function beatsFromPlan(
  plan: TeachPlanParsed,
  role?: "ground" | "truth",
  tabId?: string,
): BrowserTeachBeat[] {
  return plan.beats.map((beat) => ({
    id: role ? `${role}-${beat.id}` : beat.id,
    speech: beat.speech,
    annotation: beat.annotation,
    holdMs: beat.holdMs ?? 900,
    ...(role ? { role } : {}),
    ...(tabId ? { tabId } : {}),
  }));
}

const ACT_SYSTEM = `You write short multiple-choice checks after a browser lesson.
Return ONLY JSON:
{
  "questions": [
    {
      "id": "q1",
      "prompt": "short question",
      "choices": ["A", "B", "C"],
      "answerIndex": 0
    }
  ]
}
Rules:
- Exactly 2 or 3 questions.
- Each has 3 choices; answerIndex is 0, 1, or 2.
- Ground answers in PAGE TEXT / SOURCE only — no invented facts.
- Keep prompts under 120 characters.
- JSON only.`;

function fallbackActPlan(input: {
  question: string;
  pageTitle: string;
  pageText: string;
}): ActPlanParsed {
  const phrases = pickPhrases(input.pageText, [], 3);
  const topic = clip(input.pageTitle || input.question, 80);
  const decoys = [
    "It is unrelated to this topic.",
    "It only happens in outer space.",
    "It was invented last week.",
  ];
  const questions =
    phrases.length >= 2
      ? phrases.slice(0, 2).map((phrase, index) => ({
          id: `q${index + 1}`,
          prompt: clip(`What does this lesson say about: ${phrase}?`, 400),
          choices: [
            clip(`It matters for understanding ${topic}.`, 200),
            decoys[index % decoys.length]!,
            "The page does not mention it.",
          ],
          answerIndex: 0,
        }))
      : [
          {
            id: "q1",
            prompt: clip(`What was this page mainly about?`, 400),
            choices: [
              clip(topic, 200),
              "An unrelated sports scoreboard",
              "A cooking recipe only",
            ],
            answerIndex: 0,
          },
          {
            id: "q2",
            prompt: "What should you do next if you are still unsure?",
            choices: [
              "Ask a follow-up about this page",
              "Ignore the explanation",
              "Close the browser forever",
            ],
            answerIndex: 0,
          },
        ];
  return actPlanSchema.parse({ questions });
}

export async function planActChecks(input: {
  question: string;
  pageTitle: string;
  pageText: string;
  source?: LessonSource | null;
}): Promise<BrowserActQuestion[]> {
  const user = [
    `QUESTION: ${input.question}`,
    `PAGE TITLE: ${input.pageTitle}`,
    input.source
      ? `SOURCE: ${input.source.title} (${input.source.publisher})`
      : "",
    `PAGE TEXT:\n${input.pageText.slice(0, 6_000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await completeJson(ACT_SYSTEM, user);
    const parsed = actPlanSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data.questions.map((q) => ({
        ...q,
        answerIndex: Math.min(q.answerIndex, q.choices.length - 1),
      }));
    }
  } catch (error) {
    console.warn(
      "[browser-experience] act plan failed",
      error instanceof Error ? error.message : error,
    );
  }
  return fallbackActPlan(input).questions;
}

/** Cap beat count for a Ground intro so Truth stays the main walkthrough. */
export function limitBeats(
  beats: BrowserTeachBeat[],
  max: number,
): BrowserTeachBeat[] {
  if (beats.length <= max) return beats;
  return beats.slice(0, max);
}
