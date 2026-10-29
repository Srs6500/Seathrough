import { primaryFramework } from "@/lib/data-flow/indexRepo";
import type { RepoIndex } from "@/lib/data-flow/types";
import type { FlowEdge, FlowMapResult, FlowNode } from "@/lib/data-flow/types";

function questionTokens(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "how",
  "does",
  "what",
  "where",
  "when",
  "why",
  "with",
  "from",
  "this",
  "that",
  "into",
  "about",
  "show",
  "me",
  "please",
  "code",
  "flow",
  "data",
  "through",
  "works",
  "work",
  "happens",
  "happen",
]);

function scoreSymbol(
  tokens: string[],
  symbol: RepoIndex["symbols"][number],
): number {
  if (tokens.length === 0) return 0;
  let score = 0;
  const bag = new Set(symbol.tokens);
  for (const t of tokens) {
    if (bag.has(t)) score += 3;
    if (symbol.path.toLowerCase().includes(t)) score += 2;
    if (symbol.title.toLowerCase().includes(t)) score += 2;
    if (symbol.route?.toLowerCase().includes(t)) score += 4;
    if (symbol.names.some((n) => n.toLowerCase().includes(t))) score += 3;
  }
  // Prefer page → component → api → database order for UX
  const kindBoost: Record<string, number> = {
    page: 1.2,
    component: 1,
    api: 1.1,
    database: 1.15,
    lib: 0.6,
    other: 0.4,
  };
  return score * (kindBoost[symbol.kind] ?? 1);
}

/**
 * Pick a question-relevant subgraph and order it as a readable flow.
 * Uncertain links stay marked as guesses.
 */
