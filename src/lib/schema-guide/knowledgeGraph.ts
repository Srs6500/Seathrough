import { conceptSummary } from "@/lib/schema-guide/heuristics";
import { humanLabel, relationSentence } from "@/lib/schema-guide/overviewStory";
import type {
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  SchemaAskResult,
  SchemaAskStep,
  SchemaGuide,
  TableGuide,
} from "@/lib/schema-guide/types";

const ACCESS_FIELD =
  /role|permission|access|admin|banned|disabled|invite|scope|allow|deny|restrict/i;
const SECRET_FIELD =
  /password|passwd|secret|credential|hash|resetToken|resetAt|recovery|forgot/i;
const PEOPLE = /user|customer|person|account/i;
const MEMBER = /member|role|permission|invite|acl/i;
const SECRET_TABLE = /password|credential|secret/i;
const STOP = new Set([
  "how",
  "can",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "what",
  "when",
  "where",
  "does",
  "did",
  "are",
  "was",
  "you",
  "your",
  "our",
  "app",
  "someone",
]);

function listId(tableId: string): string {
  return `list:${tableId}`;
}

function settingId(tableId: string, field: string): string {
  return `setting:${tableId}.${field}`;
}

function ideaId(conceptId: string): string {
  return `idea:${conceptId}`;
}

function isPeople(table: TableGuide): boolean {
  return PEOPLE.test(table.id);
}

function isMembership(table: TableGuide): boolean {
  return MEMBER.test(table.id);
}

function accessFieldNames(table: TableGuide): string[] {
  return table.fields
    .filter((field) => {
      if (field.isRelation || field.isId) return false;
      if (ACCESS_FIELD.test(field.name)) return true;
      return /active|status/i.test(field.name) && isPeople(table);
    })
    .map((field) => field.name);
}

function secretFieldNames(table: TableGuide): string[] {
  return table.fields
    .filter((field) => {
      if (field.isRelation || field.isId) return false;
      return SECRET_FIELD.test(field.name);
    })
    .map((field) => field.name);
}

function isSecretList(tableId: string | null): boolean {
  return Boolean(tableId && SECRET_TABLE.test(tableId));
}

function tokensOf(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 2 && !STOP.has(part));
}

export function wantsAccess(question: string): boolean {
  return /restrict|permission|role|allow|deny|access|ban|block|admin|invite|lock|limit/.test(
    question.toLowerCase(),
  );
}

export function wantsPasswordReset(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /reset|forgot|recover/.test(q) ||
    /change(?:\s+\w+){0,2}\s+password/.test(q) ||
    /new password/.test(q)
  );
}

