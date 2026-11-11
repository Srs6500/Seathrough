import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import { extractJson } from "@/lib/experiment/systemDesign/llm";
import { normWord, sameWord } from "@/lib/explainer-video/timing";
import {
  scriptSchema,
  spokenLines,
  WORDS_PER_SECOND,
  wordCount,
  type ExplainerScript,
} from "@/lib/explainer-video/types";

const MIN_WORDS = Math.round(30 * WORDS_PER_SECOND);
const MAX_WORDS = Math.round(58 * WORDS_PER_SECOND);

const SYSTEM = `You write scripts for 30-60 second explainer reels read aloud by a TTS voice.
Return ONLY JSON in this shape:
{
  "topic": "short topic name",
  "hook": ["line 1: the problem, UNDER 6 words", "line 2: promises the payoff"],
  "problem": "text on a UI card showing the problem (it gets struck through), <= 36 chars",
  "payoff": ["2-3 tiny card labels for what they'll get, <= 18 chars each"],
  "payoffWord": "one word from hook line 2 that names the payoff",
  "points": [
    {
      "name": "1-2 word label for the header",
      "title": ["Word1", "Word2"],
      "line": "spoken sentence introducing the point; MUST say both title words",
      "stat": { "value": 73, "suffix": "%", "label": "short stat label" },
      "card": "caption for the counter card, <= 40 chars",
      "typed": "one short line typed in a terminal or search bar, <= 30 chars",
      "bar": "terminal" or "search",
      "explanation": "1-2 spoken sentences that explain it; a demo animation acts this out",
      "demo": { "kind": "flow|compare|stack|cycle", "items": ["2-4 labels <= 18 chars"], "values": [only for compare: one 1-100 number per item] },
      "stamp": "1-2 word stamp, <= 12 chars",
      "stampWord": "one word from the explanation where the stamp lands"
    }
  ],
  "closing": "one line that pays off the hook"
}
Rules:
- 3 to 7 points. Total spoken words (hook + every line + explanation + closing) between ${MIN_WORDS} and ${MAX_WORDS}.
- Spoken text is read by TTS: write numbers and symbols as words ("seventy percent"), no abbreviations, no emoji, no stage directions.
- title is exactly two single words (one word per slot, no spaces, each <= 14 chars), e.g. ["Short", "Waves"]; both appear in that point's line, spelled the same.
- stampWord appears in that point's explanation. payoffWord appears in hook line 2.
- demo kinds: flow = steps in order, compare = before/after or A vs B with values, stack = a checklist that builds up, cycle = a loop that repeats.
- Demo items should be things the explanation actually says, in the order it says them.
- On-screen text (problem, payoff, name, title, card, typed, items, stamp, stat label) has no full stops and no emoji.
- stat values must be real and defensible for the topic; if you are not sure of a figure, use a count (steps, minutes, items) instead of an invented percentage.
- Plain, concrete, conversational. Every point teaches something specific.`;

function client() {
  const cfg = getLlmConfig();
  return {
    openai: getTrackedOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }),
    model: cfg.model,
    groq: cfg.provider === "groq",
  };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

function says(text: string, word: string): boolean {
  const spoken = words(text).map(normWord);
  return words(word)
    .map(normWord)
    .every((w) => spoken.some((s) => sameWord(s, w)));
}

const FILLER = new Set("the and that this with your from into what when where which there their they them then than have just about".split(" "));

/** Longest content word of a spoken line (a real word to time a cue on). */
function anchorWord(text: string, prefer?: string): string {
  const spoken = text.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9'-]/g, "")).filter(Boolean);
  const hit = prefer && spoken.find((w) => sameWord(normWord(w), normWord(prefer)));
  if (hit) return hit;
  return spoken.filter((w) => w.length > 3 && !FILLER.has(w.toLowerCase())).sort((a, b) => b.length - a.length)[0] ?? spoken[0] ?? "";
}

/**
 * Deterministic fixes for cues that must land on a spoken word: pick a real
 * word for the stamp / ring, and lead a point's line with its title when the
 * line never says it (reads like a heading).
 */
export function repairScript(script: ExplainerScript): ExplainerScript {
  return {
    ...script,
    payoffWord: says(script.hook[1], script.payoffWord) ? script.payoffWord : anchorWord(script.hook[1], script.payoff.at(-1)),
    points: script.points.map((p) => {
      const missing = p.title.filter((w) => !says(p.line, w));
      return {
        ...p,
        line: missing.length ? `${p.title.join(" ")}. ${p.line}` : p.line,
        stampWord: says(p.explanation, p.stampWord) ? p.stampWord : anchorWord(p.explanation, p.stamp),
      };
    }),
  };
}

/** Problems a TTS-timed reel can't recover from, as plain sentences. */
export function scriptProblems(script: ExplainerScript): string[] {
  const problems: string[] = [];
  const total = wordCount(script);
  if (total < MIN_WORDS || total > MAX_WORDS) {
    problems.push(`Total spoken words is ${total}; it must be ${MIN_WORDS}-${MAX_WORDS}.`);
  }
  if (words(script.hook[0]).length >= 6) {
    problems.push("Hook line 1 must be under 6 words.");
  }
  if (!says(script.hook[1], script.payoffWord)) {
    problems.push(`payoffWord "${script.payoffWord}" is not in hook line 2.`);
  }
  script.points.forEach((point, i) => {
    for (const word of point.title) {
      if (!says(point.line, word)) {
        problems.push(`Point ${i + 1}: title word "${word}" is not said in its line.`);
      }
    }
    if (!says(point.explanation, point.stampWord)) {
      problems.push(`Point ${i + 1}: stampWord "${point.stampWord}" is not in its explanation.`);
    }
    if (point.demo.kind === "compare" && point.demo.values?.length !== point.demo.items.length) {
      problems.push(`Point ${i + 1}: compare demo needs one value per item.`);
    }
  });
  return problems;
}

async function complete(system: string, user: string): Promise<unknown> {
  const { openai, model, groq } = client();
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.6,
    max_tokens: 4096,
    ...(groq ? { reasoning_effort: "low" as const, include_reasoning: false } : {}),
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return extractJson(completion.choices[0]?.message?.content ?? "{}");
}

/**
 * Write a script for a topic: one model repair round for anything off, then
 * deterministic fixes. Timing problems that remain come back as warnings for
 * the person to fix in review. Throws only if the shape is wrong.
 */
export async function writeExplainerScript(input: {
  topic: string;
  mustMention?: string;
}): Promise<ExplainerScript> {
  const brief = [
    `Topic: ${input.topic}`,
    input.mustMention?.trim() ? `It must mention: ${input.mustMention.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let raw = await complete(SYSTEM, brief);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = scriptSchema.safeParse(raw);
    const problems = parsed.success
      ? scriptProblems(parsed.data)
      : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    if (parsed.success && (problems.length === 0 || attempt === 1)) return repairScript(parsed.data);
    if (attempt === 1) {
      throw new Error(`The script didn't come out right: ${problems.slice(0, 3).join(" ")}`);
    }
    raw = await complete(
      SYSTEM,
      `${brief}\n\nYour previous script:\n${JSON.stringify(raw)}\n\nFix these problems and return the full corrected JSON:\n- ${problems.join("\n- ")}`,
    );
  }
  throw new Error("The script didn't come out right.");
}

/** The text Kokoro reads: one line per beat, so each gets a natural breath. */
export function narrationText(script: ExplainerScript): string {
  return spokenLines(script).join("\n");
}
