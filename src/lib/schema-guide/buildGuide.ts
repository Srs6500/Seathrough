import { findPrismaUsages } from "@/lib/schema-guide/findUsage";
import {
  polishGuideWithLlm,
  schemaWriterMissing,
} from "@/lib/schema-guide/explain";
import {
  conceptFor,
  connectionSentences,
  groupConcepts,
  heuristicBehavior,
  heuristicFieldNotes,
  heuristicPurpose,
  overviewSentence,
  sampleRows,
  suggestActions,
} from "@/lib/schema-guide/heuristics";
import { computeSchemaStats, describeDatabase } from "@/lib/schema-guide/database";
import { buildBackendStories } from "@/lib/schema-guide/backendStory";
import { buildKnowledgeGraph } from "@/lib/schema-guide/knowledgeGraph";
import {
  parseSchemaFiles,
  schemaOriginLabel,
} from "@/lib/schema-guide/parseSchema";
import { sampleProjectFiles } from "@/lib/schema-guide/sampleProject";
import type { SchemaGuide, TableGuide, UploadedFile } from "@/lib/schema-guide/types";

const MAX_FILES = 70;
const MAX_FILE_CHARS = 80_000;
const MAX_TOTAL_CHARS = 1_200_000;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|py|sql|rb|prisma)$/i;

export function isSchemaPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return (
    /\.prisma$/i.test(p) ||
    /\.sql$/i.test(p) ||
    /(^|\/)models\.py$/i.test(p) ||
    /(^|\/)models\/.+\.py$/i.test(p) ||
    /(^|\/)schema\.rb$/i.test(p) ||
    /(^|\/)schema\.(ts|js)$/i.test(p)
  );
}

export function sanitizeFiles(input: UploadedFile[]): UploadedFile[] {
  const files: UploadedFile[] = [];
  let total = 0;
  for (const file of input) {
    if (files.length >= MAX_FILES) break;
    const path = String(file.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path || path.includes("..")) continue;
    if (/(^|\/)(node_modules|\.git|\.next|dist|build|coverage|venv|\.venv|__pycache__)(\/|$)/i.test(path)) {
      continue;
    }
    if (!isSchemaPath(path) && !SOURCE_EXT.test(path)) continue;
    const content = String(file.content || "");
    if (!content.trim()) continue;
    if (content.length > MAX_FILE_CHARS) continue;
    total += content.length;
    if (total > MAX_TOTAL_CHARS) break;
    files.push({ path, content });
  }
  return files;
}

function schemaText(files: UploadedFile[]): { path: string; content: string } | null {
  const preferred =
    files.find((file) => /schema\.prisma$/i.test(file.path)) ??
    files.find((file) => isSchemaPath(file.path));
  return preferred ?? null;
}

export function buildGuideFromFiles(input: UploadedFile[]): SchemaGuide {
  const files = sanitizeFiles(input);
  const parsed = parseSchemaFiles(files);
  const schema =
    parsed.sourcePath
      ? files.find((file) => file.path === parsed.sourcePath) ?? schemaText(files)
      : schemaText(files);
  const usages = findPrismaUsages(
    files.filter((file) => SOURCE_EXT.test(file.path)),
    parsed.models.map((model) => model.modelName),
    parsed.models.flatMap((model) =>
      model.fields
        .filter((field) => field.isRelation)
        .map((field) => ({
          from: model.modelName,
          field: field.name,
          to: field.type,
        })),
    ),
  );

  const tables: TableGuide[] = parsed.models.map((model) => {
    const tableUsages = usages.filter((use) => use.tableId === model.modelName);
    const behavior = heuristicBehavior(model.modelName, tableUsages);
    const purpose = model.doc?.trim() || heuristicPurpose(model);
    return {
      id: model.modelName,
      modelName: model.modelName,
      tableName: model.tableName,
      purpose,
      purposeOrigin: model.doc?.trim() ? "schema" : "heuristic",
      importantFields: heuristicFieldNotes(model, parsed.relations),
      connections: connectionSentences(model.modelName, parsed.relations),
      behavior: behavior.text,
      behaviorOrigin: behavior.origin,
      fields: model.fields,
      relationIds: parsed.relations
        .filter(
          (rel) => rel.fromTable === model.modelName || rel.toTable === model.modelName,
        )
        .map((rel) => rel.id),
      usages: tableUsages,
      sampleRows: sampleRows(model),
      concept: conceptFor(model.modelName),
    };
  });

  const enums = parsed.enums;
  const guide: SchemaGuide = {
    title: inferTitle(files, tables),
    overview: overviewSentence(tables),
    overviewOrigin: "heuristic",
    database: describeDatabase(parsed.provider, tables.length, parsed.origin),
    stats: computeSchemaStats({
      tables,
      relations: parsed.relations,
      enums,
    }),
    schemaSource: schema
      ? { path: schema.path, content: schema.content }
      : null,
    enums,
    tables,
    relations: parsed.relations,
    concepts: groupConcepts(tables),
    actions: suggestActions(tables),
    warnings:
      parsed.origin === "prisma" || parsed.origin === "none"
        ? parsed.warnings
        : [
            ...parsed.warnings,
            `No Prisma schema. Tables were read from ${schemaOriginLabel(parsed.origin)}.`,
          ],
    explainedBy: "heuristic",
    files: files.map((file) => ({
      path: file.path,
      kind: isSchemaPath(file.path) ? "schema" : "source",
    })),
  };
  guide.knowledge = buildKnowledgeGraph(guide);
  guide.backend = buildBackendStories(guide);

  return guide;
}

function inferTitle(files: UploadedFile[], tables: TableGuide[]): string {
  const schema = files.find((file) => isSchemaPath(file.path));
  const folder = schema?.path.split("/").slice(0, -1).find((part) => part && part !== "prisma");
  if (folder && folder !== "src") return folder;
  if (tables.some((table) => /order|product|customer/i.test(table.id))) {
    return "Shop";
  }
  return "Schema";
}

export async function analyzeSchemaFiles(
  input: UploadedFile[] | "demo",
): Promise<SchemaGuide> {
  const files = input === "demo" ? sampleProjectFiles() : sanitizeFiles(input);
  const guide = buildGuideFromFiles(files);
  const next = schemaWriterMissing() ? guide : await polishGuideWithLlm(guide);
  const polished = { ...next, knowledge: buildKnowledgeGraph(next) };
  return { ...polished, backend: buildBackendStories(polished) };
}
