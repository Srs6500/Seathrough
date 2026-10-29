import OpenAI from "openai";
import { envPresence, getLlmConfig } from "@/lib/env";
import {
  explainKnowledgeGraph,
  queryKnowledgeGraph,
} from "@/lib/schema-guide/knowledgeGraph";
import type { FactOrigin, SchemaAskResult, SchemaGuide } from "@/lib/schema-guide/types";

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fence?.[1]?.trim() || trimmed;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("not-json");
  }
}

function writerMissing(): boolean {
  const presence = envPresence();
  if (presence.LLM_PROVIDER === "openai") return !presence.OPENAI_API_KEY;
  return !presence.GROQ_API_KEY;
}

export function heuristicAsk(question: string, guide: SchemaGuide): SchemaAskResult {
  const slice = queryKnowledgeGraph(question, guide);
  return explainKnowledgeGraph(question, guide, slice);
}

export async function answerSchemaQuestion(
  question: string,
  guide: SchemaGuide,
): Promise<SchemaAskResult> {
  const fallback = heuristicAsk(question, guide);
  if (writerMissing()) return fallback;

  try {
    const cfg = getLlmConfig();
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    const allowedTables = new Set(guide.tables.map((table) => table.id));
    const slice = fallback.graph;

    const completion = await client.chat.completions.create({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You answer one beginner question using only the knowledge-graph slice.
Return JSON {"answer":"","tableIds":[],"walkthrough":[{"step":1,"text":"","tableId":""}]}.
Rules:
- Use only these nodes and links. Do not invent lists.
- If the slice has no role, permission, or "says who belongs" link, say the app cannot restrict a person.
- If the question is about resetting a password and the slice has no password or reset-token link, say the app cannot reset a password.
- 2-4 short everyday sentences, then 2-4 steps.
- Never list unrelated tables. Do not mention firms, cases, or other lists unless they are in the slice and needed.
Forbidden in sentences: field, column, query, schema, Prisma, foreign key, file paths, camelCase, slice, knowledge graph.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            nodes: slice.nodes.map((node) => ({
              id: node.id,
              kind: node.kind,
              name: node.label,
              means: node.summary,
              tableId: node.tableId,
            })),
            links: slice.edges.map((edge) => ({
              from: edge.from,
              to: edge.to,
              means: edge.label,
            })),
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(raw) as {
      answer?: string;
      tableIds?: string[];
      walkthrough?: Array<{ step?: number; text?: string; tableId?: string }>;
    };

    const answer = parsed.answer?.trim().slice(0, 800) ?? "";
    if (!answer) return fallback;

    const tableIds = (parsed.tableIds ?? [])
      .filter((id) => allowedTables.has(id))
      .slice(0, 3);
    const walkthrough = (parsed.walkthrough ?? [])
      .map((item, index) => ({
        step: item.step ?? index + 1,
        text: String(item.text || "").trim().slice(0, 280),
        tableId:
          item.tableId && allowedTables.has(item.tableId) ? item.tableId : null,
        file: null,
        origin: "llm" as FactOrigin,
      }))
      .filter((item) => item.text)
      .slice(0, 4);

    return {
      answer,
      tableIds: tableIds.length ? tableIds : fallback.tableIds,
      files: [],
      walkthrough: walkthrough.length ? walkthrough : fallback.walkthrough,
      graph: slice,
    };
  } catch {
    return fallback;
  }
}
