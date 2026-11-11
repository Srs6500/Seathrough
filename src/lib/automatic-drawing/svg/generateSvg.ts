import { getTrackedOpenAI } from "@/lib/llm/trackedOpenAI";
import { getLlmConfig } from "@/lib/env";
import {
  generatedSvgEnvelopeSchema,
  semanticDiagramSchema,
  type GeneratedSvgEnvelope,
  type SemanticDiagram,
} from "@/lib/automatic-drawing/svg/schema";
import { renderSemanticDiagram } from "@/lib/automatic-drawing/svg/layoutDiagram";
import { sanitizeGeneratedSvg } from "@/lib/automatic-drawing/svg/sanitize";

function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function drawingClient() {
  const openaiKey = optionalEnv("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      client: getTrackedOpenAI({ apiKey: openaiKey }),
      model: optionalEnv("VISUAL_MODEL") ?? "gpt-4.1",
      isGroq: false,
    };
  }
  const config = getLlmConfig();
  return {
    client: getTrackedOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }),
    model: config.model,
      isGroq: (config.baseURL ?? "").includes("groq.com"),
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1]?.trim() ?? trimmed;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Visual generator did not return a diagram specification");
  }
  return JSON.parse(source.slice(start, end + 1));
}

const SYSTEM_PROMPT = `You design semantic educational diagrams.
Return ONLY one JSON object describing the meaning of the diagram. Never write SVG,
coordinates, colors, dimensions, markdown, or rendering instructions.

Schema:
{
  "title": "3-52 chars",
  "kind": "relationship|process|timeline|hierarchy|comparison|cycle",
  "takeaway": "3-88 chars",
  "nodes": [
    {
      "id": "lowercase-kebab-case",
      "label": "1-28 chars",
      "detail": "1-38 chars",
      "role": "primary|supporting|outcome"
    }
  ],
  "edges": [
    { "from": "node-id", "to": "node-id", "label": "optional, max 26 chars" }
  ]
}

Use 4-6 topic-specific nodes and 3-9 meaningful edges. Process, timeline, and
comparison diagrams must use exactly 4 nodes. Every edge endpoint must exist. Use
exactly one primary node when the topic has a central concept. Keep text concise
enough to fit inside cards. Prefer factual relationships from the lesson. Do not
add legends or decorative concepts.`;

export type GenerateEducationalSvgInput = {
  prompt: string;
  lessonTitle: string;
  lessonSummary: string;
  lessonPoints: string[];
  evidence?: string;
  signal?: AbortSignal;
};

export type GeneratedEducationalSvg = GeneratedSvgEnvelope & {
  sanitizedSvg: string;
  dataUrl: string;
};

function groqOptions(isGroq: boolean) {
  return isGroq
    ? {
        reasoning_effort: "low" as const,
        include_reasoning: false,
      }
    : {};
}

function compactLabel(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

export function buildFallbackDiagram(
  input: GenerateEducationalSvgInput,
): SemanticDiagram {
  const points = input.lessonPoints
    .map((point) => point.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 5);
  while (points.length < 3) {
    points.push(
      input.lessonSummary.trim() || `Key idea ${points.length + 1}`,
    );
  }
  const nodes: SemanticDiagram["nodes"] = [
    {
      id: "main-topic",
      label: compactLabel(input.prompt || input.lessonTitle, 28),
      detail: compactLabel(input.lessonSummary || input.lessonTitle, 38),
      role: "primary",
    },
    ...points.map((point, index) => ({
      id: `idea-${index + 1}`,
      label: compactLabel(point.split(/[.:;!?]/)[0] || point, 28),
      detail: compactLabel(point, 38),
      role: index === points.length - 1 ? "outcome" as const : "supporting" as const,
    })),
  ];
  return semanticDiagramSchema.parse({
    title: compactLabel(input.lessonTitle, 52),
    kind: "relationship",
    takeaway: compactLabel(
      input.lessonSummary || input.lessonPoints[0] || input.prompt,
      88,
    ),
    nodes,
    edges: nodes.slice(1).map((node) => ({
      from: "main-topic",
      to: node.id,
    })),
  });
}

async function renderGeneratedDiagram(
  input: GenerateEducationalSvgInput,
  diagram: SemanticDiagram,
): Promise<GeneratedEducationalSvg> {
  const rendered = await renderSemanticDiagram(diagram);
  if (!rendered.inspection.pass) {
    throw new Error(rendered.inspection.issues.join(" "));
  }
  const safe = sanitizeGeneratedSvg(rendered.svg);
  const envelope = generatedSvgEnvelopeSchema.parse({
    title: diagram.title,
    alt: `A structured ${diagram.kind} diagram for ${input.lessonTitle}.`.slice(
      0,
      320,
    ),
    svg: rendered.svg,
  });
  return {
    ...envelope,
    sanitizedSvg: safe.svg,
    dataUrl: safe.dataUrl,
  };
}

export async function generateEducationalSvg(
  input: GenerateEducationalSvgInput,
): Promise<GeneratedEducationalSvg> {
  try {
    const { client, model, isGroq } = drawingClient();
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.1,
        max_tokens: 1_600,
        ...groqOptions(isGroq),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              task: input.prompt,
              lessonTitle: input.lessonTitle,
              lessonSummary: input.lessonSummary,
              lessonPoints: input.lessonPoints.slice(0, 8),
              groundingEvidence: input.evidence?.slice(0, 4_000),
            }),
          },
        ],
      },
      input.signal ? { signal: input.signal } : undefined,
    );

    const content = completion.choices[0]?.message?.content;
    if (!content?.trim()) {
      throw new Error("Visual generator returned no diagram specification");
    }
    const parsed = semanticDiagramSchema.safeParse(extractJson(content));
    if (!parsed.success) {
      throw new Error(
        `Generated diagram specification failed validation: ${
          parsed.error.issues[0]?.message ?? "invalid response"
        }`,
      );
    }
    return await renderGeneratedDiagram(input, parsed.data);
  } catch (error) {
    const abortName =
      input.signal?.reason instanceof Error ? input.signal.reason.name : "";
    if (input.signal?.aborted && abortName !== "TimeoutError") throw error;
    return await renderGeneratedDiagram(input, buildFallbackDiagram(input));
  }
}
