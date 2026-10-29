import OpenAI from "openai";
import { envPresence, getExplainVideoLlmConfig } from "@/lib/env";
import { ENGINE_GUIDE } from "@/lib/explain-video/engineGuide";
import {
  coercePlan,
  INCOMPLETE_DRAWINGS,
  INCOMPLETE_PLAN,
  LOOK_PALETTE,
  TARGET_SCENES,
  trimToTargetScenes,
  type Plan,
  type SceneCodeResponse,
} from "@/lib/explain-video/film";
import { extractScenes, LOOP_COUNTER, prepareScene } from "@/lib/explain-video/sceneCode";

const PLAN_SYSTEM = `You plan a short hand-drawn explainer film: exactly 5 scenes, about 50 to 60 seconds in total. Every frame will be drawn in code on a 2D canvas in a hand-made print look, so plan pictures that can be drawn with shapes, lines, arrows, simple characters and a few hand-lettered labels. No photos, no real faces, no detailed maps.

The user may type a short topic or paste source text. If they pasted material, teach that material. Do not add facts that are not in the topic or source.

Decide the path from the topic. Do not use a stock outline such as title, three facts, summary. Ask what the viewer needs to SEE to get it. A mechanism is a machine that moves. A process is one object travelling through stages. A comparison is two things side by side, changing. A question of size is a zoom. A cause is a chain reaction. A recurring visual anchor (the same object or character in several scenes) makes a film feel like one story; use one when it helps.

Return one JSON object:
{
  "title": "<= 60 characters",
  "look": "ink" | "riso" | "screen" | "pencil" | "blueprint" | "sky" | "chalkboard" | "pastel",
  "angle": "one sentence: the path this film takes, <= 180 characters",
  "scenes": [
    {
      "title": "<= 40 characters",
      "seconds": 4 to 9,
      "see": "what is drawn and how it moves: objects, where they sit, what moves where, the 1-3 word labels. Concrete. <= 300 characters",
      "say": "the one caption sentence the viewer reads during this scene, <= 100 characters",
      "speak": "what the narrator says aloud over this scene: 1 or 2 natural spoken sentences, 12 to 35 words, <= 240 characters"
    }
  ]
}

Looks (the background colour of the whole film):
- sky = light sky-blue paper, bold flat colours (weather, ecology, geography, how everyday things work).
- chalkboard = dark green board, chalk lines, yellow and coral accents (maths, physics, chemistry, a lesson being worked out).
- blueprint = chalk on deep navy (space, machines, computing, electricity).
- pastel = soft pink paper, watercolour fills (the body, feelings, food, gentle everyday topics).
- riso = cream stock, loud pink, blue and yellow halftone (playful science, technology).
- screen = sea blues on pale grey (oceans, engineering, travel).
- ink = warm cream paper, brown ink hatching (history, old stories, natural history).
- pencil = graphite on cream (philosophy, quiet ideas).
Pick the look whose colour suits the subject. Four of these are cream, so reach for sky, chalkboard, blueprint or pastel unless the topic really calls for old paper.

Rules:
- Teach accurately. The captions, read in order, explain the topic on their own. Pictures must be right too: correct order, correct anatomy or mechanism, conventional colours (oxygen-poor blood blue, oxygen-rich red).
- The angle states the idea the film teaches, not a description of the drawings.
- Each scene shows something different; the film moves forward, it does not repeat a layout.
- Give each scene enough seconds to read its caption and watch the motion, usually 8 to 10. Five scenes should add up to about a minute.
- The narration is a voice-over, heard while the picture moves. It explains what the picture shows, in plain spoken words, and flows from scene to scene like one talk. It says more than the caption but never contradicts it. Write numbers and symbols as words ("two", "percent"). No lists, no brackets, no "as you can see".
- Do not say "in this video". Do not invent statistics.
- If the topic asks for help doing harm, do not explain it. Plan a 3-scene film that says this page explains ordinary topics.
- JSON only.`;

