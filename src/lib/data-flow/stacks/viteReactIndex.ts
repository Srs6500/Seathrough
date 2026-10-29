import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type { IndexedSymbol, RepoIndex } from "@/lib/data-flow/types";
import {
  emptyIndex,
  lineOf,
  snippetAround,
  symbolId,
  tokenize,
} from "@/lib/data-flow/stacks/shared";

const ROUTE_JSX = /<Route\b[^>]*\bpath=\{?['"`]([^'"`]+)['"`]/g;
const ROUTE_OBJ = /\bpath:\s*['"`]([^'"`]+)['"`]/g;

function looksLikeViteReact(files: RepoSourceFile[]): boolean {
  const hasNextPage = files.some((f) =>
    /(^|\/)app\/(?:.+\/)?page\.(tsx|jsx|ts|js)$/.test(f.path),
  );
  if (hasNextPage) return false;
  const hasVite = files.some(
    (f) =>
      /(^|\/)vite\.config\.(ts|js|mts|mjs)$/.test(f.path) ||
      (f.path.endsWith("package.json") &&
        /"vite"|@vitejs\/plugin-react/.test(f.content)),
  );
  const hasReactRouter = files.some((f) =>
    /react-router|createBrowserRouter|<Route\b/.test(f.content),
  );
  const hasAppTsx = files.some((f) => /(^|\/)src\/App\.(tsx|jsx)$/.test(f.path));
  return hasVite || hasReactRouter || hasAppTsx;
}

export function buildViteReactIndex(files: RepoSourceFile[]): RepoIndex {
  if (!looksLikeViteReact(files)) return emptyIndex([]);

  const symbols: IndexedSymbol[] = [];
  const seen = new Set<string>();

  function addPage(path: string, route: string, index: number, content: string) {
    const key = `${path}:${route}`;
    if (seen.has(key)) return;
    seen.add(key);
    const line = lineOf(content, index);
    symbols.push({
      id: symbolId("page", path, route),
      kind: "page",
      title: `Page ${route === "/" ? "home" : route}`,
      path,
      startLine: line,
      endLine: line + 8,
      snippet: snippetAround(content, line, line + 10),
      tokens: tokenize(path, route, "react"),
      route,
      names: [route],
    });
  }

  for (const file of files) {
    if (!/\.(tsx|jsx|ts|js)$/.test(file.path)) continue;
    const usesRouter = /react-router|createBrowserRouter|<Route\b/.test(
      file.content,
    );
    if (usesRouter) {
      ROUTE_JSX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ROUTE_JSX.exec(file.content)) !== null) {
        const route = m[1]!.startsWith("/") ? m[1]! : `/${m[1]!}`;
        addPage(file.path, route, m.index, file.content);
      }
      if (/createBrowserRouter|createRoutesFromElements/.test(file.content)) {
        ROUTE_OBJ.lastIndex = 0;
        while ((m = ROUTE_OBJ.exec(file.content)) !== null) {
          const route = m[1]!.startsWith("/") ? m[1]! : `/${m[1]!}`;
          addPage(file.path, route, m.index, file.content);
        }
      }
    }

    if (/(^|\/)src\/App\.(tsx|jsx)$/.test(file.path) && symbols.length === 0) {
      addPage(file.path, "/", 0, file.content);
    }

    const pagesFile = file.path.match(/(^|\/)src\/pages\/(.+)\.(tsx|jsx)$/);
    if (pagesFile) {
      const rel = pagesFile[2]!.replace(/\/index$/, "");
      const route = rel === "index" || rel === "home" ? "/" : `/${rel}`;
      addPage(file.path, route, 0, file.content);
    }

    if (
      /(^|\/)(components|ui|features)\//.test(file.path) &&
      /\.(tsx|jsx)$/.test(file.path)
    ) {
      const name = file.path.split("/").pop()?.replace(/\.(tsx|jsx)$/, "") || file.path;
      symbols.push({
        id: symbolId("component", file.path, name),
        kind: "component",
        title: name,
        path: file.path,
        startLine: 1,
        endLine: 20,
        snippet: snippetAround(file.content, 1, 20),
        tokens: tokenize(file.path, name),
        names: [name],
      });
    }
  }

  return {
    frameworkOk: symbols.length > 0,
    warnings:
      symbols.length === 0
        ? ["React/Vite files found, but no routes or pages were parsed."]
        : [],
    symbols,
    edges: [],
    frameworks: symbols.length ? ["react"] : [],
  };
}
