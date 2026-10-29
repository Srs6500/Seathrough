import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type { IndexedSymbol, RepoIndex } from "@/lib/data-flow/types";
import {
  emptyIndex,
  lineOf,
  snippetAround,
  symbolId,
  tokenize,
} from "@/lib/data-flow/stacks/shared";

const GIN_CHI_ECHO =
  /\.(GET|Get|POST|Post|PUT|Put|PATCH|Patch|DELETE|Delete|HEAD|Head|OPTIONS|Options)\(\s*"([^"]+)"/g;
const NET_HTTP =
  /(?:HandleFunc|Handle)\(\s*"([^"]+)"/g;

function looksLikeGo(files: RepoSourceFile[]): boolean {
  return files.some(
    (f) =>
      f.path.endsWith(".go") &&
      /(net\/http|gin-gonic|go-chi|labstack\/echo|HandleFunc|\.(GET|POST|PUT|PATCH|DELETE)\()/.test(
        f.content,
      ),
  );
}

export function buildGoIndex(files: RepoSourceFile[]): RepoIndex {
  if (!looksLikeGo(files)) return emptyIndex([]);

  const symbols: IndexedSymbol[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".go")) continue;

    GIN_CHI_ECHO.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GIN_CHI_ECHO.exec(file.content)) !== null) {
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
        tokens: tokenize(file.path, route, method, "go"),
        route,
        names: [method],
      });
    }

    NET_HTTP.lastIndex = 0;
    while ((m = NET_HTTP.exec(file.content)) !== null) {
      const route = m[1]!.startsWith("/") ? m[1]! : `/${m[1]!}`;
      const line = lineOf(file.content, m.index);
      symbols.push({
        id: symbolId("api", file.path, `HANDLE:${route}`),
        kind: "api",
        title: `HANDLE ${route}`,
        path: file.path,
        startLine: line,
        endLine: line + 4,
        snippet: snippetAround(file.content, line, line + 6),
        tokens: tokenize(file.path, route, "go", "http"),
        route,
        names: ["HANDLE"],
      });
    }
  }

  return {
    frameworkOk: symbols.length > 0,
    warnings:
      symbols.length === 0
        ? ["Go files found, but no HTTP route registrations were parsed."]
        : [],
    symbols,
    edges: [],
    frameworks: symbols.length ? ["go"] : [],
  };
}
