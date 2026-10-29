import type { SchemaField, SchemaRelation } from "@/lib/schema-guide/types";

export type ParsedPrismaModel = {
  modelName: string;
  tableName: string;
  doc: string | null;
  fields: SchemaField[];
  compositeId: boolean;
};

export type ParsedPrismaSchema = {
  models: ParsedPrismaModel[];
  enums: string[];
  relations: SchemaRelation[];
  warnings: string[];
  provider: string | null;
};

const BLOCK = /\b(model|enum)\s+([A-Za-z_]\w*)\s*\{/g;
const ATTR_NAME = /@(?!@)(\w+)/g;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "");
}

function extractDocLines(source: string, start: number): string | null {
  const before = source.slice(0, start);
  const lines = before.split("\n");
  const docs: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    const match = line.match(/^\s*\/\/\/\s?(.*)$/);
    if (match) {
      docs.unshift((match[1] ?? "").trim());
      continue;
    }
    if (line.trim() === "") continue;
    break;
  }
  return docs.length ? docs.join(" ") : null;
}

function findBlockEnd(source: string, openBrace: number): number {
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitArgs(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "[" || ch === "(") depth += 1;
    if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseAttributes(raw: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  let i = 0;
  while (i < raw.length) {
    const at = raw.indexOf("@", i);
    if (at < 0) break;
    if (raw[at + 1] === "@") {
      i = at + 2;
      continue;
    }
    ATTR_NAME.lastIndex = at;
    const match = ATTR_NAME.exec(raw);
    if (!match) break;
    const name = match[1] ?? "";
    let next = ATTR_NAME.lastIndex;
    if (raw[next] === "(") {
      let depth = 0;
      let end = next;
      for (; end < raw.length; end++) {
        if (raw[end] === "(") depth += 1;
        else if (raw[end] === ")") {
          depth -= 1;
          if (depth === 0) {
            end += 1;
            break;
          }
        }
      }
      attrs[name] = raw.slice(next + 1, end - 1).trim();
      i = end;
    } else {
      attrs[name] = true;
      i = next;
    }
  }
  return attrs;
}

function parseModelAttributes(body: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  const re = /@@(\w+)(?:\(([\s\S]*?)\))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    attrs[match[1] ?? ""] = match[2]?.trim() || true;
  }
  return attrs;
}

function firstIdentList(value: string | true | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\[([^\]]+)\]/);
  if (!match?.[1]) return null;
  return (
    match[1]
      .split(",")
      .map((part) => part.trim())
      .find(Boolean) ?? null
  );
}

function relationMeta(value: string | true | undefined): {
  name: string | null;
  fields: string[];
  references: string[];
  onDelete: string | null;
} {
  if (value === true || value == null) {
    return { name: null, fields: [], references: [], onDelete: null };
  }
  const named = value.match(/^"([^"]+)"|^'([^']+)'/);
  const fieldsMatch = value.match(/fields\s*:\s*\[([^\]]*)\]/);
  const refsMatch = value.match(/references\s*:\s*\[([^\]]*)\]/);
  const deleteMatch = value.match(/onDelete\s*:\s*(\w+)/);
  return {
    name: named?.[1] || named?.[2] || null,
    fields: fieldsMatch?.[1]
      ? splitArgs(fieldsMatch[1]).map((part) => part.trim()).filter(Boolean)
      : [],
    references: refsMatch?.[1]
      ? splitArgs(refsMatch[1]).map((part) => part.trim()).filter(Boolean)
      : [],
    onDelete: deleteMatch?.[1] ?? null,
  };
}