const CODE_SYSTEM = `You are an animator. You draw short explainer films in JavaScript on a 2D canvas using a hand-drawn drawing library that is already loaded.
${ENGINE_GUIDE}
OUTPUT
- Write the requested scene functions in order, each declared exactly as: function sceneN(c, tau, i) { ... }
- Plain JavaScript only. No markdown fences, no prose, nothing outside the functions.
- Each scene must fully draw its "see" description: real shapes, motion over its whole duration, and the labels it names. Use the scene's dur for timing.
- Make every scene look different from the others while keeping the same look and any recurring anchor object.`;

export function filmWriterMissing(): boolean {
  const presence = envPresence();
  if (presence.EXPLAIN_VIDEO_API_KEY) return false;
  return presence.LLM_PROVIDER === "openai"
    ? !presence.OPENAI_API_KEY
    : !presence.GROQ_API_KEY;
}

type Client = { client: OpenAI; model: string; groq: boolean; tokensPerMinute: number | null };

function makeClient(): Client {
  const config = getExplainVideoLlmConfig();
  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      maxRetries: 3,
      timeout: 150_000,
    }),
    model: config.model,
    groq: config.groq,
    tokensPerMinute: config.tokensPerMinute,
  };
}

/** Rough token count for budgeting; dense code runs close to 3 characters per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Output budget that keeps prompt + output under the provider's per-request ceiling. */
function outputBudget(llm: Client, prompt: string, wanted: number): number {
  if (!llm.tokensPerMinute) return wanted;
  const room = llm.tokensPerMinute - estimateTokens(prompt) - 600;
  return Math.max(1200, Math.min(wanted, room));
}

function messageText(message: { content?: string | null; reasoning?: unknown }): string {
  if (typeof message.content === "string" && message.content.trim()) return message.content;
  return "";
}

async function complete(
  llm: Client,
  options: {
    system: string;
    user: string;
    json: boolean;
    maxTokens: number;
    temperature: number;
    effort: "low" | "medium" | "high";
  },
): Promise<string> {
  const tight = llm.tokensPerMinute !== null;
  const completion = await llm.client.chat.completions.create({
    model: llm.model,
    temperature: options.temperature,
    max_tokens: outputBudget(llm, options.system + options.user, options.maxTokens),
    ...(llm.groq
      ? { reasoning_effort: tight ? "low" : options.effort, include_reasoning: false }
      : {}),
    ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
  });
  const choice = completion.choices[0];
  const text = messageText(choice?.message ?? {});
  if (!text.trim()) {
    console.warn("[explain-video] empty reply", choice?.finish_reason ?? "no choice", completion.usage?.completion_tokens ?? "?");
  }
  return text;
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  throw new Error(INCOMPLETE_PLAN);
}

function isRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|rate_limit|quota|too many requests/i.test(message);
}

export async function generatePlan(topic: string): Promise<Plan> {
  const llm = makeClient();
  const ask = (json: boolean, retry: boolean) =>
    complete(llm, {
      system: json ? PLAN_SYSTEM : `${PLAN_SYSTEM}\n\nReturn a single JSON object only. No markdown.`,
      user: retry
        ? `Topic:\n${topic}\n\nYour last answer was incomplete. Return the full JSON object with exactly ${TARGET_SCENES} scenes.`
        : `Topic:\n${topic}`,
      json,
      maxTokens: 3000,
      temperature: 0.7,
      effort: "low",
    });

  let raw: string;
  try {
    raw = await ask(true, false);
  } catch (error) {
    if (isRateLimit(error)) throw error;
    raw = await ask(false, false);
  }
  let plan: Plan;
  try {
    plan = trimToTargetScenes(coercePlan(extractJsonObject(raw)));
  } catch (error) {
    if (!(error instanceof Error) || error.message !== INCOMPLETE_PLAN) throw error;
    plan = trimToTargetScenes(coercePlan(extractJsonObject(await ask(false, true))));
  }
  if (plan.scenes.length === TARGET_SCENES) return plan;
  try {
    const retried = trimToTargetScenes(coercePlan(extractJsonObject(await ask(false, true))));
    if (retried.scenes.length === TARGET_SCENES) return retried;
    if (retried.scenes.length > plan.scenes.length) return retried;
  } catch {
    // Keep the first usable outline rather than failing the review step.
  }
  return plan;
}

