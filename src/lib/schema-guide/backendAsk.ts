import OpenAI from "openai";
import { envPresence, getLlmConfig } from "@/lib/env";
import {
  guideBackend,
  scenarioPath,
} from "@/lib/schema-guide/backendStory";
import type {
  BackendAskResult,
  BackendFeature,
  FactOrigin,
  SchemaAskStep,
  SchemaGuide,
} from "@/lib/schema-guide/types";

const STOP = new Set([
  "how",
  "can",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "what",
  "when",
  "where",
  "does",
  "did",
  "are",
  "was",
  "you",
  "your",
  "our",
  "app",
  "someone",
  "happens",
]);

const HINTS: Array<{ id: string; match: RegExp }> = [
  { id: "signup", match: /sign(?:s)?\s*up|register|create an account/i },
  { id: "login", match: /log(?:s)?\s*in|sign(?:s)?\s*in|password/i },
  { id: "browse", match: /browse|catalog|products?|shop/i },
  { id: "checkout", match: /check\s*out|place order|buy|purchase|cart|pay/i },
  { id: "track", match: /track|order status|where is my|shipment/i },
  { id: "write-note", match: /note/i },
];

function tokensOf(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 2 && !STOP.has(part));
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fence?.[1]?.trim() || trimmed;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("not-json");
  }
}

function writerMissing(): boolean {
  const presence = envPresence();
  if (presence.LLM_PROVIDER === "openai") return !presence.OPENAI_API_KEY;
  return !presence.GROQ_API_KEY;
}

function scoreFeature(question: string, feature: BackendFeature): number {
  const q = question.toLowerCase();
  const tokens = tokensOf(question);
  const hay = [
    feature.id,
    feature.title,
    feature.when,
    feature.summary,
    ...feature.steps.map((step) => `${step.label} ${step.summary}`),
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 3;
  }
  if (HINTS.some((hint) => hint.id === feature.id && hint.match.test(q))) {
    score += 12;
  }
  return score;
}

function pickFeature(
  question: string,
  features: BackendFeature[],
): BackendFeature | null {
  const ranked = features
    .map((feature) => ({ feature, score: scoreFeature(question, feature) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].feature : null;
}

function stepsFor(feature: BackendFeature): SchemaAskStep[] {
  const path = scenarioPath(feature, "success");
  const byId = new Map(feature.steps.map((step) => [step.id, step]));
  return path
    .map((id, index) => {
      const step = byId.get(id);
      if (!step || step.kind === "decision") return null;
      return {
        step: index + 1,
        text: `${step.label}. ${step.sample.happen}.`,
        tableId: step.tech?.tableId ?? null,
        file: step.tech?.file ?? null,
        origin: "heuristic" as FactOrigin,
      };
    })
    .filter((item): item is SchemaAskStep => Boolean(item))
    .map((item, index) => ({ ...item, step: index + 1 }))
    .slice(0, 4);
}

function emptyAnswer(features: BackendFeature[]): BackendAskResult {
  const names = features.map((item) => item.title.toLowerCase());
  const list =
    names.length === 0
      ? "this app"
      : names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return {
    answer: `That does not match a backend story we mapped. The stories we have are ${list}.`,
    featureId: null,
    tableIds: [],
    files: [],
    walkthrough: [],
  };
}

export function heuristicBackendAsk(
  question: string,
  guide: SchemaGuide,
): BackendAskResult {
  const backend = guideBackend(guide);
  if (!question.trim()) {
    return {
      answer: "Ask what happens when someone uses one feature.",
      featureId: null,
      tableIds: [],
      files: [],
      walkthrough: [],
    };
  }
  if (/restrict|permission|role|ban|block/i.test(question)) {
    const login = backend.features.find((item) => item.id === "login");
    return {
      answer: login
        ? "None of these backend stories restrict a person. Log in only checks who is allowed in for that visit."
        : "None of these backend stories restrict a person. There is no role or permission step on the map.",
      featureId: login?.id ?? null,
      tableIds: login?.tableIds.slice(0, 2) ?? [],
      files: [],
      walkthrough: login ? stepsFor(login).slice(0, 2) : [],
    };
  }

  const feature = pickFeature(question, backend.features);
  if (!feature) return emptyAnswer(backend.features);

  const walkthrough = stepsFor(feature);
  const files = [
    ...new Set(
      feature.steps
        .map((step) => step.tech?.file)
        .filter((file): file is string => Boolean(file)),
    ),
  ].slice(0, 3);

  return {
    answer: `${feature.when}. ${feature.summary} This is a simulated walk-through, not a live trace.`,
    featureId: feature.id,
    tableIds: feature.tableIds.slice(0, 3),
    files,
    walkthrough,
  };
}

export async function answerBackendQuestion(
  question: string,
  guide: SchemaGuide,
): Promise<BackendAskResult> {
  const fallback = heuristicBackendAsk(question, guide);
  if (writerMissing() || !fallback.featureId) return fallback;

  const backend = guideBackend(guide);
  const feature = backend.features.find((item) => item.id === fallback.featureId);
  if (!feature) return fallback;

  try {
    const cfg = getLlmConfig();
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    const allowedTables = new Set(guide.tables.map((table) => table.id));
    const completion = await client.chat.completions.create({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You answer one beginner question using only this backend feature story.
Return JSON {"answer":"","walkthrough":[{"step":1,"text":"","tableId":""}]}.
Rules:
- Stay on this one feature. Do not invent other features.
- 2-4 short everyday sentences, then 2-4 steps from the story.
- Call it a sample walk-through, not a live trace.
Forbidden: field, column, query, schema, Prisma, foreign key, camelCase, slice, knowledge graph.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            feature: {
              title: feature.title,
              when: feature.when,
              summary: feature.summary,
              steps: feature.steps.map((step) => ({
                label: step.label,
                means: step.summary,
                happens: step.sample.happen,
                tableId: step.tech?.tableId,
              })),
            },
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(raw) as {
      answer?: string;
      walkthrough?: Array<{ step?: number; text?: string; tableId?: string }>;
    };
    const answer = parsed.answer?.trim().slice(0, 800) ?? "";
    if (!answer) return fallback;

    const walkthrough = (parsed.walkthrough ?? [])
      .map((item, index) => ({
        step: item.step ?? index + 1,
        text: String(item.text || "").trim().slice(0, 280),
        tableId:
          item.tableId && allowedTables.has(item.tableId) ? item.tableId : null,
        file: null,
        origin: "llm" as FactOrigin,
      }))
      .filter((item) => item.text)
      .slice(0, 4);

    return {
      ...fallback,
      answer,
      walkthrough: walkthrough.length ? walkthrough : fallback.walkthrough,
    };
  } catch {
    return fallback;
  }
}