function parseFieldLine(
  line: string,
  enums: Set<string>,
  models: Set<string>,
  doc: string | null,
): SchemaField | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
    return null;
  }
  const match = trimmed.match(
    /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?(.*)$/,
  );
  if (!match) return null;
  const name = match[1]!;
  const type = match[2]!;
  const list = Boolean(match[3]);
  const optional = Boolean(match[4]);
  const attrs = parseAttributes(match[5] ?? "");
  const isRelation = models.has(type) && !enums.has(type);
  return {
    name,
    type,
    optional,
    list,
    isId: attrs.id === true,
    isUnique: attrs.unique === true,
    isRelation,
    defaultValue: typeof attrs.default === "string" ? attrs.default : null,
    dbName: typeof attrs.map === "string" ? attrs.map.replace(/^["']|["']$/g, "") : null,
    doc,
  };
}

function relationId(
  fromTable: string,
  toTable: string,
  fromField: string,
): string {
  return `${fromTable}.${fromField}->${toTable}`;
}

function collectFieldAttrs(
  body: string,
): Map<string, ReturnType<typeof parseAttributes>> {
  const map = new Map<string, ReturnType<typeof parseAttributes>>();
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const match = line.match(/^([A-Za-z_]\w*)\s+[A-Za-z_]\w*/);
    if (!match?.[1]) continue;
    const rest = line.replace(/^[A-Za-z_]\w*\s+[A-Za-z_]\w*(?:\[\])?\??/, "");
    map.set(match[1], parseAttributes(rest));
  }
  return map;
}

function parseDatasourceProvider(source: string): string | null {
  const block = source.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/);
  if (!block?.[1]) return null;
  const provider = block[1].match(/provider\s*=\s*["']([^"']+)["']/);
  return provider?.[1]?.trim() || null;
}