function sceneBrief(plan: Plan, index: number): string {
  const scene = plan.scenes[index]!;
  return `Scene ${index + 1}: "${scene.title}" (dur ${scene.seconds.toFixed(1)} s)
  see: ${scene.see}
  caption (drawn by the runtime, do not draw it): ${scene.say}`;
}

function filmBrief(topic: string, plan: Plan): string {
  return `Topic: ${topic}
Film: "${plan.title}"
Angle: ${plan.angle}
Look: ${plan.look} (PAL starts as the ${LOOK_PALETTE[plan.look]} palette)

${plan.scenes.map((_, index) => sceneBrief(plan, index)).join("\n\n")}`;
}

function stripGuards(code: string): string {
  return code.replaceAll(
    `if(++${LOOP_COUNTER}>3e6)throw new Error("A loop in this scene ran too long.");`,
    "",
  );
}

async function writeOneScene(
  llm: Client,
  topic: string,
  plan: Plan,
  index: number,
  previous: { code: string | null; error: string } | null,
): Promise<{ code: string | null; error?: string }> {
  const number = index + 1;
  const fix = previous
    ? previous.code
      ? `\n\nYour previous scene${number} failed: ${previous.error}\nPrevious code:\n${stripGuards(previous.code)}\n\nRewrite scene${number} so it works. Keep what was good about the picture.`
      : `\n\nThe previous attempt failed: ${previous.error}`
    : "";
  const user = `${filmBrief(topic, plan)}

Write only function scene${number}(c, tau, i) for scene ${number}.${fix}`;

  let lastError = previous?.error ?? "The scene did not come back.";
  for (let attempt = 0; attempt < rewritePolicy(llm).attempts; attempt += 1) {
    const raw = await complete(llm, {
      system: CODE_SYSTEM,
      user:
        attempt === 0
          ? user
          : `${user}\n\nYour last answer could not be used: ${lastError}\nReturn only the function, complete.`,
      json: false,
      maxTokens: 6000,
      temperature: 0.5,
      effort: "medium",
    });
    const source = extractScenes(raw, plan.scenes.length)[index] ?? null;
    if (!source) {
      lastError = `Define the scene as function scene${number}(c, tau, i) { ... }.`;
      continue;
    }
    const prepared = prepareScene(source, number);
    if (prepared.ok) return { code: prepared.code };
    lastError = prepared.error;
  }
  return { code: null, error: lastError };
}

async function writeOneSceneSafely(
  ...args: Parameters<typeof writeOneScene>
): Promise<{ code: string | null; error?: string }> {
  try {
    return await writeOneScene(...args);
  } catch (error) {
    console.error(
      "[explain-video] scene rewrite failed",
      error instanceof Error ? error.message : "error",
    );
    return { code: null, error: "The scene could not be rewritten." };
  }
}

/**
 * Under a tight per-minute token cap every rewrite waits for the window to reset, so rewrite
 * fewer scenes, one at a time, once each; the rest fall back to title cards instead of stalling.
 */
function rewritePolicy(llm: Client): { concurrency: number; cap: number; attempts: number } {
  return llm.tokensPerMinute
    ? { concurrency: 1, cap: 2, attempts: 1 }
    : { concurrency: 3, cap: 7, attempts: 2 };
}

async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return out;
}

