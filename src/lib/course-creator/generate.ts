import OpenAI from "openai";
import { envPresence, getLlmConfig } from "@/lib/env";
import {
  BEAT_COUNT_MAX,
  BEAT_COUNT_MIN,
  coerceLessonScript,
  INCOMPLETE_SCRIPT,
  type LessonScript,
} from "@/lib/course-creator/script";

const SYSTEM = `You write a shooting script for one short teaching video. Later steps will draw the pictures and record the voice, so split those tracks now.

Return one JSON object:
{
  "title": "lesson title",
  "hook": "one sentence promise",
  "audience": "who this is for",
  "beats": [
    {
      "heading": "2-5 word board title, never intro/step1/wrapup",
      "seconds": 12,
      "visual": "what is drawn and how it moves",
      "voiceover": "what the teacher says aloud",
      "onScreen": "optional short caption"
    }
  ]
}

Rules:
- ${BEAT_COUNT_MIN} to ${BEAT_COUNT_MAX} beats. The lesson moves forward.
- heading is a readable title such as "The lock", never intro, step1, or wrapup.
- Teach accurately. Voice and picture must agree.
- Voiceover is spoken: 1 or 2 sentences, 12 to 45 words. Write numbers as words. No "in this video", no lists, no brackets.
- Visuals can be drawn with shapes, arrows, simple characters, and labels. No photos, no real faces.
- seconds is an integer from 12 to 40.
- If the prompt asks for help doing harm, write a 4-beat script that refuses.
- JSON only.`;

export function scriptWriterMissing(): boolean {
  const presence = envPresence();
  if (presence.LLM_PROVIDER === "openai") return !presence.OPENAI_API_KEY;
  return !presence.GROQ_API_KEY;
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) return JSON.parse(fence[1].trim()) as unknown;
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error(INCOMPLETE_SCRIPT);
  }
}

function isJsonModeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to validate json|failed_generation|json_validate|invalid json/i.test(
    message,
  );
}

export async function generateLessonScript(prompt: string): Promise<LessonScript> {
  const config = getLlmConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    maxRetries: 2,
    timeout: 90_000,
  });
  const groq = config.provider === "groq";
  const user = `Write the shooting script for this lesson:\n${prompt}`;

  async function complete(jsonMode: boolean): Promise<string> {
    const completion = await client.chat.completions.create({
      model: config.model,
      temperature: 0.4,
      max_tokens: 2800,
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      ...(groq ? { reasoning_effort: "low" as const, include_reasoning: false } : {}),
      messages: [
        {
          role: "system",
          content: jsonMode
            ? SYSTEM
            : `${SYSTEM}\n\nReturn a single JSON object only. No markdown.`,
        },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error(INCOMPLETE_SCRIPT);
    return text;
  }

  let raw: string;
  try {
    raw = await complete(true);
  } catch (error) {
    if (!isJsonModeError(error)) throw error;
    raw = await complete(false);
  }

  return coerceLessonScript(extractJsonObject(raw));
}
