import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getDrawingClient() {
  const openaiKey = optionalEnv("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      client: getTrackedOpenAI({ apiKey: openaiKey }),
      model: optionalEnv("OPENAI_MODEL") ?? "gpt-4.1",
    };
  }
  const cfg = getLlmConfig();
  return {
    client: getTrackedOpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    }),
    model: cfg.model,
  };
}

const EXPAND_SYSTEM = `You turn a short drawing request into a richer hand-drawn scene brief.

Return ONLY valid JSON:
{
  "expandedPrompt": string,
  "title": string
}

Rules:
1. Keep the user's core subject. Do not change what they asked for (e.g. pentagon stays a pentagon with exactly 5 sides).
2. Expand into 2–5 sentences describing a layered scene: background atmosphere, main subject parts, foreground accents.
3. Name concrete parts to draw (hull, mast, sails, hills, windows, etc.) and suggest soft color washes then ink outlines.
4. Prefer compositional language for stroke/fill drawing — not photorealism, not labels unless needed.
5. Stay under 600 characters for expandedPrompt.
6. title: short (2–6 words).
7. JSON only.`;

export type ExpandedPrompt = {
  originalPrompt: string;
  expandedPrompt: string;
  title: string;
};

export async function expandDrawingPrompt(
  description: string,
): Promise<ExpandedPrompt> {
  const trimmed = description.trim();
  if (!trimmed) throw new Error("Description is required");

  const { client, model } = getDrawingClient();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: EXPAND_SYSTEM },
      {
        role: "user",
        content: `Short request:\n${trimmed}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("Could not expand drawing prompt");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content.trim());
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      raw = JSON.parse(content.slice(start, end + 1));
    } else {
      throw new Error("Expanded prompt was not valid JSON");
    }
  }

  const obj = raw as { expandedPrompt?: unknown; title?: unknown };
  const expanded =
    typeof obj.expandedPrompt === "string" ? obj.expandedPrompt.trim() : "";
  const title = typeof obj.title === "string" ? obj.title.trim() : "";

  if (!expanded) {
    // Soft fallback — still proceed with original
    return {
      originalPrompt: trimmed,
      expandedPrompt: trimmed,
      title: title || trimmed.slice(0, 40),
    };
  }

  return {
    originalPrompt: trimmed,
    expandedPrompt: expanded.slice(0, 800),
    title: (title || trimmed.slice(0, 40)).slice(0, 80),
  };
}
