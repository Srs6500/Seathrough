import {
  parsePrismaSchema,
  type ParsedPrismaModel,
  type ParsedPrismaSchema,
} from "@/lib/schema-guide/parsePrisma";
import type { SchemaField, SchemaRelation, UploadedFile } from "@/lib/schema-guide/types";

export type SchemaOrigin =
  | "prisma"
  | "drizzle"
  | "sql"
  | "mongoose"
  | "django"
  | "sqlalchemy"
  | "inferred"
  | "none";

export type ParsedAppSchema = ParsedPrismaSchema & {
  origin: SchemaOrigin;
  sourcePath: string | null;
};

const SQL_SKIP = new Set([
  "select",
  "from",
  "where",
  "join",
  "into",
  "table",
  "index",
  "values",
  "group",
  "order",
  "limit",
  "offset",
  "public",
  "information",
  "dual",
  "constraint",
  "primary",
  "foreign",
  "references",
]);

function emptySchema(origin: SchemaOrigin, warnings: string[] = []): ParsedAppSchema {
  return {
    models: [],
    enums: [],
    relations: [],
    warnings,
    provider: null,
    origin,
    sourcePath: null,
  };
}

function toPascal(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/);
  const pascal = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  if (!pascal) return "Record";
  if (pascal.endsWith("ies") && pascal.length > 3) return `${pascal.slice(0, -3)}y`;
  if (pascal.endsWith("sses")) return pascal.slice(0, -2);
  if (pascal.endsWith("s") && !pascal.endsWith("ss") && pascal.length > 3) {
    return pascal.slice(0, -1);
  }
  return pascal;
}

