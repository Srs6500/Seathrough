import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import { algoClassifyModelSchema } from "@/lib/leetcode/schemas";
import type { AlgoPattern, AlgoSpec } from "@/lib/leetcode/types";
import {
  ALGO_PATTERNS,
  MAX_CELLS,
  PATTERN_DEFAULTS,
} from "@/lib/leetcode/types";

const SYSTEM = `You classify LeetCode-style algorithm prompts for an educational visualizer.
Return ONLY JSON with this shape:
{
  "pattern": "hash_map" | "two_pointers" | "sliding_window" | "binary_search" | "stack",
  "title": "short problem name",
  "summary": "one sentence about what to find/check",
  "nums": [numbers] (optional),
  "text": "string example" (optional),
  "target": number (optional),
  "supported": true
}

Pattern guide:
- hash_map: Two Sum, pair sums, complement lookup
- two_pointers: palindrome, reverse string, container with most water, sorted two-sum
- sliding_window: longest substring without repeating chars, max consecutive ones, window sums
- binary_search: search in sorted array, first/last position, peak finding on sorted data
- stack: valid parentheses, next greater element with stack, decode string with stack

Extract concrete example inputs from the prompt when present.
If none exist, omit nums/text/target and the server will apply defaults.
If the prompt is unrelated to these patterns, still pick the closest pattern and set supported=false.`;

export function clampNums(nums: number[] | undefined): number[] | undefined {
  if (!nums?.length) return undefined;
  return nums.slice(0, MAX_CELLS);
}

export function clampText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.slice(0, MAX_CELLS);
}

export function extractNumberArray(prompt: string): number[] | undefined {
  const match =
    prompt.match(
      /\b(?:nums|numbers|arr|array|prices|height|heights)\s*=\s*\[([^\]]*)\]/i,
    ) ?? prompt.match(/\[((?:\s*-?\d+(?:\.\d+)?\s*,?){2,})\]/);
  if (!match?.[1]) return undefined;
  const nums = match[1]
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
  return nums.length ? clampNums(nums) : undefined;
}

export function extractQuotedString(prompt: string): string | undefined {
  const match =
    prompt.match(/\b(?:s|str|string)\s*=\s*"([^"]*)"/i) ??
    prompt.match(/\b(?:s|str|string)\s*=\s*'([^']*)'/i) ??
    prompt.match(/"([^"]{1,40})"/) ??
    prompt.match(/'([^']{1,40})'/);
  if (!match?.[1]) return undefined;
  return clampText(match[1]);
}

