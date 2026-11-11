import OpenAI from "openai";
import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function designClient() {
  const openaiKey = optionalEnv("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      client: getTrackedOpenAI({ apiKey: openaiKey }),
      model: optionalEnv("OPENAI_MODEL") ?? "gpt-4.1",
      groq: false,
    };
  }
  const cfg = getLlmConfig();
  return {
    client: getTrackedOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }),
    model: cfg.model,
    groq: (cfg.baseURL ?? "").includes("groq.com"),
  };
}

/** Escapes raw newlines and tabs inside strings and drops trailing commas: the usual near-misses. */
function repairJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      else if (char === "\n") {
        out += "\\n";
        continue;
      } else if (char === "\r") continue;
      else if (char === "\t") {
        out += "\\t";
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }
    out += char;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function parseLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(repairJson(text));
    } catch {
      throw new Error("Model returned invalid JSON");
    }
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseLenient(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return parseLenient(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return parseLenient(trimmed.slice(start, end + 1));
  throw new Error("Model returned invalid JSON");
}

/** Groq rejects near-valid JSON in json mode and returns the text it refused. */
function failedGeneration(error: unknown): string | undefined {
  if (!(error instanceof OpenAI.APIError)) return undefined;
  const body = error.error as { failed_generation?: unknown } | undefined;
  return typeof body?.failed_generation === "string" ? body.failed_generation : undefined;
}

export async function completeDesignJson(
  system: string,
  user: string,
  options: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  const { client, model, groq } = designClient();
  const request = (jsonMode: boolean) =>
    client.chat.completions.create(
      {
        model,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 4096,
        // Groq's reasoning models spend max_tokens on hidden reasoning first, which truncates the JSON.
        ...(groq ? { reasoning_effort: "low" as const, include_reasoning: false } : {}),
        ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      options.signal ? { signal: options.signal } : undefined,
    );

  let content: string;
  try {
    content = (await request(true)).choices[0]?.message?.content ?? "";
  } catch (error) {
    const refused = failedGeneration(error);
    if (refused === undefined) throw error;
    try {
      return extractJson(refused);
    } catch {
      // JSON mode keeps refusing this output, so ask again without it and parse leniently.
      content = (await request(false)).choices[0]?.message?.content ?? "";
    }
  }
  if (!content.trim()) throw new Error("Empty system design from model");
  return extractJson(content);
}
