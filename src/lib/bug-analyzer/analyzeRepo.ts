import { buildNextIndex } from "@/lib/data-flow/nextIndex";
import type { RepoSourceFile } from "@/lib/data-flow/repoFiles";
import type { FlowNodeKind } from "@/lib/data-flow/types";

export type AnalyzedFunction = {
  name: string;
  kind: "export" | "http-handler" | "component" | "local";
  path: string;
  startLine: number;
  endLine: number;
  signature: string;
};

export type AnalyzedApiRoute = {
  route: string;
  methods: string[];
  path: string;
  startLine: number;
  endLine: number;
  handlers: AnalyzedFunction[];
};

export type AnalyzedFile = {
  path: string;
  role: FlowNodeKind | "config" | "other";
  summary: string;
  exportCount: number;
};

export type RepoAnalysis = {
  fullName: string;
  ref: string;
  frameworkOk: boolean;
  framework: "nextjs-ts" | "unknown";
  fileCount: number;
  truncated: boolean;
  warnings: string[];
  apiRoutes: AnalyzedApiRoute[];
  functions: AnalyzedFunction[];
  files: AnalyzedFile[];
  pages: Array<{ route: string; path: string; title: string }>;
  components: Array<{ name: string; path: string; startLine: number }>;
};

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function lineOf(content: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function endLineFromMatch(
  content: string,
  startIndex: number,
  matched: string,
): number {
  const start = lineOf(content, startIndex);
  const extras = matched.split("\n").length - 1;
  return start + extras;
}

/** Extract named functions / exports with approximate line spans. */
export function extractFunctions(
  path: string,
  content: string,
): AnalyzedFunction[] {
  const out: AnalyzedFunction[] = [];
  const seen = new Set<string>();

  const patterns: Array<{
    re: RegExp;
    kind: AnalyzedFunction["kind"];
    nameFrom: (m: RegExpExecArray) => string;
  }> = [
    {
      re: /export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g,
      kind: "export",
      nameFrom: (m) => m[1]!,
    },
    {
      re: /export\s+function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g,
      kind: "export",
      nameFrom: (m) => m[1]!,
    },
    {
      re: /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
      kind: "export",
      nameFrom: (m) => m[1]!,
    },
    {
      re: /export\s+default\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g,
      kind: "export",
      nameFrom: (m) => m[1]!,
    },
    {
      re: /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g,
      kind: "local",
      nameFrom: (m) => m[1]!,
    },
  ];

  for (const { re, kind, nameFrom } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = nameFrom(m);
      const key = `${name}@${m.index}`;
      if (seen.has(`${name}:${lineOf(content, m.index)}`)) continue;
      seen.add(`${name}:${lineOf(content, m.index)}`);
      const params = (m[2] ?? "").replace(/\s+/g, " ").trim();
      const startLine = lineOf(content, m.index);
      const fnKind: AnalyzedFunction["kind"] = HTTP_METHODS.has(name)
        ? "http-handler"
        : /^[A-Z]/.test(name) && /\.(tsx|jsx)$/.test(path)
          ? "component"
          : kind;
      out.push({
        name,
        kind: fnKind,
        path,
        startLine,
        endLine: endLineFromMatch(content, m.index, m[0]!),
        signature: `${name}(${params})`.slice(0, 120),
      });
      void key;
    }
  }

  return out;
}

function fileRole(
  path: string,
  kindFromIndex: FlowNodeKind | undefined,
): AnalyzedFile["role"] {
  if (kindFromIndex) return kindFromIndex;
  if (/(^|\/)(next\.config|package\.json|tsconfig)/i.test(path)) return "config";
  return "other";
}

function summarizeFile(
  role: AnalyzedFile["role"],
  path: string,
  exportCount: number,
): string {
  if (role === "api") return `API route handler (${exportCount} export${exportCount === 1 ? "" : "s"})`;
  if (role === "page") return "Next.js page";
  if (role === "component") return `UI component (${exportCount} export${exportCount === 1 ? "" : "s"})`;
  if (role === "database") return "Database / data access";
  if (role === "lib") return `Library module (${exportCount} export${exportCount === 1 ? "" : "s"})`;
  if (role === "config") return "Project config";
  return path.split("/").pop() || path;
}

