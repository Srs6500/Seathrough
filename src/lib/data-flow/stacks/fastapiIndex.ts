import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type { IndexedSymbol, RepoIndex } from "@/lib/data-flow/types";
import {
  emptyIndex,
  lineOf,
  snippetAround,
  symbolId,
  tokenize,
} from "@/lib/data-flow/stacks/shared";

const DECORATOR_RE =
  /@(\w+)\.(get|post|put|patch|delete|options|head)\(\s*['"]([^'"]+)['"]/gi;
const ROUTER_PREFIX_RE =
  /(\w+)\s*=\s*APIRouter\((?:[\s\S]*?prefix\s*=\s*['"]([^'"]+)['"])?/g;

function looksLikeFastapi(files: RepoSourceFile[]): boolean {
  return files.some(
    (f) =>
      f.path.endsWith(".py") &&
      (/from\s+fastapi\s+import|import\s+fastapi|FastAPI\s*\(/.test(f.content) ||
        /@(?:app|router)\.(get|post|put|patch|delete)\(/.test(f.content)),
  );
}

export function buildFastapiIndex(files: RepoSourceFile[]): RepoIndex {
  if (!looksLikeFastapi(files)) return emptyIndex([]);

  const prefixes = new Map<string, string>();
  for (const file of files) {
    if (!file.path.endsWith(".py")) continue;
    ROUTER_PREFIX_RE.lastIndex = 0;
    let p: RegExpExecArray | null;
    while ((p = ROUTER_PREFIX_RE.exec(file.content)) !== null) {
      if (p[1] && p[2]) prefixes.set(p[1], p[2]);
    }
  }

  const symbols: IndexedSymbol[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".py")) continue;
    DECORATOR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DECORATOR_RE.exec(file.content)) !== null) {
      const owner = m[1]!;
      const method = m[2]!.toUpperCase();
      let route = m[3]!;
      if (prefixes.has(owner)) {
        const prefix = prefixes.get(owner)!.replace(/\/$/, "");
        route = `${prefix}${route.startsWith("/") ? route : `/${route}`}`;
      }
      if (!route.startsWith("/")) route = `/${route}`;
      const line = lineOf(file.content, m.index);
      symbols.push({
        id: symbolId("api", file.path, `${method}:${route}`),
        kind: "api",
        title: `${method} ${route}`,
        path: file.path,
        startLine: line,
        endLine: line + 6,
        snippet: snippetAround(file.content, line, line + 8),
        tokens: tokenize(file.path, route, method, "fastapi"),
        route,
        names: [method],
      });
    }
  }

  return {
    frameworkOk: symbols.length > 0,
    warnings:
      symbols.length === 0
        ? ["FastAPI files found, but no @app/@router handlers were parsed."]
        : [],
    symbols,
    edges: [],
    frameworks: symbols.length ? ["fastapi"] : [],
  };
}
