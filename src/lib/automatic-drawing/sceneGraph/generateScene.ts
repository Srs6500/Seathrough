import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import {
  countLeaves,
  sceneGraphSchema,
  type SceneGraph,
} from "@/lib/automatic-drawing/sceneGraph/schema";

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

/**
 * System prompt mirrors aiSketch's scene-graph approach:
 * hierarchical components → fill regions → layered named strokes.
 */
const SYSTEM_PROMPT = `You are a hand-drawn scene composer. You output a semantic scene GRAPH (not an image, not SVG).

Return ONLY valid JSON matching this shape:
{
  "name": "short title",
  "version": "1.0",
  "mode": "draw",
  "background": "#ffffff",
  "canvas": { "width": 900, "height": 600 },
  "root": {
    "name": "scene",
    "type": "component",
    "children": [ /* fill | stroke | component nodes */ ]
  }
}

Node types:
1) fill — soft color regions behind lines
   { "name":"sky", "type":"fill", "layer":0, "color":"#b5cde0", "opacity":0.45,
     "points":[[0,0],[900,0],[900,280],[0,290]] }

2) stroke — marker/pen lines (main drawing)
   { "name":"hull", "type":"stroke", "layer":3, "style":"outline", "color":"#1a2b3c",
     "weight":1.2, "points":[[120,400],[300,420],[480,400],[300,380],[120,400]] }

3) component — named group of children
   { "name":"boat", "type":"component", "children":[ ... ] }

Styles (pick intentionally):
outline, outline-bold, outline-fine, detail, hatching, crosshatch, sketch,
gesture, underdrawing, soft, wash, scumble, texture, accent, highlight, construction

Composition rules (critical):
1. Canvas 900×600. Keep points inside margins ~20–880 x, 20–580 y.
2. Build 12–40 leaf nodes (fills + strokes). Prefer structure over sparsity.
3. Draw back-to-front with layers: 0 background fills → mid shapes → 5–8 foreground accents.
4. For each major object: optional underdrawing stroke, then outline, then detail/hatching.
5. Soft fills first (sky, water, ground, shadows) with low opacity (0.1–0.5).
6. Closed outlines should repeat the first point at the end.
7. Use 3–12 points per stroke; curves need more points, straight edges fewer.
8. Group related parts under components (e.g. "boat", "sun", "hills").
9. Hand-drawn look: slightly imperfect points OK; avoid perfect geometry unless asked.
10. Colors: muted hex. Dark ink for outlines (#1a1a1a / #1a2b3c). Soft fills for atmosphere.
11. No text nodes. No photorealism. JSON only.

Tiny example (structure only — expand for real prompts):
{
  "name": "sailboat",
  "version": "1.0",
  "mode": "draw",
  "background": "#f7f4ef",
  "canvas": { "width": 900, "height": 600 },
  "root": {
    "name": "scene",
    "type": "component",
    "children": [
      { "name": "sky", "type": "fill", "layer": 0, "color": "#c9daf0", "opacity": 0.4,
        "points": [[0,0],[900,0],[900,320],[0,340]] },
      { "name": "water", "type": "fill", "layer": 1, "color": "#7aa7c7", "opacity": 0.35,
        "points": [[0,360],[900,350],[900,600],[0,600]] },
      { "name": "sun", "type": "component", "children": [
        { "name": "sun-disk", "type": "stroke", "layer": 2, "style": "soft", "color": "#d4a017",
          "weight": 1.4, "points": [[700,110],[740,90],[780,110],[760,150],[720,150],[700,110]] }
      ]},
      { "name": "boat", "type": "component", "children": [
        { "name": "hull", "type": "stroke", "layer": 4, "style": "outline-bold", "color": "#3a2518",
          "weight": 1.2, "points": [[300,420],[450,440],[600,420],[450,400],[300,420]] },
        { "name": "mast", "type": "stroke", "layer": 4, "style": "outline", "color": "#1a1a1a",
          "points": [[450,400],[450,220]] },
        { "name": "sail", "type": "stroke", "layer": 5, "style": "sketch", "color": "#1b6ca8",
          "points": [[450,230],[560,360],[450,380],[450,230]] }
      ]}
    ]
  }
}`;

export async function generateSceneGraph(
  brief: string,
  signal?: AbortSignal,
): Promise<SceneGraph> {
  const { client, model } = getDrawingClient();

  const completion = await client.chat.completions.create(
    {
      model,
      temperature: 0.45,
      max_tokens: 3500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Compose a hand-drawn scene graph for this brief:\n${brief}\n\nReturn the full JSON scene now.`,
        },
      ],
    },
    signal ? { signal } : undefined,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("Empty scene graph from model");
  }

  const raw = extractJson(content);
  const parsed = sceneGraphSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Scene graph failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }

  const leaves = countLeaves(parsed.data.root);
  if (leaves < 4) {
    throw new Error("Scene graph too sparse — try a richer prompt");
  }
  if (leaves > 80) {
    // Soft clamp: still usable, but warn via truncate? Keep as-is; playback may be slow.
  }

  return parsed.data;
}
