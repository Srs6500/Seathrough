import type {
  DatabaseInfo,
  DatabaseKind,
  SchemaGuide,
  SchemaStats,
} from "@/lib/schema-guide/types";

const PROVIDERS: Record<
  string,
  { label: string; kind: DatabaseKind }
> = {
  postgresql: { label: "PostgreSQL", kind: "relational" },
  postgres: { label: "PostgreSQL", kind: "relational" },
  mysql: { label: "MySQL", kind: "relational" },
  sqlite: { label: "SQLite", kind: "relational" },
  sqlserver: { label: "SQL Server", kind: "relational" },
  cockroachdb: { label: "CockroachDB", kind: "relational" },
  mongodb: { label: "MongoDB", kind: "document" },
};

export function describeDatabase(
  provider: string | null,
  tableCount: number,
  origin?: string,
): DatabaseInfo {
  if ((!provider && tableCount === 0) || origin === "none") {
    return {
      kind: "unknown",
      provider: null,
      providerLabel: "Not found",
      summary:
        "We did not find a database schema in this repo. You can still inspect screens and backend stories from the app files.",
    };
  }
  const meta = provider ? PROVIDERS[provider.toLowerCase()] : undefined;
  const kind: DatabaseKind =
    meta?.kind ??
    (origin === "mongoose" || provider === "mongodb"
      ? "document"
      : provider
        ? "unknown"
        : "relational");
  const originLabel =
    origin === "drizzle"
      ? "Drizzle"
      : origin === "django"
        ? "Django"
        : origin === "sqlalchemy"
          ? "SQLAlchemy"
          : origin === "sql"
            ? "SQL"
            : origin === "inferred"
              ? "the app code"
              : origin === "mongoose"
                ? "Mongoose"
                : null;
  const providerLabel =
    meta?.label ?? (provider ? provider : originLabel ?? "Database");
  const summary =
    kind === "document"
      ? `${providerLabel} is a document database. Each record is a document; we still show them as lists.`
      : kind === "relational"
        ? `${providerLabel} is a relational database. Data lives in tables, and keys connect one row to another.`
        : `This schema describes ${tableCount} model${tableCount === 1 ? "" : "s"}.`;
  return {
    kind,
    provider: provider?.toLowerCase() ?? null,
    providerLabel,
    summary,
  };
}

export function computeSchemaStats(guide: Pick<SchemaGuide, "tables" | "relations" | "enums">): SchemaStats {
  let fields = 0;
  let primaryKeys = 0;
  let foreignKeys = 0;
  let uniqueKeys = 0;
  let writes = 0;
  let reads = 0;

  const declaredFk = new Set(
    guide.relations
      .filter((rel) => rel.origin === "declared")
      .map((rel) => `${rel.fromTable}.${rel.fromField}`),
  );

  for (const table of guide.tables) {
    const scalars = table.fields.filter((field) => !field.isRelation);
    fields += scalars.length;
    const ids = table.fields.filter((field) => field.isId);
    primaryKeys += ids.length || (scalars.some((field) => field.name === "id") ? 1 : 0);
    uniqueKeys += table.fields.filter((field) => field.isUnique).length;
    for (const field of table.fields) {
      if (field.isRelation) continue;
      if (declaredFk.has(`${table.id}.${field.name}`)) {
        foreignKeys += 1;
        continue;
      }
      if (/id$/i.test(field.name) && !field.isId) foreignKeys += 1;
    }
    writes += table.usages.filter((use) =>
      ["create", "update", "delete", "upsert"].includes(use.operation),
    ).length;
    reads += table.usages.filter((use) => use.operation === "read" || use.operation === "count")
      .length;
  }

  return {
    tables: guide.tables.length,
    fields,
    primaryKeys,
    foreignKeys,
    uniqueKeys,
    relations: guide.relations.length,
    oneToMany: guide.relations.filter((rel) => rel.kind === "one-to-many").length,
    oneToOne: guide.relations.filter((rel) => rel.kind === "one-to-one").length,
    manyToMany: guide.relations.filter((rel) => rel.kind === "many-to-many").length,
    enums: guide.enums?.length ?? 0,
    writes,
    reads,
  };
}

export function guideStats(guide: SchemaGuide): SchemaStats {
  if (guide.stats && typeof guide.stats.tables === "number") return guide.stats;
  return computeSchemaStats({
    tables: guide.tables,
    relations: guide.relations,
    enums: guide.enums ?? [],
  });
}

export function guideDatabase(guide: SchemaGuide): DatabaseInfo {
  if (guide.database?.summary) return guide.database;
  return describeDatabase(null, guide.tables.length);
}
