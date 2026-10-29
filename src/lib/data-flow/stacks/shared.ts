import type { IndexedEdge, IndexedSymbol, RepoIndex } from "@/lib/data-flow/types";

export function lineOf(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

export function snippetAround(
  content: string,
  startLine: number,
  endLine: number,
): string {
  const lines = content.split("\n");
  const from = Math.max(0, startLine - 1);
  const to = Math.min(lines.length, endLine);
  return lines.slice(from, to).join("\n").slice(0, 280);
}

export function tokenize(...parts: string[]): string[] {
  const set = new Set<string>();
  for (const part of parts) {
    for (const token of part
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((t) => t.length > 2)) {
      set.add(token);
    }
  }
  return [...set];
}

export function symbolId(kind: string, path: string, name?: string): string {
  const base = `${kind}:${path}${name ? `#${name}` : ""}`;
  return base.toLowerCase().replace(/[^a-z0-9:/._#-]+/g, "-");
}

export function dirnameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

export function emptyIndex(warnings: string[]): RepoIndex {
  return { frameworkOk: false, warnings, symbols: [], edges: [] };
}

export function mergeIndexes(parts: RepoIndex[]): RepoIndex {
  const symbols: IndexedSymbol[] = [];
  const edges: IndexedEdge[] = [];
  const warnings: string[] = [];
  const seenSym = new Set<string>();
  const seenEdge = new Set<string>();
  const frameworks: string[] = [];

  for (const part of parts) {
    if (!part.symbols.length && !part.frameworkOk) {
      continue;
    }
    warnings.push(...part.warnings);
    if (part.frameworks) frameworks.push(...part.frameworks);
    for (const s of part.symbols) {
      if (seenSym.has(s.id)) continue;
      seenSym.add(s.id);
      symbols.push(s);
    }
    for (const e of part.edges) {
      const key = `${e.fromId}->${e.toId}:${e.label ?? ""}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push(e);
    }
  }

  return {
    frameworkOk: symbols.length > 0,
    warnings: [...new Set(warnings)].filter(Boolean),
    symbols,
    edges,
    frameworks: [...new Set(frameworks)],
  };
}
