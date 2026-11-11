import { getLlmConfig } from "@/lib/env";
import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
      return JSON.parse(fence[1].trim()) as unknown;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error("Compression LLM returned invalid JSON");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    const msg = String(error);
    return /\b429\b/i.test(msg) || /rate limit/i.test(msg);
  }
  const e = error as {
    status?: number;
    code?: string;
    message?: string;
    error?: { message?: string };
  };
  if (e.status === 429) return true;
  const msg = `${e.message ?? ""} ${e.error?.message ?? ""} ${e.code ?? ""}`;
  return /\b429\b/i.test(msg) || /rate limit/i.test(msg);
}

function retryAfterMs(error: unknown, attempt: number): number {
  const fallback = Math.min(20_000, 2_000 * 2 ** attempt);
  let computed = fallback;
  if (error && typeof error === "object") {
    const e = error as {
      headers?: { get?: (name: string) => string | null };
      message?: string;
    };
    const header =
      typeof e.headers?.get === "function"
        ? e.headers.get("retry-after")
        : null;
    if (header && Number.isFinite(Number(header))) {
      computed = Math.max(1000, Number(header) * 1000);
    } else {
      const match = String(e.message ?? "").match(
        /try again in\s+([0-9.]+)\s*s/i,
      );
      if (match?.[1]) {
        computed = Math.max(1000, Math.ceil(Number(match[1]) * 1000) + 500);
      }
    }
  }
  // Cap waits so eval does not stall for many minutes on TPM cool-downs.
  return Math.min(30_000, computed);
}

/**
 * Small JSON chat helper for token-compression pipes.
 * Retries on Groq 429 (backoff) and once without json_object on schema rejects.
 */
export async function completeJsonObject(input: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<unknown> {
  const config = getLlmConfig();
  const client = getTrackedOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const messages = [
    { role: "system" as const, content: input.system },
    { role: "user" as const, content: input.user },
  ];

  async function once(useJsonObject: boolean): Promise<string> {
    const maxAttempts = 4;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const completion = await client.chat.completions.create({
          model: config.model,
          temperature: input.temperature ?? 0.2,
          ...(useJsonObject
            ? { response_format: { type: "json_object" as const } }
            : {}),
          messages: useJsonObject
            ? messages
            : [
                {
                  role: "system",
                  content: `${input.system}\n\nReturn a single JSON object only. No markdown.`,
                },
                messages[1]!,
              ],
        });
        const raw = completion.choices[0]?.message?.content;
        if (!raw?.trim()) {
          throw new Error("Compression LLM returned an empty response");
        }
        return raw;
      } catch (error) {
        lastError = error;
        if (!isRateLimitError(error) || attempt === maxAttempts - 1) {
          throw error;
        }
        const wait = retryAfterMs(error, attempt);
        console.warn(
          `[llm-json] 429 rate limit; retry in ${wait}ms (attempt ${attempt + 1}/${maxAttempts})`,
        );
        await sleep(wait);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }

  try {
    return extractJsonObject(await once(true));
  } catch (firstError) {
    const message =
      firstError instanceof Error ? firstError.message : String(firstError);
    try {
      return extractJsonObject(await once(false));
    } catch (secondError) {
      const second =
        secondError instanceof Error ? secondError.message : String(secondError);
      throw new Error(`Compression JSON failed: ${message} | retry: ${second}`);
    }
  }
}