export function buildKnowledgeGraph(guide: SchemaGuide): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  function addNode(node: KnowledgeNode) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  }

  function addEdge(edge: KnowledgeEdge) {
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    edges.push(edge);
  }

  for (const table of guide.tables) {
    addNode({
      id: listId(table.id),
      kind: "list",
      label: humanLabel(table.tableName || table.id),
      summary: table.purpose,
      tableId: table.id,
    });
  }

  for (const group of guide.concepts) {
    addNode({
      id: ideaId(group.id),
      kind: "idea",
      label: group.label,
      summary: group.summary || conceptSummary(group.id),
      tableId: null,
    });
    for (const tableId of group.tableIds) {
      addEdge({
        id: `part:${tableId}:${group.id}`,
        from: listId(tableId),
        to: ideaId(group.id),
        kind: "part-of",
        label: "is part of",
      });
    }
  }

  for (const rel of guide.relations) {
    if (rel.origin !== "declared") continue;
    const many = listId(rel.fromTable);
    const one = listId(rel.toTable);
    addEdge({
      id: `many:${rel.id}`,
      from: one,
      to: many,
      kind: "has-many",
      label: relationSentence(rel).replace(/\.$/, ""),
    });
    addEdge({
      id: `one:${rel.id}`,
      from: many,
      to: one,
      kind: "belongs-to",
      label: `belongs to ${humanLabel(rel.toTable).toLowerCase()}`,
    });
  }

  for (const table of guide.tables) {
    for (const field of accessFieldNames(table)) {
      const id = settingId(table.id, field);
      addNode({
        id,
        kind: "setting",
        label: field.toLowerCase().replace(/_/g, " "),
        summary: `A setting on ${humanLabel(table.tableName || table.id).toLowerCase()} that can treat people differently.`,
        tableId: table.id,
      });
      addEdge({
        id: `remember:${table.id}:${field}`,
        from: listId(table.id),
        to: id,
        kind: "remembers",
        label: "remembers",
      });
      addEdge({
        id: `control-setting:${table.id}:${field}`,
        from: id,
        to: listId(table.id),
        kind: "controls",
        label: "can restrict",
      });
    }

    for (const field of secretFieldNames(table)) {
      const id = `secret:${table.id}.${field}`;
      addNode({
        id,
        kind: "secret",
        label: field.toLowerCase().replace(/_/g, " "),
        summary: `A secret on ${humanLabel(table.tableName || table.id).toLowerCase()} that proves who someone is.`,
        tableId: table.id,
      });
      addEdge({
        id: `remember-secret:${table.id}:${field}`,
        from: listId(table.id),
        to: id,
        kind: "remembers",
        label: "remembers",
      });
    }

    if (isMembership(table)) {
      const neighbors = guide.relations.filter(
        (rel) =>
          rel.origin === "declared" &&
          (rel.fromTable === table.id || rel.toTable === table.id),
      );
      for (const rel of neighbors) {
        const other = rel.fromTable === table.id ? rel.toTable : rel.fromTable;
        addEdge({
          id: `control:${table.id}:${other}`,
          from: listId(table.id),
          to: listId(other),
          kind: "controls",
          label: "says who belongs",
        });
      }
    }
  }

  return { nodes, edges };
}

export function guideKnowledge(guide: SchemaGuide): KnowledgeGraph {
  if (guide.knowledge?.nodes?.length) return guide.knowledge;
  return buildKnowledgeGraph(guide);
}

function neighbors(
  graph: KnowledgeGraph,
  id: string,
  kinds?: KnowledgeEdge["kind"][],
): string[] {
  return graph.edges
    .filter((edge) => {
      if (edge.from !== id && edge.to !== id) return false;
      if (kinds && !kinds.includes(edge.kind)) return false;
      return true;
    })
    .map((edge) => (edge.from === id ? edge.to : edge.from));
}

