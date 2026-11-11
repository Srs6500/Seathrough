import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import {
  libraryCatalogForPrompt,
  loadAllDrawingLibraries,
} from "@/lib/automatic-drawing/library";
import { materializeScene } from "@/lib/automatic-drawing/placeElements";
import {
  excalidrawScenePlanSchema,
  type MaterializedScene,
} from "@/lib/automatic-drawing/schema";

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

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Model did not return JSON");
}

function buildSystemPrompt(packs?: string[]): string {
  let catalog = libraryCatalogForPrompt(260, packs ? { packs } : undefined);
  const catalogEmpty = catalog.includes("Shapes (use itemIndex):\n") && catalog.trim().endsWith("Shapes (use itemIndex):");
  const usedPacks = catalogEmpty ? undefined : packs;
  if (catalogEmpty) {
    catalog = libraryCatalogForPrompt();
  }
  const focus = usedPacks?.length
    ? `This is a SYSTEM DESIGN diagram. Prefer clients on the left, services in the middle, data stores on the right. Show the request path. Label every box. Use 4–10 placements.`
    : `Pick shapes from packs that match the user's topic (architecture, biology, math, UML, cards, stick figures, etc.).`;

  return `You design simple whiteboard diagrams using ONLY shapes from a fixed Excalidraw library collection.

Return ONLY valid JSON:
{
  "title": string,
  "placements": [
    { "itemIndex": number, "x": number, "y": number, "label": string (optional) }
  ]
}

Canvas is roughly 1100×700. Keep shapes inside margins (40–1000 x, 40–620 y).
Space items so they do not heavily overlap.
${focus}
Use short labels when helpful.

${catalog}

Do not invent shapes outside this catalog. itemIndex must match the list above.`;
}

export const SYSTEM_DESIGN_PACKS = [
  "software-architecture",
  "system-design",
  "decision-flow-control",
  "uml-library-activity-diagram",
  "data-viz",
] as const;

export async function generateExcalidrawScene(
  description: string,
  options?: { packs?: string[] },
): Promise<MaterializedScene> {
  const trimmed = description.trim();
  if (!trimmed) throw new Error("Description is required");
  if (trimmed.length > 800) {
    throw new Error("Description is too long (max 800 characters)");
  }

  const librarySize = loadAllDrawingLibraries().length;
  if (!librarySize) {
    throw new Error("No Excalidraw libraries found in assets/drawings");
  }

  const { client, model } = getDrawingClient();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(options?.packs) },
      { role: "user", content: `Diagram this:\n${trimmed}` },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("Empty diagram plan from model");
  }

  const raw = extractJson(content);
  const parsed = excalidrawScenePlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Diagram plan failed validation");
  }

  const cleaned = {
    ...parsed.data,
    placements: parsed.data.placements.filter(
      (p) => p.itemIndex >= 0 && p.itemIndex < librarySize,
    ),
  };
  if (!cleaned.placements.length) {
    throw new Error("No valid library shapes selected");
  }

  return materializeScene(cleaned);
}
