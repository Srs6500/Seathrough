import { conceptFor, conceptLabel, conceptSummary } from "@/lib/schema-guide/heuristics";
import { guideDatabase, guideStats } from "@/lib/schema-guide/database";
import type { SchemaGuide, SchemaRelation, TableGuide } from "@/lib/schema-guide/types";

const SINGULAR: Record<string, string> = {
  user: "person",
  customer: "customer",
  firm: "firm",
  client: "client",
  matter: "case",
  "matter membership": "person on a case",
  document: "document",
  "document chunk": "piece of a document",
  order: "order",
  "order item": "line item",
  product: "product",
  payment: "payment",
  note: "note",
  password: "password",
};

const PLURAL: Record<string, string> = {
  person: "people",
  customer: "customers",
  firm: "firms",
  client: "clients",
  case: "cases",
  "person on a case": "people on a case",
  document: "documents",
  "piece of a document": "pieces of a document",
  order: "orders",
  "line item": "line items",
  product: "products",
  payment: "payments",
  note: "notes",
  password: "passwords",
};

function spacedName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

function singular(name: string): string {
  const spaced = spacedName(name);
  return SINGULAR[spaced] ?? (spaced.replace(/s$/, "") || spaced);
}

function plural(name: string): string {
  const one = singular(name);
  if (PLURAL[one]) return PLURAL[one];
  if (one.endsWith("s")) return one;
  return `${one}s`;
}

function listPhrase(items: string[]): string {
  if (items.length === 0) return "records";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function degree(tableId: string, relations: SchemaRelation[]): number {
  return relations.filter(
    (rel) => rel.fromTable === tableId || rel.toTable === tableId,
  ).length;
}

function isSupportTable(id: string): boolean {
  return /password|session|token|chunk|membership|join/i.test(id);
}

export function humanLabel(name: string): string {
  const text = plural(name);
  return text.replace(/^\w/, (letter) => letter.toUpperCase());
}

export function relationSentence(rel: SchemaRelation): string {
  const many = plural(rel.fromTable);
  const one = singular(rel.toTable);
  if (rel.kind === "one-to-many") {
    return `One ${one} can have many ${many}.`;
  }
  if (rel.kind === "one-to-one") {
    return `Each ${singular(rel.fromTable)} belongs to one ${one}.`;
  }
  return `${many} connect to ${plural(rel.toTable)}.`;
}

export function shortRelationLabel(rel: SchemaRelation): string {
  if (rel.kind === "one-to-many") return "has many";
  if (rel.kind === "one-to-one") return "has one";
  return "many to many";
}

function uniqueLines(lines: string[]): string[] {
  return lines.filter((line, index, all) => all.indexOf(line) === index);
}

export function buildOverviewStory(guide: SchemaGuide): {
  headline: string;
  how: string;
  engine: string;
  connections: string[];
  groups: Array<{ id: string; label: string; summary: string; tableIds: string[] }>;
  heroes: Array<{ value: string; label: string }>;
} {
  const database = guideDatabase(guide);
  const stats = guideStats(guide);
  const ranked = [...guide.tables].sort(
    (a, b) => degree(b.id, guide.relations) - degree(a.id, guide.relations),
  );
  const core = ranked.filter((table) => !isSupportTable(table.id)).slice(0, 5);
  const names = core.map((table) => plural(table.tableName || table.id));
  const headline =
    names.length === 0
      ? "This app does not have any tables we could read."
      : `This app keeps ${listPhrase(names)}.`;

  const how =
    database.kind === "document"
      ? "Each kind of record is a document. Documents can still point at each other."
      : "Think of each kind of record as a spreadsheet tab. One row is one thing. Tabs point at each other with IDs.";

  const engine =
    database.provider && database.provider !== "prisma schema"
      ? `It runs on ${database.providerLabel} — ${
          database.kind === "document"
            ? "a document database."
            : "tables linked by keys."
        }`
      : database.kind === "document"
        ? "This is a document database."
        : "This is a relational database: tables linked by keys.";

  const connections = uniqueLines(
    guide.relations
      .filter((rel) => {
        if (isSupportTable(rel.fromTable) || isSupportTable(rel.toTable)) return false;
        return rel.origin === "declared" || rel.kind === "one-to-many";
      })
      .slice(0, 6)
      .map(relationSentence),
  ).slice(0, 3);

  const buckets = new Map<string, string[]>();
  for (const table of guide.tables) {
    const id = conceptFor(table.modelName || table.id);
    const list = buckets.get(id) ?? [];
    list.push(table.id);
    buckets.set(id, list);
  }
  const groups = [...buckets.entries()]
    .filter(([, ids]) => ids.length > 0)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, tableIds]) => ({
      id,
      label: conceptLabel(id),
      summary: conceptSummary(id),
      tableIds,
    }));

  const heroes = [
    {
      value: String(stats.tables),
      label: stats.tables === 1 ? "kind of record" : "kinds of records",
    },
    {
      value: String(stats.foreignKeys || stats.relations),
      label: "links between them",
    },
    database.kind === "document"
      ? {
          value: database.providerLabel,
          label: "document database",
        }
      : database.provider && database.provider !== "prisma schema"
        ? {
            value: database.providerLabel,
            label: "relational database",
          }
        : {
            value: "Relational",
            label: "tables linked by keys",
          },
  ];

  return { headline, how, engine, connections, groups, heroes };
}

export type ExploreStory = {
  kicker: string;
  headline: string;
  blurb: string;
  heroes: Array<{ value: string; label: string }>;
  connections: string[];
};

function usageCount(table: TableGuide, kind: "write" | "read"): number {
  return table.usages.filter((use) =>
    kind === "write"
      ? ["create", "update", "delete", "upsert"].includes(use.operation)
      : use.operation === "read" || use.operation === "count",
  ).length;
}

export function buildExploreStory(
  guide: SchemaGuide,
  selectedId: string | null,
): ExploreStory {
  const overview = buildOverviewStory(guide);
  const table = selectedId
    ? guide.tables.find((item) => item.id === selectedId)
    : undefined;

  if (!table) {
    return {
      kicker: "How it fits together",
      headline: overview.headline,
      blurb:
        "Each box is a kind of record. A line means those records belong together.",
      heroes: overview.heroes,
      connections: overview.connections,
    };
  }

  const stored = table.fields.filter((field) => !field.isRelation && !field.isId).length;
  const links = guide.relations.filter(
    (rel) => rel.fromTable === table.id || rel.toTable === table.id,
  );
  const writes = usageCount(table, "write");
  const reads = usageCount(table, "read");

  return {
    kicker: humanLabel(table.tableName || table.id),
    headline: table.purpose,
    blurb:
      links.length === 0
        ? "This record stands on its own."
        : `It links to ${
            links.length === 1 ? "one other kind of record" : `${links.length} other kinds of records`
          }.`,
    heroes: [
      {
        value: String(stored),
        label: stored === 1 ? "detail it stores" : "details it stores",
      },
      {
        value: String(links.length),
        label: links.length === 1 ? "link to another record" : "links to other records",
      },
      writes
        ? {
            value: String(writes),
            label: writes === 1 ? "place the app writes it" : "places the app writes it",
          }
        : {
            value: String(reads),
            label: reads === 1 ? "place the app reads it" : "places the app reads it",
          },
    ],
    connections: uniqueLines(links.map(relationSentence)).slice(0, 3),
  };
}