export function queryKnowledgeGraph(
  question: string,
  guide: SchemaGuide,
): KnowledgeGraph {
  const graph = guideKnowledge(guide);
  const q = question.toLowerCase();
  const tokens = tokensOf(question);
  const access = wantsAccess(question);
  const reset = wantsPasswordReset(question);
  const scored = graph.nodes.map((node) => {
    let score = 0;
    const hay = `${node.label} ${node.summary} ${node.tableId ?? ""}`.toLowerCase();
    for (const token of tokens) {
      if (hay.includes(token)) score += node.kind === "list" ? 3 : 2;
    }
    if (access && node.kind === "setting") score += 10;
    if (access && node.tableId && MEMBER.test(node.tableId)) score += 8;
    if (access && node.kind === "list" && node.tableId && isPeople({ id: node.tableId } as TableGuide)) {
      score += 3;
    }
    if (reset && node.kind === "secret") score += 12;
    if (reset && isSecretList(node.tableId)) score += 12;
    if (reset && node.kind === "list" && node.tableId && isPeople({ id: node.tableId } as TableGuide)) {
      score += 2;
    }
    if (/sign(?:s)?\s*up|register|account/.test(q) && node.tableId && PEOPLE.test(node.tableId)) {
      score += 8;
    }
    if (/checkout|purchase|buy|order/.test(q) && /order/i.test(node.tableId ?? "")) {
      score += 8;
    }
    return { node, score };
  });

  const ranked = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const fallback =
    reset || access
      ? scored.filter(
          (item) =>
            item.node.kind === "secret" ||
            item.node.kind === "setting" ||
            isSecretList(item.node.tableId) ||
            (item.node.kind === "list" &&
              item.node.tableId &&
              isPeople({ id: item.node.tableId } as TableGuide)),
        )
      : [];
  const seeds = (ranked.length ? ranked : fallback)
    .slice(0, access || reset ? 4 : 2)
    .map((item) => item.node.id);

  const keep = new Set<string>(seeds);
  const hopKinds: KnowledgeEdge["kind"][] = access
    ? ["controls", "remembers"]
    : reset
      ? ["remembers", "belongs-to"]
      : ["belongs-to", "has-many"];

  for (const seed of seeds) {
    for (const next of neighbors(graph, seed, hopKinds)) {
      keep.add(next);
    }
  }

  if (access) {
    for (const node of graph.nodes) {
      if (node.kind === "setting") keep.add(node.id);
      if (node.tableId && MEMBER.test(node.tableId)) keep.add(node.id);
    }
  }
  if (reset) {
    for (const node of graph.nodes) {
      if (node.kind === "secret") keep.add(node.id);
      if (isSecretList(node.tableId)) keep.add(node.id);
    }
    for (const id of [...keep]) {
      const node = graph.nodes.find((item) => item.id === id);
      if (!node) continue;
      if (node.kind === "secret" || isSecretList(node.tableId)) continue;
      if (node.kind === "list" && node.tableId && PEOPLE.test(node.tableId)) {
        continue;
      }
      keep.delete(id);
    }
  }

  const nodes = graph.nodes.filter((node) => keep.has(node.id)).slice(0, 8);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .filter((edge, index, all) => {
      if (edge.kind === "belongs-to" && all.some((other) => other.kind === "has-many" && other.from === edge.to && other.to === edge.from)) {
        return false;
      }
      return true;
    })
    .slice(0, 10);

  return { nodes, edges };
}

