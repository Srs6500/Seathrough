import { getServiceSupabase } from "@/lib/supabase/server";
import { getLlmRequestContext } from "@/lib/llm/context";

const PREVIEW_LIMIT = 4_000;
const MESSAGE_LIMIT = 12;
const CONTENT_LIMIT = 6_000;

type ChatMessage = {
  role?: string;
  content?: unknown;
};

export type LogLlmRequestInput = {
  feature?: string;
  provider?: string | null;
  model?: string | null;
  status: "ok" | "error";
  errorMessage?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  messages?: ChatMessage[] | null;
  responseText?: string | null;
  meta?: Record<string, unknown>;
};

function clip(value: string, max = PREVIEW_LIMIT): string {
  const cleaned = value.replace(/\u0000/g, "").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") return record.text;
        if (record.type === "image_url" || record.type === "input_image") {
          return "[image]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function summarizeMessages(messages: ChatMessage[] | null | undefined) {
  const list = Array.isArray(messages) ? messages.slice(-MESSAGE_LIMIT) : [];
  let prompt = "";
  let systemPreview = "";
  const summarized = list.map((message) => {
    const role = message.role ?? "unknown";
    const text = clip(contentToText(message.content), CONTENT_LIMIT);
    if (role === "system" && !systemPreview) systemPreview = text;
    if (role === "user") prompt = text;
    return { role, content: text };
  });
  return {
    prompt: prompt ? clip(prompt) : null,
    systemPreview: systemPreview ? clip(systemPreview, 1_500) : null,
    messages: summarized,
  };
}

function inferFeatureFromStack(): string {
  const stack = new Error().stack ?? "";
  const match = stack.match(/\/src\/(?:app\/api|lib)\/([^:\n]+)/);
  if (!match?.[1]) return "unknown";
  const path = match[1]
    .replace(/\\/g, "/")
    .replace(/\.(ts|tsx|js|jsx)$/, "")
    .replace(/\/route$/, "")
    .replace(/\/index$/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "voice-tutor") return "voice-tutor";
  if (parts[0] === "browser-experience") return "browser";
  if (parts[0] === "experiment" && parts[1] === "systemDesign") {
    return "system-design";
  }
  if (parts[0] === "providers" && parts[1] === "llm") return "lesson-planner";
  if (parts[0] === "token-compression") return "token-compression";
  if (parts[0] === "explain-video" || parts[0] === "explainer-video") {
    return "explain-video";
  }
  if (parts[0] === "bug-analyzer") return "bug-analyzer";
  if (parts[0] === "schema-guide") return "schema-guide";
  if (parts[0] === "vibe-coder" || parts[0] === "data-flow") return parts[0];
  if (parts[0] === "ai-tutor" || parts[0] === "ai-tutor-v2") return "ai-tutor";
  if (parts[0] === "lesson") return "lesson";
  if (parts[0] === "anatomy") return "anatomy";
  if (parts[0] === "image-explain") return "image-explain";
  if (parts[0] === "scene-explain") return "scene-explain";
  if (parts[0] === "course-creator") return "course-creator";
  if (parts[0] === "xray") return "xray";
  if (parts[0] === "model3d") return "model3d";
  if (parts[0] === "visuals") return "visual-library";
  if (parts[0] === "automatic-drawing" || parts[0] === "draw-engine") {
    return "drawing";
  }
  return parts.slice(0, 2).join("/") || "unknown";
}

export async function logLlmRequest(input: LogLlmRequestInput): Promise<void> {
  try {
    const context = getLlmRequestContext();
    const summarized = summarizeMessages(input.messages);
    const supabase = getServiceSupabase();
    const { error } = await supabase.from("llm_requests").insert({
      feature: input.feature || context.feature || inferFeatureFromStack(),
      provider: input.provider ?? null,
      model: input.model ?? null,
      user_id: context.userId ?? null,
      anon_id: context.anonId ?? null,
      status: input.status,
      error_message: input.errorMessage
        ? clip(input.errorMessage, 1_000)
        : null,
      latency_ms: input.latencyMs ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      prompt: summarized.prompt,
      system_preview: summarized.systemPreview,
      response_preview: input.responseText
        ? clip(input.responseText)
        : null,
      messages: summarized.messages,
      meta: {
        ...(context.meta ?? {}),
        ...(input.meta ?? {}),
      },
    });
    if (error) {
      console.warn("[llm_requests] insert failed:", error.message);
    }
  } catch (error) {
    console.warn(
      "[llm_requests] log failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
