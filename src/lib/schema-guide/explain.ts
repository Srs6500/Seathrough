import OpenAI from "openai";
import { envPresence, getLlmConfig } from "@/lib/env";
import type { FactOrigin, SchemaGuide } from "@/lib/schema-guide/types";

export function schemaWriterMissing(): boolean {
  const presence = envPresence();
  if (presence.LLM_PROVIDER === "openai") return !presence.OPENAI_API_KEY;
  return !presence.GROQ_API_KEY;
}

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

type LlmTable = {
  purpose?: string;
  importantFields?: Array<{ name?: string; note?: string }>;
  behavior?: string;
};

type LlmPayload = {
  overview?: string;
  tables?: Record<string, LlmTable>;
  concepts?: Record<string, string>;
  actions?: Array<{ question?: string; tableIds?: string[] }>;
};

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export async function polishGuideWithLlm(guide: SchemaGuide): Promise<SchemaGuide> {
  try {
    const cfg = getLlmConfig();
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    });
    const allowedTables = new Set(guide.tables.map((table) => table.id));
    const facts = {
      overview: guide.overview,
      tables: guide.tables.map((table) => ({
        id: table.id,
        tableName: table.tableName,
        fields: table.fields
          .filter((field) => !field.isRelation)
          .map((field) => ({
            name: field.name,
            type: field.type,
            id: field.isId,
            unique: field.isUnique,
            doc: field.doc,
          })),
        relations: guide.relations
          .filter(
            (rel) => rel.fromTable === table.id || rel.toTable === table.id,
          )
          .map((rel) => ({
            to: rel.fromTable === table.id ? rel.toTable : rel.fromTable,
            kind: rel.kind,
            origin: rel.origin,
            field: rel.fromField,
          })),
        usages: table.usages.map((use) => ({
          file: use.file,
          line: use.line,
          op: use.operation,
          fn: use.functionName,
          callee: use.callee,
        })),
        heuristicPurpose: table.purpose,
        heuristicBehavior: table.behavior,
      })),
      concepts: guide.concepts.map((concept) => ({
        id: concept.id,
        label: concept.label,
        tableIds: concept.tableIds,
      })),
    };

    const completion = await client.chat.completions.create({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 1400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You explain a Prisma database to a beginner who built an app.
Return JSON {"overview":"","tables":{"Model":{"purpose":"","importantFields":[{"name":"","note":""}],"behavior":""}},"concepts":{"accounts":""},"actions":[{"question":"","tableIds":["Model"]}]}.
Rules:
- Use only the supplied tables, fields, relations, and code calls.
- Do not invent tables, fields, relationships, or files.
- Short plain sentences. No marketing.
- If code evidence is missing, say that — do not guess app behavior.
- Relation origin "declared" is in the schema. "implicit" is a Prisma back-relation or implicit many-to-many. Never upgrade implicit to declared.`,
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(raw) as LlmPayload;
    const next: SchemaGuide = {
      ...guide,
      explainedBy: "llm",
      overview: parsed.overview?.trim()
        ? clip(parsed.overview, 400)
        : guide.overview,
      overviewOrigin: parsed.overview?.trim() ? "llm" : guide.overviewOrigin,
      tables: guide.tables.map((table) => mergeTable(table, parsed.tables?.[table.id])),
      concepts: guide.concepts.map((concept) => ({
        ...concept,
        summary: parsed.concepts?.[concept.id]?.trim()
          ? clip(parsed.concepts[concept.id]!, 180)
          : concept.summary,
      })),
    };

    if (Array.isArray(parsed.actions) && parsed.actions.length) {
      const actions = parsed.actions
        .map((action, index) => ({
          id: `llm-${index}`,
          question: clip(String(action.question || ""), 120),
          tableIds: (action.tableIds ?? []).filter((id) => allowedTables.has(String(id))),
        }))
        .filter((action) => action.question);
      if (actions.length) next.actions = actions.slice(0, 6);
    }
    return next;
  } catch {
    return guide;
  }
}

function mergeTable(
  table: SchemaGuide["tables"][number],
  llm?: LlmTable,
): SchemaGuide["tables"][number] {
  if (!llm) return table;
  const allowed = new Set(table.fields.map((field) => field.name));
  const important = Array.isArray(llm.importantFields)
    ? llm.importantFields
        .filter((item) => item?.name && allowed.has(item.name))
        .map((item) => ({
          name: item.name!,
          note: clip(String(item.note || ""), 160),
          origin: "llm" as FactOrigin,
        }))
        .filter((item) => item.note)
    : [];
  return {
    ...table,
    purpose: llm.purpose?.trim() ? clip(llm.purpose, 200) : table.purpose,
    purposeOrigin: llm.purpose?.trim() ? "llm" : table.purposeOrigin,
    importantFields: important.length ? important : table.importantFields,
    behavior: llm.behavior?.trim() ? clip(llm.behavior, 240) : table.behavior,
    behaviorOrigin: llm.behavior?.trim()
      ? table.usages.length
        ? "llm"
        : table.behaviorOrigin
      : table.behaviorOrigin,
  };
}