export function parsePrismaSchema(source: string): ParsedPrismaSchema {
  const cleaned = stripComments(source);
  const warnings: string[] = [];
  const provider = parseDatasourceProvider(cleaned);
  const enums: string[] = [];
  const models: ParsedPrismaModel[] = [];
  const enumSet = new Set<string>();
  const modelNames: string[] = [];

  let match: RegExpExecArray | null;
  BLOCK.lastIndex = 0;
  const blocks: Array<{
    kind: "model" | "enum";
    name: string;
    body: string;
    start: number;
  }> = [];
  while ((match = BLOCK.exec(cleaned))) {
    const kind = match[1] as "model" | "enum";
    const name = match[2]!;
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = findBlockEnd(cleaned, open);
    if (close < 0) {
      warnings.push(`Unclosed ${kind} ${name}.`);
      continue;
    }
    const body = cleaned.slice(open + 1, close);
    blocks.push({ kind, name, body, start: match.index ?? 0 });
    BLOCK.lastIndex = close + 1;
    if (kind === "enum") {
      enums.push(name);
      enumSet.add(name);
    } else {
      modelNames.push(name);
    }
  }

  const modelSet = new Set(modelNames);

  for (const block of blocks) {
    if (block.kind !== "model") continue;
    const modelAttrs = parseModelAttributes(block.body);
    const mapped =
      typeof modelAttrs.map === "string"
        ? modelAttrs.map.replace(/^["']|["']$/g, "")
        : block.name;
    const fields: SchemaField[] = [];
    const lines = source.length ? block.body.split("\n") : [];
    // Use cleaned body for fields; docs come from original when possible.
    const originalBodyStart = source.indexOf(`model ${block.name}`);
    const modelDoc =
      originalBodyStart >= 0 ? extractDocLines(source, originalBodyStart) : null;
    let cursor = originalBodyStart >= 0 ? originalBodyStart : 0;
    for (const raw of lines) {
      const inOriginal = source.indexOf(raw, cursor);
      const doc =
        inOriginal >= 0 ? extractDocLines(source, inOriginal) : null;
      if (inOriginal >= 0) cursor = inOriginal + raw.length;
      const field = parseFieldLine(raw, enumSet, modelSet, doc);
      if (field) fields.push(field);
    }
    models.push({
      modelName: block.name,
      tableName: mapped || block.name,
      doc: modelDoc,
      fields,
      compositeId: typeof modelAttrs.id === "string",
    });
  }

  const fieldAttrs = new Map<string, Map<string, ReturnType<typeof parseAttributes>>>();
  for (const block of blocks) {
    if (block.kind !== "model") continue;
    fieldAttrs.set(block.name, collectFieldAttrs(block.body));
  }

  const relations: SchemaRelation[] = [];
  const pairKey = new Set<string>();

  function addRelation(rel: SchemaRelation) {
    const key = `${rel.fromTable}|${rel.toTable}|${rel.fromField}|${rel.toField ?? ""}|${rel.kind}|${rel.origin}`;
    if (pairKey.has(key)) return;
    pairKey.add(key);
    relations.push(rel);
  }

  type RelField = {
    model: ParsedPrismaModel;
    field: SchemaField;
    meta: ReturnType<typeof relationMeta>;
  };
  const relFields: RelField[] = [];
  for (const model of models) {
    const attrsForModel = fieldAttrs.get(model.modelName);
    for (const field of model.fields) {
      if (!field.isRelation) continue;
      relFields.push({
        model,
        field,
        meta: relationMeta(attrsForModel?.get(field.name)?.relation),
      });
    }
  }

  for (const { model, field, meta } of relFields) {
    const hasFk = meta.fields.length > 0 && meta.references.length > 0;
    if (!hasFk) continue;
    addRelation({
      id: relationId(model.modelName, field.type, field.name),
      fromTable: model.modelName,
      toTable: field.type,
      fromField: meta.fields[0] ?? field.name,
      toField: meta.references[0] ?? "id",
      kind: field.list ? "one-to-many" : field.optional ? "one-to-one" : "one-to-one",
      origin: "declared",
      onDelete: meta.onDelete,
      name: meta.name,
    });
  }

  function declaredPair(a: string, b: string): boolean {
    return relations.some(
      (rel) =>
        rel.origin === "declared" &&
        ((rel.fromTable === a && rel.toTable === b) ||
          (rel.fromTable === b && rel.toTable === a)),
    );
  }

  for (const { model, field, meta } of relFields) {
    const hasFk = meta.fields.length > 0 && meta.references.length > 0;
    if (hasFk) continue;
    const target = models.find((item) => item.modelName === field.type);
    const back = target?.fields.find(
      (other) => other.isRelation && other.type === model.modelName,
    );
    const bothLists = Boolean(field.list && back?.list);
    if (bothLists && !declaredPair(model.modelName, field.type)) {
      const [a, b] = [model.modelName, field.type].sort();
      const implicitId = `implicit:${a}<->${b}`;
      if (!relations.some((rel) => rel.id === implicitId)) {
        addRelation({
          id: implicitId,
          fromTable: model.modelName,
          toTable: field.type,
          fromField: field.name,
          toField: back?.name ?? null,
          kind: "many-to-many",
          origin: "implicit",
          onDelete: null,
          name: meta.name,
        });
      }
      continue;
    }
    if (declaredPair(model.modelName, field.type)) continue;
    addRelation({
      id: relationId(model.modelName, field.type, field.name),
      fromTable: model.modelName,
      toTable: field.type,
      fromField: field.name,
      toField: back?.name ?? null,
      kind: field.list ? "one-to-many" : "one-to-one",
      origin: "implicit",
      onDelete: null,
      name: meta.name,
    });
  }

  // Prefer declared FK kind: if A.orders[] and B.customer User @relation(fields),
  // the declared edge should be one-to-many from Order → Customer, not one-to-one.
  for (const rel of relations) {
    if (rel.origin !== "declared") continue;
    const from = models.find((model) => model.modelName === rel.fromTable);
    const to = models.find((model) => model.modelName === rel.toTable);
    const backList = to?.fields.some(
      (field) => field.isRelation && field.type === rel.fromTable && field.list,
    );
    const selfUnique = from?.fields.some(
      (field) => field.name === rel.fromField && (field.isUnique || field.isId),
    );
    if (backList && !selfUnique) rel.kind = "one-to-many";
    else if (selfUnique) rel.kind = "one-to-one";
  }

  if (models.length === 0) {
    warnings.push("No Prisma models were found in the schema.");
  }

  return { models, enums, relations, warnings, provider };
}

export function clientAccessor(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}
