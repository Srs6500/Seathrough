import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type { IndexedSymbol, RepoIndex } from "@/lib/data-flow/types";
import {
  emptyIndex,
  lineOf,
  snippetAround,
  symbolId,
  tokenize,
} from "@/lib/data-flow/stacks/shared";

const METHOD_RE =
  /\b(?:app|router|r|server)\.(get|post|put|patch|delete|options|head|all)\(\s*['"`]([^'"`]+)['"`]/gi;

function looksLikeExpress(files: RepoSourceFile[]): boolean {
  return files.some((f) => {
    if (!/\.(ts|js|mjs|cjs)$/.test(f.path) || f.path.endsWith(".d.ts")) {
      return false;
    }
    return (
      /\bfrom\s+['"]express['"]|\brequire\(\s*['"]express['"]|from\s+['"]fastify['"]|from\s+['"]koa['"]/.test(
        f.content,
      ) ||
      /\b(?:app|router|r|server)\.(get|post|put|patch|delete|options|head|all)\(\s*['"`]/.test(
        f.content,
      )
    );
  });
}

export function buildExpressIndex(files: RepoSourceFile[]): RepoIndex {
  if (!looksLikeExpress(files)) {
    return emptyIndex([]);
  }

  const symbols: IndexedSymbol[] = [];
  for (const file of files) {
    if (!/\.(ts|js|mjs|cjs)$/.test(file.path) || file.path.endsWith(".d.ts")) {
      continue;
    }
    METHOD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = METHOD_RE.exec(file.content)) !== null) {
      const method = m[1]!.toUpperCase();
      const route = m[2]!.startsWith("/") ? m[2]! : `/${m[2]!}`;
      const line = lineOf(file.content, m.index);
      symbols.push({
        id: symbolId("api", file.path, `${method}:${route}`),
        kind: "api",
        title: `${method} ${route}`,
        path: file.path,
        startLine: line,
        endLine: line + 4,
        snippet: snippetAround(file.content, line, line + 6),
        tokens: tokenize(file.path, route, method, "express"),
        route,
        names: [method],
      });
    }
  }

  return {
    frameworkOk: symbols.length > 0,
    warnings:
      symbols.length === 0
        ? ["Express/Fastify-style files found, but no route handlers were parsed."]
        : [],
    symbols,
    edges: [],
    frameworks: symbols.length ? ["express"] : [],
  };
}
