import { clientAccessor } from "@/lib/schema-guide/parsePrisma";
import type { CodeOperation, CodeUsage } from "@/lib/schema-guide/types";

const OPS: Record<string, CodeOperation> = {
  create: "create",
  createMany: "create",
  createManyAndReturn: "create",
  update: "update",
  updateMany: "update",
  delete: "delete",
  deleteMany: "delete",
  upsert: "upsert",
  findUnique: "read",
  findUniqueOrThrow: "read",
  findFirst: "read",
  findFirstOrThrow: "read",
  findMany: "read",
  count: "count",
  aggregate: "count",
  groupBy: "read",
};

const CALLER =
  /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)|(?:export\s+)?(?:const|let)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:\(|function\b)/;

function operationFor(name: string): CodeOperation {
  return OPS[name] ?? "other";
}

function functionNear(source: string, index: number): string | null {
  const window = source.slice(Math.max(0, index - 800), index);
  let found: string | null = null;
  let match: RegExpExecArray | null;
  const re = new RegExp(CALLER.source, "g");
  while ((match = re.exec(window))) {
    found = match[1] || match[2] || found;
  }
  return found;
}

export function findPrismaUsages(
  files: Array<{ path: string; content: string }>,
  modelNames: string[],
  relationFields: Array<{ from: string; field: string; to: string }> = [],
): CodeUsage[] {
  const accessors = new Map<string, string>();
  for (const name of modelNames) {
    accessors.set(clientAccessor(name), name);
    accessors.set(name, name);
    accessors.set(name.toLowerCase(), name);
    if (!/s$/i.test(name)) accessors.set(`${name.toLowerCase()}s`, name);
  }
  const names = [...accessors.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return [];

  const nameAlt = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const dotted = new RegExp(
    `(?:prisma|db|tx|client)\\s*\\.\\s*(${nameAlt})\\s*\\.\\s*([A-Za-z_]\\w*)`,
    "g",
  );
  const indexed = new RegExp(
    `(?:prisma|db|tx|client)\\s*\\[\\s*['"\`](${nameAlt})['"\`]\\s*\\]\\s*\\.\\s*([A-Za-z_]\\w*)`,
    "g",
  );

  const usages: CodeUsage[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx|py)$/i.test(file.path)) continue;
    const content = file.content;
    const lines = content.split("\n");
    for (const re of [dotted, indexed]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content))) {
        const accessor = match[1] ?? "";
        const op = match[2] ?? "";
        const tableId = accessors.get(accessor);
        if (!tableId) continue;
        const index = match.index ?? 0;
        const line = content.slice(0, index).split("\n").length;
        const snippet = (lines[line - 1] ?? match[0]).trim().slice(0, 180);
        const key = `${tableId}|${file.path}|${line}|${op}`;
        if (seen.has(key)) continue;
        seen.add(key);
        usages.push({
          tableId,
          file: file.path,
          line,
          operation: operationFor(op),
          callee: `${accessor}.${op}`,
          snippet,
          functionName: functionNear(content, index),
        });
        if (op === "create" || op === "update" || op === "upsert") {
          const window = content.slice(index, index + 500);
          for (const rel of relationFields) {
            if (rel.from !== tableId) continue;
            const nested = new RegExp(
              `\\b${rel.field}\\s*:\\s*\\{\\s*(create|createMany|connectOrCreate)`,
            );
            if (!nested.test(window)) continue;
            const nestKey = `${rel.to}|${file.path}|${line}|nested`;
            if (seen.has(nestKey)) continue;
            seen.add(nestKey);
            usages.push({
              tableId: rel.to,
              file: file.path,
              line,
              operation: "create",
              callee: `${rel.field}.create`,
              snippet,
              functionName: functionNear(content, index),
            });
          }
        }
      }
    }
  }

  for (const file of files) {
    const content = file.content;
    const lines = content.split("\n");
    const query = new RegExp(
      `\\.(?:from|collection)\\(\\s*['"\`](${nameAlt})['"\`]\\s*\\)|\\b(${nameAlt})\\.objects\\.(create|filter|get|update|delete)|session\\.(?:query|add)\\(\\s*(${nameAlt})`,
      "g",
    );
    let match: RegExpExecArray | null;
    while ((match = query.exec(content))) {
      const accessor = match[1] || match[2] || match[4] || "";
      const tableId = accessors.get(accessor) ?? accessors.get(clientAccessor(accessor));
      if (!tableId) continue;
      const index = match.index ?? 0;
      const line = content.slice(0, index).split("\n").length;
      const snippet = (lines[line - 1] ?? match[0]).trim().slice(0, 180);
      const djangoOp = match[3];
      const op = djangoOp
        ? djangoOp === "create"
          ? "create"
          : djangoOp === "update"
            ? "update"
            : djangoOp === "delete"
              ? "delete"
              : "read"
        : /\.(insert|create|upsert)\b/i.test(snippet)
          ? "create"
          : /\.(update)\b/i.test(snippet)
            ? "update"
            : /\.(delete)\b/i.test(snippet)
              ? "delete"
              : "read";
      const key = `${tableId}|${file.path}|${line}|${op}`;
      if (seen.has(key)) continue;
      seen.add(key);
      usages.push({
        tableId,
        file: file.path,
        line,
        operation: op,
        callee: match[0].replace(/\s+/g, " ").slice(0, 80),
        snippet,
        functionName: functionNear(content, index),
      });
    }
  }

  return usages.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
