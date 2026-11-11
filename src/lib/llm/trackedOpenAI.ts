import OpenAI from "openai";
import { logLlmRequest } from "@/lib/llm/logLlmRequest";

type TrackedOptions = {
  feature?: string;
  provider?: string;
};

function providerFromBaseURL(baseURL?: string | null): string {
  if (!baseURL) return "openai";
  if (baseURL.includes("groq.com")) return "groq";
  return "openai";
}

function responseText(completion: unknown): string | null {
  if (!completion || typeof completion !== "object") return null;
  const choices = (completion as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0]) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return null;
}

/**
 * Drop-in OpenAI client that records every chat.completions.create call
 * into public.llm_requests (best-effort, never throws from logging).
 */
export function getTrackedOpenAI(
  init?: ConstructorParameters<typeof OpenAI>[0],
  options: TrackedOptions = {},
): OpenAI {
  const client = new OpenAI(init);
  const provider =
    options.provider ?? providerFromBaseURL(init?.baseURL ?? null);
  const originalCreate = client.chat.completions.create.bind(
    client.chat.completions,
  );

  // Preserve OpenAI overload signatures while wrapping for logging.
  client.chat.completions.create = ((...args: unknown[]) => {
    const body = (args[0] ?? {}) as {
      model?: string;
      messages?: Array<{ role?: string; content?: unknown }>;
      stream?: boolean;
    };
    const started = Date.now();

    const run = async () => {
      try {
        const completion = await (
          originalCreate as (...a: unknown[]) => Promise<unknown>
        )(...args);
        const usage =
          completion && typeof completion === "object"
            ? (
                completion as {
                  usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                  };
                }
              ).usage
            : undefined;

        void logLlmRequest({
          feature: options.feature,
          provider,
          model: body.model ?? null,
          status: "ok",
          latencyMs: Date.now() - started,
          inputTokens: usage?.prompt_tokens ?? null,
          outputTokens: usage?.completion_tokens ?? null,
          messages: body.messages ?? null,
          responseText: body.stream ? "[stream]" : responseText(completion),
          meta: body.stream ? { stream: true } : undefined,
        });

        return completion;
      } catch (error) {
        void logLlmRequest({
          feature: options.feature,
          provider,
          model: body.model ?? null,
          status: "error",
          errorMessage:
            error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - started,
          messages: body.messages ?? null,
        });
        throw error;
      }
    };

    return run();
  }) as typeof client.chat.completions.create;

  return client;
}