export function extractTarget(prompt: string): number | undefined {
  const match =
    prompt.match(/\btarget\s*=\s*(-?\d+(?:\.\d+)?)/i) ??
    prompt.match(/\b(?:find|search(?:\s+for)?)\s+(-?\d+(?:\.\d+)?)\b/i);
  if (!match?.[1]) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

function scorePattern(prompt: string): { pattern: AlgoPattern; score: number } {
  const p = prompt.toLowerCase();
  const scores: Record<AlgoPattern, number> = {
    hash_map: 0,
    two_pointers: 0,
    sliding_window: 0,
    binary_search: 0,
    stack: 0,
  };

  if (/\btwo\s*sum\b|\bhash\s*map\b|\bcomplement\b|\bpairs?\s+that\s+sum\b/.test(p)) {
    scores.hash_map += 5;
  }
  if (/\bpalindrome\b|\btwo\s*pointers?\b|\breverse\s+string\b|\bcontainer\s+with\s+most\s+water\b|\bfrom\s+both\s+ends\b/.test(p)) {
    scores.two_pointers += 5;
  }
  if (
    /\bsliding\s*window\b|\blongest\s+substring\b|\bwithout\s+repeating\b|\bmax(?:imum)?\s+consecutive\b|\bwindow\s+of\s+size\b/.test(
      p,
    )
  ) {
    scores.sliding_window += 5;
  }
  if (
    /\bbinary\s*search\b|\bsorted\s+array\b|\bsearch\s+insert\b|\bfirst\s+and\s+last\s+position\b|\blow\s*=|\bmid\s*=|\bhigh\s*=/.test(
      p,
    )
  ) {
    scores.binary_search += 5;
  }
  if (
    /\bvalid\s+parentheses\b|\bbrackets?\b|\bstack\b|\bnext\s+greater\b|\bpush\b.*\bpop\b|\(\)|\[\]|\{\}/.test(
      p,
    )
  ) {
    scores.stack += 4;
  }

  if (/\btarget\b/.test(p) && /\bnums?\b|\barray\b/.test(p)) {
    scores.hash_map += 1;
    scores.binary_search += 1;
  }
  if (/\bsorted\b/.test(p)) scores.binary_search += 2;
  if (/\bsubstring\b|\bunique\s+characters?\b/.test(p)) {
    scores.sliding_window += 2;
  }
  if (/\b\(\)|\[\]|\{\}|parenthes|bracket/.test(p)) scores.stack += 2;

  let best: AlgoPattern = "hash_map";
  let bestScore = -1;
  for (const pattern of ALGO_PATTERNS) {
    if (scores[pattern] > bestScore) {
      best = pattern;
      bestScore = scores[pattern];
    }
  }
  return { pattern: best, score: bestScore };
}

function applyDefaults(partial: {
  pattern: AlgoPattern;
  title?: string;
  summary?: string;
  nums?: number[];
  text?: string;
  target?: number;
  source: AlgoSpec["source"];
  supported: boolean;
}): AlgoSpec {
  const defaults = PATTERN_DEFAULTS[partial.pattern];
  const needsNums =
    partial.pattern === "hash_map" ||
    partial.pattern === "binary_search" ||
    (partial.pattern === "two_pointers" && !partial.text);
  const needsText =
    partial.pattern === "sliding_window" ||
    partial.pattern === "stack" ||
    (partial.pattern === "two_pointers" && !partial.nums);

  let nums = clampNums(partial.nums);
  let text = clampText(partial.text);
  let target = partial.target;
  let source = partial.source;

  if (needsNums && (!nums || !nums.length)) {
    nums = defaults.nums;
    target = target ?? defaults.target;
    source = source === "heuristic" || source === "llm" ? "default" : source;
  }
  if (needsText && (!text || !text.length)) {
    text = defaults.text;
    source = source === "heuristic" || source === "llm" ? "default" : source;
  }
  if (
    (partial.pattern === "hash_map" || partial.pattern === "binary_search") &&
    target === undefined
  ) {
    target = defaults.target;
  }

  // Prefer string for two_pointers when both missing; defaults use text.
  if (partial.pattern === "two_pointers" && !text && nums) {
    // numeric two-pointers (e.g. container) — keep nums
  } else if (partial.pattern === "two_pointers" && text) {
    nums = undefined;
  }

  return {
    pattern: partial.pattern,
    title: partial.title?.trim() || defaults.title,
    summary: partial.summary?.trim() || defaults.summary,
    nums,
    text,
    target,
    source,
    supported: partial.supported,
  };
}

/**
 * Fast heuristic classification. Returns null when confidence is too low.
 */
export function classifyHeuristic(prompt: string): AlgoSpec | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;

  const { pattern, score } = scorePattern(trimmed);
  if (score < 2) return null;

  const nums = extractNumberArray(trimmed);
  const text = extractQuotedString(trimmed);
  const target = extractTarget(trimmed);

  const defaults = PATTERN_DEFAULTS[pattern];
  return applyDefaults({
    pattern,
    title: defaults.title,
    summary: defaults.summary,
    nums,
    text,
    target,
    source: nums || text || target !== undefined ? "heuristic" : "default",
    supported: true,
  });
}

export async function classifyWithLlm(
  prompt: string,
  signal?: AbortSignal,
): Promise<AlgoSpec> {
  const config = getLlmConfig();
  const client = getTrackedOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const completion = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    },
    { signal },
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("The leetcode classifier returned no content.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("The leetcode classifier returned invalid JSON.");
  }

  const parsed = algoClassifyModelSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("The leetcode classifier did not match the required schema.");
  }

  const data = parsed.data;
  return applyDefaults({
    pattern: data.pattern,
    title: data.title,
    summary: data.summary || PATTERN_DEFAULTS[data.pattern].summary,
    nums: data.nums ?? extractNumberArray(prompt),
    text: data.text ?? extractQuotedString(prompt),
    target: data.target ?? extractTarget(prompt),
    source: "llm",
    supported: data.supported,
  });
}

/**
 * Classify a prompt: heuristics first, then LLM, then hash_map default.
 */
export async function classifyAlgoPrompt(
  prompt: string,
  signal?: AbortSignal,
): Promise<AlgoSpec> {
  const heuristic = classifyHeuristic(prompt);
  if (heuristic) return heuristic;

  try {
    return await classifyWithLlm(prompt, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // Missing key / provider down → still show a default visualization.
    if (
      message.includes("Missing required environment variable") ||
      /classifier|JSON|schema|content/i.test(message)
    ) {
      const nums = extractNumberArray(prompt);
      const text = extractQuotedString(prompt);
      const target = extractTarget(prompt);
      if (nums || text || target !== undefined) {
        const { pattern } = scorePattern(prompt);
        return applyDefaults({
          pattern,
          nums,
          text,
          target,
          source: "default",
          supported: false,
        });
      }
      return applyDefaults({
        pattern: "hash_map",
        source: "default",
        supported: false,
      });
    }
    throw error;
  }
}
