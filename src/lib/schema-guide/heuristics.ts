import type {
  CodeUsage,
  ConceptGroup,
  FactOrigin,
  FieldNote,
  SampleRow,
  SchemaField,
  SchemaRelation,
  SuggestedAction,
  TableGuide,
} from "@/lib/schema-guide/types";
import type { ParsedPrismaModel } from "@/lib/schema-guide/parsePrisma";

const CONCEPTS: Array<{
  id: string;
  label: string;
  match: RegExp;
}> = [
  {
    id: "accounts",
    label: "People and accounts",
    match: /user|customer|account|session|profile|member|org|team|auth|firm|client|contact|person|password|token/i,
  },
  {
    id: "work",
    label: "Work",
    match: /matter|case|ticket|job|project|order|cart/i,
  },
  {
    id: "billing",
    label: "Money",
    match: /payment|invoice|subscription|checkout|price|sku|product/i,
  },
  {
    id: "files",
    label: "Files",
    match: /document|chunk|file|attachment|artifact|media|image/i,
  },
  {
    id: "activity",
    label: "History",
    match: /audit|event|log|action|proposal/i,
  },
  {
    id: "content",
    label: "Content",
    match: /post|article|comment|page|lesson|course|note/i,
  },
];

function words(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

function article(name: string): string {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

export function conceptFor(modelName: string): string {
  for (const concept of CONCEPTS) {
    if (concept.match.test(modelName)) return concept.id;
  }
  return "other";
}

export function conceptLabel(id: string): string {
  return CONCEPTS.find((item) => item.id === id)?.label ?? "Also stored";
}

export function conceptSummary(id: string): string {
  if (id === "accounts") return "Who the app is about, and who can sign in.";
  if (id === "work") return "The jobs or cases those people work on.";
  if (id === "billing") return "What gets sold and how money is recorded.";
  if (id === "files") return "Documents and pieces of text the app keeps.";
  if (id === "activity") return "A history of what happened.";
  if (id === "content") return "Notes and other things people write.";
  return "Extra records that support the rest.";
}

export function heuristicPurpose(model: ParsedPrismaModel): string {
  const n = model.modelName;
  if (/^orderitem$/i.test(n)) {
    return "One line on an order — which product was bought and how many.";
  }
  if (/^order$/i.test(n)) return "Stores each purchase a customer makes.";
  if (/customer|user/i.test(n)) {
    return `A person who can use the app${/customer/i.test(n) ? " and place orders" : ""}.`;
  }
  if (/product/i.test(n)) return "Something the app can sell or list.";
  if (/payment/i.test(n)) return "A record that money was collected for an order.";
  if (/session/i.test(n)) return "Keeps someone signed in after they log in.";
  if (/subscription/i.test(n)) return "Tracks whether an account is paying over time.";
  return `Stores ${words(n)} records.`;
}

export function heuristicFieldNotes(
  model: ParsedPrismaModel,
  relations: SchemaRelation[],
): FieldNote[] {
  const notes: FieldNote[] = [];
  for (const field of model.fields) {
    if (field.doc) {
      notes.push({ name: field.name, note: field.doc, origin: "schema" });
      continue;
    }
    if (field.isId) {
      notes.push({
        name: field.name,
        note: "Unique id for this row.",
        origin: "heuristic",
      });
      continue;
    }
    const fk = relations.find(
      (rel) =>
        rel.origin === "declared" &&
        rel.fromTable === model.modelName &&
        rel.fromField === field.name,
    );
    if (fk) {
      notes.push({
        name: field.name,
        note: `${field.name} identifies the related ${words(fk.toTable)}.`,
        origin: "schema",
      });
      continue;
    }
    if (/email/i.test(field.name)) {
      notes.push({
        name: field.name,
        note: "How this person is found and contacted.",
        origin: "heuristic",
      });
    } else if (/status/i.test(field.name)) {
      notes.push({
        name: field.name,
        note: "Where this record is in its life cycle.",
        origin: "heuristic",
      });
    } else if (/amount|total|price/i.test(field.name)) {
      notes.push({
        name: field.name,
        note: "Money stored as a number (often cents).",
        origin: "heuristic",
      });
    }
  }
  return notes.slice(0, 6);
}

export function connectionSentences(
  modelName: string,
  relations: SchemaRelation[],
): string[] {
  const lines: string[] = [];
  for (const rel of relations) {
    if (rel.fromTable !== modelName && rel.toTable !== modelName) continue;
    const other = rel.fromTable === modelName ? rel.toTable : rel.fromTable;
    if (rel.kind === "one-to-many") {
      const one = rel.toTable;
      const many = rel.fromTable;
      lines.push(`One ${words(one)} → many ${words(many)}s.`);
    } else if (rel.kind === "many-to-many") {
      lines.push(`${words(modelName)}s connect to many ${words(other)}s, and the reverse.`);
    } else {
      lines.push(`Each ${words(modelName)} links to ${article(words(other))} ${words(other)}.`);
    }
  }
  return [...new Set(lines)];
}

export function heuristicBehavior(
  modelName: string,
  usages: CodeUsage[],
): { text: string; origin: FactOrigin } {
  const writes = usages.filter((use) =>
    ["create", "update", "delete", "upsert"].includes(use.operation),
  );
  if (writes.length) {
    const fn = writes[0]?.functionName;
    const op = writes[0]?.operation;
    const via = fn ? `${fn}()` : writes[0]?.callee;
    return {
      text: `${via} ${op === "create" ? "writes" : op === "delete" ? "removes" : "changes"} rows in this table.`,
      origin: "code",
    };
  }
  const reads = usages.filter((use) => use.operation === "read");
  if (reads.length) {
    const fn = reads[0]?.functionName;
    return {
      text: `${fn ? `${fn}()` : reads[0]?.callee} reads this table.`,
      origin: "code",
    };
  }
  return {
    text: "No matching Prisma calls were found in the uploaded files.",
    origin: "heuristic",
  };
}

function sampleValue(field: SchemaField, index: number): string {
  if (field.list) return "[]";
  if (field.isRelation) return field.optional ? "—" : "linked row";
  const type = field.type;
  if (type === "Boolean") return index === 0 ? "true" : "false";
  if (type === "Int" || type === "Float" || type === "Decimal") {
    if (/price|amount|total/i.test(field.name)) return String(1999 * (index + 1));
    if (/quantity/i.test(field.name)) return String(index + 1);
    return String(index + 1);
  }
  if (type === "DateTime") return index === 0 ? "2026-03-12 10:04" : "2026-03-13 18:22";
  if (/email/i.test(field.name)) {
    return index === 0 ? "ada@example.com" : "linus@example.com";
  }
  if (/name/i.test(field.name)) return index === 0 ? "Ada Lovelace" : "Linus Torvalds";
  if (/sku/i.test(field.name)) return index === 0 ? "MUG-1" : "TEE-4";
  if (/status/i.test(field.name)) return index === 0 ? "PAID" : "PENDING";
  if (field.isId || /id$/i.test(field.name)) {
    return `${field.name.slice(0, 3)}_${index + 1}`;
  }
  return `${words(field.name)} ${index + 1}`;
}

export function sampleRows(model: ParsedPrismaModel): SampleRow[] {
  const scalar = model.fields.filter((field) => !field.isRelation);
  return [0, 1].map((index) => ({
    values: Object.fromEntries(
      scalar.slice(0, 6).map((field) => [field.name, sampleValue(field, index)]),
    ),
  }));
}

export function groupConcepts(
  tables: TableGuide[],
): ConceptGroup[] {
  const buckets = new Map<string, string[]>();
  for (const table of tables) {
    const list = buckets.get(table.concept) ?? [];
    list.push(table.id);
    buckets.set(table.concept, list);
  }
  return [...buckets.entries()].map(([id, tableIds]) => ({
    id,
    label: conceptLabel(id),
    summary: conceptSummary(id),
    tableIds,
  }));
}

export function suggestActions(tables: TableGuide[]): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const byId = new Map(tables.map((table) => [table.id, table]));
  const has = (name: RegExp) => tables.find((table) => name.test(table.id));

  const order = has(/^order$/i);
  if (order) {
    const items = has(/^orderitem$/i);
    actions.push({
      id: "checkout",
      question: "What happens when a user checks out?",
      tableIds: [order.id, items?.id].filter(Boolean) as string[],
    });
  }
  const user = has(/^(user|customer)$/i);
  if (user) {
    actions.push({
      id: "signup",
      question: "What happens when someone signs up?",
      tableIds: [user.id],
    });
  }
  const sub = has(/subscription/i);
  if (sub) {
    actions.push({
      id: "subscriptions",
      question: "Where are subscriptions stored?",
      tableIds: [sub.id],
    });
  }

  for (const table of tables) {
    const write = table.usages.find((use) =>
      ["create", "update", "upsert"].includes(use.operation),
    );
    if (!write) continue;
    const id = `write-${table.id}`;
    if (actions.some((action) => action.tableIds[0] === table.id && action.id.startsWith("write"))) {
      continue;
    }
    actions.push({
      id,
      question: `When does the app save ${words(table.tableName)}s?`,
      tableIds: [table.id],
    });
    if (actions.length >= 6) break;
  }

  if (actions.length === 0 && tables[0]) {
    actions.push({
      id: "where",
      question: `Where does ${words(tables[0].id)} data live?`,
      tableIds: [tables[0].id],
    });
  }

  void byId;
  return actions.slice(0, 6);
}

export function overviewSentence(tables: TableGuide[]): string {
  const names = tables.map((table) => words(table.tableName));
  if (names.length === 0) return "No tables were found.";
  if (names.length === 1) return `Your app stores ${names[0]}.`;
  if (names.length === 2) return `Your app stores ${names[0]} and ${names[1]}.`;
  const last = names[names.length - 1];
  return `Your app stores ${names.slice(0, -1).join(", ")}, and ${last}.`;
}