/**
 * Parse a Next.js/TS repo snapshot into API routes, functions, and relevant files.
 */
export function analyzeNextRepo(input: {
  fullName: string;
  ref: string;
  files: RepoSourceFile[];
  truncated: boolean;
}): RepoAnalysis {
  const { fullName, ref, files, truncated } = input;
  const index = buildNextIndex(files);
  const byPath = new Map(files.map((f) => [f.path, f]));

  const allFunctions: AnalyzedFunction[] = [];
  for (const file of files) {
    if (!/\.(tsx?|jsx?)$/.test(file.path)) continue;
    allFunctions.push(...extractFunctions(file.path, file.content));
  }

  const apiSymbols = index.symbols.filter((s) => s.kind === "api");
  const apiRoutes: AnalyzedApiRoute[] = apiSymbols.map((s) => {
    const fileFns = allFunctions.filter((f) => f.path === s.path);
    const handlers = fileFns.filter((f) => f.kind === "http-handler");
    const methods =
      handlers.length > 0
        ? [...new Set(handlers.map((h) => h.name))]
        : s.names.filter((n) => HTTP_METHODS.has(n));
    return {
      route: s.route || s.title,
      methods: methods.length ? methods : ["?"],
      path: s.path,
      startLine: s.startLine,
      endLine: s.endLine,
      handlers: handlers.length ? handlers : fileFns.filter((f) => f.kind === "export"),
    };
  });

  // Dedupe API by path
  const apiByPath = new Map<string, AnalyzedApiRoute>();
  for (const route of apiRoutes) {
    const prev = apiByPath.get(route.path);
    if (!prev) {
      apiByPath.set(route.path, route);
      continue;
    }
    prev.methods = [...new Set([...prev.methods, ...route.methods])];
    prev.handlers = [...prev.handlers, ...route.handlers];
  }

  const pathKind = new Map<string, FlowNodeKind>();
  for (const s of index.symbols) {
    if (!pathKind.has(s.path) || s.kind === "api" || s.kind === "page") {
      pathKind.set(s.path, s.kind);
    }
  }

  const relevantPaths = new Set<string>();
  for (const s of index.symbols) relevantPaths.add(s.path);
  for (const f of allFunctions) {
    if (f.kind === "http-handler" || f.kind === "export" || f.kind === "component") {
      relevantPaths.add(f.path);
    }
  }
  // Always include package.json / next.config when present
  for (const file of files) {
    if (
      file.path === "package.json" ||
      /(^|\/)next\.config\.(js|mjs|ts)$/.test(file.path) ||
      file.path.endsWith("tsconfig.json")
    ) {
      relevantPaths.add(file.path);
    }
  }

  const analyzedFiles: AnalyzedFile[] = [...relevantPaths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => {
      const role = fileRole(path, pathKind.get(path));
      const exportCount = allFunctions.filter(
        (f) => f.path === path && (f.kind === "export" || f.kind === "http-handler"),
      ).length;
      return {
        path,
        role,
        summary: summarizeFile(role, path, exportCount),
        exportCount,
      };
    });

  const pages = index.symbols
    .filter((s) => s.kind === "page")
    .map((s) => ({
      route: s.route || "/",
      path: s.path,
      title: s.title,
    }));

  const components = index.symbols
    .filter((s) => s.kind === "component")
    .map((s) => ({
      name: s.names[0] || s.title,
      path: s.path,
      startLine: s.startLine,
    }));

  // Prefer meaningful functions: handlers, exports, components — skip tiny locals unless few exports
  const functions = allFunctions
    .filter(
      (f) =>
        f.kind === "http-handler" ||
        f.kind === "export" ||
        f.kind === "component",
    )
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.startLine - b.startLine,
    );

  void byPath;

  return {
    fullName,
    ref,
    frameworkOk: index.frameworkOk,
    framework: index.frameworkOk ? "nextjs-ts" : "unknown",
    fileCount: files.length,
    truncated,
    warnings: index.warnings,
    apiRoutes: [...apiByPath.values()].sort((a, b) =>
      a.route.localeCompare(b.route),
    ),
    functions,
    files: analyzedFiles,
    pages,
    components,
  };
}