function findBlockEnd(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{" || ch === "(") depth += 1;
    else if (ch === "}" || ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function makeField(
  name: string,
  type: string,
  extra: Partial<SchemaField> = {},
): SchemaField {
  return {
    name,
    type,
    optional: extra.optional ?? false,
    list: extra.list ?? false,
    isId: extra.isId ?? /^(id|_id)$/i.test(name),
    isUnique: extra.isUnique ?? false,
    isRelation: extra.isRelation ?? false,
    defaultValue: extra.defaultValue ?? null,
    dbName: extra.dbName ?? null,
    doc: extra.doc ?? null,
  };
}

function mapType(raw: string): string {
  const t = raw.toLowerCase();
  if (/uuid|char|text|string|varchar|email|slug/.test(t)) return "String";
  if (/bool/.test(t)) return "Boolean";
  if (/date|time/.test(t)) return "DateTime";
  if (/int|serial|number|float|double|decimal|numeric|money/.test(t)) return "Int";
  if (/json|dict|map|object/.test(t)) return "Json";
  if (/file|image|blob|binary/.test(t)) return "String";
  return raw.replace(/[^\w].*$/, "") || "String";
}

function relationOf(
  from: string,
  field: string,
  to: string,
  kind: SchemaRelation["kind"] = "one-to-many",
): SchemaRelation {
  return {
    id: `${from}.${field}->${to}`,
    fromTable: from,
    toTable: to,
    fromField: field,
    toField: null,
    kind,
    origin: "declared",
    onDelete: null,
    name: null,
  };
}

function mergeSchema(into: ParsedAppSchema, add: ParsedAppSchema): ParsedAppSchema {
  const models = [...into.models];
  for (const model of add.models) {
    const idx = models.findIndex((item) => item.modelName === model.modelName);
    if (idx < 0) {
      models.push(model);
      continue;
    }
    if (model.fields.length > (models[idx]?.fields.length ?? 0)) {
      models[idx] = model;
    }
  }
  const relations = [...into.relations];
  for (const rel of add.relations) {
    if (!relations.some((item) => item.id === rel.id)) relations.push(rel);
  }
  const enums = [...new Set([...into.enums, ...add.enums])];
  return {
    models,
    enums,
    relations,
    warnings: [...into.warnings, ...add.warnings],
    provider: into.provider ?? add.provider,
    origin: into.models.length ? into.origin : add.origin,
    sourcePath: into.sourcePath ?? add.sourcePath,
  };
}

function parseDrizzle(file: UploadedFile): ParsedAppSchema {
  const models: ParsedPrismaModel[] = [];
  const relations: SchemaRelation[] = [];
  const constToModel = new Map<string, string>();
  let provider: string | null = null;
  const re =
    /\b(?:export\s+const\s+)?(\w+)\s*=\s*(pgTable|mysqlTable|sqliteTable)\(\s*(['"`])([^'"`]+)\3\s*,\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(file.content))) {
    const constName = match[1]!;
    const helper = match[2]!;
    const tableName = match[4]!;
    if (helper === "pgTable") provider = provider ?? "postgresql";
    if (helper === "mysqlTable") provider = provider ?? "mysql";
    if (helper === "sqliteTable") provider = provider ?? "sqlite";
    const open = file.content.indexOf("{", match.index ?? 0);
    const close = findBlockEnd(file.content, open);
    if (close < 0) continue;
    const body = file.content.slice(open + 1, close);
    const modelName = toPascal(tableName);
    constToModel.set(constName, modelName);
    const fields: SchemaField[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      const field = line.match(/^(\w+)\s*:\s*(\w+)\(/);
      if (!field) continue;
      const name = field[1]!;
      const rest = line.slice(field[0].length);
      const ref = rest.match(/references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/);
      fields.push(
        makeField(name, mapType(field[2]!), {
          optional: !/\.notNull\(/.test(rest),
          isId: /\.primaryKey\(/.test(rest) || /^(id|_id)$/i.test(name),
          isUnique: /\.unique\(/.test(rest),
          isRelation: Boolean(ref),
        }),
      );
      if (ref) {
        const target = constToModel.get(ref[1]!) ?? toPascal(ref[1]!);
        relations.push(relationOf(modelName, name, target));
      }
    }
    models.push({
      modelName,
      tableName,
      doc: null,
      fields,
      compositeId: false,
    });
    re.lastIndex = close + 1;
  }
  if (!models.length) return emptySchema("drizzle");
  return {
    models,
    enums: [],
    relations,
    warnings: [],
    provider,
    origin: "drizzle",
    sourcePath: file.path,
  };
}

function parseSql(file: UploadedFile): ParsedAppSchema {
  const models: ParsedPrismaModel[] = [];
  const relations: SchemaRelation[] = [];
  const re =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?["'`]?(\w+)["'`]?\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(file.content))) {
    const tableName = match[1]!;
    const open = file.content.indexOf("(", match.index ?? 0);
    const close = findBlockEnd(file.content, open);
    if (close < 0) continue;
    const body = file.content.slice(open + 1, close);
    const modelName = toPascal(tableName);
    const fields: SchemaField[] = [];
    for (const part of body.split(",")) {
      const line = part.trim().replace(/\s+/g, " ");
      if (!line || /^(constraint|primary|unique|check|foreign)\b/i.test(line)) {
        const fk = line.match(/foreign\s+key\s*\(\s*(\w+)\s*\)\s*references\s+["'`]?(\w+)/i);
        if (fk) relations.push(relationOf(modelName, fk[1]!, toPascal(fk[2]!)));
        continue;
      }
      const col = line.match(/^["'`]?(\w+)["'`]?\s+([A-Za-z][\w()]*)/);
      if (!col) continue;
      const name = col[1]!;
      const rest = line.slice(col[0].length);
      fields.push(
        makeField(name, mapType(col[2]!), {
          optional: !/\bnot\s+null\b/i.test(rest),
          isId: /\bprimary\s+key\b/i.test(rest) || /^(id|_id)$/i.test(name),
          isUnique: /\bunique\b/i.test(rest),
        }),
      );
      const ref = rest.match(/\breferences\s+["'`]?(\w+)/i);
      if (ref) relations.push(relationOf(modelName, name, toPascal(ref[1]!)));
    }
    models.push({
      modelName,
      tableName,
      doc: null,
      fields,
      compositeId: false,
    });
    re.lastIndex = close + 1;
  }
  if (!models.length) return emptySchema("sql");
  return {
    models,
    enums: [],
    relations,
    warnings: [],
    provider: /postgres|pg_/i.test(file.content) ? "postgresql" : null,
    origin: "sql",
    sourcePath: file.path,
  };
}

function parseDjango(file: UploadedFile): ParsedAppSchema {
  if (!/\.py$/i.test(file.path)) return emptySchema("django");
  if (!/models\.Model|django\.db/.test(file.content)) return emptySchema("django");
  const models: ParsedPrismaModel[] = [];
  const relations: SchemaRelation[] = [];
  const classRe = /class\s+(\w+)\s*\(([^)]+)\)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = classRe.exec(file.content))) {
    const bases = match[2] ?? "";
    if (!/Model|AbstractUser|AbstractBaseUser/.test(bases)) continue;
    const modelName = match[1]!;
    const start = (match.index ?? 0) + match[0].length;
    const next = file.content.slice(start).search(/\nclass\s+\w+\s*\(/);
    const body = file.content.slice(start, next >= 0 ? start + next : file.content.length);
    const table =
      body.match(/db_table\s*=\s*['"](\w+)['"]/)?.[1] ??
      modelName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    const fields: SchemaField[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.match(/^\s+(\w+)\s*=\s*models\.(\w+)\((.*)\)\s*$/);
      if (!line) continue;
      const name = line[1]!;
      const kind = line[2]!;
      const args = line[3] ?? "";
      if (name === "Meta" || name === "objects") continue;
      const related =
        args.match(/['"]([\w.]+)['"]/)?.[1]?.split(".").pop() ??
        args.match(/^(\w+)/)?.[1];
      const isFk = /ForeignKey|OneToOneField|ManyToManyField/i.test(kind);
      fields.push(
        makeField(name, isFk ? related ?? kind : mapType(kind), {
          optional: /null\s*=\s*True/.test(args),
          isRelation: isFk,
          list: /ManyToManyField/i.test(kind),
        }),
      );
      if (isFk && related) {
        relations.push(
          relationOf(
            modelName,
            name,
            related,
            /ManyToManyField/i.test(kind) ? "many-to-many" : /OneToOneField/i.test(kind) ? "one-to-one" : "one-to-many",
          ),
        );
      }
    }
    if (
      !fields.length &&
      /AbstractUser|AbstractBaseUser/.test(bases)
    ) {
      fields.push(
        makeField("id", "String", { isId: true }),
        makeField("email", "String"),
        makeField("password", "String"),
      );
    }
    models.push({
      modelName,
      tableName: table,
      doc: null,
      fields,
      compositeId: false,
    });
  }
  if (!models.length) return emptySchema("django");
  return {
    models,
    enums: [],
    relations,
    warnings: [],
    provider: null,
    origin: "django",
    sourcePath: file.path,
  };
}

function parseSqlAlchemy(file: UploadedFile): ParsedAppSchema {
  if (!/\.py$/i.test(file.path)) return emptySchema("sqlalchemy");
  if (!/__tablename__|mapped_column|sqlalchemy|DeclarativeBase/.test(file.content)) {
    return emptySchema("sqlalchemy");
  }
  const models: ParsedPrismaModel[] = [];
  const relations: SchemaRelation[] = [];
  const classRe = /class\s+(\w+)\s*\(([^)]*)\)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = classRe.exec(file.content))) {
    const modelName = match[1]!;
    const bases = match[2] ?? "";
    if (!/Base|Model|MappedAsDataclass/.test(bases) && !/__tablename__/.test(file.content)) {
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const next = file.content.slice(start).search(/\nclass\s+\w+\s*\(/);
    const body = file.content.slice(start, next >= 0 ? start + next : file.content.length);
    if (!/__tablename__|mapped_column|Column\(/.test(body)) continue;
    const table = body.match(/__tablename__\s*=\s*['"](\w+)['"]/)?.[1] ?? modelName.toLowerCase();
    const fields: SchemaField[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.match(
        /^\s+(\w+)\s*(?::\s*[^=]+)?=\s*(?:mapped_column|Column)\((.*)\)\s*$/,
      );
      if (!line) continue;
      const name = line[1]!;
      const args = line[2] ?? "";
      const fk = args.match(/ForeignKey\(\s*['"](\w+)\.(\w+)['"]/);
      fields.push(
        makeField(name, mapType(args), {
          optional: /nullable\s*=\s*True/.test(args),
          isId: /primary_key\s*=\s*True/.test(args) || /^(id|_id)$/i.test(name),
          isUnique: /unique\s*=\s*True/.test(args),
          isRelation: Boolean(fk),
        }),
      );
      if (fk) relations.push(relationOf(modelName, name, toPascal(fk[1]!)));
    }
    models.push({
      modelName,
      tableName: table,
      doc: null,
      fields,
      compositeId: false,
    });
  }
  if (!models.length) return emptySchema("sqlalchemy");
  return {
    models,
    enums: [],
    relations,
    warnings: [],
    provider: null,
    origin: "sqlalchemy",
    sourcePath: file.path,
  };
}

function parseMongoose(file: UploadedFile): ParsedAppSchema {
  if (!/\.(ts|js)$/i.test(file.path)) return emptySchema("mongoose");
  if (!/mongoose|new Schema\(/.test(file.content)) return emptySchema("mongoose");
  const models: ParsedPrismaModel[] = [];
  const relations: SchemaRelation[] = [];
  const modelNames = [
    ...file.content.matchAll(/mongoose\.model\(\s*['"`](\w+)['"`]/g),
  ].map((item) => item[1]!);
  const schemaRe = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+Schema\(\s*\{/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = schemaRe.exec(file.content))) {
    const open = file.content.indexOf("{", match.index ?? 0);
    const close = findBlockEnd(file.content, open);
    if (close < 0) continue;
    const body = file.content.slice(open + 1, close);
    const modelName =
      modelNames[index] ??
      (match[1] || "").replace(/Schema$/, "") ??
      toPascal(file.path.split("/").pop()?.replace(/\.(ts|js)$/i, "") || "Record");
    index += 1;
    const fields: SchemaField[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      const simple = line.match(/^(\w+)\s*:\s*([A-Za-z]+)\s*,?$/);
      const obj = line.match(/^(\w+)\s*:\s*\{/);
      const name = simple?.[1] ?? obj?.[1];
      if (!name) continue;
      const rest = line.slice(name.length);
      const ref = rest.match(/ref\s*:\s*['"`](\w+)['"`]/);
      fields.push(
        makeField(name, mapType(simple?.[2] ?? "String"), {
          optional: !/required\s*:\s*true/.test(rest),
          isRelation: Boolean(ref),
        }),
      );
      if (ref) relations.push(relationOf(modelName, name, ref[1]!));
    }
    models.push({
      modelName,
      tableName: modelName.toLowerCase(),
      doc: null,
      fields,
      compositeId: false,
    });
    schemaRe.lastIndex = close + 1;
  }
  if (!models.length) return emptySchema("mongoose");
  return {
    models,
    enums: [],
    relations,
    warnings: [],
    provider: "mongodb",
    origin: "mongoose",
    sourcePath: file.path,
  };
}

function inferFromCode(files: UploadedFile[]): ParsedAppSchema {
  const counts = new Map<string, number>();
  const fromRe =
    /\.(?:from|collection|table)\(\s*['"`]([A-Za-z_][\w]*)['"`]\s*\)|sequelize\.define\(\s*['"`]([A-Za-z_][\w]*)['"`]/g;
  for (const file of files) {
    let match: RegExpExecArray | null;
    fromRe.lastIndex = 0;
    while ((match = fromRe.exec(file.content))) {
      const raw = (match[1] || match[2] || "").trim();
      if (!raw || SQL_SKIP.has(raw.toLowerCase()) || raw.length < 2) continue;
      const modelName = toPascal(raw);
      counts.set(modelName, (counts.get(modelName) ?? 0) + 1);
    }
  }
  const models = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([modelName]) => ({
      modelName,
      tableName: modelName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(),
      doc: null,
      fields: [makeField("id", "String", { isId: true })],
      compositeId: false,
    }));
  if (!models.length) return emptySchema("inferred");
  return {
    models,
    enums: [],
    relations: [],
    warnings: ["Table shapes were inferred from queries, not a schema file."],
    provider: null,
    origin: "inferred",
    sourcePath: null,
  };
}

export function parseSchemaFiles(files: UploadedFile[]): ParsedAppSchema {
  const prismaFiles = files.filter((file) => /\.prisma$/i.test(file.path));
  let bestPrisma: ParsedAppSchema | null = null;
  for (const file of prismaFiles) {
    const parsed = parsePrismaSchema(file.content);
    if (!parsed.models.length) continue;
    const next: ParsedAppSchema = {
      ...parsed,
      origin: "prisma",
      sourcePath: file.path,
    };
    if (!bestPrisma || next.models.length > bestPrisma.models.length) bestPrisma = next;
  }
  if (bestPrisma) return bestPrisma;

  let merged = emptySchema("none");
  for (const file of files) {
    merged = mergeSchema(merged, parseDrizzle(file));
    merged = mergeSchema(merged, parseSql(file));
    merged = mergeSchema(merged, parseDjango(file));
    merged = mergeSchema(merged, parseSqlAlchemy(file));
    merged = mergeSchema(merged, parseMongoose(file));
  }
  if (merged.models.length) {
    if (merged.origin === "none") merged.origin = "inferred";
    return merged;
  }

  const inferred = inferFromCode(files);
  if (inferred.models.length) return inferred;

  return emptySchema("none", [
    "No Prisma, Drizzle, SQL, Django, or Mongoose schema was found. Backend still comes from the app files.",
  ]);
}

export function schemaOriginLabel(origin: SchemaOrigin): string {
  if (origin === "prisma") return "Prisma";
  if (origin === "drizzle") return "Drizzle";
  if (origin === "sql") return "SQL";
  if (origin === "mongoose") return "MongoDB";
  if (origin === "django") return "Django";
  if (origin === "sqlalchemy") return "SQLAlchemy";
  if (origin === "inferred") return "Inferred from code";
  return "Unknown";
}