/** Write every scene in one pass, then retry the ones that did not survive validation, one by one. */
export async function generateSceneCode(
  topic: string,
  plan: Plan,
  indexes?: number[],
): Promise<SceneCodeResponse> {
  const wanted = uniqueSceneIndexes(plan, indexes);
  if (wanted && wanted.length > 0 && wanted.length < plan.scenes.length) {
    return writeSelectedScenes(topic, plan, wanted);
  }

  const llm = makeClient();
  // No per-minute token cap → write every scene at once: wall time ≈ one scene
  // instead of all of them streamed serially. Under a cap, parallel calls only
  // trade waiting for 429s, so keep the single call there.
  if (!llm.tokensPerMinute) {
    return writeAllScenesInParallel(llm, topic, plan);
  }
  const raw = await complete(llm, {
    system: CODE_SYSTEM,
    user: `${filmBrief(topic, plan)}

Write scene1 through scene${plan.scenes.length}.`,
    json: false,
    maxTokens: 20000,
    temperature: 0.5,
    effort: "medium",
  });

  const sources = extractScenes(raw, plan.scenes.length);
  const scenes: SceneCodeResponse["scenes"] = sources.map((source, index) => {
    if (!source) return { code: null, error: "The scene did not come back." };
    const prepared = prepareScene(source, index + 1);
    return prepared.ok ? { code: prepared.code } : { code: null, error: prepared.error };
  });

  const failed = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.code === null);
  if (failed.length) {
    console.warn(
      "[explain-video] rewriting scenes",
      failed.map(({ index, scene }) => `${index + 1}: ${scene.error}`).join(" | "),
    );
    const policy = rewritePolicy(llm);
    const toFix = failed.slice(0, policy.cap);
    const fixes = await inBatches(toFix, policy.concurrency, ({ index, scene }) =>
      writeOneSceneSafely(llm, topic, plan, index, {
        code: sources[index] ?? null,
        error: scene.error ?? "The scene did not come back.",
      }),
    );
    toFix.forEach(({ index }, k) => {
      scenes[index] = fixes[k]!;
    });
  }
  if (scenes.every((scene) => scene.code === null)) throw new Error(INCOMPLETE_DRAWINGS);
  return { scenes };
}

function uniqueSceneIndexes(plan: Plan, indexes?: number[]): number[] | null {
  if (!indexes?.length) return null;
  const wanted = [...new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < plan.scenes.length))];
  return wanted.length ? wanted : null;
}

async function writeAllScenesInParallel(
  llm: Client,
  topic: string,
  plan: Plan,
): Promise<SceneCodeResponse> {
  const scenes = await Promise.all(
    plan.scenes.map((_, index) => writeOneSceneSafely(llm, topic, plan, index, null)),
  );
  if (scenes.every((scene) => scene.code === null)) throw new Error(INCOMPLETE_DRAWINGS);
  return { scenes };
}

async function writeSelectedScenes(
  topic: string,
  plan: Plan,
  indexes: number[],
): Promise<SceneCodeResponse> {
  const llm = makeClient();
  const scenes: SceneCodeResponse["scenes"] = plan.scenes.map(() => ({ code: null }));
  const policy = rewritePolicy(llm);
  const written = await inBatches(indexes, policy.concurrency, (index) =>
    writeOneSceneSafely(llm, topic, plan, index, null),
  );
  indexes.forEach((index, order) => {
    scenes[index] = written[order]!;
  });
  if (indexes.every((_, order) => written[order]!.code === null)) throw new Error(INCOMPLETE_DRAWINGS);
  return { scenes };
}

export type RepairRequest = { index: number; code: string | null; error: string };

/** Rewrite scenes that failed in the browser (runtime error, blank, too slow). */
export async function repairSceneCode(
  topic: string,
  plan: Plan,
  repairs: RepairRequest[],
): Promise<{ index: number; code: string | null; error?: string }[]> {
  const llm = makeClient();
  const policy = rewritePolicy(llm);
  const fixed = await inBatches(repairs.slice(0, policy.cap), policy.concurrency, async (repair) => {
    const result = await writeOneSceneSafely(llm, topic, plan, repair.index, {
      code: repair.code,
      error: repair.error,
    });
    return { index: repair.index, ...result };
  });
  const skipped = repairs
    .slice(policy.cap)
    .map((repair) => ({ index: repair.index, code: null, error: "Not rewritten this time." }));
  return [...fixed, ...skipped];
}
