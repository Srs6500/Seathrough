import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import { lessonMcqSchema, type LessonMcq } from "@/lib/schemas/mcq";

export type McqContextInput = {
  rootPrompt?: string;
  title?: string | null;
  humanSummary?: string | null;
  transcript?: string;
  planSnippet?: string;
  narrationSoFar?: string;
  excludeQuestions?: string[];
};

const SYSTEM_PROMPT = `You write a single multiple-choice check question for a student mid-lesson on SeeThrough.

Rules:
- Return ONLY valid JSON matching this shape:
  {"question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"..."}
- Exactly 4 options. One is clearly correct.
- correctIndex is 0-3 for the correct option.
- Question must test understanding of THIS lesson so far — not trivia unrelated to the topic.
- Keep language clear and short. No markdown.
- explanation: 1-2 sentences saying why the correct answer is right (and briefly why a common wrong idea fails).
- Do NOT repeat any excluded prior questions.`;

function buildUserPrompt(input: McqContextInput): string {
  const excluded = (input.excludeQuestions ?? [])
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(-8);

  return [
    input.rootPrompt ? `Original topic:\n${input.rootPrompt}` : "",
    input.title ? `Lesson title:\n${input.title}` : "",
    input.humanSummary ? `Lesson summary:\n${input.humanSummary}` : "",
    input.transcript ? `Conversation so far:\n${input.transcript}` : "",
    input.narrationSoFar
      ? `Narration the student has heard so far:\n${input.narrationSoFar}`
      : "",
    input.planSnippet
      ? `Lesson plan excerpt:\n${input.planSnippet.slice(0, 2800)}`
      : "",
    excluded.length
      ? `Do NOT ask these again:\n${excluded.map((q) => `- ${q}`).join("\n")}`
      : "",
    "Write one new MCQ about what has been taught.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateLessonMcq(
  input: McqContextInput,
): Promise<LessonMcq> {
  const hasContext = Boolean(
    input.rootPrompt?.trim() ||
      input.title?.trim() ||
      input.humanSummary?.trim() ||
      input.transcript?.trim() ||
      input.narrationSoFar?.trim() ||
      input.planSnippet?.trim(),
  );
  if (!hasContext) {
    throw new Error("Not enough lesson context to ask a question yet");
  }

  const config = getLlmConfig();
  const client = getTrackedOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: 0.55,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("LLM returned an empty quiz question");
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("LLM returned invalid JSON for quiz question");
  }

  const parsed = lessonMcqSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Quiz question failed validation: ${parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}