export function explainKnowledgeGraph(
  question: string,
  guide: SchemaGuide,
  slice: KnowledgeGraph,
): SchemaAskResult {
  const access = wantsAccess(question);
  const reset = wantsPasswordReset(question);
  const lists = slice.nodes.filter((node) => node.kind === "list");
  const settings = slice.nodes.filter((node) => node.kind === "setting");
  const secrets = slice.nodes.filter(
    (node) => node.kind === "secret" || isSecretList(node.tableId),
  );
  const controls = slice.edges.filter((edge) => edge.kind === "controls");
  const tableIds = [...new Set(lists.map((node) => node.tableId).filter(Boolean))] as string[];

  if (reset && secrets.length === 0) {
    const people = lists.find((node) => node.tableId && PEOPLE.test(node.tableId));
    return {
      answer: people
        ? `This app keeps ${people.label.toLowerCase()}, but nothing here stores a password or a reset token. From what we read, there is no way to reset a password.`
        : "Nothing here stores a password or a reset token, so we cannot see a way to reset a password.",
      tableIds: people?.tableId ? [people.tableId] : [],
      files: [],
      walkthrough: [
        {
          step: 1,
          text: "We looked for a password, reset token, or login-secret link.",
          tableId: people?.tableId ?? null,
          file: null,
          origin: "heuristic",
        },
        {
          step: 2,
          text: "Nothing like that is connected yet. The app would need a new secret to reset a password.",
          tableId: null,
          file: null,
          origin: "heuristic",
        },
      ],
      graph: slice,
    };
  }

  if (reset) {
    const secret = secrets[0]!;
    const people = lists.find((node) => node.tableId && PEOPLE.test(node.tableId));
    return {
      answer: `To reset a password, the app would change the secret on ${secret.label.toLowerCase()}${
        people ? `, which belongs to ${people.label.toLowerCase()}` : ""
      }. That is the only password link we found.`,
      tableIds: [...new Set([secret.tableId, people?.tableId].filter(Boolean))] as string[],
      files: [],
      walkthrough: [
        {
          step: 1,
          text: secret.summary,
          tableId: secret.tableId,
          file: null,
          origin: "heuristic",
        },
        {
          step: 2,
          text: people
            ? `That secret belongs to ${people.label.toLowerCase()}.`
            : "Then the person can sign in with the new secret.",
          tableId: people?.tableId ?? null,
          file: null,
          origin: "heuristic",
        },
      ],
      graph: slice,
    };
  }

  if (access && settings.length === 0 && controls.length === 0) {
    const people = lists.find((node) => node.tableId && PEOPLE.test(node.tableId));
    return {
      answer: people
        ? `This app keeps ${people.label.toLowerCase()}, but nothing here records a role, permission, or who is allowed. From what we read, there is no way to restrict a person.`
        : "Nothing here records a role or permission, so we cannot see a way to restrict someone.",
      tableIds: people?.tableId ? [people.tableId] : [],
      files: [],
      walkthrough: [
        {
          step: 1,
          text: "We looked for a lock, role, or membership link.",
          tableId: people?.tableId ?? null,
          file: null,
          origin: "heuristic",
        },
        {
          step: 2,
          text: "Nothing like that is connected yet. The app would need a new setting to restrict people.",
          tableId: null,
          file: null,
          origin: "heuristic",
        },
      ],
      graph: slice,
    };
  }

  if (access) {
    const walkthrough: SchemaAskStep[] = [];
    if (controls.length) {
      for (const edge of controls.slice(0, 3)) {
        const from = slice.nodes.find((node) => node.id === edge.from);
        const to = slice.nodes.find((node) => node.id === edge.to);
        if (!from || !to) continue;
        walkthrough.push({
          step: walkthrough.length + 1,
          text: `${from.label} ${edge.label} on ${to.label.toLowerCase()}.`,
          tableId: from.tableId ?? to.tableId,
          file: null,
          origin: "heuristic",
        });
      }
    }
    for (const setting of settings.slice(0, 2)) {
      walkthrough.push({
        step: walkthrough.length + 1,
        text: `${setting.summary}`,
        tableId: setting.tableId,
        file: null,
        origin: "heuristic",
      });
    }
    const names = [...new Set([
      ...controls.map((edge) => slice.nodes.find((node) => node.id === edge.from)?.label),
      ...settings.map((node) => node.label),
    ].filter(Boolean))].slice(0, 2);
    return {
      answer: `To restrict someone, follow ${names.join(" and ") || "the membership links"} on the map. That is the only place this app records who belongs or what they may do.`,
      tableIds,
      files: [],
      walkthrough: walkthrough.slice(0, 4),
      graph: slice,
    };
  }

  const main = lists[0];
  if (!main) {
    return {
      answer: "We could not match that question to a list in this app.",
      tableIds: [],
      files: [],
      walkthrough: [],
      graph: slice,
    };
  }

  const walkthrough: SchemaAskStep[] = [
    {
      step: 1,
      text: main.summary,
      tableId: main.tableId,
      file: null,
      origin: "heuristic",
    },
  ];
  const fromMain = slice.edges.filter((edge) => edge.from === main.id || edge.to === main.id);
  for (const edge of fromMain.slice(0, 2)) {
    const other = slice.nodes.find(
      (node) => node.id === (edge.from === main.id ? edge.to : edge.from),
    );
    if (!other) continue;
    walkthrough.push({
      step: walkthrough.length + 1,
      text: `${main.label} ${edge.label} ${other.label.toLowerCase()}.`,
      tableId: other.tableId,
      file: null,
      origin: "heuristic",
    });
  }

  return {
    answer: `${main.summary} That lives in the list of ${main.label.toLowerCase()}.`,
    tableIds,
    files: [],
    walkthrough,
    graph: slice,
  };
}
