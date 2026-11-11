import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";

export async function tutorComplete(
  system: string,
  user: string,
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const config = getLlmConfig();
  const client = getTrackedOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const completion = await client.chat.completions.create({
    model: config.model,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 700,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content: unknown = completion.choices[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === "object" && part && "text" in part
                ? String((part as { text?: string }).text ?? "")
                : String(part),
            )
            .join("")
            .trim()
        : "";
  if (!text) throw new Error("The model returned empty text.");
  return text;
}

export function clip(text: string, maxLen: number): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

export function parseLabeled(raw: string, key: string): string {
  const match = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "im").exec(
    raw || "",
  );
  return (match?.[1] || "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
