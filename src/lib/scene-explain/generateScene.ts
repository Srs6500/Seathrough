import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import {
  builtinSceneForPrompt,
  fallbackSceneForPrompt,
} from "@/lib/scene-explain/builtinScenes";
import { inspectSceneCode } from "@/lib/scene-explain/inspectCode";
import {
  parseScenePlan,
  parseSceneProgram,
  parseRepairedCode,
} from "@/lib/scene-explain/parseProgram";
import {
  CODE_SYSTEM,
  GENERATE_SYSTEM,
  PLAN_SYSTEM,
} from "@/lib/scene-explain/prompts";
import type { SceneGenerateInput, SceneProgram } from "@/lib/scene-explain/types";

const MIN_DETAILED_CODE_CHARS = 2200;
const MIN_DETAILED_BEATS = 6;

function planUserMessage(input: SceneGenerateInput): string {
  const parts = [`Student request:\n${input.prompt.trim()}`];
  if (input.priorTitle) {
    parts.push(
      `A scene is already up: "${input.priorTitle}". Plan a deeper rebuild — more stages and mechanism, never simpler.`,
    );
  }
  if (input.priorSummary) {
    parts.push(
      `What we already explained:\n${input.priorSummary.slice(0, 1600)}`,
    );
  }
  parts.push(
    [
      "Design the most detailed classroom-quality 3D process plan you can.",
      "Require 8–10 reveal stages and 8–10 beats (3 sentences each).",
      "visualBrief must list groups, particle counts, colors, and per-stage motion so coding cannot underspecify.",
      "Model the real mechanism with intermediate states, arrows, and continuous motion.",
    ].join(" "),
  );
  return parts.join("\n\n");
}

function codeUserMessage(
  input: SceneGenerateInput,
  plan: ReturnType<typeof parseScenePlan>,
): string {
  return [
    `Student request:\n${input.prompt.trim()}`,
    `Title: ${plan.title}`,
    `maxReveal: ${plan.maxReveal}`,
    `Beats:\n${plan.beats
      .map((b) => `${b.order}. [reveal ${b.reveal}] ${b.narration}`)
      .join("\n")}`,
    `Visual brief (implement ALL of this):\n${plan.visualBrief}`,
    "Write the complete Three.js body now. Do not omit particle systems, helpers, or later reveal stages. Prefer a long dense implementation.",
  ].join("\n\n");
}

function isDetailedEnough(program: SceneProgram): boolean {
  return (
    program.code.trim().length >= MIN_DETAILED_CODE_CHARS &&
    program.beats.length >= MIN_DETAILED_BEATS &&
    program.maxReveal >= 6 &&
    inspectSceneCode(program.code).ok
  );
}

export async function generateSceneProgram(
  input: SceneGenerateInput,
): Promise<SceneProgram> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error("Prompt is required");
  }
  if (prompt.length > 600) {
    throw new Error("Prompt is too long");
  }

  try {
    const deep = await requestTwoPass(input);
    if (isDetailedEnough(deep)) return deep;
    // One enrichment retry if the first pass came back thin.
    const richer = await requestTwoPass({
      ...input,
      priorSummary: [
        input.priorSummary ?? "",
        "Previous attempt was too thin. Triple the mesh/particle count, add missing reveal stages, and lengthen __update motion.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (isDetailedEnough(richer) || richer.code.length >= deep.code.length) {
      return richer;
    }
    return deep;
  } catch {
    try {
      const single = await requestSingleShot(input, true);
      if (isDetailedEnough(single)) return single;
      return await requestSingleShot(input, false);
    } catch {
      if (!input.priorTitle && !input.priorSummary) {
        const known = builtinSceneForPrompt(prompt);
        if (known) return known;
      }
      return fallbackSceneForPrompt(prompt);
    }
  }
}

async function requestTwoPass(input: SceneGenerateInput): Promise<SceneProgram> {
  const plan = await requestPlan(input);
  const code = await requestCode(input, plan);
  const inspected = inspectSceneCode(code);
  if (!inspected.ok) {
    throw new Error(inspected.reason);
  }
  return {
    title: plan.title,
    maxReveal: plan.maxReveal,
    beats: plan.beats,
    code,
  };
}

async function requestPlan(input: SceneGenerateInput) {
  const { apiKey, model, baseURL } = getLlmConfig();
  const client = getTrackedOpenAI({ apiKey, baseURL });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.5,
    max_tokens: 3500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: planUserMessage(input) },
    ],
  });
  return parseScenePlan(completion.choices[0]?.message?.content ?? "");
}

async function requestCode(
  input: SceneGenerateInput,
  plan: ReturnType<typeof parseScenePlan>,
): Promise<string> {
  const { apiKey, model, baseURL } = getLlmConfig();
  const client = getTrackedOpenAI({ apiKey, baseURL });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 9000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CODE_SYSTEM },
      { role: "user", content: codeUserMessage(input, plan) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  try {
    const asProgram = parseSceneProgram(
      JSON.stringify({
        title: plan.title,
        maxReveal: plan.maxReveal,
        beats: plan.beats,
        code: extractCodeField(raw) ?? "",
      }),
    );
    if (asProgram.code.trim()) return asProgram.code;
  } catch {
    // fall through
  }

  try {
    return parseRepairedCode(
      raw.includes("===CODE===") ? raw : `===CODE===\n${extractCodeField(raw) ?? raw}`,
      plan.title,
    );
  } catch {
    const field = extractCodeField(raw);
    if (field?.trim()) return field.trim();
    throw new Error("The scene coder did not return Three.js code.");
  }
}

function extractCodeField(raw: string): string | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const json = JSON.parse(raw.slice(start, end + 1)) as { code?: unknown };
    return typeof json.code === "string" ? json.code : null;
  } catch {
    return null;
  }
}

async function requestSingleShot(
  input: SceneGenerateInput,
  jsonMode: boolean,
): Promise<SceneProgram> {
  const { apiKey, model, baseURL } = getLlmConfig();
  const client = getTrackedOpenAI({ apiKey, baseURL });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.4,
    max_tokens: 9000,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: GENERATE_SYSTEM },
      { role: "user", content: planUserMessage(input) },
    ],
  });

  return parseSceneProgram(completion.choices[0]?.message?.content ?? "");
}