export function buildFlowFromQuestion(input: {
  index: RepoIndex;
  question: string;
  fullName: string;
  ref: string;
  fileCount: number;
  truncated: boolean;
  priorNodeIds?: string[];
}): FlowMapResult {
  const {
    index,
    question,
    fullName,
    ref,
    fileCount,
    truncated,
    priorNodeIds,
  } = input;

  if (!index.frameworkOk) {
    return {
      fullName,
      ref,
      framework: primaryFramework(index),
      question,
      fileCount,
      truncated,
      warnings: index.warnings,
      nodes: [],
      edges: [],
    };
  }

  const tokens = questionTokens(question);
  const scored = index.symbols
    .map((s) => ({ s, score: scoreSymbol(tokens, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = new Set<string>();

  // Follow-up: keep prior seeds
  for (const id of priorNodeIds ?? []) {
    if (index.symbols.some((s) => s.id === id)) selected.add(id);
  }

  // Seed from top matches (prefer diversity of kinds)
  const kindSeen = new Set<string>();
  for (const { s, score } of scored) {
    if (selected.size >= 8) break;
    if (score < 3 && selected.size > 0) break;
    if (kindSeen.has(s.kind) && score < 6 && selected.size >= 3) continue;
    selected.add(s.id);
    kindSeen.add(s.kind);
  }

  // If question empty-ish, seed a short demo path: first page → imports → api → db
  if (selected.size === 0) {
    const page = index.symbols.find((s) => s.kind === "page");
    if (page) selected.add(page.id);
    else {
      const api = index.symbols.find((s) => s.kind === "api");
      if (api) selected.add(api.id);
    }
  }

  // Expand along edges (BFS, depth 3)
  const adj = new Map<string, string[]>();
  for (const e of index.edges) {
    if (!adj.has(e.fromId)) adj.set(e.fromId, []);
    if (!adj.has(e.toId)) adj.set(e.toId, []);
    adj.get(e.fromId)!.push(e.toId);
    adj.get(e.toId)!.push(e.fromId);
  }

  const queue = [...selected];
  const depth = new Map<string, number>([...selected].map((id) => [id, 0]));
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    if (d >= 3) continue;
    for (const next of adj.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, d + 1);
      selected.add(next);
      queue.push(next);
      if (selected.size > 28) break;
    }
    if (selected.size > 28) break;
  }

  // Prefer including database nodes connected to selected APIs
  for (const e of index.edges) {
    if (!selected.has(e.fromId) && !selected.has(e.toId)) continue;
    const a = index.symbols.find((s) => s.id === e.fromId);
    const b = index.symbols.find((s) => s.id === e.toId);
    if (a?.kind === "api" && b?.kind === "database") selected.add(b.id);
    if (b?.kind === "api" && a?.kind === "database") selected.add(a.id);
  }

  const nodes: FlowNode[] = index.symbols
    .filter((s) => selected.has(s.id))
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      summary:
        s.route != null
          ? `${s.kind} · ${s.route}`
          : `${s.kind} · ${s.path}`,
      span: {
        path: s.path,
        startLine: s.startLine,
        endLine: s.endLine,
        snippet: s.snippet,
      },
      certainty: "confirmed" as const,
    }));

  const edges: FlowEdge[] = index.edges
    .filter((e) => selected.has(e.fromId) && selected.has(e.toId))
    .map((e, i) => ({
      id: `e${i}:${e.fromId}->${e.toId}`,
      from: e.fromId,
      to: e.toId,
      label: e.label,
      certainty: e.certainty,
      reason: e.reason,
    }));

  // Heuristic guess chain when we have page + api but no edge: soft-link by tokens
  const pages = nodes.filter((n) => n.kind === "page");
  const apis = nodes.filter((n) => n.kind === "api");
  const comps = nodes.filter((n) => n.kind === "component");
  const dbs = nodes.filter((n) => n.kind === "database");

  const hasEdge = (a: string, b: string) =>
    edges.some(
      (e) =>
        (e.from === a && e.to === b) || (e.from === b && e.to === a),
    );

  for (const page of pages) {
    for (const comp of comps) {
      if (hasEdge(page.id, comp.id)) continue;
      const shared = questionTokens(page.title + " " + comp.title);
      if (shared.length === 0 && tokens.length > 0) continue;
      // Only guess if both scored for the question
      const pageScore = scored.find((x) => x.s.id === page.id)?.score ?? 0;
      const compScore = scored.find((x) => x.s.id === comp.id)?.score ?? 0;
      if (pageScore < 3 || compScore < 3) continue;
      edges.push({
        id: `guess:${page.id}->${comp.id}`,
        from: page.id,
        to: comp.id,
        label: "uses?",
        certainty: "guess",
        reason:
          "No import/fetch edge found; guessed because both match the question.",
      });
    }
  }

  for (const comp of [...comps, ...pages]) {
    for (const api of apis) {
      if (hasEdge(comp.id, api.id)) continue;
      const compScore = scored.find((x) => x.s.id === comp.id)?.score ?? 0;
      const apiScore = scored.find((x) => x.s.id === api.id)?.score ?? 0;
      if (compScore < 3 || apiScore < 3) continue;
      edges.push({
        id: `guess:${comp.id}->${api.id}`,
        from: comp.id,
        to: api.id,
        label: "calls?",
        certainty: "guess",
        reason:
          "No confirmed API call string; guessed from question relevance.",
      });
    }
  }

  for (const api of apis) {
    for (const db of dbs) {
      if (hasEdge(api.id, db.id)) continue;
      edges.push({
        id: `guess:${api.id}->${db.id}`,
        from: api.id,
        to: db.id,
        label: "persists?",
        certainty: "guess",
        reason:
          "No confirmed DB link; guessed because both appear in the selected flow.",
      });
    }
  }

  const warnings = [...index.warnings];
  if (nodes.length === 0) {
    warnings.push(
      "No matching pages, components, or API routes for that question.",
    );
  }
  const guessCount = edges.filter((e) => e.certainty === "guess").length;
  if (guessCount > 0) {
    warnings.push(
      `${guessCount} connection${guessCount === 1 ? "" : "s"} marked as guess — click an edge label for why.`,
    );
  }

  return {
    fullName,
    ref,
    framework: primaryFramework(index),
    question,
    fileCount,
    truncated,
    warnings,
    nodes,
    edges,
  };
}
